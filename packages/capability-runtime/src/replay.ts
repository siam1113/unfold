import type { Page, Response as PlaywrightResponse } from "playwright";
import { performAction, resolveTarget } from "../../worker/src/observe.js";
import type { Capability, Flow } from "../../capability-core/src/types.js";

export interface ReplayResult {
  status: number;
  results: unknown;
}

/** What a `resolveRequiredFlow` callback resolves a required capability id to — everything `replayCapability` needs to replay it. */
export interface RequiredFlowResolution {
  capability: Capability;
  flow: Flow;
}

const normalize = (url: string) => new URL(url).href;

/**
 * Replays a mined Flow against a live page, substituting agent-supplied
 * `input` for the recorded fill value.
 *
 * Cross-document aware: a step's `requiresUrl` marks it as living behind a
 * full-page navigation. Before resolving such a step's locator, this waits
 * for the page to actually be on that URL (and for `domcontentloaded`),
 * rather than assuming the previous step's action already landed there.
 * When the step that triggers the navigation is itself identifiable (the
 * *next* step's `requiresUrl` differs from the current document), the wait
 * and the triggering action run concurrently via `Promise.all` — the same
 * pattern the final step already uses for its `waitForResponse` race — so
 * there's no gap where the navigation could complete without being
 * observed. Locators are never cached across a navigation: `resolveTarget`
 * is called fresh against the live `page` immediately before every action.
 */
