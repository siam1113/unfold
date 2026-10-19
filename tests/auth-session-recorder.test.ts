import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import {
  RECORDER_SCRIPT,
  buildLoginSteps,
  type RecordedEvent,
} from "../apps/server/src/auth-capture.js";
import { runSetupSteps } from "../packages/worker/src/workflow-runner.js";

// Proves the two halves of the auto-record-then-headless-replay feature
// independently of the server/dashboard plumbing around them:
//
// 1. RECORDER_SCRIPT (the exact source injected into the real login-capture
//    browser, apps/server/src/auth-capture.ts's openAuthCapture) correctly
//    turns real clicks/fills on the fixture's /login form into
//    RecordedEvent entries — crucially, that the password field's value
//    never reaches the recorded event at all (recorded empty + secret:true
//    at the SOURCE, in the browser, not redacted after the fact).
// 2. buildLoginSteps's conversion of those events, replayed headlessly via
//    runSetupSteps (the same engine discovery's own setupSteps already use
//    — proven separately in tests/worker-setup-steps.test.ts) with the real
//    password supplied only as an in-memory `secrets` value, actually logs
//    in and reaches the gated /account route — the full round trip a
//    "Refresh session" action performs.
const PORT = 4396;

describe("auth session auto-recording: record real interaction, replay headlessly", () => {
  let server: ReturnType<typeof startFixture>;
  let browser: Browser;

  beforeAll(async () => {
    server = startFixture(PORT);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("records username fill, password fill (redacted at the source), and submit click — then replays them headlessly to a real signed-in session", async () => {
    const base = `http://127.0.0.1:${PORT}`;
    const recorded: RecordedEvent[] = [];

    const page = await browser.newPage();
    await page.exposeFunction("__unfoldRecordStep", (event: RecordedEvent) =>
      recorded.push(event),
    );
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    // The real page is already loaded (unlike openAuthCapture, which injects
    // via addInitScript before any navigation) — evaluate the exact same
    // source directly to install the same listeners on this document.
    await page.evaluate(RECORDER_SCRIPT);

    // A real user's interaction: type a username, type a password, submit.
    await page.fill("#username", "demo");
    await page.fill("#password", "demo1234");
    await page.click("#login-form button[type=submit]");
    await page.waitForURL(/\/account$/);
    await page.close();

    const fills = recorded.filter((e) => e.kind === "fill");
    const clicks = recorded.filter((e) => e.kind === "click");
    const usernameFill = fills.find((e) => e.selector.includes("username"));
    const passwordFill = fills.find((e) => e.selector.includes("password"));

    expect(usernameFill?.value).toBe("demo");
    expect(usernameFill?.secret).toBeFalsy();
    // The password's real value must never appear in the recorded event at
    // all — not merely redacted downstream.
    expect(passwordFill?.secret).toBe(true);
    expect(passwordFill?.value).toBe("");
    expect(clicks.length).toBeGreaterThan(0);

    const steps = buildLoginSteps(`${base}/login`, recorded);
    expect(steps[0]).toEqual({ type: "navigate", url: `${base}/login` });
    const passwordStepIndex = steps.findIndex(
      (s) => s.type === "fill" && s.secret,
    );
    expect(passwordStepIndex).toBeGreaterThan(0);
    // Persisted recipe must never carry the real password, matching what
    // the browser-side recorder already enforced above.
    const persistedPasswordStep = steps[passwordStepIndex];
    expect(
      persistedPasswordStep.type === "fill" && persistedPasswordStep.value,
    ).toBe("");

    // Replay headlessly — a fresh context, exactly the "Refresh session"
    // flow — supplying the real password only in-memory via `secrets`.
    const context = await browser.newContext();
    const replayPage = await context.newPage();
    try {
      await runSetupSteps(context, replayPage, base, steps, undefined, {
        [passwordStepIndex]: "demo1234",
      });
      await replayPage.waitForURL(/\/account$/);
      const state = await context.storageState();
      expect(state.cookies.some((c) => c.name === "atlas_session")).toBe(true);
    } finally {
      await context.close();
    }
  }, 20000);
});
