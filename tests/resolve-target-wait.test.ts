import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { resolveTarget } from "../packages/worker/src/observe.js";
import type { LocatorCandidate } from "../packages/shared/src/index.js";

// Proves the actual bug behind verification's "locator_unreachable — the
// page is not loaded yet" reports: resolveTarget (packages/worker/src/observe.ts)
// used to check its candidates exactly ONCE and throw immediately if none
// resolved — no retry, no wait, regardless of any configured timeout. A
// verification run's "Action" timeout (apps/dashboard/src/flow-verification-wizard.tsx)
// only ever reached Playwright's own setDefaultTimeout(), which has zero
// effect on resolveTarget's non-waiting .count()/.isVisible()/.isEnabled()
// Locator queries — so a target that existed a few hundred milliseconds
// after resolveTarget was first called (a client-rendered page still
// mounting content right after its `load` event) failed outright no matter
// how generous the configured timeout was.
const candidateFor = (selector: string): LocatorCandidate[] => [
  {
    kind: "css",
    value: selector,
    expression: `locator('${selector}')`,
    uniqueAtDiscovery: true,
    verifiedAfterRestore: true,
    score: 1,
    reasons: ["css"],
    failures: [],
  },
];

describe("resolveTarget: waits for a late-appearing target when given a timeout", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it("throws immediately (no retry) when no timeout is given — the original, unchanged default", async () => {
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    await page.evaluate(() => {
      setTimeout(() => {
        const b = document.createElement("button");
        b.id = "late";
        b.textContent = "Click me";
        document.body.appendChild(b);
      }, 400);
    });

    const start = Date.now();
    await expect(resolveTarget(page, candidateFor("#late"))).rejects.toThrow(
      /LOCATOR_UNREACHABLE/,
    );
    // Proves it failed fast — not by coincidentally waiting past the 400ms
    // the element needed, which would mask the bug this test exists to catch.
    expect(Date.now() - start).toBeLessThan(300);
    await page.close();
  });

  it("polls and succeeds once a timeout is given, even though the target doesn't exist yet when called", async () => {
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    await page.evaluate(() => {
      setTimeout(() => {
        const b = document.createElement("button");
        b.id = "late";
        b.textContent = "Click me";
        document.body.appendChild(b);
      }, 400);
    });

    const target = await resolveTarget(page, candidateFor("#late"), 2000);
    expect(await target.textContent()).toBe("Click me");
    await page.close();
  });
});
