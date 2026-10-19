// A from-scratch, pure-browser-JS replay engine — no Node, no Playwright,
// no chrome.* dependency (this file is imported by content-main.ts, which
// runs in the page's own MAIN world and therefore can't reach chrome.*
// APIs at all). It deliberately does NOT reuse
// packages/worker/src/observe.ts's resolveTarget/performAction (those are
// built around a live Playwright `Page`/`Locator`, replaying *recorded*
// candidates against discovery-captured elements over CDP) — this instead
// re-derives the same LocatorCandidate semantics
// (packages/shared/src/index.ts's LocatorSchema) directly against the
// real DOM, confirmed empirically against packages/worker/src/observe.ts's
// `locator()` mapping:
//   testId      -> Playwright's getByTestId, i.e. the default
//                  `data-testid` attribute (no custom testIdAttribute is
//                  configured anywhere in this repo)
//   placeholder -> exact `placeholder` attribute match
//   text        -> exact, innermost-element text match
//   css         -> the value used directly as a CSS selector
//   role/label  -> NOT reproduced here (real ARIA accessible-name
//                  computation is what Playwright's getByRole/getByLabel
//                  do, which this file intentionally does not attempt to
//                  re-implement) — see isFlowSupported below.

export interface LocatorCandidateLike {
  kind: "role" | "label" | "testId" | "placeholder" | "text" | "css";
  value: string;
  name?: string;
  scope?: string;
  score: number;
}

export interface ReplayStep {
  action: "click" | "hover" | "fill" | "select";
  locators: LocatorCandidateLike[];
  inputField?: string;
}

export interface ReplayFlow {
  startUrl: string;
  steps: ReplayStep[];
  expectedRequest?: { method: string; urlPattern: string };
  expectedNavigation?: { urlPattern: string };
}

export interface ReplayOutcome {
  ok: boolean;
  verified: boolean;
  message: string;
}

/** Locator kinds this engine can resolve without approximating ARIA semantics. Deliberately excludes "role"/"label" — see this file's doc comment. */
const SUPPORTED_KINDS = new Set<LocatorCandidateLike["kind"]>([
  "css",
  "testId",
  "placeholder",
  "text",
]);

export function isStepSupported(step: ReplayStep): boolean {
  return step.locators.some((candidate) => SUPPORTED_KINDS.has(candidate.kind));
}

/** A flow is only offered as an executable tool if EVERY step can be resolved by this engine — never a partial, half-working registration. */
export function isFlowSupported(flow: ReplayFlow): boolean {
  return flow.steps.length > 0 && flow.steps.every(isStepSupported);
}

function queryByKind(candidate: LocatorCandidateLike): Element[] {
  const root: ParentNode =
    (candidate.scope && document.querySelector(candidate.scope)) || document;
  switch (candidate.kind) {
    case "css":
      try {
        return [...root.querySelectorAll(candidate.value)];
      } catch {
        return []; // an invalid/unsupported selector string — try the next candidate
      }
    case "testId":
      return [...root.querySelectorAll("[data-testid]")].filter(
        (el) => el.getAttribute("data-testid") === candidate.value,
      );
    case "placeholder":
      return [...root.querySelectorAll("[placeholder]")].filter(
        (el) => el.getAttribute("placeholder") === candidate.value,
      );
    case "text": {
      const all = [...root.querySelectorAll("*")];
      const exact = all.filter(
        (el) => (el.textContent ?? "").trim() === candidate.value.trim(),
      );
      // Prefer the innermost matching element(s) — mirrors Playwright's
      // getByText preferring the most specific element over an ancestor
      // that only "contains" the same text via that one child.
      return exact.filter(
        (el) => !exact.some((other) => other !== el && el.contains(other)),
      );
    }
    default:
      return [];
  }
}

function isVisible(el: Element): boolean {
  const withCheckVisibility = el as Element & {
    checkVisibility?: (options?: Record<string, boolean>) => boolean;
  };
  if (typeof withCheckVisibility.checkVisibility === "function") {
    try {
      return withCheckVisibility.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
    } catch {
      // fall through to the manual check below
    }
  }
  if (!(el instanceof HTMLElement)) return true;
  const style = getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  )
    return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEnabled(el: Element): boolean {
  if (
    (el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement) &&
    el.disabled
  )
    return false;
  return el.getAttribute("aria-disabled") !== "true";
}

/** Mirrors packages/worker/src/observe.ts's `resolveTarget`: highest-score candidate first, require exactly one visible+enabled match. */
function resolveElement(candidates: LocatorCandidateLike[]): Element {
  const supported = candidates.filter((c) => SUPPORTED_KINDS.has(c.kind));
  if (supported.length === 0)
    throw new Error(
      "UNSUPPORTED_LOCATOR: this step only has role/label locators, which this extension can't resolve reliably outside the verified Unfold environment.",
    );
  for (const candidate of [...supported].sort((a, b) => b.score - a.score)) {
    const matches = queryByKind(candidate);
    if (matches.length !== 1) continue;
    const [element] = matches;
    if (!isVisible(element) || !isEnabled(element)) continue;
    return element;
  }
  throw new Error(
    "LOCATOR_UNREACHABLE: no unique, visible, enabled element matched any locator for this step.",
  );
}

