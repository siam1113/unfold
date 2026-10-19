import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import { Store } from "../packages/storage/src/index.js";
import { VerificationRunner } from "../packages/verification/src/runner.js";
import type {
  Capability,
  Flow,
} from "../packages/capability-core/src/types.js";

// Exercises the real verification runner (plan §9 stages A-F) against the
// fixture app with a real headless Playwright browser, same pattern as
// tests/webmcp-integration.test.ts. Three intentionally-crafted cases prove
// the state machine actually computes verified/failed/inconclusive rather
// than having those statuses hand-set.
const PORT = 4350;
const DEAD_PORT = 4351; // nothing listens here: used to force a connection failure

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

// A UI-outcome flow (Flow.expectedNavigation, no expectedRequest): clicking
// the fixture overview page's "View activity" link triggers a real
// full-page navigation to /activity, with no XHR/fetch proof at all — the
// shape mineUIOutcomeCapabilities produces for a server-rendered
// submit-and-navigate flow. This is also the one flow shape that proves
// Stage F's WebMCP tool execution actually survives a real navigation: the
// tool's execute() calls back into Node (window.__hynixExecute ->
// replayCapability) and that callback's own navigation tears down the very
// JS realm the page.evaluate(executeTool(...)) call is suspended in,
// throwing "Execution context was destroyed" from Playwright's side even
// though the capability worked exactly as intended — runner.ts must catch
// that specific case for a navigation-proven flow and fall back to
// checking page.url() instead of treating it as a real failure.
function buildNavigationFlow(startUrl: string, urlPattern: string): Flow {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    startUrl,
    kind: "atomic",
    navigations: [],
    steps: [
      {
        elementSignature: "a[href='/activity']",
        locators: [roleLocator("link", "View activity")],
        action: "click",
      },
    ],
    expectedNavigation: { urlPattern },
  };
}

function buildSearchFlow(startUrl: string, urlPattern: string): Flow {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    startUrl,
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
    expectedRequest: { method: "GET", urlPattern },
  };
}

