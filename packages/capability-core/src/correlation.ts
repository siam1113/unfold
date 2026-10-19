import type { ActionEdge, ApiCall } from "../../shared/src/index.js";
import type { CorrelationLevel } from "./types.js";

// Plan §8 "Network/action correlation": network traffic is evidence, never
// proof, that a user-observable action caused an outcome. This module is the
// one place that turns raw ApiCall/ActionEdge pairs into a correlation
// strength, so the capability miner (packages/capability-core/src/miner.ts,
// same package) and the verification runner
// (packages/verification/src/runner.ts, a different package — see below)
// share one classifier instead of re-deriving their own heuristics. Lives in
// capability-core rather than verification so the miner (capability-core's
// own module) can depend on it without an inverted cross-package edge —
// verification already depends on capability-core for its types, so this
// keeps that single direction.
//
// Data-model note: packages/worker/src/index.ts sets `ApiCall.taskId =
// task.id` for every call captured during a task, and `ApiCall.actionId =
// task.id` only when `task.kind === "action"`. An action's own `id` is that
// task id. So `call.actionId === action.id` ("direct") and `call.taskId ===
// action.id` ("task match", one of the "strong" signals) currently coincide
// for calls the worker captured during the action's own task window — but
// they are checked independently here because `actionId` can be absent (e.g.
// a call captured by a different task, or evidence recorded before this
// field existed) while `taskId` still ties the call to the same window.
//
// `classifyOne`/`classifyCorrelation` only ever read `action.id` and
// `action.createdAt` — never any other `ActionEdge` field — so the parameter
// is typed as that narrow pick rather than the full `ActionEdge`. This lets a
// caller with no real discovered action (the verification runner replays a
// flow live against a page; it has no `ActionEdge` at all) pass a minimal
// synthetic `{id, createdAt}` instead of fabricating every required
// `ActionEdge` field just to satisfy the type.
export type CorrelatableAction = Pick<ActionEdge, "id" | "createdAt">;

/** Within this window after `action.createdAt`, a task-matched call counts as "strong" evidence. Tight enough to exclude requests from unrelated later activity, generous enough to absorb render + fetch dispatch latency. */
const STRONG_WINDOW_MS = 2000;

/** Outer window for "weak" (temporal-proximity-only) correlation. A few seconds — wide enough to catch a slow user-triggered call, too tight to credibly explain unrelated background traffic. */
const WEAK_WINDOW_MS = 5000;

/** How far an individual poll gap may deviate from the group's mean gap and still count as "roughly evenly spaced". Generous enough to tolerate jitter in a real poller, tight enough to exclude bursty one-off traffic. */
const POLL_EVENNESS_TOLERANCE = 0.6;

/** Minimum number of identical-pathname calls (the call itself plus >= 3 others) required before a repeat pattern is treated as background polling rather than coincidence. */
const MIN_POLL_GROUP_SIZE = 4;

export type CorrelationInput = {
  action: CorrelatableAction;
  apiCalls: ApiCall[]; // all ApiCalls in the run, not pre-filtered
};

/** Exported so callers that need to match a call against a `urlPattern`
 * (e.g. the verification runner matching live responses against a flow's
 * `expectedRequest`) use the same pathname extraction this module relies on
 * internally, rather than a second ad hoc implementation. */
export function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pollingGroupKey(call: ApiCall): string {
  return `${call.method}:${pathnameOf(call.url)}`;
}

/**
 * Flags a call as likely background polling: >= 3 other calls in the run
 * share its method + URL pathname (query string ignored) and the group's
 * timestamps are spaced roughly evenly, which is how a background poller
 * behaves and a one-off user-triggered call does not (plan §8 point 5).
 *
 * Requires observed timestamps for the whole group to judge spacing; without
 * them there isn't enough evidence to call it polling, so this conservatively
 * returns false rather than guessing.
 */