/**
 * Sets `value` via the element's real prototype setter before dispatching
 * `input`/`change` — bypassing any `value` setter a framework (React, in
 * particular) has overridden on the instance, which is the documented
 * workaround for synthetic-event-based controlled inputs
 * (facebook/react#11488). Without this exact sequence, a React-controlled
 * input silently ignores a plain `el.value = x` assignment.
 */
function fillElement(el: Element, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  throw new Error("UNSUPPORTED_FILL_TARGET");
}

function selectElement(el: Element, value: string): void {
  if (!(el instanceof HTMLSelectElement))
    throw new Error("UNSUPPORTED_SELECT_TARGET");
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(el: Element): void {
  if (el instanceof HTMLElement) el.click();
  else
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
}

function hoverElement(el: Element): void {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForNavigation(
  urlPattern: string,
  timeoutMs = 5000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (location.pathname === urlPattern) return true;
    await sleep(100);
  }
  return location.pathname === urlPattern;
}

/** One of a capability's `requiredCapabilityIds`, as embedded by `GET /api/extension/tools` (apps/server/src/index.ts) — `flow` is present only when that prerequisite is itself published (and thus safe/replayable client-side); otherwise `available` is false and there's nothing this engine can do but name it in the error. */
export interface RequiredFlowEntry {
  name: string;
  available: boolean;
  flow?: ReplayFlow;
}

/**
 * Attempts the capability's FIRST step's locator; if it can't resolve and
 * `requiredFlows` were declared, tries each one's full flow once (one level
 * only — never passes `requiredFlows` through to those nested
 * `replayInBrowser` calls, so a prerequisite's own prerequisites are never
 * consulted, which also makes an A<->B cycle harmless by construction),
 * then retries once more. Mirrors
 * packages/capability-runtime/src/replay.ts's `resolveFirstStepTarget` —
 * same one-level-only shape and same `PRECONDITION_UNMET: ...` message
 * format, duplicated rather than shared since this file is already an
 * intentional from-scratch reimplementation (see this file's top doc
 * comment) with no dependency on that package.
 */
async function resolveFirstStepTarget(
  locators: LocatorCandidateLike[],
  requiredFlows: RequiredFlowEntry[] | undefined,
): Promise<Element> {
  try {
    return resolveElement(locators);
  } catch (error) {
    if (!requiredFlows?.length) throw error;
    const attempts: string[] = [];
    for (const required of requiredFlows) {
      if (!required.available || !required.flow) {
        attempts.push(`"${required.name}" not available`);
        continue;
      }
      try {
        await replayInBrowser(required.flow, {});
        attempts.push(`"${required.name}": ok`);
      } catch (remediationError) {
        attempts.push(
          `"${required.name}": failed — ${
            remediationError instanceof Error
              ? remediationError.message
              : String(remediationError)
          }`,
        );
      }
    }
    try {
      return resolveElement(locators);
    } catch {
      const original = error instanceof Error ? error.message : String(error);
      throw new Error(
        `PRECONDITION_UNMET: ${original}; attempted prerequisite(s): ${attempts.join(", ")}`,
      );
    }
  }
}

/**
 * Performs every step, then reports completion honestly rather than
 * claiming a verification this engine can't actually perform:
 * `expectedNavigation` flows get a real check (poll `location.pathname`);
 * `expectedRequest` flows get NO network-completion check — deliberately
 * not implemented for v1 (monkey-patching `window.fetch`/XHR on an
 * arbitrary third-party page is a materially bigger risk than the rest of
 * this engine and was explicitly flagged as needing its own review before
 * shipping) — so those report `verified: false` with a clear note instead
 * of a false "yes, confirmed" the engine never actually checked.
 */
export async function replayInBrowser(
  flow: ReplayFlow,
  input: Record<string, unknown>,
  requiredFlows?: RequiredFlowEntry[],
): Promise<ReplayOutcome> {
  if (flow.steps.length === 0)
    return {
      ok: false,
      verified: false,
      message: "This capability has no steps.",
    };

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    let element: Element;
    try {
      element =
        i === 0
          ? await resolveFirstStepTarget(step.locators, requiredFlows)
          : resolveElement(step.locators);
    } catch (error) {
      return {
        ok: false,
        verified: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not resolve this step's target.",
      };
    }
    const value = step.inputField ? String(input[step.inputField] ?? "") : "";
    try {
      if (step.action === "fill") fillElement(element, value);
      else if (step.action === "select") selectElement(element, value);
      else if (step.action === "hover") hoverElement(element);
      else clickElement(element);
    } catch (error) {
      return {
        ok: false,
        verified: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not perform this step.",
      };
    }
    // Give a React re-render / client-side navigation a moment to settle
    // before the next step resolves its own locator against stale DOM.
    await sleep(150);
  }

  if (flow.expectedNavigation) {
    const verified = await waitForNavigation(
      flow.expectedNavigation.urlPattern,
    );
    return verified
      ? {
          ok: true,
          verified: true,
          message: `Navigated to ${flow.expectedNavigation.urlPattern}.`,
        }
      : {
          ok: true,
          verified: false,
          message: `Steps performed, but the page never navigated to ${flow.expectedNavigation.urlPattern}.`,
        };
  }
  if (flow.expectedRequest) {
    return {
      ok: true,
      verified: false,
      message:
        "Steps performed. Network completion isn't verified in this context — the extension doesn't intercept network traffic.",
    };
  }
  return {
    ok: true,
    verified: false,
    message:
      "Steps performed. This capability declared no proof of completion.",
  };
}
