// Wave 2 (hynix_webmcp_extension_plan.md §9, §12): capability-registry route
// logic, factored out of apps/server/src/index.ts so it is importable (and
// unit-testable) without pulling in Express, auth, or the app's
// listen-at-import side effects. apps/server/src/index.ts wires these onto
// HTTP routes; it owns ownership checks (store.project/store.discoveries),
// these helpers assume the caller has already confirmed the project and
// discovery are owned by the caller.
import type { Store } from "../../../packages/storage/src/index.js";
import {
  mineReadOnlyCapabilities,
  mineWriteCapabilities,
  mineUIOutcomeCapabilities,
} from "../../../packages/capability-core/src/miner.js";
import type {
  Capability,
  CapabilityCandidate,
  Flow,
} from "../../../packages/capability-core/src/types.js";

/**
 * Every Capability belonging to `projectId` whose flow was mined from
 * `discoveryId`. `store.capabilities(projectId)` alone spans every
 * discovery run a project has ever had, so this resolves each capability's
 * flow and keeps only the ones scoped to the discovery being inspected.
 */
export function capabilitiesForDiscovery(
  store: Store,
  projectId: string,
  discoveryId: string,
): Capability[] {
  return store.capabilities(projectId).filter((capability) => {
    const flow = store.flow(capability.flowId);
    return flow?.runId === discoveryId;
  });
}

export interface CapabilityWithFlows extends Capability {
  flows: { primary: Flow; secondary?: Flow };
}

/**
 * `capabilitiesForDiscovery`'s output, with each capability's one or two
 * Flow records embedded (dashboard's two-flow UI/API tab switcher needs the
 * actual steps/proof to show, not just the id — see
 * apps/dashboard/src/flow-capabilities-views.tsx). Embedding here rather
 * than adding a separate `GET .../flows/:flowId` route avoids a
 * flow-ownership-check gap, since `Flow` has no back-pointer to the
 * capability that owns it.
 */
export function capabilitiesWithFlows(
  store: Store,
  projectId: string,
  discoveryId: string,
): CapabilityWithFlows[] {
  return capabilitiesForDiscovery(store, projectId, discoveryId).flatMap(
    (capability) => {
      const primary = store.flow(capability.flowId);
      if (!primary) return []; // shouldn't happen — every capability's primary flow is saved alongside it
      const secondary = capability.secondaryFlowId
        ? store.flow(capability.secondaryFlowId)
        : undefined;
      return [{ ...capability, flows: { primary, secondary } }];
    },
  );
}

/**
 * Every `published` capability for `projectId`, project-wide (not scoped to
 * one discovery — publishing is a project-level decision), paired with its
 * primary flow for `registerCapabilities`
 * (packages/adapters/webmcp/src/index.ts) to inject as live WebMCP tools.
 * v1 scope: only the primary flow — a two-flow capability's secondary (UI)
 * flow isn't separately exposed yet.
 */
export function publishedCandidatesForProject(
  store: Store,
  projectId: string,
): CapabilityCandidate[] {
  return store
    .capabilities(projectId)
    .filter((capability) => capability.status === "published")
    .flatMap((capability) => {
      const flow = store.flow(capability.flowId);
      return flow ? [{ capability, flow }] : []; // shouldn't happen — every capability's primary flow is saved alongside it
    });
}

/**
 * Mines read-only and write capability candidates from one discovery run
 * and persists the ones not already present. Dedupes against capabilities
 * already mined for this discovery by `name` — repeated "Mine" calls on an
 * unchanged discovery must not pile up duplicate rows with fresh random ids
 * each time (the miners themselves always generate new ids per call).
 * Returns the full, current, discovery-scoped capability list (same shape
 * as `capabilitiesForDiscovery`).
 */
export function mineForDiscovery(
  store: Store,
  projectId: string,
  discoveryId: string,
  ownerId: string,
): Capability[] {
  const run = store.data(discoveryId, ownerId);
  const existing = capabilitiesForDiscovery(store, projectId, discoveryId);
  // Dedup key is NOT name alone: since capability names are now a
  // human-readable title (packages/capability-core/src/miner.ts's
  // humanize()) rather than a miner-specific `search_`/`mutate_`/`ui_`
  // prefix, the same trigger action can legitimately produce the same name
  // from two different miners — e.g. an API-evidenced and a UI-evidenced
  // capability for the same "Check Out" button. Those are deliberately
  // meant to both survive (one may keep working after the other breaks —
  // see mineUIOutcomeCapabilities' doc comment), so the key also includes
  // risk + evidenceKind, which together distinguish all three miners'
  // output even when their names collide.
  const dedupeKey = (c: {
    name: string;
    risk: string;
    evidenceKind?: string;
  }) => `${c.name}::${c.risk}::${c.evidenceKind || ""}`;
  const existingKeys = new Set(existing.map(dedupeKey));
  const mined = [
    ...mineReadOnlyCapabilities(run, projectId),
    ...mineWriteCapabilities(run, projectId),
    ...mineUIOutcomeCapabilities(run, projectId),
  ];
  for (const candidate of mined) {
    const key = dedupeKey(candidate.capability);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    store.saveFlow(candidate.flow);
    store.saveCapability(candidate.capability);
  }
  return capabilitiesForDiscovery(store, projectId, discoveryId);
}

/** Plan §9: verification can only be (re)started when no attempt is already running. */
export function canStartVerification(capability: Capability): boolean {
  return capability.status !== "testing";
}

/** Plan §9: a capability must have passed the verification runner's gates before a reviewer can act on it. */
export function canApprove(capability: Capability): boolean {
  return capability.status === "verified";
}

/** Plan §9: `published` is only reachable from `verified`. */
export function canPublish(capability: Capability): boolean {
  return capability.status === "verified";
}

export function publishCapability(
  store: Store,
  capability: Capability,
): Capability {
  return store.saveCapability({ ...capability, status: "published" });
}

/** Plan §9: `disabled` is reachable from any status (manual or policy-driven). */
export function disableCapability(
  store: Store,
  capability: Capability,
): Capability {
  return store.saveCapability({ ...capability, status: "disabled" });
}

/**
 * Hard removal — unlike `disableCapability`, which keeps the row around in
 * a terminal status, this drops the registry entry (and its verification
 * history) entirely, for when a capability was mined wrong or is no longer
 * wanted and shouldn't keep cluttering the registry.
 */
export function deleteCapability(store: Store, capability: Capability): void {
  store.deleteCapability(capability.id);
}

/**
 * Dashboard-editable "Requires" link — manual override/complement to the
 * best-effort auto-suggestion the deterministic miners make
 * (packages/capability-core/src/miner.ts's `linkRequiredCapabilities`) and
 * to whatever `propose_capability` set during LLM-driven mining. Silently
 * drops any id that doesn't belong to THIS project or that equals the
 * capability's own id, rather than rejecting the whole call — the dashboard
 * UI only ever offers same-project candidates to pick from, so this is a
 * defensive floor, not the primary validation surface.
 */
export function setRequiredCapabilities(
  store: Store,
  capability: Capability,
  requiredCapabilityIds: string[],
): Capability {
  const filtered = [...new Set(requiredCapabilityIds)].filter(
    (id) =>
      id !== capability.id &&
      store.capability(id)?.projectId === capability.projectId,
  );
  return store.saveCapability({
    ...capability,
    requiredCapabilityIds: filtered,
  });
}
