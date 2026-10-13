import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:4310/api/health");
    if (response.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch({
  executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:4310");
  await page
    .getByRole("heading", { name: "Flow explorer", exact: true })
    .waitFor();
  await page.locator(".state-node").first().waitFor();
  await page.waitForTimeout(1000);
  await mkdir(".local/ui-check", { recursive: true });
  await page.screenshot({
    path: ".local/ui-check/flow-explorer.png",
    fullPage: true,
  });
  await page.locator(".state-node").first().click();
  await page.getByRole("dialog", { name: "State inspector" }).waitFor();
  await page.getByRole("button", { name: /controls \(/ }).click();
  assert((await page.locator(".locator").count()) > 0);
  await page.screenshot({
    path: ".local/ui-check/state-inspector.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("link", { name: /Components/ }).click();
  await page.getByRole("heading", { name: "Component library" }).waitFor();
  await page.locator(".table-name").first().click();
  assert((await page.locator(".component-detail").count()) === 1);
  await page.screenshot({
    path: ".local/ui-check/components.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Interactions", exact: true }).click();
  await page.getByRole("heading", { name: "Interaction log" }).waitFor();
  await page.getByRole("button", { name: /Safely skipped/ }).click();
  assert((await page.locator(".action-table tbody tr").count()) > 0);
  await page.locator(".action-table tbody tr").first().click();
  await page.getByRole("dialog", { name: "Interaction evidence" }).waitFor();
  await page.screenshot({
    path: ".local/ui-check/action-evidence.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page
    .getByRole("button", { name: "New discovery", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Let’s unfold your application." })
    .waitFor();
  await page.getByRole("button", { name: "Advanced configuration" }).click();
  await page.getByLabel("Additional configuration (JSON)").fill("{bad");
  await page.getByRole("button", { name: "Start discovery" }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "All discoveries" }).click();
  await page
    .getByRole("heading", { name: "Discover what’s possible." })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: ".local/ui-check/mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile page overflows",
  );
  assert.deepEqual(errors, []);
  console.log(
    "UI validation passed: graph, inspector, components, action evidence, config errors, mobile layout; zero page errors.",
  );
} finally {
  await browser.close();
}
