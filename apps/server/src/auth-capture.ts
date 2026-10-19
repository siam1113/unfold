// Login session capture: a human logs into the target app in a fresh,
// isolated, visible browser window, and the resulting Playwright
// storageState() is saved to disk so it can be set as a discovery run's
// ScanConfig.authStatePath (packages/worker/src/index.ts already wires that
// path straight into browser.newContext({ storageState })).
//
// Deliberately separate from apps/server/src/browse-session.ts (same
// reasoning that file gives for being separate from Coordinator): AI
// Browse's "connect" mode attaches to the user's whole real Chrome profile
// and would export every cookie in it, not just the target app's — wrong
// for a credential-bearing file headed into artifacts/. Its "launch" mode is
// headless, driven only through chat + screenshot polling — typing a
// password into an LLM chat box is also wrong. This module instead mirrors
// apps/cli/src/index.ts's `auth` command: a throwaway isolated context in a
// real, visible browser window the user drives directly with their own
// mouse/keyboard, never through our UI.
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  artifactRoot,
  type Store,
} from "../../../packages/storage/src/index.js";
import type {
  AuthCapture,
  WorkflowStep,
} from "../../../packages/shared/src/index.js";

export class AuthCaptureConflictError extends Error {}

/** One raw event the in-page recorder reported, before it's turned into a `WorkflowStep` at capture-finish time. */
export interface RecordedEvent {
  kind: "click" | "fill";
  selector: string;
  value?: string;
  secret?: boolean;
}

/**
 * Turns the raw events `RECORDER_SCRIPT` reported into the project's
 * replayable login recipe — exported (pure, no browser/Store dependency) so
 * it's unit-testable on its own and reusable anywhere else a recorded
 * session needs converting, not just `captureAuthState`'s one call site.
 * Always prepends a synthetic navigate: `runSetupSteps` starts from a
 * totally blank page (packages/core/src/index.ts's Coordinator.start()
 * never calls page.goto() before its own setup steps run), so without this
 * the recorded clicks/fills alike would have no page to act on when
 * replayed standalone, even though the LIVE capture session they were
 * recorded from had its own .goto(baseUrl) already (outside the recorder).
 */
export function buildLoginSteps(
  baseUrl: string,
  recorded: RecordedEvent[],
): WorkflowStep[] {
  return [
    { type: "navigate", url: baseUrl },
    ...recorded.map(
      (event): WorkflowStep =>
        event.kind === "click"
          ? { type: "click", selector: event.selector }
          : {
              type: "fill",
              selector: event.selector,
              value: event.secret ? "" : (event.value ?? ""),
              secret: event.secret,
            },
    ),
  ];
}

interface AuthCaptureHandle {
  id: string;
  projectId: string;
  ownerId: string;
  browser: Browser;
  page: Page;
  // A later fill on the SAME selector (the user editing/retyping a field
  // before submitting) replaces, rather than piles onto, its earlier entry —
  // keyed by selector so order is still whatever `Map` insertion order gives
  // (first-touched position), with clicks interleaved by giving each one its
  // own unique key.
  recorded: Map<string, RecordedEvent>;
}

// Injected via page.addInitScript — Playwright re-runs this on every new
// document (including the login page itself, if reaching it navigates away
// from `baseUrl`), so the listeners survive the exact kind of full-page
// navigation a login flow usually involves. Deliberately minimal and
// self-contained (no dependency on packages/worker/src/observe.ts's
// locator-candidate machinery, which lives inside a much larger in-page
// closure not built for standalone reuse): a single data-testid/id/
// structural-path CSS selector is all `executeStep`'s `page.locator(selector)`
// needs, unlike discovery's own multi-candidate scoring.
export const RECORDER_SCRIPT = `(() => {
  if (window.__unfoldRecorderInstalled) return;
  window.__unfoldRecorderInstalled = true;
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return "";
    if (el.getAttribute("data-testid"))
      return '[data-testid="' + CSS.escape(el.getAttribute("data-testid")) + '"]';
    if (el.id && !/[0-9]{4,}|[a-f0-9]{8,}|:r/.test(el.id))
      return "#" + CSS.escape(el.id);
    let p = el.tagName.toLowerCase();
    const siblings = el.parentElement
      ? Array.from(el.parentElement.children).filter((s) => s.tagName === el.tagName)
      : [];
    if (siblings.length > 1) p += ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
    if (el.parentElement && el.parentElement.tagName !== "BODY")
      return cssPath(el.parentElement) + " > " + p;
    return p;
  };
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    const tag = target.tagName;
    // Focusing a text field by clicking into it isn't a meaningful step on
    // its own — the field's own "fill" event (below) already records the
    // action that matters. A checkbox/radio DOES need its click recorded,
    // since toggling one has no separate "fill" equivalent.
    if (
      (tag === "INPUT" &&
        !["checkbox", "radio"].includes(target.type || "")) ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    )
      return;
    const el = target.closest("button, a, [role=button], summary") || target;
    window.__unfoldRecordStep?.({ kind: "click", selector: cssPath(el) });
  }, true);
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type || "")) {
      window.__unfoldRecordStep?.({ kind: "click", selector: cssPath(el) });
      return;
    }
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
    const isPassword = el.type === "password";
    window.__unfoldRecordStep?.({
      kind: "fill",
      selector: cssPath(el),
      value: isPassword ? "" : el.value,
      secret: isPassword,
    });
  }, true);
})();`;