export function isLikelyPolling(call: ApiCall, allCalls: ApiCall[]): boolean {
  const key = pollingGroupKey(call);
  const group = allCalls.filter((c) => pollingGroupKey(c) === key);
  if (group.length < MIN_POLL_GROUP_SIZE) return false;
  const times = group
    .map((c) => (c.observedAt ? Date.parse(c.observedAt) : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length < MIN_POLL_GROUP_SIZE) return false;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (mean <= 0) return false;
  return gaps.every(
    (g) => Math.abs(g - mean) <= mean * POLL_EVENNESS_TOLERANCE,
  );
}

function classifyOne(
  action: CorrelatableAction,
  call: ApiCall,
  allCalls: ApiCall[],
): CorrelationLevel {
  const actionTime = Date.parse(action.createdAt);
  const callTime = call.observedAt ? Date.parse(call.observedAt) : NaN;
  const deltaMs =
    Number.isNaN(actionTime) || Number.isNaN(callTime)
      ? Infinity
      : Math.abs(callTime - actionTime);

  if (isLikelyPolling(call, allCalls)) {
    // A call that looks like background polling can never be classified
    // above "weak", even if it carries a matching actionId/taskId or lands
    // squarely inside the action's timing window: the worker tags every
    // request observed during a task with that task's id regardless of
    // whether the action actually triggered it, so an unrelated poller firing
    // during the capture window would otherwise look "direct" by accident.
    // Plan §8 point 5 calls this out as the main false-positive source.
    return deltaMs <= WEAK_WINDOW_MS ? "weak" : "none";
  }

  if (call.actionId === action.id) return "direct";

  const taskMatches = call.taskId === action.id;
  if (taskMatches && deltaMs <= STRONG_WINDOW_MS) return "strong";

  if (deltaMs <= WEAK_WINDOW_MS) return "weak";

  return "none";
}

/**
 * Classifies every ApiCall in the run against one triggering action, per
 * plan §8's four correlation levels. Returns an array — one entry per call,
 * not a single best match — because plan §8 point 6 requires preserving
 * ambiguity: when several calls match an action at the same strength (e.g.
 * two calls the worker recorded under the same actionId for a multi-request
 * action) there is no principled way to pick one, so callers get all of them
 * and must decide how to use multiplicity rather than have it hidden here.
 */
export function classifyCorrelation(
  action: CorrelatableAction,
  apiCalls: ApiCall[],
): { call: ApiCall; level: CorrelationLevel }[] {
  return apiCalls.map((call) => ({
    call,
    level: classifyOne(action, call, apiCalls),
  }));
}

/** Same pattern used by `publicConfig` in packages/shared/src/index.ts, kept consistent so query-param redaction behaves identically across the codebase. */
const SENSITIVE_QUERY_PARAM = /token|secret|password|auth|key|session|code/i;

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()])
      if (SENSITIVE_QUERY_PARAM.test(key))
        u.searchParams.set(key, "[redacted]");
    return u.href;
  } catch {
    // Not a parseable absolute URL (e.g. already relative/malformed); nothing
    // further can be safely redacted, so return it unchanged rather than throw.
    return url;
  }
}

/**
 * Produces the `observation` object safe to persist on an Evidence row (plan
 * §8 point 8). `requestHeaders`/`requestBody`/`responseHeaders`/
 * `responseBody` are dropped entirely rather than selectively redacted:
 * those are free-form and may contain tokens, cookies, PII or secrets in
 * shapes no fixed pattern can reliably catch, so omission is the only way to
 * guarantee they never reach storage.
 */
export function redactEvidence(call: ApiCall): Record<string, unknown> {
  return {
    method: call.method,
    url: redactUrl(call.url),
    status: call.status,
    durationMs: call.durationMs,
    failed: call.failed,
  };
}

/**
 * Gate the verification runner calls before promoting a reversible_write/
 * irreversible_write capability (plan §8: "a weak correlation cannot alone
 * satisfy a mutation outcome assertion"). True only if at least one supplied
 * level is "direct" or "strong" — "weak"-only or "none" evidence must never
 * be treated as sufficient to verify a write.
 */
export function canVerifyMutation(levels: CorrelationLevel[]): boolean {
  return levels.some((level) => level === "direct" || level === "strong");
}
