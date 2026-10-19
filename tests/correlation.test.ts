import { describe, it, expect } from "vitest";
import {
  classifyCorrelation,
  isLikelyPolling,
  redactEvidence,
  canVerifyMutation,
} from "../packages/capability-core/src/correlation.js";
import type { ActionEdge, ApiCall } from "../packages/shared/src/index.js";

const runId = "run-1";
const basePolicy = {
  allowed: true,
  reason: "allowed",
  rule: "default",
  intent: "unknown" as const,
};

const actionCreatedAt = "2026-01-01T00:00:10.000Z";

const action: ActionEdge = {
  id: "action-1",
  runId,
  fromStateId: "state-1",
  toStateId: "state-1",
  elementId: "el-1",
  targetName: "Save",
  action: "click",
  effectFlags: [],
  decision: "executed",
  restoreRecipeId: "recipe-1",
  evidencePaths: [],
  policy: basePolicy,
  worker: 0,
  depth: 1,
  createdAt: actionCreatedAt,
  confidence: 1,
  intent: "unknown",
  signals: [],
  beforeUrl: "http://127.0.0.1:4174/projects",
  afterUrl: "http://127.0.0.1:4174/projects",
};

function makeCall(overrides: Partial<ApiCall> & { id: string }): ApiCall {
  return {
    runId,
    taskId: "task-x",
    sequence: 0,
    method: "GET",
    url: "http://127.0.0.1:4174/api/projects",
    resourceType: "fetch",
    failed: false,
    ...overrides,
  };
}

describe("classifyCorrelation", () => {
  it("classifies a call with matching actionId as direct", () => {
    const call = makeCall({
      id: "call-1",
      actionId: action.id,
      observedAt: "2026-01-01T00:00:10.500Z",
    });
    const [result] = classifyCorrelation(action, [call]);
    expect(result.level).toBe("direct");
  });

  it("classifies taskId+timing match without actionId as strong, and timing-only coincidence as weak", () => {
    const strongCall = makeCall({
      id: "call-strong",
      taskId: action.id, // matches the action's task, no actionId set
      observedAt: "2026-01-01T00:00:11.000Z", // 1s after action.createdAt
    });
    const weakCall = makeCall({
      id: "call-weak",
      taskId: "unrelated-task",
      observedAt: "2026-01-01T00:00:13.000Z", // 3s after, no task/actionId match
    });
    const results = classifyCorrelation(action, [strongCall, weakCall]);
    const strongResult = results.find((r) => r.call.id === "call-strong");
    const weakResult = results.find((r) => r.call.id === "call-weak");
    expect(strongResult?.level).toBe("strong");
    expect(weakResult?.level).toBe("weak");
  });

  it("caps likely-polling calls at weak even when temporally close to the action, never direct/strong", () => {
    const base = Date.parse(actionCreatedAt);
    const pollerCalls: ApiCall[] = [0, 1, 2, 3].map((i) =>
      makeCall({
        id: `poll-${i}`,
        taskId: action.id, // would otherwise look task-matched
        actionId: i === 1 ? action.id : undefined, // would otherwise look direct
        method: "GET",
        url: `http://127.0.0.1:4174/api/status?ts=${i}`,
        observedAt: new Date(base - 6000 + i * 4000).toISOString(), // evenly spaced every 4s
      }),
    );
    const results = classifyCorrelation(action, pollerCalls);
    expect(isLikelyPolling(pollerCalls[1], pollerCalls)).toBe(true);
    for (const result of results) {
      expect(["weak", "none"]).toContain(result.level);
    }
  });

  it("preserves ambiguity: returns both calls when two match the same action at direct level", () => {
    const callA = makeCall({ id: "call-a", actionId: action.id });
    const callB = makeCall({ id: "call-b", actionId: action.id });
    const results = classifyCorrelation(action, [callA, callB]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.level === "direct")).toBe(true);
    expect(results.map((r) => r.call.id).sort()).toEqual(["call-a", "call-b"]);
  });
});

describe("redactEvidence", () => {
  it("redacts sensitive query params and omits header/body fields entirely", () => {
    const call = makeCall({
      id: "call-redact",
      url: "http://127.0.0.1:4174/api/projects?token=abc123&name=Mobile",
      status: 200,
      durationMs: 42,
      failed: false,
      requestHeaders: { authorization: "Bearer secret" },
      requestBody: "name=Mobile&password=hunter2",
      responseHeaders: { "set-cookie": "session=xyz" },
      responseBody: '{"ok":true}',
    });
    const observation = redactEvidence(call);
    expect(observation.url).toContain("token=%5Bredacted%5D");
    expect(observation.url).not.toContain("abc123");
    expect(observation.method).toBe("GET");
    expect(observation.status).toBe(200);
    expect(observation.durationMs).toBe(42);
    expect(observation.failed).toBe(false);
    expect(observation).not.toHaveProperty("requestHeaders");
    expect(observation).not.toHaveProperty("requestBody");
    expect(observation).not.toHaveProperty("responseHeaders");
    expect(observation).not.toHaveProperty("responseBody");
  });
});

describe("canVerifyMutation", () => {
  it("rejects weak-only or weak+none evidence", () => {
    expect(canVerifyMutation(["weak"])).toBe(false);
    expect(canVerifyMutation(["weak", "none"])).toBe(false);
  });

  it("accepts evidence containing strong or direct", () => {
    expect(canVerifyMutation(["strong"])).toBe(true);
    expect(canVerifyMutation(["direct", "weak"])).toBe(true);
  });
});
