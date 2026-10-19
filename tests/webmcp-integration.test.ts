import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import { registerCapabilities } from "../packages/adapters/webmcp/src/index.js";
import type {
  Capability,
  CapabilityCandidate,
  Flow,
} from "../packages/capability-core/src/types.js";

// End-to-end proof of the full loop: a mined capability, replayed with a
// NEW agent-supplied value (not the one originally observed), registered as
// a real WebMCP tool, and invoked the way an external agent would.
//
// Chrome 146 Canary behind an experimental flag is the only real
// `document.modelContext` implementation as of this writing (see
// hynix_webmcp_extension_plan.md research notes), and it isn't available in
// this environment. This test installs a minimal in-page shim matching the
// spec's `registerTool`/`executeTool` surface so the adapter's contract
// (feature-detect, bridge execute to Node, only register verified
// capabilities) is exercised exactly as it would be against the native API.
const PORT = 4299;

const box = { x: 0, y: 0, width: 10, height: 10 };
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

describe("WebMCP end-to-end: mine -> replay -> tool -> outcome", () => {
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

  it("invokes search_apply_filters with a new query and returns the correct filtered result", async () => {
    const page = await browser.newPage();
    const startUrl = `http://127.0.0.1:${PORT}/projects`;
    await page.goto(startUrl);

    // Shim document.modelContext per the W3C WebMCP draft's registerTool/executeTool surface.
    await page.evaluate(() => {
      (window as any).__hynixTools = new Map();
      (document as any).modelContext = {
        registerTool(tool: any) {
          (window as any).__hynixTools.set(tool.name, tool);
          return Promise.resolve();
        },
        executeTool(name: string, input: Record<string, unknown>) {
          const tool = (window as any).__hynixTools.get(name);
          if (!tool) throw new Error(`Unknown tool: ${name}`);
          return tool.execute(input);
        },
      };
    });

    const flow: Flow = {
      id: "flow-1",
      runId: "run-1",
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
      expectedRequest: { method: "GET", urlPattern: "/api/projects" },
    };

    const capability: Capability = {
      id: "cap-1",
      projectId: "project-1",
      version: "1",
      name: "search_apply_filters",
      description: "Search projects by name.",
      inputSchema: {
        type: "object",
        properties: { project_name: { type: "string" } },
        required: ["project_name"],
      },
      flowId: flow.id,
      risk: "read",
      status: "published",
      evidenceRunIds: ["run-1"],
      createdAt: new Date().toISOString(),
      preconditions: [],
      expectedOutcomes: [],
      requiredPermissions: [],
      dependencies: [],
      requiredCapabilityIds: [],
      evidenceKind: "api",
      evidenceKinds: ["api"],
    };

    const unverifiedCapability: Capability = {
      ...capability,
      id: "cap-2",
      name: "create_project",
      status: "candidate",
      risk: "reversible_write",
    };

    const candidates: CapabilityCandidate[] = [
      { capability, flow },
      { capability: unverifiedCapability, flow },
    ];

    const registration = await registerCapabilities(page, candidates);
    expect(registration.unavailable).toBe(false);
    expect(registration.registered).toEqual(["search_apply_filters"]);

    // Repeatability gate: three isolated calls with distinct queries, all
    // returning the correct business outcome (not just a 200).
    for (const [query, expectedNames] of [
      ["Mobile", ["Mobile experience"]],
      ["Brand", ["Brand guidelines"]],
      ["zzz-no-match", []],
    ] as const) {
      const result: any = await page.evaluate(
        ([name, input]) =>
          (document as any).modelContext.executeTool(name, input),
        ["search_apply_filters", { project_name: query }] as const,
      );
      expect(result.status).toBe(200);
      expect(result.results.map((p: any) => p.name)).toEqual(expectedNames);
    }

    await page.close();
  });
});
