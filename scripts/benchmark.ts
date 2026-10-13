import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { Page, Locator } from "playwright";
import { resolve } from "node:path";
import { evaluateFixture } from "./fixture-oracle.js";
import { artifactRoot } from "../packages/storage/src/index.js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { startFixture } from "../apps/fixture/server.js";
import { Store } from "../packages/storage/src/index.js";
import { Coordinator } from "../packages/core/src/index.js";
import { chromium } from "playwright";
import {
  observe,
  resolveTarget,
  stabilize,
  locator,
} from "../packages/worker/src/observe.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import baseline from "../tests/baseline.json" with { type: "json" };
const fixtureUrl = process.env.FIXTURE_URL || "http://127.0.0.1:4175";
let fixture: ReturnType<typeof startFixture> | undefined;
try {
  await fetch(fixtureUrl + "/api/metrics");
} catch {
  fixture = startFixture(Number(new URL(fixtureUrl).port));
}
const store = new Store(resolve(".local/benchmark/benchmark.sqlite"));
const results: Record<string, unknown>[] = [];
try {
  for (const concurrency of (process.env.BENCHMARK_WORKERS || "1,1,1,2,4,4,4,8")
    .split(",")
    .map(Number)) {
    const config = ConfigSchema.parse({
      name: `Atlas benchmark · ${concurrency} workers`,
      baseUrl: fixtureUrl,
      concurrency,
      maxDepth: 2,
      maxActions: 350,
      maxStates: 150,
      maxDurationMinutes: 8,
      settleMs: 100,
      navigationIntervalMs: 10,
      actionTimeoutMs: 3500,
      captureScreenshots: true,
    });
    const beforeMetrics = await (
      await fetch(fixtureUrl + "/api/metrics")
    ).json();
    const run = store.createRun(config);
    const start = Date.now(),
      cpu = process.cpuUsage();
    await new Coordinator(store).start(run.id);
    const elapsed = Date.now() - start;
    const scanCpu = process.cpuUsage(cpu);
    const d = store.data(run.id);
    const quality = evaluateFixture(d);
    const scanMetrics = await (await fetch(fixtureUrl + "/api/metrics")).json();
    execFileSync(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "-p",
        resolve(artifactRoot(), run.id, "generated/tsconfig.json"),
      ],
      { stdio: "inherit" },
    );
    const output = resolve(".local/benchmark/generated", run.id);
    execFileSync(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "-p",
        resolve(artifactRoot(), run.id, "generated/tsconfig.json"),
        "--noEmit",
        "false",
        "--outDir",
        output,
      ],
      { stdio: "inherit" },
    );
    const generated = (await import(
      pathToFileURL(resolve(output, "index.js")).href
    )) as Record<
      string,
      new (
        page: Page,
      ) => Record<string, Locator | ((...args: unknown[]) => Promise<void>)>
    >;
    const manifest = JSON.parse(
      await readFile(
        resolve(artifactRoot(), run.id, "generated/manifest.json"),
        "utf8",
      ),
    ) as { className: string; stateId: string; getters: string[] }[];
    const routes = new Set(d.states.map((s) => new URL(s.url).pathname));
    const effects = new Set(d.actions.flatMap((a) => a.effectFlags));
    let verified = 0,
      checked = 0;
    const browser = await chromium.launch({
      executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
    });
    try {
      for (const state of d.states) {
        const targets = d.elements.filter(
          (e) =>
            e.stateId === state.id &&
            e.locatorCandidates.some((c) => c.verifiedAfterRestore),
        );
        if (!targets.length) continue;
        const ctx = await browser.newContext(),
          page = await ctx.newPage();
        page.setDefaultTimeout(3000);
        try {
          await page.goto(state.recipe.seed);
          for (const step of state.recipe.steps) {
            await (await resolveTarget(page, step.locators)).click();
            await stabilize(page, 100);
          }
          const obs = await observe(
            page,
            run.id,
            { ...config, captureScreenshots: false },
            state.recipe,
            state.depth,
            1,
          );
          for (const item of manifest.filter(
            (item) => item.stateId === state.id,
          )) {
            const instance = new generated[item.className](page);
            for (const getter of item.getters) {
              checked++;
              const target = instance[getter] as Locator;
              if (
                obs.state.fingerprint === state.fingerprint &&
                (await target.count()) === 1 &&
                (await target.isVisible())
              )
                verified++;
            }
          }
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
    const metrics = await (await fetch(config.baseUrl + "/api/metrics")).json();
    const usage = scanCpu;
    const row = {
      runId: run.id,
      concurrency,
      elapsedMs: elapsed,
      status: d.run.status,
      ...quality,
      codeGenerationValid: true,
      resources: d.run.resources,
      appRequests: scanMetrics.requests - beforeMetrics.requests,
      appResponseBytes: scanMetrics.responseBytes - beforeMetrics.responseBytes,
      appServerErrors: scanMetrics.errors - beforeMetrics.errors,
      states: d.states.length,
      routes: routes.size,
      routeRecall:
        baseline.routes.filter((r) => routes.has(r)).length /
        baseline.routes.length,
      effectCoverage:
        baseline.effects.filter((e) => effects.has(e)).length /
        baseline.effects.length,
      observedEffects: [...effects],
      executed: d.run.stats.executed,
      failed: d.run.stats.failed,
      verifiedLocatorRate: checked ? verified / checked : 0,
      verified,
      checked,
      unsafeMutations: metrics.mutations - beforeMetrics.mutations,
      duplicateFingerprintRate:
        1 - new Set(d.states.map((s) => s.fingerprint)).size / d.states.length,
      hostCpuMs: (usage.user + usage.system) / 1000,
      hostRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
    results.push(row);
    console.log(JSON.stringify(row));
    await mkdir(".local/benchmark", { recursive: true });
    await writeFile(
      ".local/benchmark/benchmark-results.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          browser: browser.version(),
          node: process.version,
          platform: process.platform + "/" + process.arch,
          fixtureUrl,
          configuration: { maxDepth: 2, maxActions: 350, maxStates: 150 },
          results,
        },
        null,
        2,
      ),
    );
    assert.equal(d.run.status, "completed");
    assert(quality.stateRecall >= 0.9, "state recall gate");
    assert(
      quality.classificationAccuracy >= 0.9,
      "classification accuracy gate",
    );
    assert(
      quality.equivalentStateDuplicationRate <= 0.05,
      "equivalent state duplication gate",
    );
    assert(verified / checked >= 0.95, "locator replay gate");
    assert.equal(row.unsafeMutations, 0);
    assert.equal(row.failed, 0);
    assert(row.routeRecall >= 0.95, "route recall gate");
    assert.equal(quality.unexpectedStates.length, 0);
    assert(
      (d.run.resources?.peakContexts || 0) >= Math.min(concurrency, 4),
      "active context concurrency gate",
    );
    assert.equal(row.appServerErrors, 0);
    assert((d.run.resources?.samples || 0) > 0);
    assert((d.run.resources?.peakBrowserRssMB || 0) > 0);
  }
  const timings = (n: number) =>
    results
      .filter((r) => r.concurrency === n)
      .map((r) => r.elapsedMs as number)
      .sort((a, b) => a - b);
  const singles = timings(1),
    fours = timings(4);
  if (singles.length >= 3 && fours.length >= 3) {
    for (const n of [1, 4]) {
      const runs = results.filter((r) => r.concurrency === n);
      const sets = runs.map((r) => new Set(r.foundExpectedStates as string[]));
      assert(
        sets.every(
          (s) =>
            [...sets[0]].filter((k) => !s.has(k)).length / sets[0].size <= 0.05,
        ),
        "repeatability gate",
      );
    }
    const speedup = singles[1] / fours[1];
    console.log(
      JSON.stringify({ medianSpeedup: speedup, qualityGates: "passed" }),
    );
    assert(speedup >= 2, "four-worker speedup target");
  }
} finally {
  store.close();
  fixture?.close();
}
