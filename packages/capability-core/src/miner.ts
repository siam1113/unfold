import { randomUUID } from "node:crypto";
import type { RunData, UIElement, RecipeStep } from "../../shared/src/index.js";
import type { CapabilityCandidate, FlowStep } from "./types.js";
import {
  classifyCorrelation,
  canVerifyMutation,
  pathnameOf,
} from "./correlation.js";
import { classifyUIOutcome } from "./ui-correlation.js";

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "evidence";

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * A mined capability's `name` is shown directly to a human in the dashboard
 * (and only separately, safely sanitized into a tool id by
 * packages/adapters/webmcp's toToolName() at the point it's actually
 * registered) — so it should read like a title, not a code identifier.
 * "Click Multiple Race Selections Allowed", not "ui_click_multiple_race...".
 */
function humanize(action: string, targetName: string): string {
  const verb = titleCase(action) || "Use";
  const subject = titleCase(targetName) || "Element";
  return `${verb} ${subject}`.trim().slice(0, 100);
}

/** One fillable field paired with the inputSchema property name it'll be addressed by. */
interface FillField {
  element: UIElement;
  inputField: string;
}

/**
 * Every enabled, named, non-password text input in a state — not just the
 * first one — so a form with several fields mines as "fill every field,
 * then submit" instead of discarding all but one. Bounded (not the whole
 * form) to keep inputSchema and the mined flow legible; a form with more
 * fields than this is still mined, just on its most prominent ones.
 */
function fillableFields(run: RunData, stateId: string, limit = 6): FillField[] {
  const used = new Set<string>();
  return run.elements
    .filter(
      (e) =>
        e.stateId === stateId &&
        e.tag === "input" &&
        e.accessibleName &&
        e.inputType !== "password" &&
        !e.disabled,
    )
    .slice(0, limit)
    .map((element) => {
      let inputField = slug(element.accessibleName);
      let n = 2;
      while (used.has(inputField))
        inputField = `${slug(element.accessibleName)}_${n++}`;
      used.add(inputField);
      return { element, inputField };
    });
}

const fillStepsFor = (fields: FillField[]): FlowStep[] =>
  fields.map(({ element, inputField }) => ({
    elementSignature: element.structuralSignature,
    locators: element.locatorCandidates,
    action: "fill",
    inputField,
  }));

const inputSchemaFor = (fields: FillField[]) => ({
  type: "object" as const,
  properties: Object.fromEntries(
    fields.map((f) => [f.inputField, { type: "string" }]),
  ),
  required: fields.map((f) => f.inputField),
});

/**
 * Converts a state's own restore recipe (packages/shared/src/index.ts's
 * RestoreRecipe — the real, ordered path of actions already needed to reach
 * that state from the seed, computed during discovery for state restoration)
 * into FlowSteps to prepend before a mined trigger — the thing that turns
 * "click X" into "dismiss the dialog, then click X", reusing path data that
 * already exists rather than re-deriving it. Bounded to the last `limit`
 * steps so a very deep path doesn't produce an unwieldy, fragile flow.
 * fill/select steps along the path get their own inputSchema property too
 * (via `usedNames`, shared with the trigger state's own fillable fields, so
 * names never collide) — FlowStep has no "fixed value" concept, so this
 * reuses the same agent-supplied-parameter mechanism as every other fill
 * step rather than inventing a second one.
 */
function recipeToFlowSteps(
  run: RunData,
  steps: RecipeStep[],
  startUrl: string,
  usedNames: Set<string>,
  limit = 5,
): { steps: FlowStep[]; properties: Record<string, { type: string }> } {
  const trimmed = steps.slice(-limit);
  const properties: Record<string, { type: string }> = {};
  const out: FlowStep[] = [];
  let urlBeforePrev = startUrl;
  for (let i = 0; i < trimmed.length; i++) {
    const step = trimmed[i];
    const urlBefore = i === 0 ? startUrl : trimmed[i - 1].expectedUrl;
    const flowStep: FlowStep = {
      elementSignature: step.elementSignature,
      locators: step.locators,
      action: step.action,
    };
    if (i > 0 && pathnameOf(urlBefore) !== pathnameOf(urlBeforePrev))
      flowStep.requiresUrl = urlBefore;
    if (step.action === "fill" || step.action === "select") {
      const element = run.elements.find(
        (e) => e.structuralSignature === step.elementSignature,
      );
      let inputField = slug(element?.accessibleName || `path_field_${i + 1}`);
      let n = 2;
      while (usedNames.has(inputField))
        inputField = `${slug(element?.accessibleName || `path_field_${i + 1}`)}_${n++}`;
      usedNames.add(inputField);
      flowStep.inputField = inputField;
      properties[inputField] = { type: "string" };
    }
    out.push(flowStep);
    urlBeforePrev = urlBefore;
  }
  return { steps: out, properties };
}

