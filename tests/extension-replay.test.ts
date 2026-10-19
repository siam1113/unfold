import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { buildSync } from "esbuild";
import { startFixture } from "../apps/fixture/server.js";

const PORT = 4380;

// apps/extension/src/replay.ts is a pure-browser-JS module with no Node/
// Playwright dependency — it has to run unmodified inside a real page's own
// JS world (content-main.ts, a MAIN-world content script with zero chrome.*
// or Node access). This bundles the real source with esbuild (format: iife,
// globalName exposes every export as a property of that global) and injects
// it into a real Playwright page via `page.addScriptTag`, then exercises it
// exactly the way content-main.ts does — through its public
// `replayInBrowser`/`isFlowSupported` functions — rather than mocking the
// DOM, matching this repo's existing "real browser, not a virtualized DOM"
// testing convention (tests/verification-runner.test.ts,
// tests/webmcp-integration.test.ts).
const bundle = buildSync({
  entryPoints: [`${import.meta.dirname}/../apps/extension/src/replay.ts`],
  bundle: true,
  format: "iife",
  globalName: "UnfoldReplay",
  write: false,
  target: "chrome120",
}).outputFiles[0].text;

describe("apps/extension's client-side replay engine", () => {
  let browser: Browser;
  let page: Page;
  let fixtureServer: ReturnType<typeof startFixture>;

  beforeAll(async () => {
    fixtureServer = startFixture(PORT);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    // page.setContent() keeps the page's CURRENT origin rather than resetting
    // to about:blank — but a freshly-created page already starts there, so
    // without a real navigation first, `history.pushState` (used by the
    // expectedNavigation test below) throws a SecurityError against
    // about:blank's opaque origin. One real same-origin navigation up front
    // gives every subsequent `setContent()` call a real http: origin to
    // pushState against, matching how an actual page in a real browser tab
    // (this engine's actual target) always has one.
    await page.goto(`http://127.0.0.1:${PORT}/`);
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  });

  async function setup(html: string) {
    await page.setContent(html);
    await page.addScriptTag({ content: bundle });
  }

  it("clicks an element resolved via a testId locator", async () => {
    await setup(
      `<button data-testid="go" onclick="window.__clicked = true">Go</button>`,
    );
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "go", score: 10 }],
            },
          ],
        },
        {},
      ),
    );
    expect(result.ok).toBe(true);
    const clicked = await page.evaluate(() => (window as any).__clicked);
    expect(clicked).toBe(true);
  });

  it("fills an input via a placeholder locator, dispatching input/change for a React-style listener", async () => {
    await setup(`
      <input placeholder="Name" />
      <script>
        document.querySelector("input").addEventListener("input", (e) => { window.__value = e.target.value; });
      </script>
    `);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "fill",
              inputField: "name",
              locators: [{ kind: "placeholder", value: "Name", score: 10 }],
            },
          ],
        },
        { name: "Ada" },
      ),
    );
    expect(result.ok).toBe(true);
    const value = await page.evaluate(() => (window as any).__value);
    expect(value).toBe("Ada");
  });

  it("rejects a step whose only locators are role/label, without throwing", async () => {
    await setup(`<button role="button" aria-label="Submit">Go</button>`);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [
                { kind: "role", value: "button", name: "Submit", score: 10 },
              ],
            },
          ],
        },
        {},
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("UNSUPPORTED_LOCATOR");
  });

  it("isFlowSupported is false for a flow with any role/label-only step", async () => {
    const supported = await page.evaluate(() =>
      (window as any).UnfoldReplay.isFlowSupported({
        startUrl: location.href,
        steps: [
          {
            action: "click",
            locators: [{ kind: "css", value: "#a", score: 1 }],
          },
          {
            action: "click",
            locators: [{ kind: "role", value: "button", score: 1 }],
          },
        ],
      }),
    );
    expect(supported).toBe(false);
  });

  it("never resolves a disabled element even when it's the only match", async () => {
    await setup(`<button data-testid="go" disabled>Go</button>`);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "go", score: 10 }],
            },
          ],
        },
        {},
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("LOCATOR_UNREACHABLE");
  });

  it("verifies expectedNavigation proof by polling location.pathname after the final step", async () => {
    await setup(
      `<a data-testid="go" href="#" onclick="history.pushState({}, '', '/done')">Go</a>`,
    );
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "go", score: 10 }],
            },
          ],
          expectedNavigation: { urlPattern: "/done" },
        },
        {},
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("reports verified:false, never a false positive, when expectedNavigation never happens", async () => {
    await setup(`<button data-testid="go">Go</button>`);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "go", score: 10 }],
            },
          ],
          expectedNavigation: { urlPattern: "/never-happens" },
        },
        {},
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
  }, 15000);

  // Regression coverage for the real bug this feature fixes: calling a
  // WebMCP tool whose target element only exists after some OTHER action
  // already happened on the page (e.g. "Continue shopping from cart" only
  // has a target once "go to cart" navigated there) used to fail with a
  // bare LOCATOR_UNREACHABLE and no indication of what else was needed.
  it("auto-remediates a first-step LOCATOR_UNREACHABLE by replaying a declared prerequisite flow once, then succeeds", async () => {
    await setup(`
      <button data-testid="reveal" onclick="document.getElementById('target').hidden = false">Reveal</button>
      <button id="target" data-testid="target" hidden onclick="window.__targetClicked = true">Target</button>
    `);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "target", score: 10 }],
            },
          ],
        },
        {},
        [
          {
            name: "reveal_target",
            available: true,
            flow: {
              startUrl: location.href,
              steps: [
                {
                  action: "click",
                  locators: [
                    { kind: "testId", value: "reveal", score: 10 },
                  ],
                },
              ],
            },
          },
        ],
      ),
    );
    expect(result.ok).toBe(true);
    const clicked = await page.evaluate(() => (window as any).__targetClicked);
    expect(clicked).toBe(true);
  });

  it("names the unmet prerequisite in the error when remediation can't help", async () => {
    await setup(`<button data-testid="target" hidden>Target</button>`);
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "target", score: 10 }],
            },
          ],
        },
        {},
        [{ name: "some_prerequisite", available: false }],
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("PRECONDITION_UNMET");
    expect(result.message).toContain("some_prerequisite");
    expect(result.message).toContain("not available");
  });

  it("reports verified:false with an honest note for an expectedRequest-only flow, never a false positive", async () => {
    await setup(
      `<button data-testid="go" onclick="window.__clicked = true">Go</button>`,
    );
    const result = await page.evaluate(() =>
      (window as any).UnfoldReplay.replayInBrowser(
        {
          startUrl: location.href,
          steps: [
            {
              action: "click",
              locators: [{ kind: "testId", value: "go", score: 10 }],
            },
          ],
          expectedRequest: { method: "POST", urlPattern: "/api/do-thing" },
        },
        {},
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.message).toContain("Network completion isn't verified");
  });
});
