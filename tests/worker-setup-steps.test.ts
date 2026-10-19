import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture } from "../apps/fixture/server.js";
import { Store } from "../packages/storage/src/index.js";
import { Coordinator } from "../packages/core/src/index.js";
import type { AppState } from "../packages/shared/src/index.js";

// Proves ConfigSchema.setupSteps (packages/shared/src/index.ts) actually
// runs before discovery begins (packages/core/src/index.ts's
// Coordinator.start()) and its effect (the session cookie from logging in)
// carries into the real discovery worker context — not just a standalone
// script. Reuses the fixture's /login + session-gated /account route
// (apps/fixture/server.ts), built for the login-capture-wizard feature:
// with NO authStatePath and only setupSteps driving the login, a run
// seeded directly at /account must still land on real "Signed in as…"
// content instead of being redirected back to /login.
const PORT = 4397;

describe("ConfigSchema.setupSteps: runs once before discovery begins", () => {
  let server: ReturnType<typeof startFixture>;
  let dir: string;

  beforeAll(() => {
    server = startFixture(PORT);
    dir = mkdtempSync(join(tmpdir(), "unfold-setup-steps-"));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs in via setup steps and reaches the gated /account route", async () => {
    const store = new Store(join(dir, "run.sqlite"));
    const base = `http://127.0.0.1:${PORT}`;
    const run = store.createRun({
      name: "Setup steps proof",
      baseUrl: `${base}/account`,
      maxDepth: 0,
      maxActions: 5,
      maxStates: 5,
      concurrency: 1,
      settleMs: 80,
      navigationIntervalMs: 10,
      actionTimeoutMs: 5000,
      captureScreenshots: false,
      setupSteps: [
        { type: "navigate", url: `${base}/login` },
        { type: "fill", selector: "#username", value: "demo" },
        { type: "fill", selector: "#password", value: "demo1234" },
        { type: "click", selector: "#login-form button[type=submit]" },
        { type: "waitFor", text: "Signed in as", ms: 5000 },
      ],
    });

    await new Coordinator(store).start(run.id);

    expect(store.run(run.id).status).toBe("completed");
    const states = store.all<AppState>("states", run.id);
    expect(
      states.some(
        (s) =>
          s.url.includes("/account") && s.mainText.includes("Signed in as"),
      ),
    ).toBe(true);
    store.close();
  }, 15000);

  it("fails the run with a clear error when a setup step can't resolve", async () => {
    const store = new Store(join(dir, "run2.sqlite"));
    const base = `http://127.0.0.1:${PORT}`;
    const run = store.createRun({
      name: "Setup steps failure",
      baseUrl: `${base}/account`,
      maxDepth: 0,
      maxActions: 5,
      maxStates: 5,
      concurrency: 1,
      settleMs: 80,
      navigationIntervalMs: 10,
      actionTimeoutMs: 3000,
      captureScreenshots: false,
      setupSteps: [
        { type: "navigate", url: `${base}/login` },
        { type: "click", selector: "#does-not-exist" },
      ],
    });

    await expect(new Coordinator(store).start(run.id)).rejects.toThrow(
      /Setup step 2\/2/,
    );
    expect(store.run(run.id).status).toBe("failed");
    store.close();
  }, 15000);
});