export async function replayCapability(
  page: Page,
  capability: Capability,
  flow: Flow,
  input: Record<string, unknown>,
  // Invoked right before the final step's action fires — i.e. the instant
  // that actually triggers the flow's proof-of-success network call/
  // navigation. The verification runner (packages/verification/src/runner.ts)
  // uses this to stamp its correlation window's `action.createdAt` there
  // instead of before this whole function runs: a multi-step flow's setup
  // clicks/fills/navigations can themselves take seconds, and stamping the
  // window's start before them made even a correctly-matching response look
  // weakly/un-correlated by the time it arrived.
  onBeforeFinalAction?: () => void,
  // How long to wait for a cross-document navigation before giving up.
  // Exposed all the way up to the verification wizard's UI
  // (apps/dashboard/src/flow-verification-wizard.tsx) since a slow real app
  // can need more than the old hardcoded 10s. Kept distinct from
  // `expectTimeoutMs` below — a flow can navigate quickly but still take a
  // while to fire its proof-of-success call, or vice versa.
  navigationTimeoutMs = 10_000,
  // How long to wait for the final step's proof-of-success response
  // (`waitForOutcome` below) before giving up.
  expectTimeoutMs = 10_000,
  // Resolves one of `capability.requiredCapabilityIds` to its capability+flow,
  // so the FIRST step (index 0, or the lone step of a single-step flow) can
  // attempt that prerequisite's full flow once before giving up — e.g.
  // "continue shopping from cart" only has a resolvable target once "go to
  // cart" has already navigated there. Omitted (the common case: Stage F's
  // probe, the extension's own nested calls) means no remediation is
  // attempted; a first-step failure is reported as-is. Passed through as
  // `undefined` to the nested `replayCapability` call below, which hard-caps
  // remediation at one level — a required capability's own
  // `requiredCapabilityIds` are never consulted, so A<->B cycles are
  // harmless by construction.
  resolveRequiredFlow?: (
    capabilityId: string,
  ) => Promise<RequiredFlowResolution | undefined>,
  // Fired right before each step's action runs (setup steps and the final
  // step alike) — lets a caller that needs to report *where* a replay
  // failed (packages/mcp/src/app-server.ts's AppMCP tool-call handler) know
  // which step was in flight when an error was thrown, without this
  // function itself needing to know anything about how that's reported.
  onStepStart?: (step: {
    index: number;
    action: Flow["steps"][number]["action"];
    requiresUrl?: string;
  }) => void,
  // How long `resolveTarget` polls for a step's target to actually become
  // resolvable before giving up (LOCATOR_UNREACHABLE) — covers a client-
  // rendered SPA that's still mounting content after `page.goto()`'s `load`
  // event already fired. Exposed so a verification run's configured
  // `actionTimeoutMs` (packages/verification/src/runner.ts) genuinely
  // extends this wait, not just Playwright's own built-in auto-wait for
  // the action itself (which `resolveTarget` never goes through — see its
  // own doc comment, packages/worker/src/observe.ts).
  targetTimeoutMs = 5_000,
): Promise<ReplayResult> {
  if (page.url() !== flow.startUrl) await page.goto(flow.startUrl);

  const ensureOnUrl = async (requiresUrl: string | undefined) => {
    if (!requiresUrl) return;
    if (normalize(page.url()) === normalize(requiresUrl)) return;
    await page.waitForURL(requiresUrl, { timeout: navigationTimeoutMs });
    await page.waitForLoadState("domcontentloaded");
  };

  // Only ever used for the capability's FIRST step (index 0 below, or the
  // lone step of a single-step flow at the bottom of this function) — a
  // mid-flow step failing to resolve is a different, already-well-handled
  // error class (a real locator/selector problem partway through an
  // otherwise-correctly-reached flow) and shouldn't trigger a full
  // precondition replay.
  const resolveFirstStepTarget = async (
    locators: Flow["steps"][number]["locators"],
  ) => {
    try {
      return await resolveTarget(page, locators, targetTimeoutMs);
    } catch (error) {
      // `?? []` guards a capability object reaching here without this field
      // at all (e.g. one read from a stale compiled server process, from
      // before this field existed) rather than assuming it's always set.
      const requiredCapabilityIds = capability.requiredCapabilityIds ?? [];
      if (!requiredCapabilityIds.length || !resolveRequiredFlow) throw error;
      const attempts: string[] = [];
      for (const requiredId of requiredCapabilityIds) {
        const required = await resolveRequiredFlow(requiredId);
        if (!required) {
          attempts.push(`"${requiredId}" not found`);
          continue;
        }
        try {
          await replayCapability(page, required.capability, required.flow, {});
          attempts.push(`"${required.capability.name}": ok`);
        } catch (remediationError) {
          attempts.push(
            `"${required.capability.name}": failed — ${
              remediationError instanceof Error
                ? remediationError.message
                : String(remediationError)
            }`,
          );
        }
      }
      try {
        return await resolveTarget(page, locators, targetTimeoutMs);
      } catch {
        const original = error instanceof Error ? error.message : String(error);
        throw new Error(
          `PRECONDITION_UNMET: ${original}; attempted prerequisite(s): ${attempts.join(", ")}`,
        );
      }
    }
  };

  for (let i = 0; i < flow.steps.length - 1; i++) {
    const step = flow.steps[i];
    const next = flow.steps[i + 1];
    // Does the *next* step require a different document than the one we're
    // currently on? If so, the step we're about to perform is presumed to
    // be the one that triggers that navigation (e.g. clicking an <a>).
    const nextCrossesNavigation =
      !!next.requiresUrl &&
      normalize(next.requiresUrl) !== normalize(page.url());

    // A setup `click` (e.g. revealing a filter panel) is often a toggle, not
    // idempotent — re-clicking it on a repeat call can undo the state the
    // first call put it in. Skip it once its goal (the next step's target
    // already resolvable) is satisfied, rather than blindly replaying it.
    // This "already satisfied" probe only makes sense within the current
    // document: if the next step lives behind a navigation we haven't made
    // yet, there's nothing to resolve yet in this document, so don't
    // attempt the skip-check across a navigation boundary — just always
    // perform the step.
    if (step.action === "click" && next && !nextCrossesNavigation) {
      const alreadySatisfied = await resolveTarget(page, next.locators).then(
        () => true,
        () => false,
      );
      if (alreadySatisfied) continue;
    }

    onStepStart?.({
      index: i,
      action: step.action,
      requiresUrl: step.requiresUrl,
    });
    await ensureOnUrl(step.requiresUrl);
    const target =
      i === 0
        ? await resolveFirstStepTarget(step.locators)
        : await resolveTarget(page, step.locators, targetTimeoutMs);
    const value = step.inputField
      ? String(input[step.inputField] ?? "")
      : undefined;

    if (nextCrossesNavigation) {
      // Race the navigation wait against the action that triggers it, same
      // shape as the final step's waitForResponse race below, so we never
      // start resolving the next step's locator before the new document
      // has actually loaded.
      await Promise.all([
        page.waitForURL(next.requiresUrl!, { timeout: navigationTimeoutMs }),
        performAction(target, step.action, value),
      ]);
      await page.waitForLoadState("domcontentloaded");
    } else {
      await performAction(target, step.action, value);
    }
  }

  const finalStep = flow.steps.at(-1);
  if (!finalStep) throw new Error("EMPTY_FLOW");
  // If the flow's last action happens on a different document than
  // `flow.startUrl` (or than wherever the loop above left us), make sure
  // that navigation has already completed before racing waitForOutcome
  // below — otherwise we'd be waiting for a response against the wrong
  // document.
  onStepStart?.({
    index: flow.steps.length - 1,
    action: finalStep.action,
    requiresUrl: finalStep.requiresUrl,
  });
  await ensureOnUrl(finalStep.requiresUrl);
  // `finalStep` is also the capability's FIRST step when the flow has only
  // one step at all (the common case for a navigation-outcome capability
  // mined from a single click) — the loop above never runs in that case, so
  // remediation has to be offered here too, not just inside the loop.
  const finalTarget =
    flow.steps.length === 1
      ? await resolveFirstStepTarget(finalStep.locators)
      : await resolveTarget(page, finalStep.locators, targetTimeoutMs);
  const finalValue = finalStep.inputField
    ? String(input[finalStep.inputField] ?? "")
    : undefined;

  onBeforeFinalAction?.();
  const [response] = await Promise.all([
    waitForOutcome(page, flow, expectTimeoutMs),
    performAction(finalTarget, finalStep.action, finalValue),
  ]);

  // `response` is undefined for an inferred flow (packages/mcp/src/mining-tools.ts's
  // propose_capability with no `proof`) — there's no recorded network call or
  // navigation to wait for, so the only thing replay can honestly claim is
  // that the real, resolved elements accepted the action without throwing.
  // `status: 0`/`results: undefined` is a sentinel the verification runner
  // (packages/verification/src/runner.ts) recognizes to report this as
  // "inconclusive — no outcome proof" rather than a guessed pass or a
  // misleading "bad response" failure.
  if (!response) return { status: 0, results: undefined };
  const results = await response.json().catch(() => undefined);
  return { status: response.status(), results };
}

