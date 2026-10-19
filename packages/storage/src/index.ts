import type { DatabaseSync as DatabaseType } from "node:sqlite";
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite",
) as typeof import("node:sqlite");
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
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
  BrowseSessionSchema,
  type BrowseSession,
  BrowseEventSchema,
  type BrowseEvent,
  AuthCaptureSchema,
  type AuthCapture,
  AutomationWorkflowSchema,
  type AutomationWorkflow,
  WorkflowRunSchema,
  type WorkflowRun,
  FrameworkProjectSchema,
  type FrameworkProject,
  TestRunSchema,
  type TestRun,
  PackageOperationSchema,
  type PackageOperation,
} from "../../shared/src/index.js";
import { equivalent } from "../../analysis/src/index.js";
import {
  CapabilitySchema,
  type Capability,
  FlowSchema,
  type Flow,
  EvidenceSchema,
  type Evidence,
  VerificationRunSchema,
  type VerificationRun,
} from "../../capability-core/src/types.js";
export const dataRoot = () => resolve(process.env.UNFOLD_DATA_DIR || ".local");
export const artifactRoot = () =>
  resolve(process.env.UNFOLD_ARTIFACT_DIR || "artifacts");
// Which worker (1-indexed) owns a given URL's branch of the site, by
// hashing its top-level path segment. Every worker shares one login
// session (one authStatePath), so two workers landing on the same branch
// concurrently (e.g. both touching the same patient record) silently
// corrupt each other's view of server-side session state — not a timing
// bug, a structural one. Pinning each branch to one worker removes the
// collision instead of retrying around it.
export function routeShard(url: string, concurrency: number): number {
  const segment = (() => {
    try {
      return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      return url;
    }
  })();
  let h = 2166136261;
  for (let i = 0; i < segment.length; i++)
    h = Math.imul(h ^ segment.charCodeAt(i), 16777619);
  // Worker slots are 1-indexed everywhere else in this codebase (lease(),
  // events, currentPages) — match that instead of returning 0-indexed.
  return ((h >>> 0) % concurrency) + 1;
}

