import { Command } from "commander";
import { readFile, mkdir, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { ConfigSchema } from "../../../packages/shared/src/index.js";
import { Store } from "../../../packages/storage/src/index.js";
import { Coordinator } from "../../../packages/core/src/index.js";
import { exportRun } from "../../../packages/generator/src/index.js";
import { startProjectStdioMcp } from "../../../packages/mcp/src/server.js";
const cli = new Command()
  .name("appscan")
  .description("Unfold live application discovery")
  .version("1.0.0");
const load = async (path: string) =>
  ConfigSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
cli
  .command("run")
  .option("-c, --config <path>", "Scan configuration", "scan.config.json")
  .action(async (options) => {
    const store = new Store();
    try {
      const run = store.createRun(await load(options.config));
      console.log(`Run ${run.id}`);
      const coordinator = new Coordinator(store);
      process.once("SIGINT", () => {
        coordinator.pause(run.id);
        console.log("Pausing after active observations…");
      });
      await coordinator.start(run.id);
      console.log(JSON.stringify(store.summary(run.id), null, 2));
    } finally {
      store.close();
    }
  });
cli
  .command("resume")
  .requiredOption("--run <id>")
  .option("--max-actions <count>")
  .option("--max-states <count>")
  .option("--max-duration-minutes <count>")
  .action(async (options) => {
    const store = new Store();
    try {
      const run = store.run(options.run);
      const changes = {
        ...(options.maxActions
          ? { maxActions: Number(options.maxActions) }
          : {}),
        ...(options.maxStates ? { maxStates: Number(options.maxStates) } : {}),
        ...(options.maxDurationMinutes
          ? { maxDurationMinutes: Number(options.maxDurationMinutes) }
          : {}),
      };
      store.updateRun(run.id, {
        config: ConfigSchema.parse({ ...run.config, ...changes }),
      });
      const coordinator = new Coordinator(store);
      process.once("SIGINT", () => coordinator.pause(run.id));
      await coordinator.start(run.id);
      console.log(JSON.stringify(store.summary(run.id), null, 2));
    } finally {
      store.close();
    }
  });
cli
  .command("pause")
  .requiredOption("--run <id>")
  .action((o) => {
    const s = new Store();
    new Coordinator(s).pause(o.run);
    console.log(s.summary(o.run).status);
    s.close();
  });
cli.command("list").action(() => {
  const s = new Store();
  console.table(
    s.list().map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      states: r.stats.states,
      actions: r.stats.actions,
    })),
  );
  s.close();
});
cli
  .command("export")
  .requiredOption("--run <id>")
  .action(async (o) => {
    const s = new Store();
    try {
      console.log(await exportRun(s, o.run));
    } finally {
      s.close();
    }
  });
cli
  .command("auth")
  .option("-c, --config <path>", "Scan configuration", "scan.config.json")
  .action(async (o) => {
    const config = await load(o.config),
      path = resolve(config.authStatePath || ".local/auth-state.json");
    const browser = await chromium.launch({
      headless: false,
      executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(config.baseUrl);
      const input = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      await input.question(
        "Sign in in the browser, then press Enter to save the local session. ",
      );
      input.close();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await context.storageState({ path });
      await chmod(path, 0o600);
      console.log(
        `Session saved to ${path}. Set authStatePath in the scan configuration.`,
      );
    } finally {
      await browser.close();
    }
  });
cli
  .command("mcp")
  .requiredOption("--project <id>", "Project UUID to expose through MCP")
  .description("Serve one project's discovery evidence over MCP stdio")
  .action(async (options) => {
    const store = new Store();
    try {
      const coordinator = new Coordinator(store);
      const activeRuns = new Map<string, Promise<unknown>>();
      const server = await startProjectStdioMcp(
        store,
        options.project,
        ({ name, seeds }) => {
          const project = store.project(options.project);
          if (project.archivedAt)
            throw new Error("Archived projects cannot start a discovery");
          const config = ConfigSchema.parse({
            ...project.scanConfig,
            name: name || project.name,
            seeds: seeds ?? project.scanConfig.seeds,
          });
          const run = store.createRun(config, project.id);
          const running = coordinator
            .start(run.id)
            .catch((error) =>
              console.error("MCP discovery failed:", error.message),
            )
            .finally(() => activeRuns.delete(run.id));
          activeRuns.set(run.id, running);
          return store.summary(run.id);
        },
      );
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        for (const runId of activeRuns.keys()) coordinator.pause(runId);
        void server
          .close()
          .then(() => Promise.allSettled(activeRuns.values()))
          .finally(() => {
            store.close();
            process.exit(0);
          });
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    } catch (error) {
      store.close();
      throw error;
    }
  });
cli.parseAsync().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
