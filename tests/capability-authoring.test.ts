import { describe, it, expect } from "vitest";
import {
  validateAndMergeGroups,
  type CandidatePool,
} from "../packages/capability-core/src/authoring.js";
import type {
  Capability,
  CapabilityCandidate,
  Flow,
} from "../packages/capability-core/src/types.js";

const runId = "run-1";

function makeFlow(overrides: Partial<Flow> & { id: string }): Flow {
  return {
    runId,
    startUrl: "http://127.0.0.1:4174/checkout",
    kind: "atomic",
    navigations: [],
    steps: [
      {
        elementSignature: "input#promo",
        locators: [],
        action: "fill",
        inputField: "promo_code",
      },
      {
        elementSignature: "button#submit",
        locators: [],
        action: "click",
      },
    ],
    expectedRequest: { method: "POST", urlPattern: "/api/checkout" },
    ...overrides,
  };
}

function makeCapability(
  overrides: Partial<Capability> & { id: string; flowId: string },
): Capability {
  return {
    projectId: "project-1",
    version: "1",
    name: "mutate_check_out",
    description: "Mechanical description.",
    inputSchema: {
      type: "object",
      properties: { promo_code: { type: "string" } },
      required: ["promo_code"],
    },
    risk: "reversible_write",
    status: "candidate",
    evidenceRunIds: [runId],
    createdAt: new Date().toISOString(),
    preconditions: [],
    expectedOutcomes: ["record created"],
    requiredPermissions: [],
    dependencies: ["button#submit", "/checkout"],
    requiredCapabilityIds: [],
    evidenceKinds: ["api"],
    ...overrides,
  };
}

const apiFlow = makeFlow({
  id: "flow-api",
  expectedRequest: { method: "POST", urlPattern: "/api/checkout" },
});
const apiCandidate: CapabilityCandidate = {
  capability: makeCapability({
    id: "cap-api",
    flowId: apiFlow.id,
    name: "mutate_check_out",
    evidenceKinds: ["api"],
  }),
  flow: apiFlow,
};

// Same real action, observed via a UI navigation instead — note the
// DIFFERENT inputField name ("code" vs "promo_code"), which is exactly what
// the merge's canonicalization step must reconcile.
const uiFlow = makeFlow({
  id: "flow-ui",
  expectedRequest: undefined,
  expectedNavigation: { urlPattern: "/order-confirmation" },
  steps: [
    {
      elementSignature: "input#promo",
      locators: [],
      action: "fill",
      inputField: "code",
    },
    { elementSignature: "button#submit", locators: [], action: "click" },
  ],
});
const uiCandidate: CapabilityCandidate = {
  capability: makeCapability({
    id: "cap-ui",
    flowId: uiFlow.id,
    name: "ui_check_out",
    risk: "reversible_write",
    evidenceKinds: ["ui"],
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
  }),
  flow: uiFlow,
};

const otherFlow = makeFlow({
  id: "flow-other",
  startUrl: "http://127.0.0.1:4174/search",
});
const otherApiCandidate: CapabilityCandidate = {
  capability: makeCapability({
    id: "cap-other",
    flowId: otherFlow.id,
    name: "search_apply_filters",
    risk: "read",
    evidenceKinds: ["api"],
  }),
  flow: otherFlow,
};

// A capability proposed from real elements the discovery policy never
// actually let execute (e.g. a fill/submit skipped for lack of an
// allowlist entry) — propose_capability's no-`proof` path
// (packages/mcp/src/mining-tools.ts). Neither expectedRequest nor
// expectedNavigation is set.
const inferredFlow = makeFlow({
  id: "flow-inferred",
  expectedRequest: undefined,
  expectedNavigation: undefined,
});
const inferredCandidate: CapabilityCandidate = {
  capability: makeCapability({
    id: "cap-inferred",
    flowId: inferredFlow.id,
    name: "fill_newsletter_signup",
    evidenceKinds: ["inferred"],
  }),
  flow: inferredFlow,
};

function makePool(...candidates: CapabilityCandidate[]): CandidatePool {
  const pool: CandidatePool = new Map();
  candidates.forEach((c, i) => pool.set(`c${i + 1}`, c));
  return pool;
}

