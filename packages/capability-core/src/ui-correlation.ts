import type { ActionEdge, AppState } from "../../shared/src/index.js";
import type { CorrelationLevel } from "./types.js";

// Plan §8's four correlation levels were defined for ApiCall evidence
// (correlation.ts). This module gives the miner a second, independent proof
// path for flows that have no XHR/fetch evidence to key off at all — a
// classic server-rendered submit-and-navigate flow (e.g. a checkout button
// that just does a full-page navigation) never produces an ApiCall
// (packages/worker/src/index.ts only records apiCalls for resourceType
// "xhr"/"fetch"), so classifyCorrelation always returns "none" for it even
// though the action plainly did something. `classifyUIOutcome` instead asks:
// did this action transition to a genuinely different page, per the
// crawler's own fingerprint — its canonical "this is a different document"
// signal, already used everywhere else in this codebase to distinguish real
// navigations from no-ops.
//
// Deliberately narrow (V1), same spirit as miner.ts's own candidates: only
// "direct" (an executed, policy-allowed action whose recorded destination
// state has a different fingerprint than its origin) and "none" are
// produced. "strong"/"weak" are left unused here rather than invented
// without a concrete signal backing them — there's no equivalent to
// correlation.ts's timing-window/polling heuristics for a pure state
// transition, so a later slice can add them if a real need shows up instead
// of guessing now.
export function classifyUIOutcome(
  trigger: ActionEdge,
  states: AppState[],
): CorrelationLevel {
  if (
    trigger.decision !== "executed" ||
    !trigger.policy.allowed ||
    !trigger.toStateId
  )
    return "none";
  const from = states.find((state) => state.id === trigger.fromStateId);
  const to = states.find((state) => state.id === trigger.toStateId);
  if (!from || !to) return "none";
  return from.fingerprint !== to.fingerprint ? "direct" : "none";
}
