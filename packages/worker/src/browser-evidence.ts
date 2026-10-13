import type { Browser, BrowserContext, Page } from "playwright";
import type { BrowserPageSnapshot } from "../../shared/src/index.js";

/**
 * Return a value-free snapshot of browser state around an action. Text is
 * examined only inside the browser to classify status messages; it never
 * crosses the page binding or gets persisted.
 */
export async function snapshotBrowserPage(
  page: Page,
  context: BrowserContext,
): Promise<BrowserPageSnapshot> {
  const pageFacts = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && element.getClientRects().length > 0;
    };
    const count = (selector: string) =>
      [...document.querySelectorAll(selector)].filter(visible).length;
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:not([type=hidden]), select, textarea",
    )].filter(visible);
    const invalidReasons: Record<string, number> = {
      valueMissing: 0,
      typeMismatch: 0,
      patternMismatch: 0,
      tooLong: 0,
      tooShort: 0,
      rangeUnderflow: 0,
      rangeOverflow: 0,
      stepMismatch: 0,
      badInput: 0,
      customError: 0,
    };
    let invalidFieldCount = 0;
    for (const field of fields) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) continue;
      if (!field.willValidate || field.validity.valid) continue;
      invalidFieldCount++;
      for (const reason of Object.keys(invalidReasons)) {
        if (field.validity[reason as keyof ValidityState]) invalidReasons[reason]++;
      }
    }
    const alerts = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].filter(visible);
    const statuses = [...document.querySelectorAll('[role="status"], [aria-live="polite"]')].filter(visible);
    const messageText = [...alerts, ...statuses]
      .map((element) => element.textContent || "")
      .join(" ")
      .slice(0, 12000)
      .toLowerCase();
    const authControls = [...document.querySelectorAll<HTMLElement>(
      'button, a, input[type="submit"], [role="button"]',
    )].filter(visible).map((element) => {
      // Text remains local to the page evaluation; only counts leave it.
      return `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.textContent || ""}`.toLowerCase();
    });
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    let localStorageEntryCount: number | undefined;
    let sessionStorageEntryCount: number | undefined;
    const navigationApi = (window as Window & { navigation?: { currentEntry?: { index: number } | null } }).navigation;
    const rawNavigationEntryIndex = navigationApi?.currentEntry?.index;
    try { localStorageEntryCount = window.localStorage.length; } catch { /* opaque origin */ }
    try { sessionStorageEntryCount = window.sessionStorage.length; } catch { /* opaque origin */ }
    return {
      navigationType: nav?.type === "navigate" || nav?.type === "reload" || nav?.type === "back_forward" ? nav.type : undefined,
      historyLength: Number.isSafeInteger(window.history.length) && window.history.length >= 0 ? window.history.length : undefined,
      navigationEntryIndex: typeof rawNavigationEntryIndex === "number" && Number.isSafeInteger(rawNavigationEntryIndex) && rawNavigationEntryIndex >= 0 ? rawNavigationEntryIndex : undefined,
      busyCount: count('[aria-busy="true"]'),
      alertCount: alerts.length,
      statusCount: statuses.length,
      emptyCueCount: count('[data-empty-state], [data-testid*="empty" i], [aria-label*="no results" i], [aria-label*="empty" i]'),
      successCueCount: Number(/\b(saved|success(?:ful)?|completed|created|updated|sent)\b/.test(messageText)),
      errorCueCount: Number(/\b(error|failed|invalid|required|denied|unable)\b/.test(messageText)),
      formCount: count("form"),
      fieldCount: fields.length,
      invalidFieldCount,
      invalidReasons,
      searchControlCount: count('input[type="search"], [role="searchbox"]'),
      filterControlCount: count('select, [role="combobox"], input[type="checkbox"], input[type="radio"]'),
      passwordControlCount: count('input[type="password"]'),
      identifierControlCount: count('input[type="email"], input[autocomplete="username"], input[autocomplete="email"]'),
      signInControlCount: authControls.filter((text) => /\b(sign in|log in|login|authenticate)\b/.test(text)).length,
      signOutControlCount: authControls.filter((text) => /\b(sign out|log out|logout)\b/.test(text)).length,
      resultItemCount: count('main [role="row"], main [role="listitem"], main article, main li'),
      localStorageEntryCount,
      sessionStorageEntryCount,
    };
  });
  const cookieFacts = await context.cookies().then((cookies) => ({
    cookieCount: cookies.length,
    secureCookieCount: cookies.filter((cookie) => cookie.secure).length,
    httpOnlyCookieCount: cookies.filter((cookie) => cookie.httpOnly).length,
    sessionCookieCount: cookies.filter((cookie) => cookie.expires <= 0).length,
  })).catch(() => ({}));
  return { ...pageFacts, ...cookieFacts } as BrowserPageSnapshot;
}

/**
 * Check that value-bearing Playwright storage state can be imported into an
 * isolated context, while returning only counts for the active origin.
 */
export async function probeIsolatedContextPersistence(
  browser: Browser,
  context: BrowserContext,
  pageUrl: string,
) {
  let isolated: BrowserContext | undefined;
  try {
    const origin = new URL(pageUrl).origin;
    const savedState = await context.storageState();
    const savedEntries = savedState.origins.find((item) => item.origin === origin)?.localStorage.length || 0;
    const savedCookies = (await context.cookies([origin])).length;
    isolated = await browser.newContext({ storageState: savedState, serviceWorkers: "block" });
    const restoredState = await isolated.storageState();
    const restoredEntries = restoredState.origins.find((item) => item.origin === origin)?.localStorage.length || 0;
    const restoredCookies = (await isolated.cookies([origin])).length;
    return {
      origin,
      localStorageEntryCount: savedEntries,
      restoredLocalStorageEntryCount: restoredEntries,
      cookieCount: savedCookies,
      restoredCookieCount: restoredCookies,
    };
  } catch {
    return undefined;
  } finally {
    await isolated?.close().catch(() => {});
  }
}
