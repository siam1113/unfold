import { describe, it, expect } from "vitest";
import { parseRobots } from "../packages/core/src/robots.js";
import { resourcePressure } from "../packages/core/src/resources.js";
describe("robots access policy", () => {
  it("merges matching groups and uses exact agent rules before wildcard", () => {
    const p = parseRobots(
      "User-agent: *\nDisallow: /\nUser-agent: Unfold\nDisallow: /private\nUser-agent: UNFOLD\nAllow: /private/public\nCrawl-delay: 1.5",
    );
    expect(p.allows("https://example.test/ok")).toBe(true);
    expect(p.allows("https://example.test/private")).toBe(false);
    expect(p.allows("https://example.test/private/public")).toBe(true);
    expect(p.delayMs).toBe(1500);
  });
  it("handles wildcards, anchors, query, encoding and allow ties", () => {
    const p = parseRobots(
      "User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?secret=*\nDisallow: /%70rivate\nDisallow: /café\nAllow: /private\n",
    );
    expect(p.allows("https://example.test/a.pdf")).toBe(false);
    expect(p.allows("https://example.test/a.pdf?q=1")).toBe(true);
    expect(p.allows("https://example.test/search?secret=x")).toBe(false);
    expect(p.allows("https://example.test/private")).toBe(true);
    expect(p.allows("https://example.test/caf%C3%A9")).toBe(false);
    expect(p.allows("https://example.test/robots.txt")).toBe(true);
  });
  it("accepts empty disallow and ignores unrelated records", () => {
    expect(
      parseRobots(
        "User-agent: *\nDisallow:\nSitemap: https://example.test/sitemap.xml",
      ).allows("https://example.test/"),
    ).toBe(true);
  });
});
it("distinguishes CPU and memory pressure with configured limits", () => {
  const s = {
    browserRssMB: 1000,
    browserCpuPercent: 200,
    browserCpuMs: 500,
    processes: 6,
  };
  expect(resourcePressure(s, 4096, 800)).toBeUndefined();
  expect(resourcePressure(s, 512, 800)).toBe("memory");
  expect(resourcePressure(s, 4096, 100)).toBe("cpu");
});

import { ConfigSchema } from "../packages/shared/src/index.js";
it("keeps URL credentials out of persisted replay recipes", () => {
  expect(() =>
    ConfigSchema.parse({ baseUrl: "https://example.test/?token=private" }),
  ).toThrow(/auth-state/);
});
