import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import { resolve } from "node:path";
import { Store, artifactRoot } from "../packages/storage/src/index.js";
import { Coordinator } from "../packages/core/src/index.js";
import { observe } from "../packages/worker/src/observe.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import { RobotsPolicy } from "../packages/core/src/robots.js";
const dir = await mkdtemp(join(tmpdir(), "unfold-hardening-"));
const store = new Store(join(dir, "db.sqlite"));
let blockedHits = 0,
  writes = 0,
  authMisses = 0;
const server = createServer((req, res) => {
  if (req.url === "/robots.txt") {
    res.end("User-agent: *\nDisallow: /blocked\nCrawl-delay: 0.01");
    return;
  }
  if (req.url === "/blocked") {
    blockedHits++;
    res.end("Forbidden");
    return;
  }
  if (req.url === "/write") {
    writes++;
    res.end("Mutation");
    return;
  }
  if (!req.headers.cookie?.includes("fixture-session=authorized")) {
    authMisses++;
    res.writeHead(401);
    res.end("Login required");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/tooltip") {
    res.end(
      '<main><button data-tooltip onmouseenter="document.getElementById(\'tip\').hidden=false">Help hint</button><div role="tooltip" id="tip" hidden>Observed tooltip</div></main>',
    );
    return;
  }
  if (req.url === "/failure") {
    res.end(
      '<main><h1>Failure fixture</h1><button aria-controls="result" style="pointer-events:none">Unreachable control</button><div id="result"></div></main>',
    );
    return;
  }
  res.end(
    `<main><h1>Authenticated fixture</h1><a href="/blocked">Restricted page</a><a href="http://127.0.0.1:4199/outside">Outside page</a><button aria-controls="result" id="probe">Inspect isolated state</button><div id="result"></div><div class="cards">${["One", "Two", "Three"].map((n) => `<div><h2>${n}</h2><p>Repeated card</p><a href="/">Open ${n}</a></div>`).join("")}</div><script>document.querySelector('#probe').onclick=()=>{const before=localStorage.getItem('probe');document.querySelector('#result').textContent=before?'CONTEXT LEAK':'Isolated';localStorage.setItem('probe','used');fetch('/write',{method:'POST'}).catch(()=>{});}</script><style>.cards>div{width:200px;height:100px}</style></main>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;
try {
  const authPath = join(dir, "auth.json");
  await writeFile(
    authPath,
    JSON.stringify({
      cookies: [
        {
          name: "fixture-session",
          value: "authorized",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
  const config = ConfigSchema.parse({
    baseUrl,
    authStatePath: authPath,
    concurrency: 4,
    maxDepth: 1,
    maxActions: 40,
    settleMs: 50,
    navigationIntervalMs: 0,
    captureScreenshots: false,
  });
  const run = store.createRun(config);
  await new Coordinator(store).start(run.id);
  const data = store.data(run.id);
  assert.equal(blockedHits, 0);
  assert.equal(writes, 0);
  assert.equal(authMisses, 0);
  assert(data.states.some((s) => s.mainText.includes("Isolated")));
  assert(!data.states.some((s) => s.mainText.includes("CONTEXT LEAK")));
  assert(
    data.actions.some(
      (a) => a.policy.rule === "robots" && a.decision === "skipped_policy",
    ),
  );
  assert(
    data.actions.some((a) =>
      a.signals.some((s) => s.startsWith("blocked_write")),
    ),
  );
  assert(data.actions.some((a) => a.policy.rule === "origin"));
  const repeated = data.components.filter((c) => c.familyId);
  assert(repeated.length >= 3);
  assert.equal(new Set(repeated.map((c) => c.familyId)).size, 1);
  assert(
    repeated.every((c) =>
      c.classificationEvidence.some((e) => e.includes("Repeated")),
    ),
  );
  assert(!JSON.stringify(data).includes("fixture-session"));
  // A repeated div is discovered by shape even without semantic component markers.
  const browser = await chromium.launch({
    executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
  });
  try {
    const ctx = await browser.newContext({ storageState: authPath });
    const page = await ctx.newPage();
    await page.goto(baseUrl);
    const observation = await observe(
      page,
      "shape-fixture",
      config,
      { id: "r", seed: baseUrl, steps: [] },
      0,
      1,
    );
    const cards = observation.components.filter((c) => c.familyId);
    assert.equal(cards.length, 3);
    assert(
      cards.every(
        (c) => c.rootLocator.uniqueAtDiscovery && c.elementIds.length === 1,
      ),
    );
    await ctx.close();
  } finally {
    await browser.close();
  }
  const unavailable = new RobotsPolicy(
    ConfigSchema.parse({ baseUrl: "http://127.0.0.1:1" }),
    () => {},
  );
  await unavailable.load();
  assert(!unavailable.allows("http://127.0.0.1:1/private"));
  const memory = store.createRun({
    ...config,
    maxBrowserMemoryMB: 128,
    maxDepth: 6,
  });
  await new Coordinator(store).start(memory.id);
  assert.equal(store.run(memory.id).status, "limited");
  assert.equal(
    store.run(memory.id).stopReason,
    "Browser memory budget reached",
  );
  assert(store.summary(memory.id).stats.pending > 0);
  const tooltip = store.createRun({ ...config, baseUrl: baseUrl + "/tooltip" });
  await new Coordinator(store).start(tooltip.id);
  assert(
    store
      .data(tooltip.id)
      .actions.some(
        (a) => a.action === "hover" && a.effectFlags.includes("show_tooltip"),
      ),
  );
  const failure = store.createRun({
    ...config,
    baseUrl: baseUrl + "/failure",
    captureScreenshots: true,
    actionTimeoutMs: 500,
  });
  await new Coordinator(store).start(failure.id);
  const failureData = store.data(failure.id);
  const failed = failureData.actions.find((a) => a.decision === "failed");
  assert(failed?.errorCode);
  assert.equal(failureData.tasks.find((t) => t.kind === "action")?.attempts, 2);
  assert(failed.evidencePaths.some((p) => p.endsWith(".png")));
  const trace = failed.evidencePaths.find((p) => p.endsWith(".zip"));
  assert(trace);
  const entries = unzipSync(await readFile(resolve(artifactRoot(), trace)));
  assert(Object.keys(entries).every((name) => name.endsWith(".trace")));
  assert(
    !Object.values(entries).some((bytes) =>
      strFromU8(bytes).includes("fixture-session"),
    ),
  );
  console.log(
    JSON.stringify(
      {
        robots: "passed",
        originGuard: "passed",
        networkWriteGuard: "passed",
        authenticatedContexts: "passed",
        contextIsolation: "passed",
        repeatedComponents: "passed",
        memoryBudget: "passed",
        boundedRetries: "passed",
        failureEvidence: "passed",
        sanitizedTraces: "passed",
        tooltipHover: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await rm(dir, { recursive: true, force: true });
}
