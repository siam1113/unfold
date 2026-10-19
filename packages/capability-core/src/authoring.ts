// LLM-driven capability mining (hynix_webmcp_extension_plan.md). The LLM is
// the primary *author* of a capability's name/description/risk and of
// whether a UI-evidenced and an API-evidenced candidate represent the same
// real action and should merge into one two-flow capability — but it NEVER
// authors the mechanical replay details (locators, URLs). Those are always
// derived by the existing deterministic miners (miner.ts, this package)
// from real recorded evidence; this module only reorganizes/relabels their
// output (grounded mode) or, in generative mode, lets the LLM compose a new
// flow by referencing real evidence IDs (packages/mcp/src/mining-tools.ts
// resolves those IDs server-side — never from LLM-typed text).
//
// Pure, no OpenAI/Store/Express dependency (that orchestration lives in
// apps/server/src/mining-session.ts) — lives in this package, a sibling of
// miner.ts, rather than in apps/server, specifically so packages/mcp's
// mining-tools.ts can import it without inverting the "packages depend on
// packages, never on apps" direction every other package in this repo keeps.
import type { RunData } from "../../shared/src/index.js";
import {
  mineReadOnlyCapabilities,
  mineWriteCapabilities,
  mineUIOutcomeCapabilities,
} from "./miner.js";
import type { Capability, CapabilityCandidate, Flow, Risk } from "./types.js";

export type EvidenceScope = "api" | "ui" | "both";

/** Keyed by a short, stable id (`c1`, `c2`, ...) so the LLM can reference a candidate without seeing its real UUID or any locator/URL data. */
export type CandidatePool = Map<string, CapabilityCandidate>;

export function buildCandidatePool(
  run: RunData,
  projectId: string,
  evidenceScope: EvidenceScope = "both",
): CandidatePool {
  const all: CapabilityCandidate[] = [
    ...(evidenceScope !== "ui" ? mineReadOnlyCapabilities(run, projectId) : []),
    ...(evidenceScope !== "ui" ? mineWriteCapabilities(run, projectId) : []),
    ...(evidenceScope !== "api"
      ? mineUIOutcomeCapabilities(run, projectId)
      : []),
  ];
  const pool: CandidatePool = new Map();
  all.forEach((candidate, index) => pool.set(`c${index + 1}`, candidate));
  return pool;
}

/**
 * The compact, locator/URL-free summary the `list_candidate_evidence` tool
 * hands the LLM. Deliberately omits `Capability.dependencies[0]`
 * (`triggerElement.structuralSignature` — a real selector, see
 * packages/capability-core/src/miner.ts) and any raw `Flow.steps`/`startUrl`
 * detail; `routeKey` (`dependencies[1]`) is the one dependency entry that's
 * just a route string, safe to show.
 */
export interface CandidateSummary {
  id: string;
  mechanicalName: string;
  description: string;
  risk: Risk;
  evidenceKind: "api" | "ui" | "inferred";
  routeKey: string;
}

export function summarizePool(pool: CandidatePool): CandidateSummary[] {
  return [...pool.entries()].map(([id, candidate]) => ({
    id,
    mechanicalName: candidate.capability.name,
    description: candidate.capability.description,
    risk: candidate.capability.risk,
    evidenceKind: candidate.capability.evidenceKinds[0],
    routeKey: candidate.capability.dependencies[1] ?? "",
  }));
}

export interface FinalizeGroup {
  name: string;
  description: string;
  risk: Risk;
  candidateIds: string[];
  /**
   * Other candidates (by the SAME pool-key id vocabulary as `candidateIds`
   * — list_candidate_evidence's ids, never a real UUID the LLM is never
   * shown) that this group's resulting capability needs to already be
   * satisfied before it runs — e.g. a "continue shopping from cart" group
   * naming the candidate id for "go to cart". Resolved to real, final
   * Capability ids by `validateAndMergeGroups` below (pool keys don't
   * survive past this module); an id that doesn't resolve to a real
   * candidate, or resolves to the group's own capability, is silently
   * dropped — same "drop what's wrong, never reject the whole call" stance
   * this module already takes for `candidateIds`.
   */
  requiredCandidateIds?: string[];
}

/** A finalized, ready-to-persist capability, paired with its one or two flows. */
export interface AuthoredCandidate {
  capability: Capability;
  flow: Flow;
  secondaryFlow?: Flow;
}