// In-memory liveness map, mirroring browse-session.ts's `live` pattern — the
// live Browser/Page handle can't be persisted across a process restart; the
// Store is the only durable record, and closeStaleAuthCaptures() reconciles
// it at startup.
const live = new Map<string, AuthCaptureHandle>();

export async function openAuthCapture(
  store: Store,
  projectId: string,
  ownerId: string,
  baseUrl: string,
): Promise<AuthCapture> {
  // One active capture per project at a time — two open windows against the
  // same project would just confuse whoever's clicking "I'm logged in".
  if ([...live.values()].some((handle) => handle.projectId === projectId))
    throw new AuthCaptureConflictError(
      "A login capture is already open for this project",
    );

  const id = randomUUID();
  store.createAuthCapture({
    id,
    projectId,
    ownerId,
    baseUrl,
    status: "open",
    loginSteps: [],
    createdAt: new Date().toISOString(),
  });

  let browser: Browser;
  let page: Page;
  const recorded = new Map<string, RecordedEvent>();
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
    });
    // A fresh, isolated context — never the user's real browser profile.
    const context = await browser.newContext();
    page = await context.newPage();
    let clickSeq = 0;
    await page.exposeFunction("__unfoldRecordStep", (event: RecordedEvent) => {
      if (!event.selector) return;
      // Clicks get a unique key each (there's no "the same click" to
      // replace), fills key on their selector so a later edit to the same
      // field replaces its earlier recording instead of piling up.
      recorded.set(
        event.kind === "click"
          ? `click:${clickSeq++}`
          : `fill:${event.selector}`,
        event,
      );
    });
    await page.addInitScript(RECORDER_SCRIPT);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (error) {
    return store.updateAuthCapture(
      id,
      {
        status: "failed",
        lastError:
          error instanceof Error
            ? `Could not open a browser window: ${error.message}`
            : "Could not open a browser window.",
      },
      ownerId,
    );
  }

  live.set(id, { id, projectId, ownerId, browser, page, recorded });
  page.once("close", () => {
    live.delete(id);
  });

  return store.updateAuthCapture(id, { status: "open" }, ownerId);
}

export async function captureAuthState(
  store: Store,
  id: string,
  ownerId: string,
): Promise<AuthCapture> {
  const handle = live.get(id);
  if (!handle) throw new Error("This login capture is no longer open");
  const capture = store.authCapture(id, ownerId);
  if (!capture) throw new Error("Auth capture not found");

  const state = await handle.page.context().storageState();
  const path = resolve(
    artifactRoot(),
    "projects",
    handle.projectId,
    `auth-state-${Date.now()}.json`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(state));
  await chmod(path, 0o600);

  const domains = new Set<string>();
  for (const cookie of state.cookies)
    domains.add(cookie.domain.replace(/^\./, ""));
  for (const origin of state.origins)
    try {
      domains.add(new URL(origin.origin).hostname);
    } catch {
      // Ignore an unparseable origin rather than failing the whole capture.
    }

  const loginSteps = buildLoginSteps(capture.baseUrl, [
    ...handle.recorded.values(),
  ]);

  live.delete(id);
  await handle.browser.close().catch(() => {});

  return store.updateAuthCapture(
    id,
    {
      status: "captured",
      path,
      cookieCount: state.cookies.length,
      domains: [...domains].sort(),
      capturedAt: new Date().toISOString(),
      loginSteps,
    },
    ownerId,
  );
}

export async function cancelAuthCapture(
  store: Store,
  id: string,
  ownerId: string,
): Promise<AuthCapture> {
  const handle = live.get(id);
  live.delete(id);
  if (handle) await handle.browser.close().catch(() => {});
  return store.updateAuthCapture(id, { status: "cancelled" }, ownerId);
}

export async function forgetAuthCapture(
  store: Store,
  id: string,
  ownerId: string,
): Promise<void> {
  const capture = store.authCapture(id, ownerId);
  if (capture?.path) await rm(capture.path, { force: true }).catch(() => {});
  const handle = live.get(id);
  live.delete(id);
  if (handle) await handle.browser.close().catch(() => {});
  store.deleteAuthCapture(id, ownerId);
}