describe("validateAndMergeGroups", () => {
  it("merges an api candidate and a ui candidate into one two-flow capability, with LLM-authored fields and canonicalized input field", () => {
    const pool = makePool(apiCandidate, uiCandidate);
    const [result] = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "Place an order at checkout.",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
      },
    ]);
    expect(result.capability.name).toBe("place_order");
    expect(result.capability.description).toBe("Place an order at checkout.");
    expect(result.capability.flowId).toBe(apiFlow.id);
    expect(result.capability.secondaryFlowId).toBe(uiFlow.id);
    expect(result.capability.evidenceKinds.sort()).toEqual(["api", "ui"]);
    // Canonicalization: secondary flow's fill step now uses the primary's field name.
    expect(result.secondaryFlow?.steps[0].inputField).toBe("promo_code");
    expect(result.capability.inputSchema).toEqual(
      apiCandidate.capability.inputSchema,
    );
  });

  it("drops an unknown candidate id from a group but keeps the remaining valid one", () => {
    const pool = makePool(apiCandidate);
    const [result] = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "desc",
        risk: "reversible_write",
        candidateIds: ["c1", "does-not-exist"],
      },
    ]);
    expect(result.capability.name).toBe("place_order");
    expect(result.capability.secondaryFlowId).toBeUndefined();
  });

  it("drops a group with two candidates of the same evidence kind wholesale, falling through both to standalone", () => {
    const pool = makePool(apiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "bad_merge",
        description: "desc",
        risk: "read",
        candidateIds: ["c1", "c2"],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.capability.name).sort()).toEqual(
      ["mutate_check_out", "search_apply_filters"].sort(),
    );
    expect(result.every((r) => r.secondaryFlow === undefined)).toBe(true);
  });

  it("strips a candidate id referenced by a second group — first group wins", () => {
    const pool = makePool(apiCandidate, uiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "first",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1"],
      },
      {
        name: "second",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
      },
    ]);
    // c1 is claimed by "first"; "second" is left with only c2, which still forms its own capability.
    expect(result.map((r) => r.capability.name).sort()).toEqual([
      "first",
      "second",
    ]);
    expect(
      result.find((r) => r.capability.name === "first")?.capability
        .secondaryFlowId,
    ).toBeUndefined();
    expect(
      result.find((r) => r.capability.name === "second")?.capability
        .secondaryFlowId,
    ).toBeUndefined();
  });

  it("auto-includes every pool candidate never referenced by any group, with its original mechanical fields untouched", () => {
    const pool = makePool(apiCandidate, uiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, []);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.capability.name).sort()).toEqual(
      ["mutate_check_out", "search_apply_filters", "ui_check_out"].sort(),
    );
  });

  it("never produces more capabilities than the pool had candidates", () => {
    const pool = makePool(apiCandidate, uiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
      },
    ]);
    expect(result.length).toBeLessThanOrEqual(pool.size);
  });

  it("resolves a group's requiredCandidateIds (pool-key vocabulary) to the referenced group's final capability id", () => {
    const pool = makePool(apiCandidate, uiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "go_to_other",
        description: "d",
        risk: "read",
        candidateIds: ["c3"],
      },
      {
        name: "place_order",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
        requiredCandidateIds: ["c3"],
      },
    ]);
    const placeOrder = result.find((r) => r.capability.name === "place_order");
    const goToOther = result.find((r) => r.capability.name === "go_to_other");
    expect(placeOrder?.capability.requiredCapabilityIds).toEqual([
      goToOther?.capability.id,
    ]);
  });

  it("resolves a forward-referenced requiredCandidateIds (a group processed before the group it points at)", () => {
    const pool = makePool(apiCandidate, uiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
        requiredCandidateIds: ["c3"],
      },
      {
        name: "go_to_other",
        description: "d",
        risk: "read",
        candidateIds: ["c3"],
      },
    ]);
    const placeOrder = result.find((r) => r.capability.name === "place_order");
    const goToOther = result.find((r) => r.capability.name === "go_to_other");
    expect(placeOrder?.capability.requiredCapabilityIds).toEqual([
      goToOther?.capability.id,
    ]);
  });

  it("resolves a requiredCandidateIds entry pointing at a standalone (never grouped) candidate", () => {
    const pool = makePool(apiCandidate, uiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
        requiredCandidateIds: ["c3"],
      },
    ]);
    const placeOrder = result.find((r) => r.capability.name === "place_order");
    expect(placeOrder?.capability.requiredCapabilityIds).toEqual([
      otherApiCandidate.capability.id,
    ]);
  });

  it("drops an unresolvable requiredCandidateIds entry and a self-reference, leaving requiredCapabilityIds empty", () => {
    const pool = makePool(apiCandidate, otherApiCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "place_order",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1"],
        requiredCandidateIds: ["c1", "does-not-exist"],
      },
    ]);
    const placeOrder = result.find((r) => r.capability.name === "place_order");
    expect(placeOrder?.capability.requiredCapabilityIds).toEqual([]);
  });

  it("keeps an inferred (no-proof) candidate standalone when the LLM never groups it with anything", () => {
    const pool = makePool(apiCandidate, inferredCandidate);
    const result = validateAndMergeGroups(pool, []);
    const inferred = result.find(
      (r) => r.capability.name === "fill_newsletter_signup",
    );
    expect(inferred?.capability.evidenceKinds).toEqual(["inferred"]);
    expect(inferred?.secondaryFlow).toBeUndefined();
  });

  it("drops a group wholesale, both candidates falling back to standalone, if it pairs an inferred candidate with an evidenced one — an unconfirmed action never merges with a confirmed one", () => {
    const pool = makePool(apiCandidate, inferredCandidate);
    const result = validateAndMergeGroups(pool, [
      {
        name: "bad_merge",
        description: "d",
        risk: "reversible_write",
        candidateIds: ["c1", "c2"],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.capability.name).sort()).toEqual(
      ["fill_newsletter_signup", "mutate_check_out"].sort(),
    );
    expect(result.every((r) => r.secondaryFlow === undefined)).toBe(true);
  });
});
