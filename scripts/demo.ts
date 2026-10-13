import { readFile } from "node:fs/promises";
import { startFixture } from "../apps/fixture/server.js";
import { Store } from "../packages/storage/src/index.js";
import { Coordinator } from "../packages/core/src/index.js";
let fixture: ReturnType<typeof startFixture> | undefined;
try {
  await fetch("http://127.0.0.1:4174/api/metrics");
} catch {
  fixture = startFixture();
}
const store = new Store();
try {
  const config = JSON.parse(await readFile("scan.config.json", "utf8"));
  const run = store.createRun(config);
  console.log(`Discovering Atlas: ${run.id}`);
  await new Coordinator(store).start(run.id);
  const summary = store.summary(run.id);
  console.log(
    JSON.stringify(
      {
        id: run.id,
        status: summary.status,
        ...summary.stats,
        elapsed: summary.elapsedMs,
      },
      null,
      2,
    ),
  );
  console.log(`Open http://127.0.0.1:5173/runs/${run.id}/graph`);
} finally {
  store.close();
  fixture?.close();
}
