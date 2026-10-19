import { Store } from "../../storage/src/index.js";
import { ConfigSchema } from "../../shared/src/index.js";
import { Coordinator } from "../../core/src/index.js";
import { startProjectStdioMcp } from "./server.js";

const projectIndex = process.argv.indexOf("--project");
const projectId =
  projectIndex >= 0
    ? process.argv[projectIndex + 1]
    : process.env.UNFOLD_PROJECT_ID;
if (!projectId)
  throw new Error("Set UNFOLD_PROJECT_ID or pass --project <project-id>");
const store = new Store();
const coordinator = new Coordinator(store);
const activeRuns = new Map<string, Promise<unknown>>();
const server = await startProjectStdioMcp(
  store,
  projectId,
  ({ name, seeds }) => {
    const project = store.project(projectId);
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
      .catch((error) => console.error("MCP discovery failed:", error.message))
      .finally(() => activeRuns.delete(run.id));
    activeRuns.set(run.id, running);
    return store.summary(run.id);
  },
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
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
  });
