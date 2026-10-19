import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import { startFixture } from "../apps/fixture/server.js";
import { observe } from "../packages/worker/src/observe.js";
import { ConfigSchema } from "../packages/shared/src/index.js";

// Proves observe() (packages/worker/src/observe.ts) finds a plain,
// non-semantic clickable control (<div>, no button/role/tabindex, no
// cursor:pointer either — how older enterprise UI toolkits like
// Kendo/Telerik often render controls) rather than returning zero
// interactive elements on a page built that way, which is exactly what was
// happening against a real target app: observe() found 0 elements on its
// first page, so the discovery worker had nothing to click and the run
// completed after a single route with no further exploration. Detection
// here is deliberately NOT keyed on any convention (role, tabindex, cursor
// style) — every element is a candidate, scoped only by basic structure
// (control-sized, not a wrapper around an already-found control).
const PORT = 4398;

describe("observe(): finds non-semantic controls regardless of styling convention", () => {
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

  it("includes the legacy div-as-button control as an interactive element", async () => {
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${PORT}/legacy-ui`;
    await page.goto(url);
    const config = ConfigSchema.parse({ baseUrl: url });

    const observation = await observe(
      page,
      "run",
      config,
      { id: "r", seed: url, steps: [] },
      0,
      1,
    );

    const legacy = observation.elements.find((e) =>
      e.accessibleName.includes("Run action"),
    );
    expect(legacy).toBeDefined();
    expect(legacy?.role).toBe("button");
  });
});
