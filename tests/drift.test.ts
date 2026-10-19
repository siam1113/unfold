import { describe, it, expect } from "vitest";
import {
  buildDependencyIndex,
  detectDrift,
} from "../packages/verification/src/drift.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import type {
  AppState,
  RunData,
  UIElement,
} from "../packages/shared/src/index.js";
import type {
  Capability,
  Flow,
} from "../packages/capability-core/src/types.js";

const config = ConfigSchema.parse({ baseUrl: "http://127.0.0.1:4174" });
const runId = "run-1";
const box = { x: 0, y: 0, width: 10, height: 10 };
const recipe = { id: "r1", seed: "http://127.0.0.1:4174/projects", steps: [] };

function makeState(id: string, routeKey: string): AppState {
  return {
    id,
    runId,
    url: `http://127.0.0.1:4174${routeKey}`,
    routeKey,
    fingerprint: `fp-${id}`,
    fingerprintVersion: 1,
    fingerprintReason: "structure",
    structureTokens: [],
    title: "Title",
    visibleRegionSummary: [],
    interactiveElementIds: [],
    discoveredAt: new Date().toISOString(),
    depth: 1,
    worker: 0,
    recipe,
    mainText: "",
  };
}

function makeElement(
  id: string,
  stateId: string,
  signature: string,
): UIElement {
  return {
    id,
    stateId,
    role: "button",
    accessibleName: "Button",
    tag: "button",
    textSnippet: "Button",
    structuralSignature: signature,
    locatorCandidates: [],
    disabled: false,
    isSubmit: true,
    box,
  };
}

function makeRun(overrides: Partial<RunData>): RunData {
  return {
    run: {
      id: runId,
      name: "test run",
      status: "completed",
      config,
      createdAt: new Date().toISOString(),
      elapsedMs: 0,
      stats: {
        states: 1,
        routes: 1,
        actions: 0,
        executed: 0,
        blocked: 0,
        failed: 0,
        components: 0,
        elements: 1,
        verified: 0,
        pending: 0,
        active: 0,
      },
    },
    states: [],
    elements: [],
    components: [],
    actions: [],
    apiCalls: [],
    tasks: [],
    events: [],
    ...overrides,
  };
}

