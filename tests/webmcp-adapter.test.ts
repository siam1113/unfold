import { describe, it, expect, vi } from "vitest";
import {
  toModelContextTool,
  registerCapabilities,
} from "../packages/adapters/webmcp/src/index.js";
import type {
  Capability,
  CapabilityCandidate,
  Flow,
} from "../packages/capability-core/src/types.js";

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
  flowId: "flow-1",
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

const flow: Flow = {
  id: "flow-1",
  runId: "run-1",
  startUrl: "http://127.0.0.1:4174/projects",
  kind: "atomic",
  navigations: [],
  steps: [],
  expectedRequest: { method: "GET", urlPattern: "/api/projects" },
};

describe("toModelContextTool", () => {
  it("maps a read capability onto the WebMCP tool shape", () => {
    const tool = toModelContextTool(capability);
    expect(tool.name).toBe("search_apply_filters");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      consequentialHint: false,
    });
    expect(tool.inputSchema).toBe(capability.inputSchema);
  });

  it("slugifies names outside WebMCP's allowed character set", () => {
    const tool = toModelContextTool({
      ...capability,
      name: "search projects!",
    });
    expect(tool.name).toBe("search_projects_");
  });

  it("marks non-read capabilities as consequential", () => {
    const tool = toModelContextTool({
      ...capability,
      risk: "reversible_write",
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: true,
    });
  });
});

// `registerCapabilities` now makes 3 kinds of `page.evaluate` calls:
// (1) the polyfill install — a long source STRING (never a function, see
//     packages/adapters/webmcp/src/polyfill.ts's doc comment on why);
// (2) the `"modelContext" in document` feature-detect — a zero-arg function;
// (3) one source STRING per registered tool, with its name/description/etc
//     inlined via JSON.stringify rather than passed as a second `arg` —
//     also to avoid Function.prototype.toString()-serialization pitfalls.
// These mocks dispatch on call shape (string vs. function) rather than the
// old single-call-per-tool-with-an-arg assumption.
function isPolyfillInstall(fn: unknown): boolean {
  return typeof fn === "string" && fn.includes("document.modelContext = {");
}
function toolNameFromSource(fn: unknown): string | undefined {
  if (typeof fn !== "string") return undefined;
  return fn.match(/name:\s*"([^"]*)"/)?.[1];
}

describe("registerCapabilities", () => {
  it("reports unavailable without throwing when document.modelContext is absent", async () => {
    const page = {
      evaluate: vi.fn(async (fn: unknown) => {
        if (isPolyfillInstall(fn)) return undefined;
        if (typeof fn === "function" && fn.length === 0) return false; // feature-detection probe
        return undefined;
      }),
      exposeFunction: vi.fn(),
    };
    const result = await registerCapabilities(page as any, [
      { capability, flow },
    ] satisfies CapabilityCandidate[]);
    expect(result).toEqual({ registered: [], unavailable: true });
    expect(page.exposeFunction).not.toHaveBeenCalled();
  });

  it("never registers a candidate/testing capability, only published ones", async () => {
    const registeredNames: string[] = [];
    const page = {
      evaluate: vi.fn(async (fn: unknown) => {
        if (isPolyfillInstall(fn)) return undefined;
        if (typeof fn === "function" && fn.length === 0) return true; // feature-detection probe
        const name = toolNameFromSource(fn);
        if (name) registeredNames.push(name);
        return undefined;
      }),
      exposeFunction: vi.fn(async () => {}),
    };
    const candidates: CapabilityCandidate[] = [
      { capability, flow },
      {
        capability: {
          ...capability,
          id: "cap-2",
          name: "create_project",
          status: "candidate",
        },
        flow,
      },
    ];
    const result = await registerCapabilities(page as any, candidates);
    expect(result.unavailable).toBe(false);
    expect(result.registered).toEqual(["search_apply_filters"]);
    expect(registeredNames).toEqual(["search_apply_filters"]);
  });
});
