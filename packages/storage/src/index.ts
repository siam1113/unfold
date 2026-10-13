import type { DatabaseSync as DatabaseType } from "node:sqlite";
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite",
) as typeof import("node:sqlite");
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ConfigSchema,
  publicConfig,
  type Run,
  type RunSummary,
  type RunData,
  type ScanConfig,
  type AppState,
  type UIElement,
  type Component,
  type ActionEdge,
  type ApiCall,
  type TaskLease,
  type Observation,
  type RunEvent,
  type Project,
  type ProjectData,
  type ProjectSummary,
  ProjectSchema,
  ProjectInputSchema,
  UserSettingsSchema,
  type UserSettings,
} from "../../shared/src/index.js";
import { equivalent } from "../../analysis/src/index.js";
export const dataRoot = () => resolve(process.env.UNFOLD_DATA_DIR || ".local");
export const artifactRoot = () =>
  resolve(process.env.UNFOLD_ARTIFACT_DIR || "artifacts");
export class Store {
  db: DatabaseType;
  constructor(path = resolve(dataRoot(), "unfold.sqlite")) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL,owner_id TEXT NOT NULL DEFAULT 'local');
   CREATE TABLE IF NOT EXISTS states(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(run_id,fingerprint));
   CREATE TABLE IF NOT EXISTS elements(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS components(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS api_calls(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,task_key TEXT NOT NULL,status TEXT NOT NULL,depth INTEGER NOT NULL,priority INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(run_id,task_key));
   CREATE INDEX IF NOT EXISTS task_frontier ON tasks(run_id,status,depth,priority);
   CREATE INDEX IF NOT EXISTS state_runs ON states(run_id);
   CREATE INDEX IF NOT EXISTS element_runs ON elements(run_id);
   CREATE INDEX IF NOT EXISTS action_runs ON actions(run_id);
   CREATE INDEX IF NOT EXISTS component_runs ON components(run_id);
   CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS auth_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS auth_transactions(state_hash TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
  `);
    const projectColumns = this.db
      .prepare("PRAGMA table_info(projects)")
      .all() as {
      name: string;
    }[];
    if (!projectColumns.some((column) => column.name === "owner_id"))
      this.db.exec(
        "ALTER TABLE projects ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'",
      );
    this.migrateProjects();
  }
  private migrateProjects() {
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "project_id"))
      this.db.exec("ALTER TABLE runs ADD COLUMN project_id TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS run_projects ON runs(project_id)");
    const legacy = this.db
      .prepare(
        "SELECT id,data FROM runs WHERE project_id IS NULL ORDER BY rowid",
      )
      .all() as { id: string; data: string }[];
    const projectsByOrigin = new Map<string, Project>();
    for (const row of legacy) {
      const run = JSON.parse(row.data) as Run;
      const origin = new URL(run.config.baseUrl).origin;
      let project = projectsByOrigin.get(origin);
      if (!project) {
        const existing = this.db.prepare("SELECT data FROM projects").all() as {
          data: string;
        }[];
        const found = existing
          .map((item) => ProjectSchema.parse(JSON.parse(item.data)))
          .find(
            (item) =>
              new URL(item.baseUrl).origin === origin && !item.archivedAt,
          );
        project =
          found ||
          this.createProject({
            name: run.name.slice(0, 100),
            description:
              "Imported discovery history. New discoveries stay scoped to this application.",
            baseUrl: run.config.baseUrl,
            scanConfig: run.config,
            agentInstructions:
              "Use only this project’s MCP tools and stored discovery evidence. Do not infer behavior that the observations do not establish.",
          });
        projectsByOrigin.set(origin, project);
      }
      run.projectId = project.id;
      this.db
        .prepare("UPDATE runs SET data=?,project_id=? WHERE id=?")
        .run(JSON.stringify(run), project.id, run.id);
    }
  }
  createProject(input: unknown, ownerId = "local"): Project {
    const values = ProjectInputSchema.parse(input);
    const scanConfig = ConfigSchema.parse({
      ...values.scanConfig,
      name: values.name,
      baseUrl: values.baseUrl,
    });
    const now = new Date().toISOString();
    const project = ProjectSchema.parse({
      id: randomUUID(),
      name: values.name,
      description: values.description,
      baseUrl: values.baseUrl,
      scanConfig,
      agentInstructions:
        values.agentInstructions ||
        "Use only this project’s MCP tools and stored discovery evidence. Separate observed behavior from assumptions, and say when a discovery has not verified something.",
      createdAt: now,
      updatedAt: now,
    });
    this.db
      .prepare("INSERT INTO projects(id,data,owner_id) VALUES (?,?,?)")
      .run(project.id, JSON.stringify(project), ownerId);
    return project;
  }
  project(id: string, ownerId?: string): Project {
    const row = this.db
      .prepare(
        ownerId
          ? "SELECT data FROM projects WHERE id=? AND owner_id=?"
          : "SELECT data FROM projects WHERE id=?",
      )
      .get(...(ownerId ? [id, ownerId] : [id])) as { data: string } | undefined;
    if (!row) throw new Error("Project not found");
    return ProjectSchema.parse(JSON.parse(row.data));
  }
  userSettings(userId: string): UserSettings {
    const row = this.db
      .prepare("SELECT data FROM user_preferences WHERE user_id=?")
      .get(userId) as { data: string } | undefined;
    return UserSettingsSchema.parse(row ? JSON.parse(row.data) : {});
  }
  saveUserSettings(userId: string, input: unknown): UserSettings {
    const settings = UserSettingsSchema.parse(input);
    this.db
      .prepare(
        "INSERT INTO user_preferences(user_id,data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      )
      .run(userId, JSON.stringify(settings));
    return settings;
  }
  updateProject(id: string, patch: unknown, ownerId?: string): Project {
    const project = this.project(id, ownerId);
    const changes = patch as Record<string, unknown>;
    const next = ProjectSchema.parse({
      ...project,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description }
        : {}),
      ...(changes.agentInstructions !== undefined
        ? { agentInstructions: changes.agentInstructions }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  archiveProject(id: string, ownerId?: string): Project {
    const project = this.project(id, ownerId);
    const next = ProjectSchema.parse({
      ...project,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  restoreProject(id: string, ownerId?: string): Project {
    const project = this.project(id, ownerId);
    const next = {
      ...project,
      archivedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  projects(ownerId?: string): ProjectSummary[] {
    const rows = this.db
      .prepare(
        ownerId
          ? "SELECT id FROM projects WHERE owner_id=? ORDER BY rowid DESC"
          : "SELECT id FROM projects ORDER BY rowid DESC",
      )
      .all(...(ownerId ? [ownerId] : [])) as { id: string }[];
    return rows.map(({ id }) => {
      const project = this.project(id);
      const discoveries = this.discoveries(id);
      const latestDiscovery = discoveries[0];
      return {
        id,
        name: project.name,
        description: project.description,
        baseUrl: publicConfig(project.scanConfig).baseUrl,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        archivedAt: project.archivedAt,
        discoveryCount: discoveries.length,
        latestDiscovery,
        stats: discoveries.reduce(
          (stats, run) => ({
            states: stats.states + run.stats.states,
            actions: stats.actions + run.stats.executed,
            components: stats.components + run.stats.components,
            verified: stats.verified + run.stats.verified,
          }),
          { states: 0, actions: 0, components: 0, verified: 0 },
        ),
      };
    });
  }
  discoveries(projectId: string, ownerId?: string): RunSummary[] {
    this.project(projectId, ownerId);
    return (
      this.db
        .prepare("SELECT id FROM runs WHERE project_id=? ORDER BY rowid DESC")
        .all(projectId) as { id: string }[]
    ).map((row) => this.summary(row.id));
  }
  projectData(id: string, ownerId?: string): ProjectData {
    const project = this.project(id, ownerId);
    const discoveries = this.discoveries(id, ownerId);
    const stats = discoveries.reduce(
      (total, run) => ({
        states: total.states + run.stats.states,
        actions: total.actions + run.stats.executed,
        components: total.components + run.stats.components,
        verified: total.verified + run.stats.verified,
      }),
      { states: 0, actions: 0, components: 0, verified: 0 },
    );
    const name = `${project.name} project expert`;
    const systemPrompt = [
      `You are ${name}, an expert only in project ${project.id}.`,
      `Project scope: ${project.description || project.name}. Application origin: ${new URL(project.baseUrl).origin}.`,
      project.agentInstructions,
      `This project contains ${discoveries.length} discoveries, ${stats.states} observed states, ${stats.components} component observations, and ${stats.actions} executed interactions.`,
      "Use search_api_calls to find observed endpoints and get_api_flow to trace calls caused by a route or interaction. Dedicated observed_flow_* tools expose individual captured flows. After a new discovery finishes, call refresh_flow_tools to register its dedicated flow tools. These flow tools return evidence and do not execute API calls. If evidence is missing or stale, use start_discovery, then poll list_discoveries until that discovery finishes before drawing conclusions.",
      "Use only this project’s MCP resources and tools. Cite discovery IDs and state or component IDs for claims. Distinguish observed facts from guesses. Say when project evidence is missing. Never claim knowledge from another project.",
    ].join("\n\n");
    return {
      project: { ...project, scanConfig: publicConfig(project.scanConfig) },
      discoveries,
      stats,
      agent: { name, instructions: project.agentInstructions, systemPrompt },
      mcp: {
        endpoint: `/api/projects/${id}/mcp`,
        tools: [
          "project_overview",
          "list_discoveries",
          "search_states",
          "get_state",
          "search_components",
          "get_component",
          "search_interactions",
          "get_interaction",
          "search_api_calls",
          "get_api_flow",
          "refresh_flow_tools",
          "start_discovery",
          "compare_discoveries",
        ],
        resources: [`unfold://projects/${id}/context`],
        prompts: ["project-expert"],
      },
    };
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  createRun(input: unknown, projectId?: string, ownerId?: string): Run {
    const config = ConfigSchema.parse(input);
    let project: Project | undefined;
    if (projectId) project = this.project(projectId, ownerId);
    else {
      const origin = new URL(config.baseUrl).origin;
      const candidates = this.db
        .prepare(
          ownerId
            ? "SELECT data FROM projects WHERE owner_id=?"
            : "SELECT data FROM projects",
        )
        .all(...(ownerId ? [ownerId] : [])) as { data: string }[];
      project = candidates
        .map((row) => ProjectSchema.parse(JSON.parse(row.data)))
        .find(
          (candidate) =>
            new URL(candidate.baseUrl).origin === origin &&
            !candidate.archivedAt,
        );
      if (!project) {
        const name = config.name || new URL(config.baseUrl).host;
        project = this.createProject(
          {
            name,
            baseUrl: config.baseUrl,
            scanConfig: config,
            description: "Application discovery workspace",
          },
          ownerId,
        );
      }
    }
    if (new URL(config.baseUrl).origin !== new URL(project.baseUrl).origin)
      throw new Error("Discovery URL must stay within its project origin");
    const run: Run = {
      id: randomUUID(),
      projectId: project.id,
      name: config.name,
      config,
      status: "queued",
      createdAt: new Date().toISOString(),
      elapsedMs: 0,
    };
    this.db
      .prepare("INSERT INTO runs(id,data,project_id) VALUES (?,?,?)")
      .run(run.id, JSON.stringify(run), project.id);
    this.event(run.id, "info", "Run created");
    return run;
  }
  run(id: string, ownerId?: string): Run {
    const row = this.db
      .prepare(
        ownerId
          ? "SELECT runs.data FROM runs JOIN projects ON projects.id=runs.project_id WHERE runs.id=? AND projects.owner_id=?"
          : "SELECT data FROM runs WHERE id=?",
      )
      .get(...(ownerId ? [id, ownerId] : [id]));
    if (!row) throw new Error("Run not found");
    return JSON.parse(row.data as string);
  }
  updateRun(id: string, patch: Partial<Run>, ownerId?: string): Run {
    const run = { ...this.run(id, ownerId), ...patch };
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  all<T>(
    table:
      | "states"
      | "elements"
      | "components"
      | "actions"
      | "api_calls"
      | "tasks",
    runId: string,
  ): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} WHERE run_id=? ORDER BY rowid`)
      .all(runId)
      .map((r) => JSON.parse(r.data as string));
  }
  get<T>(
    table:
      | "states"
      | "elements"
      | "components"
      | "actions"
      | "api_calls"
      | "tasks",
    id: string,
  ): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  put(
    table: "elements" | "components" | "actions" | "api_calls",
    runId: string,
    item: { id: string },
  ) {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table}(id,run_id,data) VALUES (?,?,?)`)
      .run(item.id, runId, JSON.stringify(item));
  }
  observation(obs: Observation): { state: AppState; fresh: boolean } {
    const exact = this.db
      .prepare("SELECT data FROM states WHERE run_id=? AND fingerprint=?")
      .get(obs.state.runId, obs.state.fingerprint);
    const existing = exact
      ? (JSON.parse(exact.data as string) as AppState)
      : this.all<AppState>("states", obs.state.runId).find((s) =>
          equivalent(s, obs.state),
        );
    if (existing) {
      if (obs.state.recipe.steps.length < existing.recipe.steps.length) {
        existing.recipe = obs.state.recipe;
        existing.depth = obs.state.depth;
        this.db
          .prepare("UPDATE states SET data=? WHERE id=?")
          .run(JSON.stringify(existing), existing.id);
      }
      return { state: existing, fresh: false };
    }
    const count = this.db
      .prepare("SELECT COUNT(*) as n FROM states WHERE run_id=?")
      .get(obs.state.runId)!.n as number;
    if (count >= this.run(obs.state.runId).config.maxStates)
      throw new Error("STATE_BUDGET");
    this.db
      .prepare("INSERT INTO states VALUES (?,?,?,?)")
      .run(
        obs.state.id,
        obs.state.runId,
        obs.state.fingerprint,
        JSON.stringify(obs.state),
      );
    obs.elements.forEach((e) => this.put("elements", obs.state.runId, e));
    obs.components.forEach((c) => this.put("components", obs.state.runId, c));
    return { state: obs.state, fresh: true };
  }
  enqueue(task: TaskLease) {
    this.db
      .prepare("INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?,?,?)")
      .run(
        task.id,
        task.runId,
        task.key,
        task.status,
        task.depth,
        task.priority,
        JSON.stringify(task),
      );
  }
  saveTask(task: TaskLease) {
    this.db
      .prepare("UPDATE tasks SET status=?,depth=?,priority=?,data=? WHERE id=?")
      .run(
        task.status,
        task.depth,
        task.priority,
        JSON.stringify(task),
        task.id,
      );
  }
  lease(runId: string, worker: number, timeout: number): TaskLease | undefined {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT data FROM tasks WHERE run_id=? AND status='pending' ORDER BY depth ASC,priority DESC,rowid ASC LIMIT 1",
        )
        .get(runId);
      if (!row) return;
      const task: TaskLease = JSON.parse(row.data as string);
      task.status = "leased";
      task.worker = worker;
      task.attempts++;
      task.leaseUntil = Date.now() + timeout;
      this.saveTask(task);
      return task;
    });
  }
  recover(runId: string) {
    for (const task of this.all<TaskLease>("tasks", runId))
      if (task.status === "leased") {
        task.status = "pending";
        task.leaseUntil = undefined;
        this.saveTask(task);
      }
  }
  event(
    runId: string,
    level: RunEvent["level"],
    message: string,
    worker?: number,
  ) {
    this.db.prepare("INSERT INTO events(run_id,data) VALUES (?,?)").run(
      runId,
      JSON.stringify({
        runId,
        time: new Date().toISOString(),
        level,
        message,
        worker,
      }),
    );
  }
  events(runId: string): RunEvent[] {
    return this.db
      .prepare(
        "SELECT id,data FROM events WHERE run_id=? ORDER BY id DESC LIMIT 200",
      )
      .all(runId)
      .map((r) => ({ ...JSON.parse(r.data as string), id: r.id }));
  }
  summary(id: string, ownerId?: string): RunSummary {
    const run = this.run(id, ownerId),
      states = this.all<AppState>("states", id),
      actions = this.all<ActionEdge>("actions", id),
      elements = this.all<UIElement>("elements", id),
      tasks = this.all<TaskLease>("tasks", id);
    return {
      ...run,
      config: publicConfig(run.config),
      stats: {
        states: states.length,
        routes: new Set(states.map((s) => s.routeKey)).size,
        actions: actions.length,
        executed: actions.filter((a) => a.decision === "executed").length,
        blocked: actions.filter((a) => a.decision === "skipped_policy").length,
        failed: actions.filter((a) => a.decision === "failed").length,
        components: this.all<Component>("components", id).length,
        elements: elements.length,
        verified: elements.filter((e) =>
          e.locatorCandidates.some((l) => l.verifiedAfterRestore),
        ).length,
        pending: tasks.filter((t) => t.status === "pending").length,
        active: tasks.filter((t) => t.status === "leased").length,
      },
    };
  }
  list(ownerId?: string): RunSummary[] {
    return this.db
      .prepare(
        ownerId
          ? "SELECT runs.id FROM runs JOIN projects ON projects.id=runs.project_id WHERE projects.owner_id=? ORDER BY runs.rowid DESC"
          : "SELECT id FROM runs ORDER BY rowid DESC",
      )
      .all(...(ownerId ? [ownerId] : []))
      .map((r) => this.summary(r.id as string, ownerId));
  }
  data(id: string, ownerId?: string): RunData {
    return {
      run: this.summary(id, ownerId),
      states: this.all("states", id),
      elements: this.all("elements", id),
      components: this.all("components", id),
      actions: this.all("actions", id),
      apiCalls: this.all<ApiCall>("api_calls", id),
      tasks: this.all("tasks", id),
      events: this.events(id),
    };
  }
  saveAuthSession(id: string, userId: string, data: string, expiresAt: number) {
    this.db
      .prepare(
        "INSERT INTO auth_sessions(id,user_id,data,expires_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,data=excluded.data,expires_at=excluded.expires_at",
      )
      .run(id, userId, data, expiresAt);
  }
  authSession(
    id: string,
  ):
    | { id: string; user_id: string; data: string; expires_at: number }
    | undefined {
    return this.db
      .prepare(
        "SELECT id,user_id,data,expires_at FROM auth_sessions WHERE id=?",
      )
      .get(id) as
      | { id: string; user_id: string; data: string; expires_at: number }
      | undefined;
  }
  deleteAuthSession(id: string) {
    this.db.prepare("DELETE FROM auth_sessions WHERE id=?").run(id);
  }
  saveAuthTransaction(stateHash: string, data: string, expiresAt: number) {
    this.db
      .prepare(
        "INSERT INTO auth_transactions(state_hash,data,expires_at) VALUES (?,?,?)",
      )
      .run(stateHash, data, expiresAt);
  }
  consumeAuthTransaction(stateHash: string): string | undefined {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT data FROM auth_transactions WHERE state_hash=? AND expires_at>?",
        )
        .get(stateHash, Date.now()) as { data: string } | undefined;
      this.db
        .prepare("DELETE FROM auth_transactions WHERE state_hash=?")
        .run(stateHash);
      return row?.data;
    });
  }
  clearExpiredAuthState() {
    this.db
      .prepare("DELETE FROM auth_transactions WHERE expires_at<=?")
      .run(Date.now());
    this.db
      .prepare("DELETE FROM auth_sessions WHERE expires_at<=?")
      .run(Date.now());
  }
  close() {
    this.db.close();
  }
}
