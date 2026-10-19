import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../packages/shared/src/index.js";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  UIElement,
} from "../packages/shared/src/index.js";
import { Store } from "../packages/storage/src/index.js";
import { VerificationRunner } from "../packages/verification/src/runner.js";
import { registerCapabilities } from "../packages/adapters/webmcp/src/index.js";
import type {
  Capability,
  Flow,
} from "../packages/capability-core/src/types.js";
import { startFixture } from "../apps/fixture/server.js";
import {
  capabilitiesForDiscovery,
  mineForDiscovery,
  canStartVerification,
  canApprove,
  canPublish,
  publishCapability,
  disableCapability,
} from "../apps/server/src/capabilities.js";

// Exercises apps/server/src/capabilities.ts — the logic backing the new
// capability-registry routes added to apps/server/src/index.ts in this
// wave (GET/POST .../capabilities, .../capabilities/mine, and the
// verify/approve/publish/disable lifecycle routes). apps/server/src/index.ts
// itself requires a configured Auth0 session to exercise over HTTP, so this
// tests the same Store + helper-function logic the routes call directly
// (per the task's own "lightest approach that actually exercises the new
// routes" guidance), plus the real VerificationRunner/registerCapabilities
// for the verify/publish-gating assertions.

const PORT = 4360;
const box = { x: 0, y: 0, width: 10, height: 10 };
const basePolicy = {
  allowed: true,
  reason: "allowed",
  rule: "default",
  intent: "unknown" as const,
};

describe("capability registry routes (mining + dedupe)", () => {
  let dir: string;
  let store: Store;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "unfold-registry-"));
    store = new Store(join(dir, "db.sqlite"));
  });

  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("mining twice does not duplicate capability rows for the same discovery", () => {
    const ownerId = "owner-1";
    const config = ConfigSchema.parse({ baseUrl: "http://127.0.0.1:4174" });
    const project = store.createProject(
      {
        name: "Registry test project",
        description: "test",
        baseUrl: config.baseUrl,
        scanConfig: config,
      },
      ownerId,
    );
    const run = store.createRun(config, project.id, ownerId);

    const recipe = { id: "r1", seed: `${config.baseUrl}/projects`, steps: [] };
    const projectsState: AppState = {
      id: "state-projects",
      runId: run.id,
      url: `${config.baseUrl}/projects`,
      routeKey: "/projects",
      fingerprint: "fp-projects",
      fingerprintVersion: 1,
      fingerprintReason: "structure",
      structureTokens: [],
      title: "Projects",
      visibleRegionSummary: [],
      interactiveElementIds: ["search-input", "apply-filters"],
      discoveredAt: new Date().toISOString(),
      depth: 1,
      worker: 0,
      recipe,
      mainText: "Projects",
    };
    const searchInput: UIElement = {
      id: "search-input",
      stateId: projectsState.id,
      role: "textbox",
      accessibleName: "Project name",
      tag: "input",
      textSnippet: "",
      structuralSignature: "input#search",
      locatorCandidates: [],
      disabled: false,
      isSubmit: false,
      inputType: "text",
      box,
    };
    const applyFiltersElement: UIElement = {
      id: "apply-filters-el",
      stateId: projectsState.id,
      role: "button",
      accessibleName: "Apply filters",
      tag: "button",
      textSnippet: "Apply filters",
      structuralSignature: "button#apply-filters",
      locatorCandidates: [],
      disabled: false,
      isSubmit: true,
      box,
    };
    const applyFiltersAction: ActionEdge = {
      id: "action-apply-filters",
      runId: run.id,
      fromStateId: projectsState.id,
      toStateId: projectsState.id,
      elementId: applyFiltersElement.id,
      targetName: "Apply filters",
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
      beforeUrl: projectsState.url,
      afterUrl: projectsState.url,
    };
    const searchApiCall: ApiCall = {
      id: "call-1",
      runId: run.id,
      taskId: "task-search",
      actionId: applyFiltersAction.id,
      sequence: 0,
      method: "GET",
      url: `${config.baseUrl}/api/projects?query=Mobile`,
      resourceType: "fetch",
      status: 200,
      failed: false,
    };

    store.observation({
      state: projectsState,
      elements: [searchInput, applyFiltersElement],
      components: [],
      links: [],
      observedAt: new Date().toISOString(),
    });
    store.put("actions", run.id, applyFiltersAction);
    store.put("api_calls", run.id, searchApiCall);

    const firstPass = mineForDiscovery(store, project.id, run.id, ownerId);
    expect(firstPass).toHaveLength(1);
    expect(firstPass[0].name).toBe("Click Apply Filters");

    const secondPass = mineForDiscovery(store, project.id, run.id, ownerId);
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0].id).toBe(firstPass[0].id); // same row, not a new candidate

    const scoped = capabilitiesForDiscovery(store, project.id, run.id);
    expect(scoped).toHaveLength(1);
  });
});

