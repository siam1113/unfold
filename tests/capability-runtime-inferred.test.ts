import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import { replayCapability } from "../packages/capability-runtime/src/replay.js";
import type {
  Capability,
  Flow,
} from "../packages/capability-core/src/types.js";

// Proves replayCapability honestly reports "ran, no outcome to confirm"
// for an inferred flow (packages/mcp/src/mining-tools.ts's propose_capability
// with no `proof`, i.e. neither expectedRequest nor expectedNavigation set)
// rather than throwing FLOW_HAS_NO_EXPECTED_OUTCOME or hanging forever
// waiting for a response that was never going to come. The fixture's
// /projects "Show filters" toggle is a real, observable control that fires
// no network call and no navigation — exactly the shape an inferred
// capability's flow has.
const PORT = 4399;

const cssLocator = (value: string) => ({
  kind: "css" as const,
  value,
  expression: `locator('${value}')`,
  uniqueAtDiscovery: true,
  verifiedAfterRestore: true,
  score: 1,
  reasons: ["css"],
  failures: [],
});

function makeInferredFlow(): Flow {
  return {
    id: "flow-inferred",
    runId: "run-1",
    startUrl: `http://127.0.0.1:${PORT}/projects`,
    kind: "atomic",
    navigations: [],
    steps: [
      {
        elementSignature: "button#filter-toggle",
        locators: [cssLocator("#filter-toggle")],
        action: "click",
      },
    ],
    // Deliberately neither set — the inferred case.
    expectedRequest: undefined,
    expectedNavigation: undefined,
  };
}

function makeCapability(flowId: string): Capability {
  return {
    id: "cap-inferred",
    projectId: "project-1",
    version: "1",
    name: "Show Project Filters",
    description: "Toggle the project filters panel open.",
    inputSchema: { type: "object", properties: {}, required: [] },
    flowId,
    risk: "read",
    status: "candidate",
    evidenceRunIds: ["run-1"],
    createdAt: new Date().toISOString(),
    preconditions: [],
    expectedOutcomes: [],
    requiredPermissions: [],
    dependencies: ["/projects"],
    requiredCapabilityIds: [],
    evidenceKinds: ["inferred"],
  };
}

describe("replayCapability: inferred (no-proof) flow", () => {
  let server: ReturnType<typeof startFixture>;
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    server = startFixture(PORT);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("performs the real action and returns status 0 / undefined results instead of throwing or hanging", async () => {
    const page = await browser.newPage();
    const flow = makeInferredFlow();
    const capability = makeCapability(flow.id);

    const result = await replayCapability(page, capability, flow, {});
    expect(result.status).toBe(0);
    expect(result.results).toBeUndefined();

    // The action genuinely happened — not a no-op fallback.
    const expanded = await page
      .locator("#filter-toggle")
      .getAttribute("aria-expanded");
    expect(expanded).toBe("true");
    await page.close();
  });
});
