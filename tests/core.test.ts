import { describe, it, expect } from "vitest";
import {
  ConfigSchema,
  type UIElement,
  type TaskLease,
} from "../packages/shared/src/index.js";
import { decide, allowedUrl, riskyUrl } from "../packages/core/src/policy.js";
import {
  normalizeUrl,
  stableText,
  expression,
} from "../packages/analysis/src/index.js";
import { Store } from "../packages/storage/src/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const config = ConfigSchema.parse({ baseUrl: "http://127.0.0.1:4174" });
const el = (patch: Partial<UIElement> = {}): UIElement => ({
  id: "e",
  stateId: "s",
  role: "button",
  accessibleName: "Delete project",
  tag: "button",
  textSnippet: "",
  structuralSignature: "s",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  box: { x: 0, y: 0, width: 1, height: 1 },
  ...patch,
});
describe("configuration and safety", () => {
  it("validates exact origins and budgets", () => {
    expect(() =>
      ConfigSchema.parse({ baseUrl: "file:///etc/passwd" }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({ baseUrl: config.baseUrl, concurrency: 17 }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({
        baseUrl: config.baseUrl,
        seeds: ["https://outside.test"],
      }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({
        baseUrl: config.baseUrl,
        allowedOrigins: ["https://outside.test/path"],
      }),
    ).toThrow();
  });
  it("blocks destructive, ambiguous and submission controls by default", () => {
    expect(decide(el(), config.baseUrl, config).allowed).toBe(false);
    expect(
      decide(el({ accessibleName: "Continue" }), config.baseUrl, config)
        .allowed,
    ).toBe(false);
    expect(
      decide(
        el({
          accessibleName: "Show report",
          isSubmit: true,
          controls: "report",
        }),
        config.baseUrl,
        config,
      ).allowed,
    ).toBe(false);
  });
  it("allows semantic disclosure, exact approvals, and safe links", () => {
    expect(
      decide(
        el({ accessibleName: "Details", hasPopup: "dialog" }),
        config.baseUrl,
        config,
      ).allowed,
    ).toBe(true);
    expect(
      decide(el(), config.baseUrl, {
        ...config,
        actionAllowlist: [{ route: "/", name: "Delete project" }],
      }).allowed,
    ).toBe(true);
    expect(
      decide(
        el({ accessibleName: "Projects", href: config.baseUrl + "/projects" }),
        config.baseUrl,
        config,
      ).allowed,
    ).toBe(true);
  });
  it("never lets an allowlist override the origin boundary or dry run", () => {
    const c = {
      ...config,
      actionAllowlist: [{ route: "/", name: "Delete project" }],
    };
    expect(
      decide(el({ href: "https://outside.test" }), config.baseUrl, c).allowed,
    ).toBe(false);
    expect(decide(el(), config.baseUrl, { ...c, dryRun: true }).allowed).toBe(
      false,
    );
    expect(
      decide(
        el({ accessibleName: "Project" }),
        config.baseUrl,
        {
          ...config,
          dryRun: true,
          formValues: [{ route: "/", label: "Project", value: "test" }],
        },
        "fill",
      ).allowed,
    ).toBe(false);
  });
  it("restricts network scope and detects risky navigation", () => {
    expect(allowedUrl(config.baseUrl + "/projects", config)).toBe(true);
    expect(allowedUrl("http://127.0.0.1:4174.evil.test", config)).toBe(false);
    expect(allowedUrl("javascript:alert(1)", config)).toBe(false);
    expect(riskyUrl(config.baseUrl + "/delete?item=1", config)).toBe(true);
  });
});
describe("stable evidence", () => {
  it("normalizes tracking and redacts secret query parameters", () => {
    const value = normalizeUrl(
      config.baseUrl + "/?utm_source=test&token=secret&q=ok",
      config,
    );
    expect(value).not.toContain("secret");
    expect(value).not.toContain("utm_source");
    expect(value).toContain("q=ok");
    expect(stableText("Updated 2026-01-01 at 12:40")).toBe(
      "Updated [date] at [time]",
    );
  });
  it("escapes captured app text in generated source", () => {
    expect(
      expression({ kind: "role", value: "button", name: 'a"; throw "bad' }),
    ).toContain('a\\"; throw \\"bad'.replace("\\\\", "\\"));
  });
});
describe("durable queue", () => {
  it("deduplicates and leases work atomically, then recovers after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "unfold-store-"));
    try {
      let store = new Store(join(dir, "db.sqlite"));
      const run = store.createRun(config);
      const task: TaskLease = {
        id: "t",
        key: "one",
        runId: run.id,
        kind: "route",
        url: config.baseUrl,
        action: "click",
        depth: 0,
        priority: 1,
        status: "pending",
        attempts: 0,
      };
      store.enqueue(task);
      store.enqueue({ ...task, id: "duplicate" });
      expect(store.all("tasks", run.id)).toHaveLength(1);
      expect(store.lease(run.id, 1, 1000)?.worker).toBe(1);
      expect(store.lease(run.id, 2, 1000)).toBeUndefined();
      store.close();
      store = new Store(join(dir, "db.sqlite"));
      store.recover(run.id);
      expect(store.lease(run.id, 2, 1000)?.attempts).toBe(2);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