// AES-256-GCM seal/unseal for a project's login-recipe secrets (any
// `secret: true` fill step's real value — packages/shared/src/index.ts's
// WorkflowStepSchema — supplied explicitly by the user when they save the
// recipe, specifically so the AppMCP "Authenticate" tool
// (packages/mcp/src/app-server.ts) can log in on an agent's behalf without
// asking a human to retype a password every time). Deliberately its own
// derivation, independent of apps/server/src/auth.ts's own seal/unseal
// (which only exists inside createAuth()'s closure, gated on Auth0 actually
// being configured) — reuses the same AUTH0_SECRET key material (already
// documented as "the app's private session key" in .env.example) under a
// distinct label, rather than a second env var for what is, operationally,
// the same kind of secret. Lives in this package (not apps/server) because
// packages/mcp/src/app-server.ts — a package, which must not import from
// apps/server — needs to unseal these too.
let cachedSecretKey: Buffer | undefined;
function secretEncryptionKey(): Buffer {
  if (cachedSecretKey) return cachedSecretKey;
  const secret = process.env.AUTH0_SECRET;
  if (!secret)
    throw new Error(
      "AUTH0_SECRET must be configured to store or read an encrypted login secret",
    );
  cachedSecretKey = scryptSync(secret, "unfold-login-secrets", 32);
  return cachedSecretKey;
}
function sealSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}
function unsealSecret<T>(value: string): T {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue)
    throw new Error("Invalid encrypted login secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
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
   CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT);
   CREATE INDEX IF NOT EXISTS api_token_owners ON api_tokens(owner_id);
   CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS capabilities(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS capability_projects ON capabilities(project_id);
   CREATE TABLE IF NOT EXISTS flows(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS flow_runs ON flows(run_id);
   CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,verification_run_id TEXT,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS evidence_runs ON evidence(run_id);
   CREATE INDEX IF NOT EXISTS evidence_verification_runs ON evidence(verification_run_id);
   CREATE TABLE IF NOT EXISTS verification_runs(id TEXT PRIMARY KEY,capability_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS verification_run_capabilities ON verification_runs(capability_id);
   CREATE TABLE IF NOT EXISTS browse_sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS browse_session_projects ON browse_sessions(project_id);
   CREATE TABLE IF NOT EXISTS browse_events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(session_id,sequence));
   CREATE INDEX IF NOT EXISTS browse_event_sessions ON browse_events(session_id,sequence);
   CREATE TABLE IF NOT EXISTS auth_captures(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS auth_capture_projects ON auth_captures(project_id);
   CREATE TABLE IF NOT EXISTS automation_workflows(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS automation_workflow_projects ON automation_workflows(project_id,owner_id);
   CREATE TABLE IF NOT EXISTS workflow_runs(id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS workflow_run_workflows ON workflow_runs(workflow_id);
   CREATE TABLE IF NOT EXISTS framework_projects(id TEXT PRIMARY KEY,project_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS framework_github_tokens(framework_project_id TEXT PRIMARY KEY,token TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS project_auth_secrets(project_id TEXT PRIMARY KEY,ciphertext TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS test_runs(id TEXT PRIMARY KEY,framework_project_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS test_run_framework_projects ON test_runs(framework_project_id);
   CREATE TABLE IF NOT EXISTS package_operations(id TEXT PRIMARY KEY,framework_project_id TEXT NOT NULL,owner_id TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS package_operation_framework_projects ON package_operations(framework_project_id);
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
      ...(changes.appMcpHeaded !== undefined
        ? { appMcpHeaded: changes.appMcpHeaded }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  /**
   * Replaces the project's `scanConfig.setupSteps` — the project-level login
   * recipe a "Refresh session" action (apps/server/src/auth-session.ts)
   * replays headlessly, and that every new discovery's wizard seeds its own
   * draft from. Deliberately its own narrow method rather than folded into
   * `updateProject`'s generic whitelist: unlike name/description, this can
   * carry a (redacted-at-read-time, but not at-rest) credential-shaped fill
   * value, so it gets a dedicated route with its own intent rather than
   * blending into the general-purpose project-settings PATCH.
   */
  updateProjectLoginRecipe(
    id: string,
    setupSteps: unknown,
    ownerId?: string,
  ): Project {
    const project = this.project(id, ownerId);
    const next = ProjectSchema.parse({
      ...project,
      scanConfig: { ...project.scanConfig, setupSteps },
      updatedAt: new Date().toISOString(),
    });
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  /**
   * Points the project's `scanConfig.authStatePath` at a freshly captured or
   * refreshed session file — never client-driven directly (no route accepts
   * an arbitrary path here; it's always a path this server itself just
   * wrote to, from auth-capture.ts's manual capture or auth-session.ts's
   * headless refresh). `packages/verification/src/runner.ts`'s
   * `resolveAuthStatePath` prefers this project-level path over whatever a
   * specific past discovery run's own config happened to freeze in, so one
   * refresh here immediately un-blocks verification for every capability in
   * the project, not just future discovery runs.
   */
  updateProjectAuthStatePath(
    id: string,
    authStatePath: string,
    ownerId?: string,
  ): Project {
    const project = this.project(id, ownerId);
    const next = ProjectSchema.parse({
      ...project,
      scanConfig: { ...project.scanConfig, authStatePath },
      updatedAt: new Date().toISOString(),
    });
    this.db
      .prepare("UPDATE projects SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  /**
   * A saved login session to replay/execute a flow authenticated with —
   * shared by every caller that needs to attach cookies to a live
   * Playwright context before running a capability's flow
   * (packages/verification/src/runner.ts's repeatability attempts,
   * packages/mcp/src/app-server.ts's AppMCP tool execution). Prefers the
   * PROJECT's current session (`scanConfig.authStatePath` — kept fresh by
   * a "Refresh session" action or a manual re-capture) over the specific
   * discovery run's own frozen-at-crawl-time path: a run's own path is
   * whatever was captured back when THAT crawl happened, with no way to
   * update it short of re-running discovery — if that session has since
   * expired, every future replay against flows from that run would
   * otherwise fail forever for a reason that has nothing to do with the
   * flow itself. Falls back to the run's own path when the project has
   * none (e.g. an older project that never adopted a project-level
   * session). Advisory, not fatal throughout: any lookup failure just
   * falls through to the next option, down to no auth state at all.
   */
  resolveFlowAuthStatePath(
    runId: string,
    ownerId?: string,
  ): string | undefined {
    let run;
    try {
      run = this.run(runId, ownerId);
    } catch {
      return undefined;
    }
    try {
      if (!run.projectId) throw new Error("Run has no projectId");
      const projectPath = this.project(run.projectId, ownerId).scanConfig
        .authStatePath;
      if (projectPath && existsSync(projectPath)) return projectPath;
    } catch {
      // Fall through to the run's own path below.
    }
    const path = run.config.authStatePath;
    return path && existsSync(path) ? path : undefined;
  }
  /**
   * Replaces a project's encrypted login-recipe secrets (keyed by the
   * owning `WorkflowStep`'s own index in `scanConfig.setupSteps` — same
   * indexing `executeStep`'s `secrets` param already uses,
   * packages/worker/src/workflow-runner.ts). Called once, when the user
   * saves the recipe (apps/server/src/index.ts's PUT .../login-recipe),
   * explicitly opting into persistence — never auto-captured; see
   * apps/server/src/auth-capture.ts's recorder, which deliberately never
   * lets a password's real value reach the server at all otherwise. An
   * empty map clears any previously stored secrets for the project rather
   * than leaving stale ones behind after a recipe edit removes a secret
   * step.
   */
  saveProjectAuthSecrets(
    projectId: string,
    secrets: Record<string, string>,
  ): void {
    if (Object.keys(secrets).length === 0) {
      this.db
        .prepare("DELETE FROM project_auth_secrets WHERE project_id=?")
        .run(projectId);
      return;
    }
    const ciphertext = sealSecret(secrets);
    this.db
      .prepare(
        "INSERT INTO project_auth_secrets(project_id,ciphertext) VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET ciphertext=excluded.ciphertext",
      )
      .run(projectId, ciphertext);
  }
  /**
   * The decrypted secrets map for a project's login recipe — server-
   * internal use only (packages/mcp/src/app-server.ts's "Authenticate"
   * tool). Never call this from a route that returns its result to a
   * client; nothing else in this codebase should ever see a real secret
   * value come back from the server once saved.
   */
  projectAuthSecrets(projectId: string): Record<string, string> {
    const row = this.db
      .prepare("SELECT ciphertext FROM project_auth_secrets WHERE project_id=?")
      .get(projectId) as { ciphertext: string } | undefined;
    if (!row) return {};
    try {
      return unsealSecret<Record<string, string>>(row.ciphertext);
    } catch {
      return {};
    }
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
      "Use search_api_calls to find observed endpoints, then get_api_flow (with that call's taskId) to read the full captured request sequence behind one interaction, route, or probe task — omit taskId to list every flow in a discovery instead. These tools return evidence and do not execute API calls. If evidence is missing or stale, use start_discovery, then poll list_discoveries until that discovery finishes before drawing conclusions.",
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
      const concurrency = this.run(runId).config.concurrency;
      // concurrency===1 has nothing to shard between; take the next task
      // as before. Otherwise each worker only pulls tasks whose branch it
      // owns (see routeShard) — never the whole shared frontier — so a
      // worker whose branch is exhausted goes idle rather than reaching
      // into another worker's in-progress branch.
      if (concurrency <= 1) {
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
      }
      const rows = this.db
        .prepare(
          "SELECT data FROM tasks WHERE run_id=? AND status='pending' ORDER BY depth ASC,priority DESC,rowid ASC",
        )
        .all(runId) as { data: string }[];
      for (const row of rows) {
        const task: TaskLease = JSON.parse(row.data);
        if (routeShard(task.url, concurrency) !== worker) continue;
        task.status = "leased";
        task.worker = worker;
        task.attempts++;
        task.leaseUntil = Date.now() + timeout;
        this.saveTask(task);
        return task;
      }
      return undefined;
    });
  }
  // lease() is synchronous, so with sharding active a worker whose branch
  // owns nothing yet can hit "no task" and check "is everything idle"
  // before any OTHER worker has had a turn to lease the one task that
  // exists (e.g. the very first seed route, which only one shard owns) —
  // inFlight alone can't tell a truly-finished run apart from that
  // startup race. Callers should only exit when inFlight is 0 *and*
  // nothing is left pending anywhere, not just in their own shard.
  hasPending(runId: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM tasks WHERE run_id=? AND status='pending' LIMIT 1",
        )
        .get(runId) !== undefined
    );
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
  // Personal access tokens (apps/server/src/auth.ts's `requireAuth` extends
  // its existing cookie/Auth0-JWT bearer paths with these — the Chrome
  // extension (apps/extension) needs a credential it can hold long-term
  // without an OAuth refresh flow running client-side, which neither a
  // short-lived Auth0 access token nor a sensitive refresh token is safe
  // for). Only ever a hash is stored, matching `auth_sessions`'s pattern —
  // the plaintext token is shown to the user exactly once, at creation.
  createApiToken(
    id: string,
    ownerId: string,
    tokenHash: string,
    label: string,
    createdAt: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO api_tokens(id,owner_id,token_hash,label,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, ownerId, tokenHash, label, createdAt);
  }
  apiTokenByHash(
    tokenHash: string,
  ): { id: string; owner_id: string; label: string } | undefined {
    return this.db
      .prepare("SELECT id,owner_id,label FROM api_tokens WHERE token_hash=?")
      .get(tokenHash) as
      | { id: string; owner_id: string; label: string }
      | undefined;
  }
  touchApiToken(id: string) {
    this.db
      .prepare("UPDATE api_tokens SET last_used_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
  }
  apiTokens(
    ownerId: string,
  ): { id: string; label: string; createdAt: string; lastUsedAt?: string }[] {
    return (
      this.db
        .prepare(
          "SELECT id,label,created_at,last_used_at FROM api_tokens WHERE owner_id=? ORDER BY created_at DESC",
        )
        .all(ownerId) as {
        id: string;
        label: string;
        created_at: string;
        last_used_at: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? undefined,
    }));
  }
  /** Scoped to `ownerId` so a user can only ever revoke their own tokens. */
  deleteApiToken(id: string, ownerId: string) {
    this.db
      .prepare("DELETE FROM api_tokens WHERE id=? AND owner_id=?")
      .run(id, ownerId);
  }
  saveCapability(capability: Capability): Capability {
    const parsed = CapabilitySchema.parse(capability);
    this.db
      .prepare(
        "INSERT INTO capabilities(id,project_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(parsed.id, parsed.projectId, JSON.stringify(parsed));
    return parsed;
  }
  capability(id: string): Capability | undefined {
    const row = this.db
      .prepare("SELECT data FROM capabilities WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? CapabilitySchema.parse(JSON.parse(row.data)) : undefined;
  }
  capabilities(projectId: string): Capability[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM capabilities WHERE project_id=? ORDER BY rowid DESC",
        )
        .all(projectId) as { data: string }[]
    ).map((row) => CapabilitySchema.parse(JSON.parse(row.data)));
  }
  /** Also drops the capability's own verification history — it has no other owner once the capability is gone. */
  deleteCapability(id: string): void {
    this.db
      .prepare("DELETE FROM verification_runs WHERE capability_id=?")
      .run(id);
    this.db.prepare("DELETE FROM capabilities WHERE id=?").run(id);
  }
  saveFlow(flow: Flow): Flow {
    const parsed = FlowSchema.parse(flow);
    this.db
      .prepare(
        "INSERT INTO flows(id,run_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(parsed.id, parsed.runId, JSON.stringify(parsed));
    return parsed;
  }
  flow(id: string): Flow | undefined {
    const row = this.db.prepare("SELECT data FROM flows WHERE id=?").get(id) as
      | { data: string }
      | undefined;
    return row ? FlowSchema.parse(JSON.parse(row.data)) : undefined;
  }
  flows(runId: string): Flow[] {
    return (
      this.db
        .prepare("SELECT data FROM flows WHERE run_id=? ORDER BY rowid DESC")
        .all(runId) as { data: string }[]
    ).map((row) => FlowSchema.parse(JSON.parse(row.data)));
  }
  saveEvidence(evidence: Evidence): Evidence {
    const parsed = EvidenceSchema.parse(evidence);
    this.db
      .prepare(
        "INSERT INTO evidence(id,run_id,verification_run_id,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,verification_run_id=excluded.verification_run_id",
      )
      .run(
        parsed.id,
        parsed.runId,
        parsed.verificationRunId ?? null,
        JSON.stringify(parsed),
      );
    return parsed;
  }
  evidence(id: string): Evidence | undefined {
    const row = this.db
      .prepare("SELECT data FROM evidence WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? EvidenceSchema.parse(JSON.parse(row.data)) : undefined;
  }
  evidenceForVerificationRun(verificationRunId: string): Evidence[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM evidence WHERE verification_run_id=? ORDER BY rowid ASC",
        )
        .all(verificationRunId) as { data: string }[]
    ).map((row) => EvidenceSchema.parse(JSON.parse(row.data)));
  }
  saveVerificationRun(run: VerificationRun): VerificationRun {
    const parsed = VerificationRunSchema.parse(run);
    this.db
      .prepare(
        "INSERT INTO verification_runs(id,capability_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(parsed.id, parsed.capabilityId, JSON.stringify(parsed));
    return parsed;
  }
  verificationRun(id: string): VerificationRun | undefined {
    const row = this.db
      .prepare("SELECT data FROM verification_runs WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? VerificationRunSchema.parse(JSON.parse(row.data)) : undefined;
  }
  verificationRuns(capabilityId: string): VerificationRun[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM verification_runs WHERE capability_id=? ORDER BY rowid DESC",
        )
        .all(capabilityId) as { data: string }[]
    ).map((row) => VerificationRunSchema.parse(JSON.parse(row.data)));
  }
  // AI Browse (apps/server/src/browse-session.ts). Unlike capabilities/flows,
  // browse_sessions carries owner_id directly rather than relying on a prior
  // store.project(id, ownerId) ownership check at the call site — a browse
  // session is reached by session id alone on the events/chat/close routes,
  // with no natural "look up the project first" hop the way capability
  // routes have.
  createBrowseSession(session: BrowseSession): BrowseSession {
    const parsed = BrowseSessionSchema.parse(session);
    this.db
      .prepare(
        "INSERT INTO browse_sessions(id,project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(parsed.id, parsed.projectId, parsed.ownerId, JSON.stringify(parsed));
    return parsed;
  }
  browseSession(id: string, ownerId: string): BrowseSession | undefined {
    const row = this.db
      .prepare("SELECT data FROM browse_sessions WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? BrowseSessionSchema.parse(JSON.parse(row.data)) : undefined;
  }
  browseSessions(projectId: string, ownerId: string): BrowseSession[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM browse_sessions WHERE project_id=? AND owner_id=? ORDER BY rowid DESC",
        )
        .all(projectId, ownerId) as { data: string }[]
    ).map((row) => BrowseSessionSchema.parse(JSON.parse(row.data)));
  }
  updateBrowseSession(
    id: string,
    patch: Partial<BrowseSession>,
    ownerId: string,
  ): BrowseSession {
    const existing = this.browseSession(id, ownerId);
    if (!existing) throw new Error("Browse session not found");
    const parsed = BrowseSessionSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE browse_sessions SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  // Call once at server startup. A browse session's actual Browser/Page
  // handle lives only in apps/server/src/browse-session.ts's in-memory
  // `live` map — it never survives a process restart. Any session this
  // table still calls "live"/"connecting" from a previous process is
  // therefore necessarily stale (that process died or was restarted while
  // it was open), and left alone it fools the dashboard's session-recovery
  // effect into reattaching to a dead session instead of starting a fresh
  // one — skipping the connect/launch flow (and the base-URL auto-navigate
  // that only happens inside openBrowseSession) entirely.
  closeStaleBrowseSessions(): void {
    const rows = this.db
      .prepare("SELECT id, data FROM browse_sessions")
      .all() as { id: string; data: string }[];
    const closedAt = new Date().toISOString();
    for (const row of rows) {
      const session = BrowseSessionSchema.parse(JSON.parse(row.data));
      if (session.status !== "live" && session.status !== "connecting")
        continue;
      const patched = BrowseSessionSchema.parse({
        ...session,
        status: "closed",
        closedAt,
      });
      this.db
        .prepare("UPDATE browse_sessions SET data=? WHERE id=?")
        .run(JSON.stringify(patched), row.id);
    }
  }
  appendBrowseEvent(event: BrowseEvent): BrowseEvent {
    const parsed = BrowseEventSchema.parse(event);
    this.db
      .prepare(
        "INSERT INTO browse_events(id,session_id,sequence,data) VALUES (?,?,?,?) ON CONFLICT(session_id,sequence) DO NOTHING",
      )
      .run(
        parsed.id,
        parsed.sessionId,
        parsed.sequence,
        JSON.stringify(parsed),
      );
    return parsed;
  }
  browseEventsSince(sessionId: string, afterSequence: number): BrowseEvent[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM browse_events WHERE session_id=? AND sequence>? ORDER BY sequence ASC",
        )
        .all(sessionId, afterSequence) as { data: string }[]
    ).map((row) => BrowseEventSchema.parse(JSON.parse(row.data)));
  }
  // Login session capture (apps/server/src/auth-capture.ts) — a human logs
  // into the target app in a fresh, isolated, visible browser window; the
  // resulting storageState() is saved to disk and its path offered as a
  // discovery run's ScanConfig.authStatePath. Same owner_id-on-row shape as
  // browse_sessions, for the same reason (reached by capture id alone).
  createAuthCapture(capture: AuthCapture): AuthCapture {
    const parsed = AuthCaptureSchema.parse(capture);
    this.db
      .prepare(
        "INSERT INTO auth_captures(id,project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(parsed.id, parsed.projectId, parsed.ownerId, JSON.stringify(parsed));
    return parsed;
  }
  authCapture(id: string, ownerId: string): AuthCapture | undefined {
    const row = this.db
      .prepare("SELECT data FROM auth_captures WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? AuthCaptureSchema.parse(JSON.parse(row.data)) : undefined;
  }
  authCaptures(projectId: string, ownerId: string): AuthCapture[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM auth_captures WHERE project_id=? AND owner_id=? ORDER BY rowid DESC",
        )
        .all(projectId, ownerId) as { data: string }[]
    ).map((row) => AuthCaptureSchema.parse(JSON.parse(row.data)));
  }
  updateAuthCapture(
    id: string,
    patch: Partial<AuthCapture>,
    ownerId: string,
  ): AuthCapture {
    const existing = this.authCapture(id, ownerId);
    if (!existing) throw new Error("Auth capture not found");
    const parsed = AuthCaptureSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE auth_captures SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  deleteAuthCapture(id: string, ownerId: string): void {
    this.db
      .prepare("DELETE FROM auth_captures WHERE id=? AND owner_id=?")
      .run(id, ownerId);
  }
  // Call once at server startup — mirrors closeStaleBrowseSessions(): an
  // auth capture's live Browser/Page handle lives only in
  // apps/server/src/auth-capture.ts's in-memory map and never survives a
  // process restart, so any row still "open" from a previous process is
  // necessarily stale.
  closeStaleAuthCaptures(): void {
    const rows = this.db
      .prepare("SELECT id, data FROM auth_captures")
      .all() as {
      id: string;
      data: string;
    }[];
    for (const row of rows) {
      const capture = AuthCaptureSchema.parse(JSON.parse(row.data));
      if (capture.status !== "open") continue;
      const patched = AuthCaptureSchema.parse({
        ...capture,
        status: "cancelled",
      });
      this.db
        .prepare("UPDATE auth_captures SET data=? WHERE id=?")
        .run(JSON.stringify(patched), row.id);
    }
  }
  // Automation: Workflow tab. See apps/server/src/automation-workflows.ts.
  createAutomationWorkflow(workflow: AutomationWorkflow): AutomationWorkflow {
    const parsed = AutomationWorkflowSchema.parse(workflow);
    this.db
      .prepare(
        "INSERT INTO automation_workflows(id,project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(parsed.id, parsed.projectId, parsed.ownerId, JSON.stringify(parsed));
    return parsed;
  }
  automationWorkflow(
    id: string,
    ownerId: string,
  ): AutomationWorkflow | undefined {
    const row = this.db
      .prepare(
        "SELECT data FROM automation_workflows WHERE id=? AND owner_id=?",
      )
      .get(id, ownerId) as { data: string } | undefined;
    return row
      ? AutomationWorkflowSchema.parse(JSON.parse(row.data))
      : undefined;
  }
  automationWorkflows(
    projectId: string,
    ownerId: string,
  ): AutomationWorkflow[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM automation_workflows WHERE project_id=? AND owner_id=? ORDER BY rowid DESC",
        )
        .all(projectId, ownerId) as { data: string }[]
    ).map((row) => AutomationWorkflowSchema.parse(JSON.parse(row.data)));
  }
  updateAutomationWorkflow(
    id: string,
    patch: Partial<AutomationWorkflow>,
    ownerId: string,
  ): AutomationWorkflow {
    const existing = this.automationWorkflow(id, ownerId);
    if (!existing) throw new Error("Workflow not found");
    const parsed = AutomationWorkflowSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE automation_workflows SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  deleteAutomationWorkflow(id: string, ownerId: string): void {
    this.db
      .prepare("DELETE FROM automation_workflows WHERE id=? AND owner_id=?")
      .run(id, ownerId);
    this.db.prepare("DELETE FROM workflow_runs WHERE workflow_id=?").run(id);
  }
  createWorkflowRun(run: WorkflowRun): WorkflowRun {
    const parsed = WorkflowRunSchema.parse(run);
    this.db
      .prepare(
        "INSERT INTO workflow_runs(id,workflow_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(
        parsed.id,
        parsed.workflowId,
        parsed.ownerId,
        JSON.stringify(parsed),
      );
    return parsed;
  }
  workflowRun(id: string, ownerId: string): WorkflowRun | undefined {
    const row = this.db
      .prepare("SELECT data FROM workflow_runs WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? WorkflowRunSchema.parse(JSON.parse(row.data)) : undefined;
  }
  workflowRuns(workflowId: string, ownerId: string): WorkflowRun[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM workflow_runs WHERE workflow_id=? AND owner_id=? ORDER BY rowid DESC",
        )
        .all(workflowId, ownerId) as { data: string }[]
    ).map((row) => WorkflowRunSchema.parse(JSON.parse(row.data)));
  }
  updateWorkflowRun(
    id: string,
    patch: Partial<WorkflowRun>,
    ownerId: string,
  ): WorkflowRun {
    const existing = this.workflowRun(id, ownerId);
    if (!existing) throw new Error("Workflow run not found");
    const parsed = WorkflowRunSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE workflow_runs SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  // Automation: Framework tab. See apps/server/src/automation-framework.ts.
  // One FrameworkProject per project (get-or-create) — framework_projects
  // enforces that with a UNIQUE(project_id) column.
  createFrameworkProject(project: FrameworkProject): FrameworkProject {
    const parsed = FrameworkProjectSchema.parse(project);
    this.db
      .prepare(
        "INSERT INTO framework_projects(id,project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(parsed.id, parsed.projectId, parsed.ownerId, JSON.stringify(parsed));
    return parsed;
  }
  frameworkProject(
    projectId: string,
    ownerId: string,
  ): FrameworkProject | undefined {
    const row = this.db
      .prepare(
        "SELECT data FROM framework_projects WHERE project_id=? AND owner_id=?",
      )
      .get(projectId, ownerId) as { data: string } | undefined;
    return row ? FrameworkProjectSchema.parse(JSON.parse(row.data)) : undefined;
  }
  frameworkProjectById(
    id: string,
    ownerId: string,
  ): FrameworkProject | undefined {
    const row = this.db
      .prepare("SELECT data FROM framework_projects WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? FrameworkProjectSchema.parse(JSON.parse(row.data)) : undefined;
  }
  updateFrameworkProject(
    id: string,
    patch: Partial<FrameworkProject>,
    ownerId: string,
  ): FrameworkProject {
    const existing = this.frameworkProjectById(id, ownerId);
    if (!existing) throw new Error("Framework project not found");
    const parsed = FrameworkProjectSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE framework_projects SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  // The GitHub PAT a FrameworkProject connects with — kept out of the
  // framework_projects.data blob entirely so every route that returns a
  // FrameworkProject to the client is safe by construction.
  setFrameworkGithubToken(frameworkProjectId: string, token: string): void {
    this.db
      .prepare(
        "INSERT INTO framework_github_tokens(framework_project_id,token) VALUES (?,?) ON CONFLICT(framework_project_id) DO UPDATE SET token=excluded.token",
      )
      .run(frameworkProjectId, token);
  }
  frameworkGithubToken(frameworkProjectId: string): string | undefined {
    const row = this.db
      .prepare(
        "SELECT token FROM framework_github_tokens WHERE framework_project_id=?",
      )
      .get(frameworkProjectId) as { token: string } | undefined;
    return row?.token;
  }
  createTestRun(run: TestRun): TestRun {
    const parsed = TestRunSchema.parse(run);
    this.db
      .prepare(
        "INSERT INTO test_runs(id,framework_project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(
        parsed.id,
        parsed.frameworkProjectId,
        parsed.ownerId,
        JSON.stringify(parsed),
      );
    return parsed;
  }
  testRun(id: string, ownerId: string): TestRun | undefined {
    const row = this.db
      .prepare("SELECT data FROM test_runs WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? TestRunSchema.parse(JSON.parse(row.data)) : undefined;
  }
  testRuns(frameworkProjectId: string, ownerId: string): TestRun[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM test_runs WHERE framework_project_id=? AND owner_id=? ORDER BY rowid DESC",
        )
        .all(frameworkProjectId, ownerId) as { data: string }[]
    ).map((row) => TestRunSchema.parse(JSON.parse(row.data)));
  }
  updateTestRun(id: string, patch: Partial<TestRun>, ownerId: string): TestRun {
    const existing = this.testRun(id, ownerId);
    if (!existing) throw new Error("Test run not found");
    const parsed = TestRunSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE test_runs SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  createPackageOperation(op: PackageOperation): PackageOperation {
    const parsed = PackageOperationSchema.parse(op);
    this.db
      .prepare(
        "INSERT INTO package_operations(id,framework_project_id,owner_id,data) VALUES (?,?,?,?)",
      )
      .run(
        parsed.id,
        parsed.frameworkProjectId,
        parsed.ownerId,
        JSON.stringify(parsed),
      );
    return parsed;
  }
  packageOperation(id: string, ownerId: string): PackageOperation | undefined {
    const row = this.db
      .prepare("SELECT data FROM package_operations WHERE id=? AND owner_id=?")
      .get(id, ownerId) as { data: string } | undefined;
    return row ? PackageOperationSchema.parse(JSON.parse(row.data)) : undefined;
  }
  updatePackageOperation(
    id: string,
    patch: Partial<PackageOperation>,
    ownerId: string,
  ): PackageOperation {
    const existing = this.packageOperation(id, ownerId);
    if (!existing) throw new Error("Package operation not found");
    const parsed = PackageOperationSchema.parse({ ...existing, ...patch });
    this.db
      .prepare("UPDATE package_operations SET data=? WHERE id=?")
      .run(JSON.stringify(parsed), id);
    return parsed;
  }
  close() {
    this.db.close();
  }
}
