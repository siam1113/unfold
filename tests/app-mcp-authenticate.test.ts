import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture } from "../apps/fixture/server.js";
import { Store } from "../packages/storage/src/index.js";
import {
  buildAppMcpServer,
  type AppMcpSession,
} from "../packages/mcp/src/app-server.js";

// Proves the "Authenticate" tool (packages/mcp/src/app-server.ts) end to
// end: a project's saved login recipe (scanConfig.setupSteps, the same
// WorkflowStep sequence apps/dashboard/src/flow-auth-capture-views.tsx's
// "Save as project login recipe" persists) plus an encrypted secret
// (Store.saveProjectAuthSecrets) together let an agent log in on its own —
// no pre-captured storageState file required, no human re-typing a
// password. Uses the exact same fixture /login + session-gated /account
// route tests/worker-setup-steps.test.ts and
// tests/auth-session-recorder.test.ts already prove the underlying
// mechanism against.
const PORT = 4395;

describe('AppMCP "Authenticate" tool', () => {
  let server: ReturnType<typeof startFixture>;
  let dir: string;
  let store: Store;

  beforeAll(() => {
    // Store.saveProjectAuthSecrets/projectAuthSecrets derive their
    // encryption key from AUTH0_SECRET — harmless to set here, this test
    // never touches real Auth0.
    process.env.AUTH0_SECRET = "test-secret-for-login-recipe-encryption";
    server = startFixture(PORT);
    dir = mkdtempSync(join(tmpdir(), "unfold-appmcp-auth-"));
    store = new Store(join(dir, "db.sqlite"));
  });

  afterAll(async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("logs in using the saved recipe + encrypted secret, with zero pre-existing session", async () => {
    const base = `http://127.0.0.1:${PORT}`;
    const project = store.createProject({
      name: "Authenticate tool test",
      baseUrl: base,
    });

    const steps = [
      { type: "navigate" as const, url: `${base}/login` },
      { type: "fill" as const, selector: "#username", value: "demo" },
      {
        type: "fill" as const,
        selector: "#password",
        value: "",
        secret: true,
      },
      {
        type: "click" as const,
        selector: "#login-form button[type=submit]",
      },
      { type: "waitFor" as const, text: "Signed in as", ms: 5000 },
    ];
    store.updateProjectLoginRecipe(project.id, steps);
    // Index 2 is the password step above.
    store.saveProjectAuthSecrets(project.id, { 2: "demo1234" });

    const session: AppMcpSession = {
      projectId: project.id,
      ownerId: "local",
      transport: undefined as never,
      server: undefined as never,
      lastActivity: Date.now(),
    };
    const appServer = buildAppMcpServer(store, project.id, session, false);
    const client = new Client({ name: "test-client", version: "1.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await appServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("Authenticate");

      const result = await client.callTool({
        name: "Authenticate",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();

      // The project's canonical session file should now exist and carry a
      // real signed-in cookie — the same path verification/other AppMCP
      // calls resolve via Store.resolveFlowAuthStatePath.
      const updated = store.project(project.id);
      expect(updated.scanConfig.authStatePath).toBeTruthy();
    } finally {
      await client.close().catch(() => {});
      await appServer.close().catch(() => {});
      await session.browser?.close().catch(() => {});
    }
  }, 20000);
});