function buildCapability(flowId: string, secondaryFlowId?: string): Capability {
  return {
    id: randomUUID(),
    projectId: "project-1",
    version: "1",
    name: "search_apply_filters",
    description: "Search projects by name.",
    inputSchema: {
      type: "object",
      properties: { project_name: { type: "string" } },
      required: ["project_name"],
    },
    flowId,
    secondaryFlowId,
    risk: "read",
    status: "candidate",
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

describe("VerificationRunner", () => {
  let server: ReturnType<typeof startFixture>;
  let dir: string;
  let store: Store;

  beforeAll(() => {
    server = startFixture(PORT);
    dir = mkdtempSync(join(tmpdir(), "unfold-verify-"));
    process.env.UNFOLD_DATA_DIR = dir;
    store = new Store(join(dir, "db.sqlite"));
  });

  afterAll(async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("ends verified with 3 passes when the flow truly replays and the adapter contract holds", async () => {
    const flow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/projects",
    );
    store.saveFlow(flow);
    const capability = buildCapability(flow.id);
    store.saveCapability(capability);

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id);

    expect(run.passCount).toBe(3);
    expect(run.evidenceIds.length).toBe(3);
    expect(run.status).toBe("verified");
  }, 30000);

  // Regression test: Stage F's WebMCP tool execution used to surface
  // Playwright's "Execution context was destroyed, most likely because of
  // a navigation" as a hard adapter_execution_error for any
  // navigation-proven flow, since the real click-and-navigate the tool
  // triggers tears down the JS realm the executeTool() call is suspended
  // in before it can resolve. See runner.ts's catch branch around
  // `/execution context was destroyed/i`.
  it("ends verified for a navigation-proven flow even though Stage F's real navigation destroys the executeTool() JS realm", async () => {
    const flow = buildNavigationFlow(`http://127.0.0.1:${PORT}/`, "/activity");
    store.saveFlow(flow);
    const capability = buildCapability(flow.id);
    store.saveCapability(capability);

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id);

    expect(run.passCount).toBe(3);
    expect(run.status).toBe("verified");
    expect(run.failureCategories).not.toContain("adapter_execution_error");
    expect(store.capability(capability.id)?.status).toBe("verified");
  }, 30000);

  it("ends failed, never verified, when the expected network response never arrives", async () => {
    const flow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/does-not-exist",
    );
    store.saveFlow(flow);
    const capability = buildCapability(flow.id);
    store.saveCapability(capability);

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id);

    expect(run.status).toBe("failed");
    expect(run.status).not.toBe("verified");
    expect(store.capability(capability.id)?.status).toBe("failed");
    expect(store.capability(capability.id)?.status).not.toBe("verified");
  }, 20000);

  it("ends inconclusive with a single bounded connection attempt when the environment is unreachable", async () => {
    const flow = buildSearchFlow(
      `http://127.0.0.1:${DEAD_PORT}/projects`,
      "/api/projects",
    );
    store.saveFlow(flow);
    const capability = buildCapability(flow.id);
    store.saveCapability(capability);

    const runner = new VerificationRunner(store);
    const start = Date.now();
    const run = await runner.run(capability.id);
    const elapsed = Date.now() - start;

    expect(run.status).toBe("inconclusive");
    expect(run.passCount).toBe(0);
    // One connection failure stops the run outright (no blind retry loop):
    // well under 3 attempts' worth of the 10s navigation timeout.
    expect(elapsed).toBeLessThan(15000);
  }, 20000);

  it("threads options.headless through to the injected browser-launch factory", async () => {
    const flow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/projects",
    );
    store.saveFlow(flow);
    const capability = buildCapability(flow.id);
    store.saveCapability(capability);

    let capturedHeadless: boolean | undefined;
    const runner = new VerificationRunner(store, (headless) => {
      capturedHeadless = headless;
      // Actually launch headless regardless of what's requested — this test
      // only cares that the option was threaded through, not that a real
      // headed browser can start in CI.
      return chromium.launch({ headless: true });
    });
    await runner.run(capability.id, { headless: false });

    expect(capturedHeadless).toBe(false);
  }, 30000);

  it("verifies an explicit flowId override rather than the capability's primary flow", async () => {
    const primaryFlow = buildSearchFlow(
      `http://127.0.0.1:${DEAD_PORT}/projects`,
      "/api/projects",
    );
    const secondaryFlow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/projects",
    );
    store.saveFlow(primaryFlow);
    store.saveFlow(secondaryFlow);
    const capability = buildCapability(primaryFlow.id, secondaryFlow.id);
    store.saveCapability(capability);

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id, { flowId: secondaryFlow.id });

    expect(run.flowId).toBe(secondaryFlow.id);
    expect(run.status).toBe("verified");
  }, 30000);

  it("rolls the capability status up to verified once any flow has ever passed, without regressing a later failing attempt on the OTHER flow, while each flow's own run keeps its honest outcome", async () => {
    const workingFlow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/projects",
    );
    const brokenFlow = buildSearchFlow(
      `http://127.0.0.1:${PORT}/projects`,
      "/api/does-not-exist",
    );
    store.saveFlow(workingFlow);
    store.saveFlow(brokenFlow);
    const capability = buildCapability(brokenFlow.id, workingFlow.id);
    store.saveCapability(capability);

    // Seed the OTHER flow (workingFlow, the capability's secondary) as
    // already verified from a prior attempt, without re-running a real
    // replay for it — only the rollup logic under test needs this to exist.
    store.saveVerificationRun({
      id: randomUUID(),
      capabilityId: capability.id,
      flowId: workingFlow.id,
      status: "verified",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      passCount: 3,
      failureCategories: [],
      evidenceIds: [],
    });

    const runner = new VerificationRunner(store);
    const run = await runner.run(capability.id, { flowId: brokenFlow.id });

    // This run's own record is honest — the broken flow really did fail.
    expect(run.flowId).toBe(brokenFlow.id);
    expect(run.status).toBe("failed");
    // But the capability-level rollup stays verified: the OTHER flow
    // (workingFlow) already proved the capability usable, and a failing
    // attempt on brokenFlow must not regress that.
    expect(store.capability(capability.id)?.status).toBe("verified");
  }, 20000);
});