/**
 * Default `Capability.preconditions` entry every candidate from a run
 * inherits when that run only reached its evidence because a session was
 * already established — either a captured login (`authStatePath`) or setup
 * steps run once before discovery began (`packages/core/src/index.ts`'s
 * sequential setup pass). Without this, a mined capability that in fact
 * depends on being logged in carries no record of that at all: replaying it
 * cold would fail with no documented reason why. Deliberately distinct from
 * `requiredCapabilityIds` (another candidate that must run first) — this is
 * about session state the discovery run itself relied on, which no
 * candidate-to-candidate link can express.
 */
function sessionPreconditions(run: RunData): string[] {
  const { authStatePath, setupSteps } = run.run.config;
  if (!authStatePath && setupSteps.length === 0) return [];
  return [
    "Requires an authenticated session (this capability's evidence run used a captured login or setup steps to establish one)",
  ];
}

/**
 * Best-effort auto-suggestion for `Capability.requiredCapabilityIds`: if a
 * candidate's flow starts on a route that exactly one OTHER candidate in
 * this same batch declares as its own navigation-outcome destination
 * (`flow.expectedNavigation.urlPattern`), that other candidate is very
 * likely a prerequisite — e.g. "continue shopping from cart" only has a
 * resolvable target once "go to cart" has already navigated there.
 * Deliberately conservative: 0 or 2+ matches is left empty rather than
 * guessing wrong; a human/LLM can always wire this up explicitly in the
 * dashboard or via `propose_capability`'s `requiredCandidateIds` instead.
 * Mutates `candidates` in place; called once at the end of each miner.
 */
function linkRequiredCapabilities(candidates: CapabilityCandidate[]): void {
  for (const candidate of candidates) {
    const startPath = pathnameOf(candidate.flow.startUrl);
    const matches = candidates.filter(
      (other) =>
        other !== candidate &&
        other.flow.expectedNavigation?.urlPattern === startPath,
    );
    if (matches.length === 1)
      candidate.capability.requiredCapabilityIds = [matches[0].capability.id];
  }
}

/**
 * Mines read-only capability candidates from one discovery run's observed
 * action/API graph. Deliberately narrow (V1): a candidate requires a single
 * `click`/submit action whose correlated network evidence (same `taskId`) is
 * entirely GET and non-failing, triggered from a state that has at least one
 * enabled, named text input the agent could fill. That GET-only requirement
 * is what keeps write flows like `/api/delete` (a POST) out without needing
 * to parse `effectFlags` vocabulary. This does not yet pair a specific
 * preceding `fill` action edge to a specific input (§7's "backtrack to
 * stable reachable preconditions" is simplified to "any fillable input in
 * the triggering state") — a later slice can tighten this once composite
 * flows are mined.
 */