function makeCapability(overrides: Partial<Capability>): Capability {
  return {
    id: "cap-1",
    projectId: "project-1",
    version: "1",
    name: "test_capability",
    description: "desc",
    inputSchema: { type: "object", properties: {} },
    flowId: "flow-1",
    risk: "read",
    status: "verified",
    evidenceRunIds: [runId],
    createdAt: new Date().toISOString(),
    preconditions: [],
    expectedOutcomes: [],
    requiredPermissions: [],
    dependencies: [],
    requiredCapabilityIds: [],
    evidenceKind: "api",
    evidenceKinds: ["api"],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<Flow>): Flow {
  return {
    id: "flow-1",
    runId,
    startUrl: "http://127.0.0.1:4174/projects",
    kind: "atomic",
    navigations: [],
    steps: [],
    expectedRequest: { method: "GET", urlPattern: "/api/projects" },
    ...overrides,
  };
}

describe("buildDependencyIndex", () => {
  it("maps a shared dependency string to both capability ids that declare it", () => {
    const capA = makeCapability({ id: "cap-a", dependencies: ["sig-shared"] });
    const capB = makeCapability({
      id: "cap-b",
      dependencies: ["sig-shared", "sig-only-b"],
    });
    const index = buildDependencyIndex([capA, capB]);
    expect(index.get("sig-shared")).toEqual(new Set(["cap-a", "cap-b"]));
    expect(index.get("sig-only-b")).toEqual(new Set(["cap-b"]));
  });
});

describe("detectDrift", () => {
  it("reports no drift when previous and new runs are identical", () => {
    const state = makeState("state-1", "/projects");
    const element = makeElement("el-1", state.id, "sig-1");
    const apiCall = {
      id: "call-1",
      runId,
      taskId: "task-1",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/projects",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    const run = makeRun({
      states: [state],
      elements: [element],
      apiCalls: [apiCall],
    });
    const capability = makeCapability({ dependencies: ["sig-1", "/projects"] });
    const flow = makeFlow({});
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      run,
      run,
    );
    expect(result.staleCapabilityIds).toEqual([]);
  });

  it("marks a capability stale when its dependent selector disappears", () => {
    const state = makeState("state-1", "/projects");
    const element = makeElement("el-1", state.id, "sig-1");
    const previousRun = makeRun({ states: [state], elements: [element] });
    const newRun = makeRun({ states: [state], elements: [] });
    const capability = makeCapability({ id: "cap-1", dependencies: ["sig-1"] });
    const flow = makeFlow({
      expectedRequest: { method: "GET", urlPattern: "/api/projects" },
    });
    const apiCall = {
      id: "call-1",
      runId,
      taskId: "task-1",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/projects",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    previousRun.apiCalls = [apiCall];
    newRun.apiCalls = [apiCall];
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual(["cap-1"]);
    expect(result.reasons["cap-1"].some((r) => r.includes("sig-1"))).toBe(true);
  });

  it("marks a capability stale when its dependent route disappears", () => {
    const state = makeState("state-1", "/projects");
    const previousRun = makeRun({ states: [state], elements: [] });
    const newRun = makeRun({ states: [], elements: [] });
    const capability = makeCapability({
      id: "cap-1",
      dependencies: ["/projects"],
    });
    const flow = makeFlow({});
    const apiCall = {
      id: "call-1",
      runId,
      taskId: "task-1",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/projects",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    previousRun.apiCalls = [apiCall];
    newRun.apiCalls = [apiCall];
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual(["cap-1"]);
    expect(result.reasons["cap-1"].some((r) => r.includes("/projects"))).toBe(
      true,
    );
  });

  it("marks a capability stale when its flow's expected API endpoint disappears", () => {
    const state = makeState("state-1", "/projects");
    const capability = makeCapability({ id: "cap-1", dependencies: [] });
    const flow = makeFlow({
      expectedRequest: { method: "GET", urlPattern: "/api/projects" },
    });
    const apiCall = {
      id: "call-1",
      runId,
      taskId: "task-1",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/projects",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    const previousRun = makeRun({ states: [state], apiCalls: [apiCall] });
    const newRun = makeRun({ states: [state], apiCalls: [] });
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual(["cap-1"]);
    expect(
      result.reasons["cap-1"].some((r) => r.includes("/api/projects")),
    ).toBe(true);
  });

  it("does not blanket-invalidate capabilities with unrelated, unaffected dependencies", () => {
    const state = makeState("state-1", "/projects");
    const elA = makeElement("el-a", state.id, "sig-a");
    const elB = makeElement("el-b", state.id, "sig-b");
    const previousRun = makeRun({ states: [state], elements: [elA, elB] });
    // Only sig-a disappears; sig-b (and its capability) is untouched.
    const newRun = makeRun({ states: [state], elements: [elB] });
    const capA = makeCapability({
      id: "cap-a",
      flowId: "flow-a",
      dependencies: ["sig-a"],
    });
    const capB = makeCapability({
      id: "cap-b",
      flowId: "flow-b",
      dependencies: ["sig-b"],
    });
    const flowA = makeFlow({
      id: "flow-a",
      expectedRequest: { method: "GET", urlPattern: "/api/a" },
    });
    const flowB = makeFlow({
      id: "flow-b",
      expectedRequest: { method: "GET", urlPattern: "/api/b" },
    });
    const callA = {
      id: "call-a",
      runId,
      taskId: "task-a",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/a",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    const callB = {
      id: "call-b",
      runId,
      taskId: "task-b",
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/b",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    previousRun.apiCalls = [callA, callB];
    newRun.apiCalls = [callA, callB];
    const result = detectDrift(
      [capA, capB],
      new Map([
        [flowA.id, flowA],
        [flowB.id, flowB],
      ]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual(["cap-a"]);
    expect(result.staleCapabilityIds).not.toContain("cap-b");
  });

  it("excludes non verified/published capabilities from drift detection", () => {
    const state = makeState("state-1", "/projects");
    const element = makeElement("el-1", state.id, "sig-1");
    const previousRun = makeRun({ states: [state], elements: [element] });
    const newRun = makeRun({ states: [state], elements: [] });
    const capability = makeCapability({
      id: "cap-1",
      status: "candidate",
      dependencies: ["sig-1"],
    });
    const flow = makeFlow({});
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual([]);
  });

  it("treats published capabilities the same as verified ones", () => {
    const state = makeState("state-1", "/projects");
    const element = makeElement("el-1", state.id, "sig-1");
    const previousRun = makeRun({ states: [state], elements: [element] });
    const newRun = makeRun({ states: [state], elements: [] });
    const capability = makeCapability({
      id: "cap-1",
      status: "published",
      dependencies: ["sig-1"],
    });
    const flow = makeFlow({});
    const result = detectDrift(
      [capability],
      new Map([[flow.id, flow]]),
      previousRun,
      newRun,
    );
    expect(result.staleCapabilityIds).toEqual(["cap-1"]);
  });
});