/**
 * Waits for this flow's recorded proof of success: either a correlated
 * XHR/fetch response (`expectedRequest`, mined by
 * `mineReadOnlyCapabilities`/`mineWriteCapabilities`) or a full-page
 * navigation response (`expectedNavigation`, mined by
 * `mineUIOutcomeCapabilities` for flows with no XHR/fetch evidence at all —
 * see packages/capability-core/src/miner.ts). Both branches use the same
 * `waitForResponse` primitive so a real HTTP status always backs the proof;
 * they differ only in which resource type/method they require a match on.
 * Returns `undefined` — nothing to wait for — when neither is set (an
 * inferred flow, composed from real elements the LLM never actually saw
 * execute; see packages/mcp/src/mining-tools.ts's `propose_capability`).
 */
function waitForOutcome(
  page: Page,
  flow: Flow,
  timeoutMs: number,
): Promise<PlaywrightResponse> | undefined {
  if (flow.expectedRequest) {
    const { method, urlPattern } = flow.expectedRequest;
    return page.waitForResponse(
      (res) =>
        res.request().method() === method &&
        new URL(res.url()).pathname === urlPattern,
      { timeout: timeoutMs },
    );
  }
  if (flow.expectedNavigation) {
    const { urlPattern } = flow.expectedNavigation;
    return page.waitForResponse(
      (res) =>
        res.request().resourceType() === "document" &&
        new URL(res.url()).pathname === urlPattern,
      { timeout: timeoutMs },
    );
  }
  return undefined;
}
