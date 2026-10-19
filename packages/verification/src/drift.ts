import type { RunData } from "../../shared/src/index.js";
import type { Capability, Flow } from "../../capability-core/src/types.js";
import type { Store } from "../../storage/src/index.js";

// Implements hynix_webmcp_extension_plan.md §11 "Selective re-verification".
//
// `Capability.dependencies` already names the leaf identifiers a flow
// depends on (structuralSignature/routeKey — see
// packages/capability-core/src/miner.ts), so the "selector/route/API ->
// affected flow steps -> capabilities" chain in the plan collapses here into
// a direct "dependency string -> capability ids" index; the "affected flow
// steps" hop is implicit rather than separately materialized, consistent
// with how narrow the rest of the mining pipeline already is.

/** One inverted-index row: a dependency string and every capability that relies on it. */
export interface DependencyIndexEntry {
  dependency: string; // a structuralSignature or routeKey string, as found in Capability.dependencies
  capabilityIds: string[];
}

/**
 * Inverts `Capability.dependencies` into `dependency string -> capability
 * ids` so a later diff against a fresh discovery run only has to look up the
 * handful of capabilities a changed identifier actually touches, instead of
 * scanning every capability in the project.
 */
export function buildDependencyIndex(
  capabilities: Capability[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const capability of capabilities) {
    for (const dependency of capability.dependencies) {
      const bucket = index.get(dependency) ?? new Set<string>();
      bucket.add(capability.id);
      index.set(dependency, bucket);
    }
  }
  return index;
}

/** Only these statuses have a published/verified contract worth protecting (plan §9); candidate/failed/disabled/etc have nothing to go stale. */
const DRIFT_ELIGIBLE_STATUSES = new Set(["verified", "published"]);

export interface DriftResult {
  staleCapabilityIds: string[];
  reasons: Record<string, string[]>; // capabilityId -> list of human-readable reasons it went stale
}

/** Same pathname extraction the miner uses for `Flow.expectedRequest.urlPattern` (`new URL(call.url).pathname`), so a live call can be compared against it. */
function pathnameOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Diffs a previous discovery run against a new one and reports which
 * verified/published capabilities' dependencies no longer hold — i.e. went
 * stale per plan §11. Deliberately conservative: "absent now" is the only
 * drift signal for selectors/routes (no fuzzy "changed shape" heuristics),
 * and only capabilities whose *own* dependencies are affected are returned —
 * unrelated UI churn elsewhere in the app must not invalidate every tool.
 */
export function detectDrift(
  publishedOrVerifiedCapabilities: Capability[],
  flowsById: Map<string, Flow>,
  previousRun: RunData,
  newRun: RunData,
): DriftResult {
  const previousSignatures = new Set(
    previousRun.elements.map((e) => e.structuralSignature),
  );
  const newSignatures = new Set(
    newRun.elements.map((e) => e.structuralSignature),
  );
  const previousRoutes = new Set(previousRun.states.map((s) => s.routeKey));
  const newRoutes = new Set(newRun.states.map((s) => s.routeKey));
  const newApiPairs = new Set(
    newRun.apiCalls
      .map((call) => {
        const pathname = pathnameOf(call.url);
        return pathname ? `${call.method} ${pathname}` : undefined;
      })
      .filter((pair): pair is string => pair !== undefined),
  );
  // A navigation-proven flow (Flow.expectedNavigation) has no API pair to
  // miss — its proof is "this route is still reachable", so drift for it is
  // judged against observed routes, not apiCalls.
  const newRoutePathnames = new Set(
    newRun.states
      .map((state) => pathnameOf(state.url))
      .filter((pathname): pathname is string => pathname !== undefined),
  );

  const staleCapabilityIds: string[] = [];
  const reasons: Record<string, string[]> = {};

  for (const capability of publishedOrVerifiedCapabilities) {
    if (!DRIFT_ELIGIBLE_STATUSES.has(capability.status)) continue;
    const capabilityReasons: string[] = [];

    for (const dependency of capability.dependencies) {
      const wasSignature = previousSignatures.has(dependency);
      const wasRoute = previousRoutes.has(dependency);
      if (wasSignature && !newSignatures.has(dependency)) {
        capabilityReasons.push(
          `selector ${dependency} no longer found in latest discovery`,
        );
      }
      if (wasRoute && !newRoutes.has(dependency)) {
        capabilityReasons.push(
          `route ${dependency} missing from latest discovery`,
        );
      }
    }

    const flow = flowsById.get(capability.flowId);
    if (flow?.expectedRequest) {
      const expectedPathname = pathnameOf(flow.expectedRequest.urlPattern);
      // expectedRequest.urlPattern is itself already a pathname when mined
      // from the miner above; fall back to using it verbatim if it isn't a
      // full URL.
      const pathname = expectedPathname ?? flow.expectedRequest.urlPattern;
      const pair = `${flow.expectedRequest.method} ${pathname}`;
      if (!newApiPairs.has(pair)) {
        capabilityReasons.push(
          `API ${flow.expectedRequest.method} ${pathname} no longer observed`,
        );
      }
    } else if (flow?.expectedNavigation) {
      const pathname =
        pathnameOf(flow.expectedNavigation.urlPattern) ??
        flow.expectedNavigation.urlPattern;
      if (!newRoutePathnames.has(pathname)) {
        capabilityReasons.push(
          `route ${pathname} no longer reachable in latest discovery`,
        );
      }
    }

    if (capabilityReasons.length > 0) {
      staleCapabilityIds.push(capability.id);
      reasons[capability.id] = capabilityReasons;
    }
  }

  return { staleCapabilityIds, reasons };
}

/**
 * Applies a `DriftResult` to storage: loads each stale capability and
 * transitions it to `status: "stale"`. `drift.reasons` is intentionally not
 * persisted anywhere — `Capability` has no notes/reasons field, and adding
 * one is out of scope here (packages/capability-core/src/types.ts is owned
 * by another concurrent slice) — callers that want to log/display reasons
 * should read them straight off the in-memory `DriftResult`.
 */
export function markStale(store: Store, drift: DriftResult): void {
  for (const capabilityId of drift.staleCapabilityIds) {
    const capability = store.capability(capabilityId);
    if (!capability) continue;
    store.saveCapability({ ...capability, status: "stale" });
  }
}
