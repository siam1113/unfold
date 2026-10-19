import type { Page, Locator } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import {
  hash,
  fingerprint,
  normalizeUrl,
  stableText,
  expression,
  redact,
} from "../../analysis/src/index.js";
import type {
  LocatorCandidate,
  Observation,
  ScanConfig,
  RestoreRecipe,
  UIElement,
  Component,
} from "../../shared/src/index.js";
import { artifactRoot } from "../../storage/src/index.js";
export function locator(page: Page, c: LocatorCandidate): Locator {
  const root = c.scope ? page.locator(c.scope) : page;
  switch (c.kind) {
    case "role":
      return root.getByRole(c.value as Parameters<Page["getByRole"]>[0], {
        name: c.name,
        exact: true,
      });
    case "label":
      return root.getByLabel(c.value, { exact: true });
    case "testId":
      return root.getByTestId(c.value);
    case "placeholder":
      return root.getByPlaceholder(c.value, { exact: true });
    case "text":
      return root.getByText(c.value, { exact: true });
    default:
      return root.locator(c.value);
  }
}
export async function verify(
  page: Page,
  candidates: LocatorCandidate[],
  restored = false,
): Promise<LocatorCandidate[]> {
  return Promise.all(
    candidates.map(async (c) => {
      try {
        const l = locator(page, c);
        const count = await l.count();
        const valid = count === 1 && (await l.isVisible());
        return {
          ...c,
          uniqueAtDiscovery: restored ? c.uniqueAtDiscovery : valid,
          verifiedAfterRestore: restored ? valid : c.verifiedAfterRestore,
          score: valid ? c.score : Math.min(15, c.score),
          reasons: [
            ...new Set([
              ...c.reasons,
              valid
                ? "Resolves to one visible element"
                : `Resolves to ${count} elements or is hidden`,
            ]),
          ],
          failures: valid
            ? c.failures
            : [
                ...c.failures,
                restored
                  ? "Did not resolve after restoration"
                  : "Ambiguous or hidden at discovery",
              ],
        };
      } catch {
        return {
          ...c,
          score: 0,
          uniqueAtDiscovery: restored ? c.uniqueAtDiscovery : false,
          verifiedAfterRestore: restored ? false : c.verifiedAfterRestore,
          failures: [...c.failures, "Invalid selector"],
        };
      }
    }),
  );
}
/**
 * `timeoutMs` (default 0 — preserves the original instant-check behavior
 * for every existing caller that doesn't pass it) polls the candidates
 * every ~200ms until one resolves or the deadline passes, instead of
 * giving up after a single check. That single check was the real bug
 * behind a `LOCATOR_UNREACHABLE` fired the instant a page's `load` event
 * fires but before a client-rendered SPA has actually mounted its content —
 * `page.setDefaultTimeout()` (what a verification run's `actionTimeoutMs`
 * sets, packages/verification/src/runner.ts) only extends Playwright's own
 * built-in auto-wait for actions like `.click()`/`.fill()`, which this
 * function never calls — `.count()`/`.isVisible()`/`.isEnabled()` are
 * immediate, non-waiting Locator queries no timeout setting affects. A
 * caller that wants its configured action timeout to actually cover "wait
 * for the target to exist" has to pass it here explicitly (see
 * packages/capability-runtime/src/replay.ts).
 */
export async function resolveTarget(
  page: Page,
  candidates: LocatorCandidate[],
  timeoutMs = 0,
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
      const l = locator(page, c);
      try {
        if (
          (await l.count()) === 1 &&
          (await l.isVisible()) &&
          (await l.isEnabled())
        )
          return l;
      } catch {
        /* try next candidate */
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(200, remaining));
  }
  throw new Error("LOCATOR_UNREACHABLE: no unique visible enabled candidate");
}
// A fill or click resolves its own Playwright promise the instant the DOM
// event dispatches, but the page's own JS reacting to that event — a
// controlled-input re-render, a debounced validator that enables the submit
// button, a password manager writing back into the field — runs on a later
// tick. Starting the next step's actionability check immediately can race
// that settle, which is how a fast scripted run (e.g. the Auth tool) ends up
// clicking "submit" before the password field has actually registered its
// value. apps/extension/src/replay.ts's in-page replay engine already waits
// this long after every step for the same reason; this mirrors it for the
// Playwright-driven engines (capability replay, workflow/auth steps).
export const ACTION_SETTLE_MS = 150;
export async function settleAfterAction(page: Page) {
  await page.waitForTimeout(ACTION_SETTLE_MS).catch(() => {});
}
/**
 * Performs one interaction against an already-resolved locator using an
 * explicit value rather than a `valueKey` lookup, so callers outside the
 * discovery worker (e.g. a capability replay) can supply agent-provided
 * input directly.
 */
