import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import {
  stabilize,
  trackPageRequests,
} from "../packages/worker/src/observe.js";

// Proves stabilize() (packages/worker/src/observe.ts) actually waits out a
// busy indicator and a pending network request, not just DOM-mutation
// silence — the two cases a mutation-only debounce misses (see the fixture's
// /lab page, apps/fixture/index.html, built specifically to exercise them):
//   - "Run report": sets aria-busy, then goes quiet for 800ms with zero DOM
//     mutations, then clears aria-busy and swaps in the final text. A
//     mutation-only wait declares victory during that 800ms gap.
//   - "Load data": click causes no DOM mutation at all; a fetch resolves
//     800ms later and only then renders. A mutation-only wait declares
//     victory almost immediately, before the fetch even finishes.
const PORT = 4390;

describe("stabilize(): waits out busy indicators and pending network, not just DOM silence", () => {
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

  it("waits for an aria-busy indicator to clear before returning", async () => {
    const page = await browser.newPage();
    trackPageRequests(page);
    await page.goto(`http://127.0.0.1:${PORT}/lab`);

    await page.click("#lab-report-button");
    await stabilize(page, 250);

    expect(await page.textContent("#lab-report-result")).toBe("Report ready");
    expect(await page.getAttribute("#lab-report-result", "aria-busy")).toBe(
      null,
    );
  });

  it("waits for a pending fetch to resolve and render before returning", async () => {
    const page = await browser.newPage();
    trackPageRequests(page);
    await page.goto(`http://127.0.0.1:${PORT}/lab`);

    await page.click("#lab-data-button");
    await stabilize(page, 250);

    expect(await page.textContent("#lab-data-result")).toBe("Loaded: 3 items");
  });
});