const dedupe = (values: string[]): string[] => [...new Set(values)];

function emptyInputSchema() {
  return { type: "object", properties: {}, required: [] };
}

/**
 * When a merge pairs a flow that fills an input with one that doesn't,
 * there's nothing to reconcile — the capability's inputSchema is simply
 * whichever flow's schema is non-empty (the other flow's replay never
 * references that property at all, so an extra unused key is harmless).
 * When BOTH flows fill an input, `buildAuthoredCandidate` has already
 * renamed the secondary's `inputField` to match the primary's before this
 * runs, so they now agree and the primary's schema is authoritative.
 */
function mergeInputSchemas(
  primary: Capability,
  secondary: Capability,
  primaryHasFill: boolean,
  secondaryHasFill: boolean,
): Record<string, unknown> {
  if (primaryHasFill) return primary.inputSchema;
  if (secondaryHasFill) return secondary.inputSchema;
  return emptyInputSchema();
}

function buildAuthoredCandidate(
  group: FinalizeGroup,
  primary: CapabilityCandidate,
  secondary?: CapabilityCandidate,
): AuthoredCandidate {
  const name = group.name.trim() || primary.capability.name;
  const description =
    group.description.trim() || primary.capability.description;
  const risk = group.risk;

  if (!secondary) {
    return {
      capability: { ...primary.capability, name, description, risk },
      flow: primary.flow,
    };
  }

  // Input-field canonicalization (see module doc comment and the schema
  // comment in packages/capability-core/src/types.ts): if both flows fill a
  // single input, rename the secondary flow's fill step (and nothing else)
  // to the primary's field name so verification's single-string-key
  // `syntheticInputs` heuristic (packages/verification/src/runner.ts) and
  // replayCapability's `input[step.inputField]` lookup both resolve
  // unambiguously regardless of which flow is actually being replayed.
  const primaryFillField = primary.flow.steps.find(
    (s) => s.action === "fill",
  )?.inputField;
  const secondaryFillField = secondary.flow.steps.find(
    (s) => s.action === "fill",
  )?.inputField;
  let secondaryFlow = secondary.flow;
  if (
    primaryFillField &&
    secondaryFillField &&
    primaryFillField !== secondaryFillField
  ) {
    secondaryFlow = {
      ...secondary.flow,
      steps: secondary.flow.steps.map((step) =>
        step.action === "fill" && step.inputField === secondaryFillField
          ? { ...step, inputField: primaryFillField }
          : step,
      ),
    };
  }

  return {
    capability: {
      ...primary.capability,
      name,
      description,
      risk,
      flowId: primary.flow.id,
      secondaryFlowId: secondaryFlow.id,
      evidenceKinds: dedupe([
        ...primary.capability.evidenceKinds,
        ...secondary.capability.evidenceKinds,
      ]) as ("api" | "ui")[],
      dependencies: dedupe([
        ...primary.capability.dependencies,
        ...secondary.capability.dependencies,
      ]),
      evidenceRunIds: dedupe([
        ...primary.capability.evidenceRunIds,
        ...secondary.capability.evidenceRunIds,
      ]),
      preconditions: dedupe([
        ...primary.capability.preconditions,
        ...secondary.capability.preconditions,
      ]),
      expectedOutcomes: dedupe([
        ...primary.capability.expectedOutcomes,
        ...secondary.capability.expectedOutcomes,
      ]),
      requiredPermissions: dedupe([
        ...primary.capability.requiredPermissions,
        ...secondary.capability.requiredPermissions,
      ]),
      inputSchema: mergeInputSchemas(
        primary.capability,
        secondary.capability,
        Boolean(primaryFillField),
        Boolean(secondaryFillField),
      ),
    },
    flow: primary.flow,
    secondaryFlow,
  };
}

/**
 * True when a group references more candidates than the ≤1-api+≤1-ui rule
 * allows, two candidates of the same evidence kind, or an "inferred"
 * candidate (packages/mcp/src/mining-tools.ts's propose_capability with no
 * `proof`) paired with anything else — an inferred candidate represents a
 * real action nobody actually confirmed, so merging it with an
 * api/ui-evidenced one (which by definition WAS confirmed) would misrepresent
 * the evidenced one's confidence. Inferred candidates only ever stand alone.
 */