export async function performAction(
  target: Locator,
  action: string,
  value?: string,
) {
  if (action === "fill" || action === "select") {
    if (value === undefined) throw new Error("MISSING_SYNTHETIC_VALUE");
    if (action === "select") await target.selectOption(value);
    else await target.fill(value);
  } else if (action === "hover") await target.hover();
  else await target.click();
  await settleAfterAction(target.page());
}
// Node-side network-idle tracking, keyed by Page so concurrent crawls (each
// with their own page/context) never cross-count. Additive: Playwright lets
// multiple listeners share one event, so this sits alongside — never
// replaces — the bookkeeping listeners packages/worker/src/index.ts's
// attach() already has for apiCalls/recordBrowserEvent.
const inFlight = new WeakMap<Page, { count: number }>();
// "websocket"/"eventsource" are long-lived by design (a live socket that
// never closes would mean network never looks idle); "ping" is a
// fire-and-forget analytics beacon nobody is waiting on. Everything else
// (document/xhr/fetch/script/stylesheet/image/font/...) counts.
const COUNTED_RESOURCE_TYPES = new Set([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "manifest",
  "signedexchange",
  "preflight",
  "other",
]);
export function trackPageRequests(page: Page) {
  const state = { count: 0 };
  inFlight.set(page, state);
  const relevant = (req: { resourceType(): string }) =>
    COUNTED_RESOURCE_TYPES.has(req.resourceType());
  page.on("request", (req) => {
    if (relevant(req)) state.count++;
  });
  const release = (req: { resourceType(): string }) => {
    if (relevant(req)) state.count = Math.max(0, state.count - 1);
  };
  page.on("requestfinished", release);
  page.on("requestfailed", release);
}
async function waitForNetworkIdle(page: Page, quietMs: number) {
  const capMs = Math.max(1000, quietMs * 4);
  const start = Date.now();
  let quietSince: number | undefined;
  while (Date.now() - start < capMs) {
    const count = inFlight.get(page)?.count ?? 0;
    if (count === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else {
      quietSince = undefined;
    }
    await new Promise((r) => setTimeout(r, Math.min(50, quietMs)));
  }
}
// Waits for DOM mutations, running Web Animations, and visible busy/progress
// indicators to all go quiet together — any one of them resets the clock,
// same as a mutation always has. Capped so a page with persistent animation
// or a permanently-busy widget still returns instead of hanging forever.
async function waitForDomQuiet(page: Page, ms: number) {
  await page
    .evaluate(async (delay) => {
      await new Promise<void>((resolve) => {
        let quiet: ReturnType<typeof setTimeout>;
        const activityPresent = () =>
          document.getAnimations().some((a) => a.playState === "running") ||
          document.querySelector(
            '[aria-busy="true"], [role="progressbar"]:not([aria-valuenow])',
          ) !== null;
        const done = () => {
          clearTimeout(quiet);
          clearTimeout(cap);
          clearInterval(poll);
          observer.disconnect();
          resolve();
        };
        const bump = () => {
          clearTimeout(quiet);
          quiet = setTimeout(done, delay);
        };
        const observer = new MutationObserver(bump);
        const poll = setInterval(
          () => {
            if (activityPresent()) bump();
          },
          Math.min(100, delay),
        );
        const cap = setTimeout(done, Math.max(1000, delay * 4));
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        quiet = setTimeout(done, delay);
      });
    }, ms)
    .catch(() => {});
}
export async function stabilize(page: Page, ms: number) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 3000 })
    .catch(() => {});
  // A click→fetch→render sequence settles in one round. The loop exists so
  // that if rendering the response kicks off a new request (pagination,
  // lazy images), we wait that out too, rather than declaring stable the
  // instant the DOM happens to go quiet between rounds. Bounded at 3 rounds
  // so a page with truly persistent background activity still returns.
  for (let round = 0; round < 3; round++) {
    await waitForNetworkIdle(page, ms);
    await waitForDomQuiet(page, ms);
    if ((inFlight.get(page)?.count ?? 0) === 0) return;
  }
}
/**
 * stabilize() + observe(), but doesn't trust the first scan: network-idle
 * and DOM-quiet are both proxies for "done rendering," and a transient
 * loading/processing indicator can keep toggling after both go quiet (seen
 * in production — an unnamed overlay flickering a handful of anonymous
 * elements in and out after the network settled). Re-observes until two
 * consecutive scans agree on the same fingerprint, bounded the same way
 * stabilize() bounds its own rounds, so a page with a permanently-live
 * widget still returns instead of hanging forever. The two throwaway scans
 * skip screenshot capture; only the final, agreed-upon observation pays for
 * it.
 */
