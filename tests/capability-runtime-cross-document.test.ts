import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import { replayCapability } from "../packages/capability-runtime/src/replay.js";
import type {
  Capability,
  Flow,
} from "../packages/capability-core/src/types.js";

// Proves replayCapability's cross-document behavior against the fixture's
// genuine full-page-navigation flow: /projects -> click "Manage permissions"
// (a real <a href> anchor, no client-side router) -> /projects/:id/permissions
// -> select a role -> submit. Asserts the fixture's DURABLE effect (the
// stored role, read back via the authorized GET oracle) actually changes
// across two isolated calls with two different role values, not just that
// replayCapability returns status 200.
const PORT = 4300;

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
// The fixture's /projects table renders a "Manage permissions" link per row
// (same accessible name for every project), so a plain role+name locator
// would be ambiguous across rows. Scope to proj-1's specific href instead.
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

describe("replayCapability: cross-document flow", () => {
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

  it("navigates across documents and durably changes the stored role across two distinct calls", async () => {
    const page = await browser.newPage();
    const startUrl = `http://127.0.0.1:${PORT}/projects`;
    const permissionsUrl = `http://127.0.0.1:${PORT}/projects/proj-1/permissions`;

    const flow: Flow = {
      id: "flow-cross-doc-1",
      runId: "run-cross-doc-1",
      startUrl,
      kind: "cross_document",
      navigations: [permissionsUrl],
      steps: [
        {
          elementSignature: "a[href='/projects/proj-1/permissions']",
          locators: [cssLocator('a[href="/projects/proj-1/permissions"]')],
          action: "click",
        },
        {
          elementSignature: "select#role",
          locators: [roleLocator("combobox", "Access role")],
          action: "select",
          inputField: "role",
          requiresUrl: permissionsUrl,
        },
        {
          elementSignature: "button[type=submit]",
          locators: [roleLocator("button", "Save permissions")],
          action: "click",
          requiresUrl: permissionsUrl,
        },
      ],
      expectedRequest: {
        method: "POST",
        urlPattern: "/api/projects/proj-1/permissions",
      },
    };

    const capability: Capability = {
      id: "cap-cross-doc-1",
      projectId: "project-1",
      version: "1",
      name: "configure_project_permissions",
      description: "Set a project's access role across a full-page navigation.",
      inputSchema: {
        type: "object",
        properties: { role: { type: "string" } },
        required: ["role"],
      },
      flowId: flow.id,
      risk: "reversible_write",
      status: "testing",
      evidenceRunIds: ["run-cross-doc-1"],
      createdAt: new Date().toISOString(),
      preconditions: [],
      expectedOutcomes: [
        "Project's stored access role matches the submitted value",
      ],
      requiredPermissions: [],
      dependencies: [],
      requiredCapabilityIds: [],
      evidenceKind: "api",
      evidenceKinds: ["api"],
    };

    for (const role of ["editor", "admin"]) {
      await page.goto(startUrl);
      const result = await replayCapability(page, capability, flow, { role });
      expect(result.status).toBe(200);
      expect((result.results as { role: string }).role).toBe(role);

      // Independent durable-outcome check via the authorized read oracle —
      // not just trusting the POST response or the replay's return value.
      const confirmed = await page.evaluate(
        async (url) => (await fetch(url)).json(),
        `http://127.0.0.1:${PORT}/api/projects/proj-1/permissions`,
      );
      expect(confirmed.role).toBe(role);
    }

    await page.close();
  });
});
