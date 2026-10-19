import { z } from "zod";
import { LocatorSchema } from "../../shared/src/index.js";

// See hynix_webmcp_extension_plan.md §6 for the full intended shape.
// `Capability.flowId`/`secondaryFlowId` support exactly two flows (an
// API-evidenced one and a UI-evidenced one for the same real action,
// produced by the LLM mining-authoring layer — apps/server/src/mining-session.ts)
// — a general N-flow composition is still deferred until a later slice
// needs more than that.

export const RiskSchema = z.enum([
  "read",
  "reversible_write",
  "irreversible_write",
]);
export type Risk = z.infer<typeof RiskSchema>;

// Plan §9's state machine: candidate -> testing -> verified -> published,
// with failed/inconclusive as alternate terminal-ish states reachable from
// testing, stale as a re-verification trigger from verified/published, and
// disabled as the manual/policy-driven endpoint from published. `verified`
// and `published` are deliberately distinct — `registerCapabilities`
// (packages/adapters/webmcp) only ever registers `published` capabilities;
// reaching `verified` means the verification runner's gates passed, not that
// a reviewer has approved exposing it as a live tool.
export const VerificationStatusSchema = z.enum([
  "candidate",
  "testing",
  "verified",
  "published",
  "inconclusive",
  "failed",
  "stale",
  "disabled",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const FlowStepSchema = z.object({
  elementSignature: z.string(),
  /** Real locator evidence, reused with `resolveTarget` to replay against a live page. */
  locators: z.array(LocatorSchema),
  action: z.enum(["click", "hover", "fill", "select"]),
  /** Name of the inputSchema property supplying this step's value, when action is fill/select. */
  inputField: z.string().optional(),
  /**
   * URL this step must be on before it runs. Omitted for steps that stay in
   * the document the flow started on. Present marks a step as following a
   * full-page navigation (set by a prior step or by the flow's own
   * cross-document transition), so replay knows to wait for a navigation
   * rather than resolve the locator in the current document.
   */
  requiresUrl: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowKindSchema = z.enum(["atomic", "composite", "cross_document"]);
export type FlowKind = z.infer<typeof FlowKindSchema>;

// One discovered, replayable path: where it starts, what it does, and what
// proves its outcome. That proof is either a network call (`expectedRequest`,
// an XHR/fetch method+pathname pair) or a full-page navigation
// (`expectedNavigation`, a destination pathname) — exactly one should be set.
// Mining paths that have no XHR/fetch evidence to key off (e.g. a classic
// server-rendered submit-and-navigate flow) use `expectedNavigation` instead;
// see `mineUIOutcomeCapabilities` in miner.ts.
export const FlowSchema = z.object({
  id: z.string(),
  runId: z.string(),
  startUrl: z.string(),
  /**
   * Classification of how many documents this flow spans. Defaults to
   * "atomic" for flows mined before this field existed (a single action) —
   * callers that care about cross-document orchestration should check this
   * rather than inferring it from `steps.length`.
   */
  kind: FlowKindSchema.default("atomic"),
  /**
   * Full-page navigation URLs this flow passes through, in order, beyond
   * `startUrl`. Empty for same-document flows. A step's `requiresUrl` should
   * reference one of these (or `startUrl`).
   */
  navigations: z.array(z.string()).default([]),
  steps: z.array(FlowStepSchema),
  expectedRequest: z
    .object({
      method: z.string(),
      urlPattern: z.string(),
    })
    .optional(),
  expectedNavigation: z
    .object({
      urlPattern: z.string(),
    })
    .optional(),
});
export type Flow = z.infer<typeof FlowSchema>;

export const CorrelationLevelSchema = z.enum([
  "direct",
  "strong",
  "weak",
  "none",
]);
export type CorrelationLevel = z.infer<typeof CorrelationLevelSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum(["ui", "network", "api"]),
  observedAt: z.string(),
  source: z.string(),
  observation: z.record(z.string(), z.unknown()),
  /**
   * Section 8's correlation strength between this evidence and the action it
   * is attributed to. Defaults to "direct" for evidence recorded before this
   * field existed, matching the only correlation level the original miner
   * ever produced (a single matching apiCall per task).
   */
  correlation: CorrelationLevelSchema.default("direct"),
  /** The verification attempt this evidence was collected during, if any. */
  verificationRunId: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// One attempt to verify a capability (plan §9's testing -> verified/failed/
// inconclusive transition). Immutable once finished: a re-verification
// creates a new VerificationRun rather than mutating this one.
export const VerificationRunSchema = z.object({
  id: z.string(),
  capabilityId: z.string(),
  flowId: z.string(),
  status: z.enum(["testing", "verified", "failed", "inconclusive"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  /** Count of isolated, successful repeat executions (plan §9 stage E; gate is 3). */
  passCount: z.number().int().nonnegative().default(0),
  failureCategories: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type VerificationRun = z.infer<typeof VerificationRunSchema>;

export const CapabilitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  flowId: z.string(),
  risk: RiskSchema,
  status: VerificationStatusSchema,
  evidenceRunIds: z.array(z.string()),
  createdAt: z.string(),
  /** Conditions that must hold before this capability can run (plan §6). */
  preconditions: z.array(z.string()).default([]),
  /**
   * Other capabilities (same `projectId`) that should already be satisfied
   * before this one runs — e.g. "Continue shopping from cart" only has a
   * resolvable target once "Go to cart" has already navigated there. Both
   * replay engines (packages/capability-runtime/src/replay.ts,
   * apps/extension/src/replay.ts) attempt these once, automatically, only
   * when the flow's FIRST step can't resolve, then retry; unmet ones are
   * named explicitly in the resulting error rather than a bare locator
   * failure. Distinct from `dependencies` below, which is an unrelated,
   * already-committed mechanism (selector/route/API identifier strings for
   * drift detection, packages/verification/src/drift.ts) — never capability
   * ids, never read at execution time.
   */
  requiredCapabilityIds: z.array(z.string()).default([]),
  /** Externally observable goals a successful run must satisfy. */
  expectedOutcomes: z.array(z.string()).default([]),
  /** Scopes/roles/permissions the invoking session must already hold. */
  requiredPermissions: z.array(z.string()).default([]),
  /** Selector/route/API identifiers this capability's flow depends on, used by drift detection (plan §11). */
  dependencies: z.array(z.string()).default([]),
  /**
   * The paired flow when an authoring step (apps/server/src/mining-session.ts)
   * merged an API-evidenced candidate and a UI-evidenced candidate into one
   * capability because they represent the same real action — `flowId` stays
   * the "primary" flow (API wins primary when both exist; see
   * mining-session.ts's merge rules), `secondaryFlowId` is the other one.
   * Undefined for every single-flow capability, which is still the common
   * case.
   */
  secondaryFlowId: z.string().optional(),
  /**
   * Which kind(s) of evidence prove this capability's flow(s): a correlated
   * network call ("api", the original miners) and/or a UI/navigation state
   * change with no required network proof ("ui",
   * `mineUIOutcomeCapabilities` in miner.ts). A third kind, "inferred", marks
   * a capability the LLM mining path composed from real, observed elements
   * (never a fabricated id) but never actually saw execute — e.g. discovery's
   * policy gates skipped the fill/submit, so there's no real apiCall or
   * state-transition proof backing it (see `propose_capability`'s optional
   * `proof`, packages/mcp/src/mining-tools.ts). Two entries only when
   * `secondaryFlowId` is set — always exactly one entry when "inferred" is
   * present, since an inferred capability never has a paired evidenced flow.
   * Defaults to `["api"]` so every already-persisted row (mined before this
   * field existed) still parses.
   */
  evidenceKinds: z
    .array(z.enum(["api", "ui", "inferred"]))
    .min(1)
    .max(2)
    .default(["api"]),
  /**
   * @deprecated superseded by `evidenceKinds`. Kept optional, unread by new
   * code, purely so an already-persisted row or an in-flight client built
   * against the old single-kind field doesn't fail to parse during the
   * transition. Safe to delete once nothing writes it anymore.
   */
  evidenceKind: z.enum(["api", "ui"]).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/** A mined-but-not-yet-registered capability, paired with the flow it replays. */
export interface CapabilityCandidate {
  capability: Capability;
  flow: Flow;
}