function violatesEvidenceKindCap(
  resolved: { candidate: CapabilityCandidate }[],
): boolean {
  if (resolved.length > 2) return true;
  const kinds = resolved.map(
    (entry) => entry.candidate.capability.evidenceKinds[0],
  );
  if (resolved.length > 1 && kinds.includes("inferred")) return true;
  return new Set(kinds).size !== kinds.length;
}

/**
 * Validates and applies the LLM's `finalize_capabilities` grouping against a
 * raw candidate pool. Pure — no OpenAI dependency — so it's the unit-test
 * seam for the whole authoring layer (tests/capability-authoring.test.ts).
 *
 * Rules (deliberately conservative — see plan): an unknown id is dropped
 * from its group, not a hard reject of the whole call. A group with more
 * than one candidate of the same evidence kind (or more than 2 candidates
 * at all) is dropped WHOLESALE, never silently truncated — truncating would
 * discard evidence the caller thought it was keeping. An id referenced by
 * more than one surviving group: first occurrence wins. Every pool
 * candidate never referenced by a surviving group is auto-included
 * standalone with its original mechanical fields, so this layer can only
 * ever add value on top of what the deterministic miners already produced,
 * never silently drop evidence.
 */
export function validateAndMergeGroups(
  pool: CandidatePool,
  groups: FinalizeGroup[],
): AuthoredCandidate[] {
  const used = new Set<string>();
  // Pool-key id -> the final capability id it ends up as (a group's primary's
  // id for every candidate the group consumed, or its own id for a standalone
  // candidate) — built alongside `pending` below so `requiredCandidateIds`
  // (still in pool-key vocabulary) can be resolved to real ids in a second
  // pass, after every group's final id is known.
  const poolKeyToFinalId = new Map<string, string>();
  const pending: {
    authored: AuthoredCandidate;
    requiredCandidateIds: string[];
  }[] = [];

  for (const group of groups) {
    const candidateIds = dedupe(group.candidateIds).filter(
      (id) => !used.has(id),
    );
    const resolved = candidateIds
      .map((id) => ({ id, candidate: pool.get(id) }))
      .filter(
        (entry): entry is { id: string; candidate: CapabilityCandidate } =>
          Boolean(entry.candidate),
      );
    if (resolved.length === 0) continue;
    if (violatesEvidenceKindCap(resolved)) continue;

    for (const entry of resolved) used.add(entry.id);

    const api = resolved.find(
      (e) => e.candidate.capability.evidenceKinds[0] === "api",
    );
    const ui = resolved.find(
      (e) => e.candidate.capability.evidenceKinds[0] === "ui",
    );
    // A solo "inferred" group (the only way one reaches this point, per
    // violatesEvidenceKindCap above) has neither — falls back to the
    // resolved entry itself.
    const primary = (api ?? ui ?? resolved[0]).candidate;
    const secondary = api && ui ? ui.candidate : undefined;

    const authored = buildAuthoredCandidate(group, primary, secondary);
    for (const entry of resolved) {
      poolKeyToFinalId.set(entry.id, authored.capability.id);
    }
    pending.push({
      authored,
      requiredCandidateIds: group.requiredCandidateIds ?? [],
    });
  }

  for (const [id, candidate] of pool) {
    if (used.has(id)) continue;
    poolKeyToFinalId.set(id, candidate.capability.id);
    pending.push({
      authored: { capability: candidate.capability, flow: candidate.flow },
      requiredCandidateIds: [],
    });
  }

  return pending.map(({ authored, requiredCandidateIds }) => {
    if (requiredCandidateIds.length === 0) return authored;
    // Drop ids that don't resolve to any final capability, and self-refs —
    // same "drop what's wrong, never reject the whole call" stance as the
    // rest of this function.
    const resolvedIds = requiredCandidateIds
      .map((id) => poolKeyToFinalId.get(id))
      .filter(
        (id): id is string => Boolean(id) && id !== authored.capability.id,
      );
    if (resolvedIds.length === 0) return authored;
    return {
      ...authored,
      capability: {
        ...authored.capability,
        requiredCapabilityIds: dedupe([
          ...authored.capability.requiredCapabilityIds,
          ...resolvedIds,
        ]),
      },
    };
  });
}