export function mineReadOnlyCapabilities(
  run: RunData,
  projectId: string,
): CapabilityCandidate[] {
  const byTask = new Map<string, typeof run.apiCalls>();
  for (const call of run.apiCalls) {
    const group = byTask.get(call.taskId) || [];
    group.push(call);
    byTask.set(call.taskId, group);
  }
  const candidates: CapabilityCandidate[] = [];
  const seen = new Set<string>();
  for (const calls of byTask.values()) {
    if (calls.length === 0) continue;
    const sorted = [...calls].sort((a, b) => a.sequence - b.sequence);
    const allSafeReads = sorted.every(
      (call) =>
        call.method === "GET" &&
        !call.failed &&
        (call.status === undefined ||
          (call.status >= 200 && call.status < 300)),
    );
    if (!allSafeReads) continue;
    const triggerId = sorted[0].actionId;
    const trigger = triggerId
      ? run.actions.find((action) => action.id === triggerId)
      : undefined;
    if (!trigger || trigger.decision !== "executed" || !trigger.policy.allowed)
      continue;
    // Plan §8: don't trust the taskId grouping alone — require the call this
    // candidate's `expectedRequest` is built from to actually correlate with
    // the trigger at "direct" or "strong" strength. With today's grouping
    // (trigger is found via `sorted[0].actionId`) this is always "direct" in
    // practice, but it's an explicit, principled check via the shared
    // classifier rather than an unstated assumption — and it protects against
    // a future looser trigger-matching rule accidentally mining a candidate
    // off a background-polling call that merely shares the task window.
    const proofLevel = classifyCorrelation(trigger, sorted).find(
      (c) => c.call.id === sorted[0].id,
    )?.level;
    if (proofLevel !== "direct" && proofLevel !== "strong") continue;
    const state = run.states.find((s) => s.id === trigger.fromStateId);
    const triggerElement = run.elements.find((e) => e.id === trigger.elementId);
    if (!state || !triggerElement) continue;
    const fields = fillableFields(run, state.id);
    if (fields.length === 0) continue;
    const key = `${trigger.targetName}:${state.routeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = randomUUID();
    candidates.push({
      flow: {
        id: flowId,
        runId: run.run.id,
        startUrl: state.url,
        kind: "atomic",
        navigations: [],
        steps: [
          ...fillStepsFor(fields),
          {
            elementSignature: triggerElement.structuralSignature,
            locators: triggerElement.locatorCandidates,
            action: trigger.action as "click" | "hover" | "fill" | "select",
          },
        ],
        expectedRequest: {
          method: "GET",
          urlPattern: new URL(sorted[0].url).pathname,
        },
      },
      capability: {
        id: randomUUID(),
        projectId,
        version: "1",
        name: humanize(trigger.action, trigger.targetName || state.routeKey),
        description: `Search or filter ${state.title || state.routeKey}, replaying an observed fill-and-submit flow with new values. Evidence from discovery run ${run.run.id}.`,
        inputSchema: inputSchemaFor(fields),
        flowId,
        risk: "read",
        status: "candidate",
        evidenceRunIds: [run.run.id],
        createdAt: new Date().toISOString(),
        preconditions: sessionPreconditions(run),
        expectedOutcomes: [
          `${trigger.targetName || "search"} returns a filtered result set`,
        ],
        requiredPermissions: [],
        evidenceKind: "api",
        evidenceKinds: ["api"],
        dependencies: [triggerElement.structuralSignature, state.routeKey],
        requiredCapabilityIds: [],
      },
    });
  }
  linkRequiredCapabilities(candidates);
  return candidates;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Mines composite write capability candidates from one discovery run's
 * observed action/API graph. Deliberately narrow (V1), following the same
 * simplifying spirit as `mineReadOnlyCapabilities` above:
 *
 * - A candidate requires a single triggering action (same shape as the read
 *   miner — click/select/etc, correlated network evidence grouped by
 *   `taskId`) whose evidence includes at least one non-failing
 *   POST/PUT/PATCH/DELETE call, triggered from a state with at least one
 *   enabled, named, fillable text input (same "any fillable input in the
 *   triggering state" simplification the read miner documents for §7's
 *   "backtrack to preconditions").
 * - Produces one same-document `composite` Flow (`navigations: []`, no step
 *   sets `requiresUrl`) per unique `(targetName, routeKey)` pair, mirroring
 *   the read miner's dedup key.
 *
 * Scope/limitation this does NOT cover: plan §7's full two-hop
 * cross-document correlation — e.g. a `create_project` mutation whose
 * response contains a new record id, followed by a full-page navigation to
 * a URL that embeds that id (`/projects/:id/permissions`), where a *second*
 * mutation happens. Reliably inferring "this response field becomes part of
 * a later request's URL" from an arbitrary discovered graph — without
 * hard-coding one app's response-body conventions — is fragile: a generic
 * id-position matcher risks mining a capability off a coincidental id match
 * rather than a real dependency between the two actions. Per the task's own
 * guidance, that heuristic is deliberately NOT force-fit here. This miner
 * instead mines the *first* mutation (e.g. the create step) as its own
 * one-hop composite write capability; composing it with a subsequent
 * cross-document capability (if one is also mined from the same run) is left
 * to a human reviewer or the verification runner, not this function. A later
 * slice can add real two-hop mining once the discovery pipeline captures a
 * more structured signal than raw response bytes (e.g. a declared
 * response-field -> next-request-param binding).
 *
 * Every candidate is produced at `status: "candidate"` / `risk:
 * "reversible_write"` — this miner never auto-verifies a mutation; that is
 * the verification runner's job (plan §9).
 */
export function mineWriteCapabilities(
  run: RunData,
  projectId: string,
): CapabilityCandidate[] {
  const byTask = new Map<string, typeof run.apiCalls>();
  for (const call of run.apiCalls) {
    const group = byTask.get(call.taskId) || [];
    group.push(call);
    byTask.set(call.taskId, group);
  }
  const candidates: CapabilityCandidate[] = [];
  const seen = new Set<string>();
  for (const calls of byTask.values()) {
    if (calls.length === 0) continue;
    const sorted = [...calls].sort((a, b) => a.sequence - b.sequence);
    const mutation = sorted.find(
      (call) =>
        WRITE_METHODS.has(call.method) &&
        !call.failed &&
        (call.status === undefined ||
          (call.status >= 200 && call.status < 300)),
    );
    if (!mutation) continue;
    const triggerId = mutation.actionId ?? sorted[0].actionId;
    const trigger = triggerId
      ? run.actions.find((action) => action.id === triggerId)
      : undefined;
    if (!trigger || trigger.decision !== "executed" || !trigger.policy.allowed)
      continue;
    // Plan §8: "a weak correlation cannot alone satisfy a mutation outcome
    // assertion" — applied here at mining time, not just at verification
    // time, so a mutation whose only evidence is a coincidental-timing match
    // (e.g. `mutation.actionId` was unset and the fallback above landed on
    // an unrelated action) never even becomes a candidate. `canVerifyMutation`
    // requires at least one "direct"/"strong" level; "weak"/"none" is
    // rejected regardless of how many ambiguous matches exist.
    const mutationLevel = classifyCorrelation(trigger, sorted).find(
      (c) => c.call.id === mutation.id,
    )?.level;
    if (!mutationLevel || !canVerifyMutation([mutationLevel])) continue;
    const state = run.states.find((s) => s.id === trigger.fromStateId);
    const triggerElement = run.elements.find((e) => e.id === trigger.elementId);
    if (!state || !triggerElement) continue;
    const fields = fillableFields(run, state.id);
    if (fields.length === 0) continue;
    const key = `${trigger.targetName}:${state.routeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flowId = randomUUID();
    const urlPattern = new URL(mutation.url).pathname;
    candidates.push({
      flow: {
        id: flowId,
        runId: run.run.id,
        startUrl: state.url,
        kind: "composite",
        navigations: [],
        steps: [
          ...fillStepsFor(fields),
          {
            elementSignature: triggerElement.structuralSignature,
            locators: triggerElement.locatorCandidates,
            action: trigger.action as "click" | "hover" | "fill" | "select",
          },
        ],
        expectedRequest: {
          method: mutation.method,
          urlPattern,
        },
      },
      capability: {
        id: randomUUID(),
        projectId,
        version: "1",
        name: humanize(trigger.action, trigger.targetName || state.routeKey),
        description: `Create or modify a record via an observed fill-and-submit flow (${mutation.method} ${urlPattern}), replaying with new agent-supplied input. Evidence from discovery run ${run.run.id}. Candidate only — requires verification before publishing (plan §9).`,
        inputSchema: inputSchemaFor(fields),
        flowId,
        risk: "reversible_write",
        status: "candidate",
        evidenceRunIds: [run.run.id],
        createdAt: new Date().toISOString(),
        preconditions: sessionPreconditions(run),
        expectedOutcomes: [
          `${trigger.targetName || "record"} is durably created or modified`,
        ],
        requiredPermissions: [],
        evidenceKind: "api",
        evidenceKinds: ["api"],
        dependencies: [triggerElement.structuralSignature, state.routeKey],
        requiredCapabilityIds: [],
      },
    });
  }
  linkRequiredCapabilities(candidates);
  return candidates;
}

/**
 * Mines capability candidates purely from UI/navigation evidence — a trigger
 * action whose destination state is a genuinely different page per
 * `classifyUIOutcome` (ui-correlation.ts), with no `ApiCall` evidence
 * required or even inspected. This is the third, fully independent mining
 * path (alongside `mineReadOnlyCapabilities`/`mineWriteCapabilities` above):
 * a classic server-rendered flow (e.g. a "Check Out" button that just
 * full-page-navigates to a new route, no XHR in sight) never produces the
 * ApiCall evidence those two miners require, so it mines zero candidates
 * from them today even though it's a perfectly real, replayable capability.
 *
 * Deliberately NOT deduped against the other two miners' output, even when
 * they'd mine the exact same trigger action: a reviewer may want both the
 * API-evidenced and the UI-evidenced version of the same real-world flow on
 * record (one may keep working after the other breaks, e.g. if the app's
 * API contract changes but the UI doesn't, or vice versa). The `ui_` name
 * prefix (vs. `search_`/`mutate_`) guarantees `mineForDiscovery`'s
 * dedupe-by-name in apps/server/src/capabilities.ts can never collide the
 * two paths' candidates for the same action into one row.
 *
 * Every candidate is `risk: "reversible_write"` regardless of what the
 * trigger action actually does — unlike `mineReadOnlyCapabilities`'s
 * all-GET check, there is no network evidence here to safely claim
 * read-only idempotency, so this stays conservative rather than guessing.
 */
export function mineUIOutcomeCapabilities(
  run: RunData,
  projectId: string,
): CapabilityCandidate[] {
  const candidates: CapabilityCandidate[] = [];
  const seen = new Set<string>();
  for (const trigger of run.actions) {
    if (classifyUIOutcome(trigger, run.states) !== "direct") continue;
    const state = run.states.find((s) => s.id === trigger.fromStateId);
    const toState = run.states.find((s) => s.id === trigger.toStateId);
    const triggerElement = run.elements.find((e) => e.id === trigger.elementId);
    if (!state || !toState || !triggerElement) continue;
    const key = `${trigger.targetName}:${state.routeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = fillableFields(run, state.id);
    // The real path already taken to reach this state (its own
    // RestoreRecipe — see recipeToFlowSteps' doc comment) prepended before
    // the fill-and-trigger steps below: this is what turns a mined
    // capability into "dismiss the dialog, then click X" instead of just
    // "click X", reusing path data discovery already computed.
    const usedNames = new Set(fields.map((f) => f.inputField));
    const path = recipeToFlowSteps(
      run,
      state.recipe.steps,
      state.url,
      usedNames,
    );
    const navigations = [
      ...new Set(
        path.steps.filter((s) => s.requiresUrl).map((s) => s.requiresUrl!),
      ),
    ];
    const flowId = randomUUID();
    candidates.push({
      flow: {
        id: flowId,
        runId: run.run.id,
        startUrl: state.url,
        kind: navigations.length
          ? "cross_document"
          : path.steps.length
            ? "composite"
            : "atomic",
        navigations,
        steps: [
          ...path.steps,
          ...fillStepsFor(fields),
          {
            elementSignature: triggerElement.structuralSignature,
            locators: triggerElement.locatorCandidates,
            action: trigger.action as "click" | "hover" | "fill" | "select",
          },
        ],
        expectedNavigation: { urlPattern: pathnameOf(toState.url) },
      },
      capability: {
        id: randomUUID(),
        projectId,
        version: "1",
        name: humanize(trigger.action, trigger.targetName || state.routeKey),
        description: `Replay an observed UI-driven transition (${trigger.action} on "${trigger.targetName || state.routeKey}") from ${state.routeKey} to ${toState.title || toState.routeKey}, proven by a page navigation rather than a correlated API call. Evidence from discovery run ${run.run.id}.`,
        inputSchema: {
          type: "object",
          properties: {
            ...path.properties,
            ...inputSchemaFor(fields).properties,
          },
          required: [
            ...Object.keys(path.properties),
            ...fields.map((f) => f.inputField),
          ],
        },
        flowId,
        risk: "reversible_write",
        status: "candidate",
        evidenceRunIds: [run.run.id],
        createdAt: new Date().toISOString(),
        preconditions: sessionPreconditions(run),
        expectedOutcomes: [
          `Navigates to ${toState.title || toState.routeKey}, replaying an observed UI-driven transition with no required network proof`,
        ],
        requiredPermissions: [],
        dependencies: [triggerElement.structuralSignature, state.routeKey],
        requiredCapabilityIds: [],
        evidenceKind: "ui",
        evidenceKinds: ["ui"],
      },
    });
  }
  linkRequiredCapabilities(candidates);
  return candidates;
}