export async function settle(
  page: Page,
  runId: string,
  config: ScanConfig,
  recipe: RestoreRecipe,
  depth: number,
  worker: number,
  provenanceActionId?: string,
  browserTabId?: string,
  browserTabParentId?: string,
): Promise<Observation> {
  await stabilize(page, config.settleMs);
  const probeConfig = { ...config, captureScreenshots: false };
  let obs = await observe(page, runId, probeConfig, recipe, depth, worker);
  for (let round = 0; round < 3; round++) {
    await new Promise((r) => setTimeout(r, config.settleMs));
    const next = await observe(page, runId, probeConfig, recipe, depth, worker);
    const stable = next.state.fingerprint === obs.state.fingerprint;
    obs = next;
    if (stable) break;
  }
  // The polling rounds above always skip screenshot capture, so only pay
  // for a final real observe() when the caller actually wants one — most
  // call sites (recipe-replay steps, the LLM-recovery loop) pass
  // captureScreenshots: false already and can just reuse the last round.
  if (!config.captureScreenshots) {
    obs.state.provenanceActionId = provenanceActionId;
    obs.state.browserTabId = browserTabId;
    obs.state.browserTabParentId = browserTabParentId;
    return obs;
  }
  return observe(
    page,
    runId,
    config,
    recipe,
    depth,
    worker,
    provenanceActionId,
    browserTabId,
    browserTabParentId,
  );
}
export async function observe(
  page: Page,
  runId: string,
  config: ScanConfig,
  recipe: RestoreRecipe,
  depth: number,
  worker: number,
  provenanceActionId?: string,
  browserTabId?: string,
  browserTabParentId?: string,
): Promise<Observation> {
  const raw = await page.evaluate(
    (syntheticValues) => {
      // Flattened list of every reachable render root — the document plus
      // every open shadow root nested anywhere inside it. Web-component UIs
      // (Angular Elements, etc.) render their real content behind one of
      // these, which plain document.querySelectorAll never sees; every
      // query below goes through queryAll() so it's found regardless of
      // which shadow root it lives in. Closed shadow roots stay opaque by
      // design — JS has no handle on them, only CDP-level access would do.
      const shadowRootsOf = (root: ParentNode): ShadowRoot[] => {
        const found: ShadowRoot[] = [];
        for (const el of Array.from(root.querySelectorAll("*"))) {
          if (el.shadowRoot) {
            found.push(el.shadowRoot);
            found.push(...shadowRootsOf(el.shadowRoot));
          }
        }
        return found;
      };
      const roots: ParentNode[] = [document, ...shadowRootsOf(document)];
      const queryAll = (selector: string): Element[] =>
        roots.flatMap((r) => Array.from(r.querySelectorAll(selector)));
      const modal = queryAll("dialog:modal")[0] as Element | undefined;
      const visible = (e: Element) => {
        if (e.closest("[data-private],[data-sensitive]")) return false;
        const closed = e.closest("details:not([open])");
        if (
          closed &&
          e !== closed &&
          !closed.querySelector("summary")?.contains(e)
        )
          return false;
        if (modal && !modal.contains(e) && !e.contains(modal)) return false;
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        if (
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= innerHeight &&
          r.right <= innerWidth
        ) {
          const top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          if (
            top &&
            top !== e &&
            !e.contains(top) &&
            top.closest("dialog,[role=dialog],[data-drawer],[role=menu]")
          )
            return false;
        }
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          !e.closest('[aria-hidden="true"],[inert]')
        );
      };
      const text = (e: Element | null) =>
        e
          ? (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180)
          : "";
      const name = (e: Element) =>
        e.getAttribute("aria-label") ||
        (e.getAttribute("aria-labelledby") || "")
          .split(" ")
          .map((id) => text(document.getElementById(id)))
          .filter(Boolean)
          .join(" ") ||
        (e instanceof HTMLInputElement ||
        e instanceof HTMLTextAreaElement ||
        e instanceof HTMLSelectElement
          ? Array.from(e.labels || [])
              .map(text)
              .join(" ")
          : "") ||
        e.getAttribute("alt") ||
        e.getAttribute("title") ||
        text(e);
      const css = (e: Element): string => {
        if (e.getAttribute("data-testid"))
          return `[data-testid=${JSON.stringify(e.getAttribute("data-testid"))}]`;
        if (e.id && !/[0-9]{4,}|[a-f0-9]{8,}|:r/.test(e.id))
          return "#" + CSS.escape(e.id);
        let p = e.tagName.toLowerCase();
        const siblings = e.parentElement
          ? Array.from(e.parentElement.children).filter(
              (s) => s.tagName === e.tagName,
            )
          : [];
        if (siblings.length > 1)
          p += `:nth-of-type(${siblings.indexOf(e) + 1})`;
        if (e.parentElement && e.parentElement.tagName !== "BODY")
          return css(e.parentElement) + " > " + p;
        // Top of an open shadow tree (no light-DOM parent left to climb) —
        // keep going through the host so the path still crosses the shadow
        // boundary. Playwright's own CSS engine pierces shadow roots when
        // resolving this selector later, so losing the host here would
        // otherwise produce a selector with no idea which shadow tree it's in.
        const root = e.getRootNode();
        return root instanceof ShadowRoot ? css(root.host) + " > " + p : p;
      };
      const semantic =
        'header,nav,main,form,dialog,table,[role="dialog"],[role="navigation"],[role="toolbar"],[role="menu"],article,[data-component],[data-drawer]';
      const containers = queryAll(semantic).filter(visible);
      // Repeated siblings need matching structure, meaningful content and a visible layout boundary.
      const shape = (e: Element, depth = 0): string =>
        `${e.tagName.toLowerCase()}:${e.getAttribute("role") || ""}${
          depth < 3
            ? "[" +
              Array.from(e.children)
                .map((child) => shape(child, depth + 1))
                .join(",") +
              "]"
            : ""
        }`;
      const repeated = new Map<Element, { family: string; count: number }>();
      for (const parent of queryAll("main,section,ul,ol,div,tbody")) {
        const groups = new Map<string, Element[]>();
        for (const child of Array.from(parent.children)) {
          if (
            !child.matches("div,li,tr,article,section") ||
            !visible(child) ||
            child.children.length < 2
          )
            continue;
          if (!child.querySelector("h2,h3,h4,a,button,input,td,[role=button]"))
            continue;
          const box = child.getBoundingClientRect();
          if (box.width < 80 || box.height < 24) continue;
          const key = shape(child);
          groups.set(key, [...(groups.get(key) || []), child]);
        }
        for (const [family, members] of groups)
          if (members.length >= 3) {
            for (const member of members) {
              repeated.set(member, { family, count: members.length });
              if (!containers.includes(member)) containers.push(member);
            }
          }
      }
      const containerFor = (element: Element | null) => {
        for (let e = element; e; e = e.parentElement)
          if (containers.includes(e)) return e;
        return null;
      };
      const regions = queryAll(
        'dialog,[role="dialog"],[data-drawer],[role="menu"],[role="tooltip"],form,[role="tab"][aria-selected="true"],details[open]',
      )
        .filter(visible)
        .map(
          (e) =>
            `${e.hasAttribute("data-drawer") ? "drawer" : e.matches('dialog,[role="dialog"]') ? "dialog" : e.getAttribute("role") || e.tagName.toLowerCase()}:${name(e).slice(0, 90)}`,
        );
      const semanticInteractive = queryAll(
        'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"],[role="menuitem"],[role="combobox"],[aria-haspopup],[data-tooltip],[tabindex="0"]',
      );
      const semanticSet = new Set<Element>(semanticInteractive);
      // Not every clickable control carries semantic markup — custom
      // component libraries, legacy UI toolkits, bespoke internal widgets
      // all render controls however they like, with no button/role/
      // tabindex/cursor convention to rely on. Rather than guess which
      // conventions a given app follows, consider literally every element
      // on the page a candidate, scoped only by structure (a plausible
      // control-sized leaf, not a wrapper duplicating a control already
      // found) rather than by how "interactive" it looks. decide() still
      // gates every candidate identically regardless of how it was found —
      // this only widens what's offered for consideration, not what's
      // allowed to actually run.
      const pointerCandidates = queryAll("*").filter((e) => {
        if (semanticSet.has(e)) return false;
        for (const match of semanticSet) if (e.contains(match)) return false;
        if (
          e.querySelector(
            'a[href],button,input,select,textarea,[role="button"],[tabindex]',
          )
        )
          return false;
        const box = e.getBoundingClientRect();
        if (
          box.width < 4 ||
          box.height < 4 ||
          box.width > 400 ||
          box.height > 200
        )
          return false;
        return visible(e);
      });
      const els = semanticInteractive
        .concat(pointerCandidates)
        .filter(visible)
        .map((e) => {
          const tag = e.tagName.toLowerCase();
          const inputType = e.getAttribute("type") || "";
          const role =
            e.getAttribute("role") ||
            {
              a: "link",
              button: "button",
              select: "combobox",
              textarea: "textbox",
              summary: "button",
            }[tag] ||
            (tag === "input"
              ? ["button", "submit", "reset"].includes(inputType)
                ? "button"
                : inputType === "checkbox"
                  ? "checkbox"
                  : inputType === "radio"
                    ? "radio"
                    : "textbox"
              : // A non-semantic match with no role attribute — treated as
                // a button, the same default the underlying click action
                // would assume anyway.
                "button");
          const parent = containerFor(e),
            box = e.getBoundingClientRect();
          const isFormControl =
            e instanceof HTMLInputElement ||
            e instanceof HTMLTextAreaElement ||
            e instanceof HTMLSelectElement ||
            e instanceof HTMLButtonElement;
          const form = isFormControl ? e.form : null;
          const formIndex = form
            ? Array.from(document.forms).indexOf(form)
            : -1;
          const formId = form
            ? form.id || `observed-form-${formIndex + 1}`
            : undefined;
          const validationControl =
            e instanceof HTMLInputElement ||
            e instanceof HTMLTextAreaElement ||
            e instanceof HTMLSelectElement
              ? e
              : undefined;
          const validity = validationControl?.validity;
          return {
            tag,
            role,
            name: name(e),
            text: text(e),
            css: css(e),
            testId: e.getAttribute("data-testid"),
            placeholder: e.getAttribute("placeholder"),
            label:
              e instanceof HTMLInputElement ||
              e instanceof HTMLTextAreaElement ||
              e instanceof HTMLSelectElement
                ? Array.from(e.labels || [])
                    .map(text)
                    .join(" ")
                : "",
            href: e instanceof HTMLAnchorElement ? e.href : undefined,
            inputType,
            valueState:
              syntheticValues.some((v) => v.label === name(e)) &&
              (e instanceof HTMLInputElement ||
                e instanceof HTMLTextAreaElement ||
                e instanceof HTMLSelectElement)
                ? syntheticValues.some(
                    (v) => v.label === name(e) && v.value === e.value,
                  )
                  ? ("configured" as const)
                  : ("pending" as const)
                : undefined,
            expanded:
              e.getAttribute("aria-expanded") ??
              (tag === "summary"
                ? String(e.parentElement?.hasAttribute("open"))
                : undefined),
            selected: e.getAttribute("aria-selected") ?? undefined,
            hasPopup:
              e.getAttribute("aria-haspopup") ??
              (e.hasAttribute("data-tooltip") ? "tooltip" : undefined),
            controls: e.getAttribute("aria-controls") ?? undefined,
            disabled: e.matches(':disabled,[aria-disabled="true"]'),
            isSubmit:
              (e instanceof HTMLButtonElement &&
                e.type === "submit" &&
                !!e.form) ||
              (e instanceof HTMLInputElement &&
                e.type === "submit" &&
                !!e.form),
            formId,
            formNoValidate:
              e instanceof HTMLButtonElement || e instanceof HTMLInputElement
                ? e.formNoValidate
                : undefined,
            validationEvidence: validity
              ? {
                  required: validationControl?.required ?? false,
                  ariaInvalid: e.getAttribute("aria-invalid") === "true",
                  cssInvalid: e.matches(":invalid"),
                  willValidate: validationControl?.willValidate ?? false,
                  valid: validity.valid,
                  valueMissing: validity.valueMissing,
                  typeMismatch: validity.typeMismatch,
                  patternMismatch: validity.patternMismatch,
                  tooLong: validity.tooLong,
                  tooShort: validity.tooShort,
                  rangeUnderflow: validity.rangeUnderflow,
                  rangeOverflow: validity.rangeOverflow,
                  stepMismatch: validity.stepMismatch,
                  badInput: validity.badInput,
                  customError: validity.customError,
                }
              : undefined,
            container: parent ? containers.indexOf(parent) : -1,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
          };
        });
      const components = containers.map((e) => ({
        name:
          e.getAttribute("aria-label") ||
          text(e.querySelector("h1,h2,h3,legend,caption")) ||
          e.getAttribute("data-component") ||
          e.tagName.toLowerCase(),
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute("role"),
        css: css(e),
        box: (() => {
          const box = e.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        })(),
        parent: containers.indexOf(containerFor(e.parentElement) as Element),
        repeated: repeated.get(e),
      }));
      const main = (document.querySelector("main") || document.body).cloneNode(
        true,
      ) as HTMLElement;
      main
        .querySelectorAll(
          'input,textarea,script,style,[data-private],[data-sensitive],[aria-hidden="true"],time',
        )
        .forEach((e) => e.remove());
      return {
        title: document.title,
        regions,
        els,
        components,
        mainText: main.textContent || "",
        links: queryAll("a[href]:not([download])")
          .filter(visible)
          .map((e) => (e as HTMLAnchorElement).href),
      };
    },
    config.formValues.filter((v) => v.route === new URL(page.url()).pathname),
  );
  const url = normalizeUrl(page.url(), config);
  const tokens = [
    ...raw.regions,
    ...raw.els.map(
      (e) =>
        `${e.role}:${stableText(e.name)}:expanded=${e.expanded}:selected=${e.selected}:disabled=${e.disabled}:submit=${e.isSubmit}:formNoValidate=${e.formNoValidate ?? "unknown"}${e.valueState ? `:value=${e.valueState}` : ""}${e.validationEvidence ? `:required=${e.validationEvidence.required}:ariaInvalid=${e.validationEvidence.ariaInvalid}:cssInvalid=${e.validationEvidence.cssInvalid}:willValidate=${e.validationEvidence.willValidate}:valid=${e.validationEvidence.valid}:validity=${[e.validationEvidence.valueMissing, e.validationEvidence.typeMismatch, e.validationEvidence.patternMismatch, e.validationEvidence.tooLong, e.validationEvidence.tooShort, e.validationEvidence.rangeUnderflow, e.validationEvidence.rangeOverflow, e.validationEvidence.stepMismatch, e.validationEvidence.badInput, e.validationEvidence.customError].map((flag) => Number(flag)).join("")}` : ""}`,
    ),
  ].sort();
  const fp = fingerprint(url, tokens, raw.mainText);
  const stateId = hash([runId, fp]);
  const candidates = (e: (typeof raw.els)[number]): LocatorCandidate[] => {
    const list: LocatorCandidate[] = [];
    const add = (
      kind: LocatorCandidate["kind"],
      value: string,
      score: number,
      name?: string,
      scope?: string,
    ) => {
      const c: LocatorCandidate = {
        kind,
        value,
        name,
        scope,
        score,
        uniqueAtDiscovery: false,
        verifiedAfterRestore: false,
        reasons: [
          kind === "css"
            ? "Structural CSS fallback"
            : "Semantic or stable attribute",
        ],
        failures: [],
        expression: "",
      };
      c.expression = expression(c);
      list.push(c);
    };
    if (e.role && e.name) add("role", e.role, 96, e.name);
    if (e.label) add("label", e.label, 95);
    if (e.testId) add("testId", e.testId, 93);
    if (e.placeholder) add("placeholder", e.placeholder, 85);
    if (e.container >= 0 && e.role && e.name)
      add("role", e.role, 88, e.name, raw.components[e.container].css);
    add("css", e.css, e.css.includes("nth-") ? 35 : 70);
    return list;
  };
  const elements: UIElement[] = await Promise.all(
    raw.els.map(async (e, index) => ({
      id: hash([stateId, index, e.css]),
      stateId,
      role: e.role,
      accessibleName: redact(e.name),
      tag: e.tag,
      textSnippet: redact(e.text),
      structuralSignature: hash([e.role, e.name, e.css]),
      containerId:
        e.container >= 0
          ? hash([stateId, "component", e.container])
          : undefined,
      locatorCandidates: await verify(page, candidates(e)),
      href: e.href ? normalizeUrl(e.href, config) : undefined,
      inputType: e.inputType,
      valueState: e.valueState,
      expanded: e.expanded,
      selected: e.selected,
      hasPopup: e.hasPopup,
      controls: e.controls,
      disabled: e.disabled,
      isSubmit: e.isSubmit,
      formId: e.formId,
      formNoValidate: e.formNoValidate,
      validationEvidence: e.validationEvidence,
      box: e.box,
    })),
  );
  const components: Component[] = await Promise.all(
    raw.components.map(async (c, index) => {
      const id = hash([stateId, "component", index]);
      const kind: Component["kind"] =
        c.role === "dialog" || c.tag === "dialog"
          ? "dialog"
          : c.role === "navigation" || c.tag === "nav"
            ? "navigation"
            : c.role === "toolbar"
              ? "toolbar"
              : c.tag === "article" || (c.repeated && c.tag !== "tr")
                ? "card"
                : ["header", "form", "table"].includes(c.tag)
                  ? (c.tag as Component["kind"])
                  : "custom";
      const candidate: LocatorCandidate = {
        kind: "css",
        value: c.css,
        expression: expression({ kind: "css", value: c.css }),
        uniqueAtDiscovery: false,
        verifiedAfterRestore: false,
        score: c.css.includes("nth-") ? 40 : 80,
        reasons: ["Semantic container root"],
        failures: [],
      };
      return {
        id,
        stateId,
        name: redact(c.name),
        familyId: c.repeated
          ? hash(["repeated", c.repeated.family])
          : undefined,
        kind,
        rootLocator: (await verify(page, [candidate]))[0],
        box: c.box,
        elementIds: elements
          .filter((e) => e.containerId === id)
          .map((e) => e.id),
        childComponentIds: raw.components.flatMap((child, j) =>
          child.parent === index ? [hash([stateId, "component", j])] : [],
        ),
        classificationEvidence: [
          ...(c.repeated
            ? [
                `Repeated DOM shape across ${c.repeated.count} visible siblings`,
                "Matching hierarchy, content and layout boundary",
              ]
            : [`Semantic ${c.tag} element`]),
          ...(c.role ? [`ARIA role: ${c.role}`] : []),
        ],
        confidence: c.repeated ? 0.82 : c.tag === "main" ? 0.8 : 0.94,
      };
    }),
  );
  let screenshotPath: string | undefined;
  if (config.captureScreenshots) {
    screenshotPath = `${runId}/evidence/screenshots/${stateId}.png`;
    const path = resolve(artifactRoot(), screenshotPath);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({
      path,
      fullPage: false,
      animations: "disabled",
      mask: config.redactSelectors.map((s) => page.locator(s)),
      maskColor: "#a2adbd",
    });
  }
  const u = new URL(url);
  return {
    state: {
      id: stateId,
      runId,
      url,
      routeKey: u.origin + u.pathname,
      fingerprint: fp,
      fingerprintVersion: 1,
      fingerprintReason:
        "Normalized URL, visible regions, control semantics and stable main content; conservative similarity fallback",
      structureTokens: tokens,
      title: redact(raw.title),
      visibleRegionSummary: raw.regions.map(redact),
      interactiveElementIds: elements.map((e) => e.id),
      screenshotPath,
      discoveredAt: new Date().toISOString(),
      depth,
      worker,
      browserTabId,
      browserTabParentId,
      recipe,
      mainText: stableText(raw.mainText),
      provenanceActionId,
    },
    elements,
    components,
    links: raw.links
      .filter((l) => /^https?:/.test(l))
      .map((l) => normalizeUrl(l, config)),
    observedAt: new Date().toISOString(),
  };
}