describe("capability lifecycle gating (verify / approve / publish / disable)", () => {
  let fixtureServer: ReturnType<typeof startFixture>;
  let dir: string;
  let store: Store;

  beforeAll(() => {
    fixtureServer = startFixture(PORT);
    dir = mkdtempSync(join(tmpdir(), "unfold-lifecycle-"));
    store = new Store(join(dir, "db.sqlite"));
  });

  afterAll(async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  });

  const roleLocator = (value: string, name: string) => ({
    kind: "role" as const,
    value,
    name,
    expression: `getByRole('${value}', { name: '${name}' })`,
    uniqueAtDiscovery: true,
    verifiedAfterRestore: true,
    score: 1,
    reasons: ["role+name"],
    failures: [],
  });
  const placeholderLocator = (value: string) => ({
    kind: "placeholder" as const,
    value,
    expression: `getByPlaceholder('${value}')`,
    uniqueAtDiscovery: true,
    verifiedAfterRestore: true,
    score: 1,
    reasons: ["placeholder"],
    failures: [],
  });

  function buildFlow(): Flow {
    return {
      id: "flow-lifecycle",
      runId: "run-lifecycle",
      startUrl: `http://127.0.0.1:${PORT}/projects`,
      kind: "atomic",
      navigations: [],
      steps: [
        {
          elementSignature: "button#filter-toggle",
          locators: [roleLocator("button", "Show filters")],
          action: "click",
        },
        {
          elementSignature: "input#search",
          locators: [placeholderLocator("Find a project")],
          action: "fill",
          inputField: "project_name",
        },
        {
          elementSignature: "button[type=submit]",
          locators: [roleLocator("button", "Apply filters")],
          action: "click",
        },
      ],
      expectedRequest: { method: "GET", urlPattern: "/api/projects" },
    };
  }

  function buildCapability(
    flowId: string,
    status: Capability["status"] = "candidate",
  ): Capability {
    return {
      id: `cap-${status}-${Math.random().toString(36).slice(2)}`,
      projectId: "project-lifecycle",
      version: "1",
      name: "search_apply_filters",
      description: "Search projects by name.",
      inputSchema: {
        type: "object",
        properties: { project_name: { type: "string" } },
        required: ["project_name"],
      },
      flowId,
      risk: "read",
      status,
      evidenceRunIds: [],
      createdAt: new Date().toISOString(),
      preconditions: [],
      expectedOutcomes: [],
      requiredPermissions: [],
      dependencies: [],
      requiredCapabilityIds: [],
      evidenceKind: "api",
      evidenceKinds: ["api"],
    };
  }

  it("verify guard: cannot start a second verification while one is already testing", async () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    const capability = store.saveCapability(buildCapability(flow.id));

    expect(canStartVerification(capability)).toBe(true);

    const runner = new VerificationRunner(store);
    const pending = runner.run(capability.id);
    // The synchronous prefix of VerificationRunner.run() flips status to
    // "testing" before its first await, so by the time run() returns a
    // promise the guard should already observe "in progress".
    const mid = store.capability(capability.id)!;
    expect(canStartVerification(mid)).toBe(false);

    const finished = await pending;
    expect(["verified", "failed", "inconclusive"]).toContain(finished.status);
  }, 20000);

  it("verify eventually reaches a terminal state against the fixture", async () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    const capability = store.saveCapability(buildCapability(flow.id));

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id);

    expect(["verified", "failed", "inconclusive"]).toContain(run.status);
    const stored = store.capability(capability.id)!;
    expect(stored.status).not.toBe("candidate");
    expect(stored.status).not.toBe("testing");
  }, 20000);

  it("publish requires verified: a candidate/testing/failed capability cannot be published", () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    for (const status of [
      "candidate",
      "testing",
      "failed",
      "inconclusive",
    ] as const) {
      const capability = buildCapability(flow.id, status);
      expect(canPublish(capability)).toBe(false);
      expect(canApprove(capability)).toBe(false);
    }
    const verified = buildCapability(flow.id, "verified");
    expect(canPublish(verified)).toBe(true);
    expect(canApprove(verified)).toBe(true);
  });

  it("approve validates eligibility without transitioning state", () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    const verified = store.saveCapability(buildCapability(flow.id, "verified"));
    // approve is a confirmation step, not a state transition: status stays "verified".
    expect(canApprove(verified)).toBe(true);
    expect(verified.status).toBe("verified");
  });

  it("publish transitions verified -> published", () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    const verified = store.saveCapability(buildCapability(flow.id, "verified"));
    const published = publishCapability(store, verified);
    expect(published.status).toBe("published");
    expect(store.capability(verified.id)?.status).toBe("published");
  });

  it("disable is allowed from any status, including published", () => {
    const flow = buildFlow();
    store.saveFlow(flow);
    for (const status of [
      "candidate",
      "verified",
      "published",
      "failed",
    ] as const) {
      const capability = store.saveCapability(buildCapability(flow.id, status));
      const disabled = disableCapability(store, capability);
      expect(disabled.status).toBe("disabled");
    }
  });

  it("a disabled capability is excluded from registerCapabilities, even if previously published", async () => {
    const flow = buildFlow();
    const published = buildCapability(flow.id, "published");
    const disabled = {
      ...buildCapability(flow.id, "disabled"),
      name: "other_tool",
    };
    // See tests/webmcp-adapter.test.ts for why this dispatches on call
    // shape (string vs. zero-arg function) rather than a single
    // call-per-tool-with-an-arg assumption.
    const registeredNames: string[] = [];
    const page = {
      evaluate: async (fn: unknown) => {
        if (typeof fn === "string" && fn.includes("document.modelContext = {"))
          return undefined; // polyfill install
        if (typeof fn === "function" && fn.length === 0) return true; // feature-detection probe
        const name =
          typeof fn === "string"
            ? fn.match(/name:\s*"([^"]*)"/)?.[1]
            : undefined;
        if (name) registeredNames.push(name);
        return undefined;
      },
      exposeFunction: async () => {},
    };
    const result = await registerCapabilities(page as any, [
      { capability: published, flow },
      { capability: disabled, flow },
    ]);
    expect(result.registered).toEqual(["search_apply_filters"]);
    expect(result.registered).not.toContain("other_tool");
    expect(registeredNames).toEqual(["search_apply_filters"]);
  });
});
