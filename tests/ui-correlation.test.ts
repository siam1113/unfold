import { describe, it, expect } from "vitest";
import { classifyUIOutcome } from "../packages/capability-core/src/ui-correlation.js";
import type { ActionEdge, AppState } from "../packages/shared/src/index.js";

const runId = "run-1";
const recipe = { id: "r1", seed: "http://127.0.0.1:4174/cart", steps: [] };

function makeState(overrides: Partial<AppState> & { id: string }): AppState {
  return {
    runId,
    url: "http://127.0.0.1:4174/cart",
    routeKey: "/cart",
    fingerprint: "fp-cart",
    fingerprintVersion: 1,
    fingerprintReason: "structure",
    structureTokens: [],
    title: "Cart",
    visibleRegionSummary: [],
    interactiveElementIds: [],
    discoveredAt: new Date().toISOString(),
    depth: 1,
    worker: 0,
    recipe,
    mainText: "Cart",
    ...overrides,
  };
}

const fromState = makeState({ id: "state-cart", fingerprint: "fp-cart" });
const toState = makeState({
  id: "state-checkout",
  url: "http://127.0.0.1:4174/checkout",
  routeKey: "/checkout",
  fingerprint: "fp-checkout",
  title: "Checkout",
});

const basePolicy = {
  allowed: true,
  reason: "allowed",
  rule: "default",
  intent: "unknown" as const,
};

const baseAction: ActionEdge = {
  id: "action-checkout",
  runId,
  fromStateId: fromState.id,
  toStateId: toState.id,
  elementId: "el-checkout",
  targetName: "Check Out",
  action: "click",
  effectFlags: [],
  decision: "executed",
  restoreRecipeId: recipe.id,
  evidencePaths: [],
  policy: basePolicy,
  worker: 0,
  depth: 1,
  createdAt: new Date().toISOString(),
  confidence: 1,
  intent: "unknown",
  signals: [],
  beforeUrl: fromState.url,
  afterUrl: toState.url,
};

describe("classifyUIOutcome", () => {
  it("classifies an executed, policy-allowed action whose destination state has a different fingerprint as direct", () => {
    expect(classifyUIOutcome(baseAction, [fromState, toState])).toBe("direct");
  });

  it("returns none when the action was only skipped by policy, not executed", () => {
    const action: ActionEdge = { ...baseAction, decision: "skipped_policy" };
    expect(classifyUIOutcome(action, [fromState, toState])).toBe("none");
  });

  it("returns none when policy did not allow the action", () => {
    const action: ActionEdge = {
      ...baseAction,
      policy: { ...basePolicy, allowed: false },
    };
    expect(classifyUIOutcome(action, [fromState, toState])).toBe("none");
  });

  it("returns none when the action has no toStateId at all", () => {
    const action: ActionEdge = { ...baseAction, toStateId: undefined };
    expect(classifyUIOutcome(action, [fromState, toState])).toBe("none");
  });

  it("returns none when the destination state's fingerprint is unchanged (no real transition)", () => {
    const sameState = makeState({
      id: "state-cart-same",
      fingerprint: "fp-cart",
    });
    const action: ActionEdge = {
      ...baseAction,
      toStateId: sameState.id,
    };
    expect(classifyUIOutcome(action, [fromState, sameState])).toBe("none");
  });
});
