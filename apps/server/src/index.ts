import express from "express";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { zipSync } from "fflate";
import { ConfigSchema } from "../../../packages/shared/src/index.js";
import { Store, artifactRoot } from "../../../packages/storage/src/index.js";
import { Coordinator } from "../../../packages/core/src/index.js";
import { exportRun } from "../../../packages/generator/src/index.js";
import {
  connectProjectMcpClient,
  handleProjectMcp,
} from "../../../packages/mcp/src/server.js";
import {
  handleProjectAppMcpPost,
  handleProjectAppMcpGet,
  handleProjectAppMcpDelete,
} from "../../../packages/mcp/src/app-server.js";
import { createAuth } from "./auth.js";
import { VerificationRunner } from "../../../packages/verification/src/runner.js";
import {
  capabilitiesForDiscovery,
  capabilitiesWithFlows,
  publishedCandidatesForProject,
  mineForDiscovery,
  canStartVerification,
  canApprove,
  canPublish,
  publishCapability,
  disableCapability,
  deleteCapability,
  setRequiredCapabilities,
} from "./capabilities.js";
import {
  openBrowseSession,
  closeBrowseSession,
  getLiveSession,
  recordEvent,
  subscribeBrowseSession,
  screenshotBrowseSession,
  BrowseSessionConflictError,
} from "./browse-session.js";
import {
  openAuthCapture,
  captureAuthState,
  cancelAuthCapture,
  forgetAuthCapture,
  AuthCaptureConflictError,
} from "./auth-capture.js";
import { connectBrowseMcpClient } from "../../../packages/mcp/src/browse-tools.js";
import {
  toModelContextTool,
  registerCapabilities,
} from "../../../packages/adapters/webmcp/src/index.js";
import { replayCapability } from "../../../packages/capability-runtime/src/replay.js";
import {
  mineWithLlm,
  isMiningJobActive,
  MiningJobConflictError,
} from "./mining-session.js";
import type { EvidenceScope } from "../../../packages/capability-core/src/authoring.js";
import {
  listWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflow,
  getWorkflowRun,
} from "./automation-workflows.js";
import {
  getOrCreateFrameworkProject,
  listFiles as listFrameworkFiles,
  readFile as readFrameworkFile,
  writeFile as writeFrameworkFile,
  listPackages,
} from "./automation-framework.js";
import {
  runFrameworkTests,
  addPackage,
  removePackage,
} from "./automation-execution.js";
import { connectGithub, syncGithub } from "./automation-github.js";
import { suggestFix } from "./automation-suggest-fix.js";
const app = express(),
  store = new Store(),
  coordinator = new Coordinator(store),
  verificationRunner = new VerificationRunner(store);
// Browse sessions' live Browser/Page handle never survives a restart —
// clear out any session this process's predecessor left marked "live" so
// the dashboard starts a real new session (and runs the base-URL
// auto-navigate) instead of reattaching to a dead one.
store.closeStaleBrowseSessions();
store.closeStaleAuthCaptures();
// Fallback when there's no OPENAI_API_KEY, the live /models fetch fails
// (network, non-OpenAI-compatible endpoint), or returns nothing usable —
// the dropdown always has something in it either way.
const agentModels = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", detail: "Fast and efficient" },
  { id: "gpt-4.1", label: "GPT-4.1", detail: "Advanced reasoning-free model" },
];
// Model ids that exist in the catalog but aren't chat-completion models
// (embeddings, audio, image, moderation, legacy completion-only models) —
// filtered out so the dropdown only ever offers models that can actually
// back the agent chat / mining calls this list feeds.
const NON_CHAT_MODEL_PATTERN =
  /embedding|whisper|tts|dall-e|moderation|davinci|babbage|curie|ada-|realtime|audio|image|transcribe/i;
let liveModelCache: { models: typeof agentModels; fetchedAt: number } | null =
  null;
const LIVE_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
async function fetchLiveOpenAIModels(): Promise<
  typeof agentModels | undefined
> {
  if (
    liveModelCache &&
    Date.now() - liveModelCache.fetchedAt < LIVE_MODEL_CACHE_TTL_MS
  )
    return liveModelCache.models;
  if (!process.env.OPENAI_API_KEY) return undefined;
  try {
    const base = (
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: { id: string }[] };
    const ids = (body.data || [])
      .map((m) => m.id)
      .filter((id) => id && !NON_CHAT_MODEL_PATTERN.test(id))
      .sort();
    if (!ids.length) return undefined;
    const models = ids.map((id) => ({ id, label: id, detail: "OpenAI" }));
    liveModelCache = { models, fetchedAt: Date.now() };
    return models;
  } catch {
    return undefined;
  }
}
/**
 * Validates a client-requested model id against whatever's actually
 * offered right now (the live-fetched catalog when available, same as
 * /agent/status serves to the dropdown — falling back to the static
 * agentModels list otherwise) plus the configured server default. Returns
 * the configured default for an empty/missing request, or undefined for a
 * request that doesn't match anything offered (caller should reject rather
 * than silently substitute, so picking an unsupported model is a clear
 * error instead of quietly running under a different one than asked for).
 */
async function resolveAllowedModel(
  requested: unknown,
): Promise<string | undefined> {
  const configuredModel = process.env.OPENAI_MODEL || agentModels[0].id;
  if (requested === undefined || requested === null || requested === "")
    return configuredModel;
  if (typeof requested !== "string") return undefined;
  const live = await fetchLiveOpenAIModels();
  const offered = live && live.length ? live : agentModels;
  const allowed = new Set([...offered.map((m) => m.id), configuredModel]);
  return allowed.has(requested) ? requested : undefined;
}
const port = Number(process.env.PORT) || 4310;
const auth = createAuth(store);
const userId = (res: express.Response) =>
  (res.locals.authUser as { sub: string }).sub;
const appOrigin =
  process.env.APP_ORIGIN ||
  process.env.APP_BASE_URL ||
  (process.env.RENDER_EXTERNAL_HOSTNAME
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
    : `http://127.0.0.1:${port}`);
const configuredOrigins = (process.env.APP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .flatMap((value) => {
    try {
      const origin = new URL(value).origin;
      return origin === value.replace(/\/$/, "") ? [origin] : [];
    } catch {
      return [];
    }
  });
const allowedOrigins = new Set([
  appOrigin,
  ...configuredOrigins,
  `http://127.0.0.1:${port}`,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  `http://localhost:${port}`,
]);
const configuredHosts = (process.env.APP_ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .flatMap((value) => {
    try {
      const host = value.includes("://") ? new URL(value).host : value;
      return /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)
        ? [host.toLowerCase()]
        : [];
    } catch {
      return [];
    }
  });
const allowedHosts = new Set(
  [...allowedOrigins, ...configuredHosts].map((origin) => {
    try {
      return origin.includes("://")
        ? new URL(origin).host.toLowerCase()
        : origin.toLowerCase();
    } catch {
      return "";
    }
  }),
);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  const host = (req.get("host") || "").toLowerCase();
  if (!allowedHosts.has(host)) {
    res.status(403).json({ error: "Host not allowed" });
    return;
  }
  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !req.is("application/json")
  ) {
    res.status(415).json({ error: "Use application/json" });
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "100kb" }));
app.get("/auth/status", auth.status);
app.get("/auth/login", auth.login);
app.get("/auth/callback", auth.callback);
app.get("/auth/me", auth.requireAuth, auth.me);
app.get("/auth/logout", auth.logout);
app.post("/auth/forgot-password", auth.forgotPassword);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, engine: "Unfold v1" }),
);
app.use("/api", auth.requireAuth);
app.get("/api/settings", (_req, res) =>
  res.json(store.userSettings(userId(res))),
);
app.put("/api/settings", (req, res) =>
  res.json(store.saveUserSettings(userId(res), req.body)),
);
// Personal access tokens (apps/server/src/auth.ts) — the credential the
// Chrome extension (apps/extension) authenticates with. Issuing/listing/
// revoking all require an already-authenticated session (cookie or Auth0
// JWT, per `app.use("/api", auth.requireAuth)` above) — a PAT can list and
// revoke other PATs but, deliberately, cannot mint a new one, so a leaked
// extension token alone can't be used to self-issue further tokens.
app.get("/api/settings/tokens", (_req, res) =>
  res.json(auth.listApiTokens(userId(res))),
);
app.post("/api/settings/tokens", (req, res) => {
  const label = String(req.body?.label || "").trim();
  if (!label || label.length > 80)
    return res.status(400).json({ error: "label must be 1-80 characters." });
  res.status(201).json(auth.createApiToken(userId(res), label));
});
app.delete("/api/settings/tokens/:tokenId", (req, res) => {
  auth.revokeApiToken(userId(res), req.params.tokenId);
  res.status(204).end();
});
/**
 * The Chrome extension's (apps/extension) tool catalog for one real-world
 * origin — unlike `GET .../browse/webmcp-tools` (an AI Browse-only,
 * display-only name/description list), this returns the FULL
 * `{capability, flow}` pairs `publishedCandidatesForProject` already builds
 * for `registerCapabilities`, because the extension has no Playwright/Node
 * bridge behind it (packages/capability-runtime/src/replay.ts only runs
 * server-side) — its content script needs the real locators/steps/proof to
 * replay a capability itself, entirely client-side
 * (apps/extension/src/replay.ts). Spans every project owned by the
 * authenticated user (cookie, Auth0 JWT, or a personal access token — all
 * handled identically by `auth.requireAuth` above) whose `baseUrl` origin
 * matches `origin`, not just one project, since the content script only
 * knows `location.origin`, never a specific project id.
 */
app.get("/api/extension/tools", (req, res) => {
  const origin = String(req.query.origin || "");
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    return res
      .status(400)
      .json({ error: "A valid origin query param is required." });
  }
  const ownerId = userId(res);
  const projects = store.projects(ownerId).filter((project) => {
    try {
      return new URL(project.baseUrl).origin === parsedOrigin;
    } catch {
      return false;
    }
  });
  const tools = projects.flatMap((project) => {
    const published = publishedCandidatesForProject(store, project.id);
    // Only a PUBLISHED prerequisite can actually be replayed client-side —
    // the extension has no Store/DB access of its own (apps/extension/src's
    // MAIN-world content script can't reach anything but what's embedded
    // right here). Every declared requiredCapabilityIds entry is still
    // represented (so apps/extension/src/replay.ts can name a missing one
    // in its error text instead of silently vanishing), just without a
    // `flow` to actually replay when it isn't published.
    const byId = new Map(published.map((c) => [c.capability.id, c] as const));
    return published.map((candidate) => ({
      projectId: project.id,
      projectName: project.name,
      ...candidate,
      // `?? []` guards a capability row persisted before this field existed
      // somehow reaching here without the zod default having applied (e.g.
      // a stale compiled server process) rather than assuming every
      // Capability object always carries it.
      requiredCapabilities: (
        candidate.capability.requiredCapabilityIds ?? []
      ).map((requiredId) => {
        const requiredPublished = byId.get(requiredId);
        if (requiredPublished)
          return {
            name: requiredPublished.capability.name,
            available: true,
            flow: requiredPublished.flow,
          };
        const requiredAny = store.capability(requiredId);
        return { name: requiredAny?.name ?? requiredId, available: false };
      }),
    }));
  });
  res.json(tools);
});
/**
 * Packages the already-built Chrome extension (`npm run extension:build`,
 * which produces apps/extension/dist) as a zip so the dashboard's Connect
 * modal can offer a direct download instead of asking the user to build it
 * themselves. 404s with a clear message if the build hasn't been run yet.
 */
app.get("/api/extension/download", async (_req, res) => {
  const root = resolve("apps/extension/dist");
  if (!existsSync(root)) {
    res.status(404).json({
      error: "Extension build not found. Run `npm run extension:build`.",
    });
    return;
  }
  const files: Record<string, Uint8Array> = {};
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files[relative(root, path)] = new Uint8Array(await readFile(path));
    }
  }
  await walk(root);
  res
    .type("application/zip")
    .attachment("unfold-extension.zip")
    .send(Buffer.from(zipSync(files)));
});
app.get("/api/projects", (_req, res) => res.json(store.projects(userId(res))));
app.post("/api/projects", (req, res) => {
  const ownerId = userId(res);
  const project = store.createProject(req.body, ownerId);
  res.status(201).json(store.projectData(project.id, ownerId));
});
app.get("/api/projects/:id", (req, res) =>
  res.json(store.projectData(req.params.id, userId(res))),
);
app.patch("/api/projects/:id", (req, res) =>
  res.json({
    project: store.updateProject(req.params.id, req.body, userId(res)),
  }),
);
app.post("/api/projects/:id/archive", (req, res) =>
  res.json({ project: store.archiveProject(req.params.id, userId(res)) }),
);
app.post("/api/projects/:id/restore", (req, res) =>
  res.json({ project: store.restoreProject(req.params.id, userId(res)) }),
);
app.get("/api/projects/:id/agent.md", (req, res) => {
  const project = store.projectData(req.params.id, userId(res));
  res
    .type("text/markdown")
    .attachment("AGENTS.md")
    .send(project.agent.systemPrompt);
});
app.get("/api/projects/:id/agent/status", async (req, res, next) => {
  try {
    store.project(req.params.id, userId(res));
    const defaultModel = process.env.OPENAI_MODEL || agentModels[0].id;
    const live = await fetchLiveOpenAIModels();
    const base = live && live.length ? live : agentModels;
    const models = base.some((model) => model.id === defaultModel)
      ? base
      : [
          ...base,
          {
            id: defaultModel,
            label: `Configured · ${defaultModel}`,
            detail: "Server default",
          },
        ];
    res.json({
      configured: Boolean(process.env.OPENAI_API_KEY),
      defaultModel,
      models,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/projects/:id/agent/live", (req, res) => {
  const ownerId = userId(res);
  const discoveries = store.discoveries(req.params.id, ownerId);
  const run =
    discoveries.find((item) =>
      ["queued", "running", "pausing"].includes(item.status),
    ) || discoveries[0];
  if (!run) return res.json({ run: undefined, state: undefined });
  const data = store.data(run.id, ownerId);
  const state = [...data.states].sort((a, b) =>
    b.discoveredAt.localeCompare(a.discoveredAt),
  )[0];
  res.json({ run, state });
});
app.post("/api/projects/:id/agent/chat", async (req, res, next) => {
  let connection:
    | Awaited<ReturnType<typeof connectProjectMcpClient>>
    | undefined;
  let emit = (_value: unknown) => {};
  try {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    if (!process.env.OPENAI_API_KEY)
      return res.status(503).json({
        error: "Configure OPENAI_API_KEY to run the project agent.",
      });
    const prompt = String(req.body.message || "").trim();
    if (!prompt || prompt.length > 12000)
      return res
        .status(400)
        .json({ error: "Message must be 1–12,000 characters." });
    const model = await resolveAllowedModel(req.body.model);
    if (!model)
      return res
        .status(400)
        .json({ error: "Choose a supported assistant model." });
    const history = Array.isArray(req.body.history)
      ? req.body.history
          .filter(
            (item: any) =>
              ["user", "assistant"].includes(item?.role) &&
              typeof item?.content === "string",
          )
          .slice(-12)
          .map((item: any) => ({
            role: item.role,
            content: item.content.slice(0, 12000),
          }))
      : [];
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    emit = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ type: "status", message: "Connecting project MCP tools…" });
    connection = await connectProjectMcpClient(
      store,
      project.id,
      ({ name, seeds }) => {
        if (project.archivedAt)
          throw new Error("Archived projects cannot start a discovery");
        const defaults = store.userSettings(ownerId).discovery;
        const config = ConfigSchema.parse({
          ...project.scanConfig,
          ...defaults,
          name: name || project.name,
          seeds: seeds ?? project.scanConfig.seeds,
          denyActionKeywords: [
            ...new Set([
              ...project.scanConfig.denyActionKeywords,
              ...defaults.denyActionKeywords,
            ]),
          ],
        });
        const run = store.createRun(config, project.id, ownerId);
        void coordinator
          .start(run.id)
          .catch((error) =>
            console.error("Agent discovery failed:", error.message),
          );
        return store.summary(run.id, ownerId);
      },
    );
    const listed = await connection.client.listTools();
    const tools = (listed.tools as any[]).map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || tool.name,
        parameters: tool.inputSchema,
      },
    }));
    const messages: any[] = [
      {
        role: "system",
        content: `${store.projectData(project.id, ownerId).agent.systemPrompt}\n\nYou are running inside Unfold. Use the provided MCP tools for project actions and evidence. You may start a browser discovery with start_discovery; discoveries run asynchronously. When asked to write tests or prompts, produce complete, usable content in your answer and ground selectors in observed evidence when available. Never claim a test was run unless you actually ran an available project tool.`,
      },
      ...history,
      { role: "user", content: prompt },
    ];
    let answer = "";
    const endpoint = `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
    for (let step = 0; step < 8; step++) {
      emit({ type: "status", message: "Thinking through the request…" });
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(90000),
      });
      const result: any = await response.json();
      if (!response.ok)
        throw new Error(
          result?.error?.message || `Model request failed (${response.status})`,
        );
      const message = result.choices?.[0]?.message;
      if (!message) throw new Error("The model returned an empty response");
      messages.push(message);
      answer = typeof message.content === "string" ? message.content : "";
      if (!message.tool_calls?.length) break;
      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments || "{}");
        emit({
          type: "tool",
          name: call.function.name,
          status: "running",
        });
        const result = await connection.client.callTool({
          name: call.function.name,
          arguments: args,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            ((result.content || []) as any[])
              .map((part: any) =>
                part.type === "text" ? part.text : JSON.stringify(part),
              )
              .join("\n") || JSON.stringify(result.structuredContent || {}),
        });
        emit({
          type: "tool",
          name: call.function.name,
          status: result.isError ? "failed" : "done",
        });
      }
      if (step === 7)
        answer =
          answer ||
          "I reached the tool-call limit for this turn. Ask me to continue.";
    }
    emit({ type: "done", message: answer });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      emit({
        type: "error",
        message:
          error instanceof Error ? error.message : "Agent request failed",
      });
      res.end();
    } else next(error);
  } finally {
    await connection?.close();
  }
});
// AI Browse: a live session connected to the user's own local Chrome via its
// CDP remote-debugging port (chromium.connectOverCDP — see
// apps/server/src/browse-session.ts), driven by a real LLM tool-calling
// agent loop. Routes mirror the agent/chat shape above where possible.
app.post("/api/projects/:id/browse/sessions", async (req, res, next) => {
  try {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    const mode = req.body.mode === "launch" ? "launch" : "connect";
    if (mode === "connect") {
      const cdpEndpoint = String(req.body.cdpEndpoint || "").trim();
      if (!cdpEndpoint)
        return res.status(400).json({ error: "cdpEndpoint is required." });
      const session = await openBrowseSession(
        store,
        project.id,
        ownerId,
        { mode: "connect", cdpEndpoint },
        project.baseUrl,
      );
      return res.status(session.status === "failed" ? 502 : 201).json(session);
    }
    const session = await openBrowseSession(
      store,
      project.id,
      ownerId,
      { mode: "launch" },
      project.baseUrl,
    );
    res.status(session.status === "failed" ? 502 : 201).json(session);
  } catch (error) {
    if (error instanceof BrowseSessionConflictError)
      return res.status(409).json({ error: error.message });
    next(error);
  }
});
app.get("/api/projects/:id/browse/sessions", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  res.json(store.browseSessions(project.id, ownerId));
});
// The WebMCP tool catalog a browse session's chat actually exposes to the
// agent alongside its fixed browser tools (navigate/click/fill/…) — every
// `published` capability this project owns, mapped through the same
// toModelContextTool() a real WebMCP registration would use, so the name
// shown here always matches the name the chat loop calls.
app.get("/api/projects/:id/browse/webmcp-tools", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  const tools = store
    .capabilities(project.id)
    .filter((capability) => capability.status === "published")
    .map((capability) => ({
      ...toModelContextTool(capability),
      risk: capability.risk,
    }));
  res.json(tools);
});
// Same catalog shape as above, for the dashboard's AppMCP tab — every
// `published` capability this project owns, the tool list any MCP client
// connected to /api/projects/:id/appmcp would see from tools/list.
app.get("/api/projects/:id/appmcp-tools", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  const tools = publishedCandidatesForProject(store, project.id).map(
    ({ capability }) => ({
      ...toModelContextTool(capability),
      risk: capability.risk,
    }),
  );
  res.json(tools);
});
app.get("/api/projects/:id/browse/sessions/:sessionId/events", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  const session = store.browseSession(req.params.sessionId, ownerId);
  if (!session || session.projectId !== project.id)
    throw new Error("Browse session not found");
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const emit = (value: unknown) =>
    res.write(`data: ${JSON.stringify(value)}\n\n`);
  const since = Number(req.query.since) || 0;
  for (const event of store.browseEventsSince(session.id, since)) emit(event);
  const unsubscribe = subscribeBrowseSession(session.id, emit);
  req.on("close", unsubscribe);
});
app.post(
  "/api/projects/:id/browse/sessions/:sessionId/chat",
  async (req, res, next) => {
    let connection:
      | Awaited<ReturnType<typeof connectBrowseMcpClient>>
      | undefined;
    let emit = (_value: unknown) => {};
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      if (!process.env.OPENAI_API_KEY)
        return res.status(503).json({
          error: "Configure OPENAI_API_KEY to run the AI Browse agent.",
        });
      const session = store.browseSession(req.params.sessionId, ownerId);
      if (!session || session.projectId !== project.id)
        return res.status(404).json({ error: "Browse session not found." });
      const handle = getLiveSession(session.id);
      if (!handle || session.status !== "live")
        return res.status(409).json({
          error: "This browse session isn't live. Reconnect and try again.",
        });
      const prompt = String(req.body.message || "").trim();
      if (!prompt || prompt.length > 12000)
        return res
          .status(400)
          .json({ error: "Message must be 1–12,000 characters." });
      const model = await resolveAllowedModel(req.body.model);
      if (!model)
        return res
          .status(400)
          .json({ error: "Choose a supported assistant model." });
      const history = Array.isArray(req.body.history)
        ? req.body.history
            .filter(
              (item: any) =>
                ["user", "assistant"].includes(item?.role) &&
                typeof item?.content === "string",
            )
            .slice(-12)
            .map((item: any) => ({
              role: item.role,
              content: item.content.slice(0, 12000),
            }))
        : [];
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      emit = (value: unknown) =>
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      connection = await connectBrowseMcpClient(
        handle.page,
        (name, args, status, result) => {
          recordEvent(store, handle, "agent_tool", {
            name,
            args,
            status,
            result,
            source: "browser",
          });
        },
      );
      const listed = await connection.client.listTools();
      const tools = (listed.tools as any[]).map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || tool.name,
          parameters: tool.inputSchema,
        },
      }));
      // Published capabilities are this project's WebMCP tools — invoked
      // here via the same replayCapability() a real document.modelContext
      // registration would bridge to (packages/adapters/webmcp), rather than
      // through connection.client, since these aren't registered on the MCP
      // server above; they're kept in webmcpByName so the dispatch loop
      // below can tell the two tool families apart.
      const webmcpByName = new Map(
        store
          .capabilities(project.id)
          .filter((capability) => capability.status === "published")
          .flatMap((capability) => {
            const flow = store.flow(capability.flowId);
            return flow ? [{ capability, flow }] : [];
          })
          .map(
            (entry) =>
              [toModelContextTool(entry.capability).name, entry] as const,
          ),
      );
      for (const { capability } of webmcpByName.values()) {
        const tool = toModelContextTool(capability);
        tools.push({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
      const messages: any[] = [
        {
          role: "system",
          content:
            "You are driving a live browser tab on behalf of the user inside Unfold's AI Browse. Use the provided browser tools (navigate/click/fill/read_page/screenshot) for direct page interaction, and prefer any published WebMCP capability tools when one matches the user's goal, since those are higher-level, verified actions. Never claim you did something you didn't actually do with a tool call.",
        },
        ...history,
        { role: "user", content: prompt },
      ];
      let answer = "";
      const endpoint = `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
      for (let step = 0; step < 8; step++) {
        emit({ type: "status", message: "Thinking through the request…" });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(90000),
        });
        const result: any = await response.json();
        if (!response.ok)
          throw new Error(
            result?.error?.message ||
              `Model request failed (${response.status})`,
          );
        const message = result.choices?.[0]?.message;
        if (!message) throw new Error("The model returned an empty response");
        messages.push(message);
        answer = typeof message.content === "string" ? message.content : "";
        if (!message.tool_calls?.length) break;
        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments || "{}");
          emit({ type: "tool", name: call.function.name, status: "running" });
          const webmcp = webmcpByName.get(call.function.name);
          let toolResult: {
            content: any[];
            isError?: boolean;
            structuredContent?: unknown;
          };
          if (webmcp) {
            recordEvent(store, handle, "agent_tool", {
              name: call.function.name,
              args,
              status: "running",
              source: "webmcp",
            });
            try {
              const replayResult = await replayCapability(
                handle.page,
                webmcp.capability,
                webmcp.flow,
                args,
              );
              recordEvent(store, handle, "agent_tool", {
                name: call.function.name,
                args,
                status: "done",
                result: replayResult,
                source: "webmcp",
              });
              toolResult = {
                content: [{ type: "text", text: JSON.stringify(replayResult) }],
              };
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              recordEvent(store, handle, "agent_tool", {
                name: call.function.name,
                args,
                status: "failed",
                result: { error: errorMessage },
                source: "webmcp",
              });
              toolResult = {
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              };
            }
          } else {
            toolResult = (await connection.client.callTool({
              name: call.function.name,
              arguments: args,
            })) as any;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              ((toolResult.content || []) as any[])
                .map((part: any) =>
                  part.type === "text" ? part.text : `[${part.type}]`,
                )
                .join("\n") ||
              JSON.stringify(toolResult.structuredContent || {}),
          });
          emit({
            type: "tool",
            name: call.function.name,
            status: toolResult.isError ? "failed" : "done",
          });
        }
        if (step === 7)
          answer =
            answer ||
            "I reached the tool-call limit for this turn. Ask me to continue.";
      }
      emit({ type: "done", message: answer });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Agent request failed",
        });
        res.end();
      } else next(error);
    } finally {
      await connection?.close();
    }
  },
);
app.post(
  "/api/projects/:id/browse/sessions/:sessionId/close",
  async (req, res) => {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    const session = store.browseSession(req.params.sessionId, ownerId);
    if (!session || session.projectId !== project.id)
      throw new Error("Browse session not found");
    await closeBrowseSession(store, session.id, ownerId);
    res.json(store.browseSession(session.id, ownerId));
  },
);
app.post(
  "/api/projects/:id/browse/sessions/:sessionId/publish-tools",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const session = store.browseSession(req.params.sessionId, ownerId);
      if (!session || session.projectId !== project.id)
        throw new Error("Browse session not found");
      const handle = getLiveSession(session.id);
      if (!handle || session.status !== "live")
        return res.status(409).json({
          error: "This browse session isn't live. Reconnect and try again.",
        });
      const candidates = publishedCandidatesForProject(store, project.id);
      const result = await registerCapabilities(handle.page, candidates);
      recordEvent(store, handle, "status", {
        message: result.unavailable
          ? "WebMCP is unavailable on this page."
          : `Published ${result.registered.length} tool${result.registered.length === 1 ? "" : "s"} to this page.`,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/projects/:id/browse/sessions/:sessionId/url",
  (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const session = store.browseSession(req.params.sessionId, ownerId);
      if (!session || session.projectId !== project.id)
        throw new Error("Browse session not found");
      const handle = getLiveSession(session.id);
      if (!handle || session.status !== "live")
        return res.status(409).json({
          error: "This browse session isn't live. Reconnect and try again.",
        });
      res.json({ url: handle.page.url() });
    } catch (error) {
      next(error);
    }
  },
);
// Lets the dashboard's own address bar drive the tab directly, the same
// way the agent's "navigate" tool does (packages/mcp/src/browse-tools.ts)
// but without going through a chat turn — the user typing a URL and
// hitting enter shouldn't need to ask an LLM to do it for them.
app.post(
  "/api/projects/:id/browse/sessions/:sessionId/navigate",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const session = store.browseSession(req.params.sessionId, ownerId);
      if (!session || session.projectId !== project.id)
        throw new Error("Browse session not found");
      const handle = getLiveSession(session.id);
      if (!handle || session.status !== "live")
        return res.status(409).json({
          error: "This browse session isn't live. Reconnect and try again.",
        });
      const url = String(req.body.url || "").trim();
      if (!url) return res.status(400).json({ error: "url is required." });
      recordEvent(store, handle, "agent_tool", {
        source: "browser",
        name: "navigate",
        args: { url },
        status: "running",
      });
      try {
        await handle.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        recordEvent(store, handle, "agent_tool", {
          source: "browser",
          name: "navigate",
          args: { url },
          status: "done",
          result: { url: handle.page.url() },
        });
        res.json({ url: handle.page.url() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordEvent(store, handle, "agent_tool", {
          source: "browser",
          name: "navigate",
          args: { url },
          status: "failed",
          result: { error: message },
        });
        res.status(502).json({ error: message });
      }
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/projects/:id/browse/sessions/:sessionId/screenshot",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const session = store.browseSession(req.params.sessionId, ownerId);
      if (!session || session.projectId !== project.id)
        throw new Error("Browse session not found");
      const png = await screenshotBrowseSession(session.id);
      res.setHeader("Content-Type", "image/png");
      res.send(png);
    } catch (error) {
      next(error);
    }
  },
);
// Login session capture: opens a fresh, visible browser window for the user
// to log into the target app by hand, then saves the resulting
// storageState() to disk so its path can be set as a discovery run's
// ScanConfig.authStatePath (see apps/server/src/auth-capture.ts for why this
// is a separate, narrower flow from AI Browse above).
app.post("/api/projects/:id/auth-captures", async (req, res, next) => {
  try {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    const capture = await openAuthCapture(
      store,
      project.id,
      ownerId,
      project.baseUrl,
    );
    res.status(capture.status === "failed" ? 502 : 201).json(capture);
  } catch (error) {
    if (error instanceof AuthCaptureConflictError)
      return res.status(409).json({ error: error.message });
    next(error);
  }
});
app.get("/api/projects/:id/auth-captures", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  res.json(store.authCaptures(project.id, ownerId));
});
app.post(
  "/api/projects/:id/auth-captures/:captureId/finish",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const capture = store.authCapture(req.params.captureId, ownerId);
      if (!capture || capture.projectId !== project.id)
        throw new Error("Login capture not found");
      res.json(await captureAuthState(store, capture.id, ownerId));
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/projects/:id/auth-captures/:captureId/cancel",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const capture = store.authCapture(req.params.captureId, ownerId);
      if (!capture || capture.projectId !== project.id)
        throw new Error("Login capture not found");
      res.json(await cancelAuthCapture(store, capture.id, ownerId));
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/projects/:id/auth-captures/:captureId",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const capture = store.authCapture(req.params.captureId, ownerId);
      if (!capture || capture.projectId !== project.id)
        throw new Error("Login capture not found");
      await forgetAuthCapture(store, capture.id, ownerId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/projects/:id/discoveries", (req, res) => {
  const ownerId = userId(res);
  const project = store.project(req.params.id, ownerId);
  const defaults = store.userSettings(ownerId).discovery;
  const input = {
    ...project.scanConfig,
    ...defaults,
    ...(req.body.config || {}),
    denyActionKeywords: [
      ...new Set([
        ...project.scanConfig.denyActionKeywords,
        ...defaults.denyActionKeywords,
        ...(req.body.config?.denyActionKeywords || []),
      ]),
    ],
  };
  input.baseUrl = project.baseUrl;
  input.allowedOrigins =
    req.body.config?.allowedOrigins ?? project.scanConfig.allowedOrigins;
  const config = ConfigSchema.parse(input);
  const run = store.createRun(config, project.id, ownerId);
  res.status(201).json(store.summary(run.id, ownerId));
  void coordinator
    .start(run.id)
    .catch((e) => console.error("Discovery failed:", e.message));
});
app.get("/api/projects/:id/discoveries", (req, res) =>
  res.json(store.discoveries(req.params.id, userId(res))),
);
app.get("/api/projects/:id/discoveries/:discoveryId", (req, res) => {
  if (
    !store
      .discoveries(req.params.id, userId(res))
      .some((run) => run.id === req.params.discoveryId)
  )
    throw new Error("Discovery not found in this project");
  res.json(store.data(req.params.discoveryId, userId(res)));
});
app.get(
  "/api/projects/:id/discoveries/:discoveryId/workers/:worker/screenshot",
  async (req, res, next) => {
    try {
      const ownerId = userId(res);
      const run = store
        .discoveries(req.params.id, ownerId)
        .find((item) => item.id === req.params.discoveryId);
      if (!run) throw new Error("Discovery not found in this project");
      if (!run.config.streamWorkers)
        return res
          .status(404)
          .json({ error: "Live worker view is not enabled for this run" });
      const worker = Number(req.params.worker);
      if (
        !Number.isInteger(worker) ||
        worker < 1 ||
        worker > run.config.concurrency
      )
        return res.status(404).json({ error: "No such worker" });
      const jpeg = await coordinator.screenshotWorker(run.id, worker);
      if (!jpeg) return res.status(204).end();
      res.setHeader("Content-Type", "image/jpeg");
      res.send(jpeg);
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/projects/:id/discoveries/:discoveryId/pause", (req, res) => {
  if (
    !store
      .discoveries(req.params.id, userId(res))
      .some((run) => run.id === req.params.discoveryId)
  )
    throw new Error("Discovery not found in this project");
  coordinator.pause(req.params.discoveryId);
  res.json(store.summary(req.params.discoveryId, userId(res)));
});
app.post("/api/projects/:id/discoveries/:discoveryId/resume", (req, res) => {
  if (
    !store
      .discoveries(req.params.id, userId(res))
      .some((run) => run.id === req.params.discoveryId)
  )
    throw new Error("Discovery not found in this project");
  const ownerId = userId(res);
  const run = store.run(req.params.discoveryId, ownerId);
  if (["running", "pausing", "completed"].includes(run.status))
    return res
      .status(409)
      .json({ error: "Discovery cannot be resumed in its current state" });
  if (req.body.budgets)
    store.updateRun(
      run.id,
      { config: ConfigSchema.parse({ ...run.config, ...req.body.budgets }) },
      ownerId,
    );
  void coordinator
    .start(run.id)
    .catch((e) => console.error("Discovery resume failed:", e.message));
  res.json(store.summary(run.id, ownerId));
});
app.get(
  "/api/projects/:id/discoveries/:discoveryId/capabilities",
  (req, res) => {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    if (
      !store
        .discoveries(project.id, ownerId)
        .some((run) => run.id === req.params.discoveryId)
    )
      throw new Error("Discovery not found in this project");
    res.json(capabilitiesWithFlows(store, project.id, req.params.discoveryId));
  },
);
app.post(
  "/api/projects/:id/discoveries/:discoveryId/capabilities/mine",
  async (req, res, next) => {
    let emit = (_value: unknown) => {};
    try {
      const ownerId = userId(res);
      const project = store.project(req.params.id, ownerId);
      const discoveryId = req.params.discoveryId;
      if (
        !store
          .discoveries(project.id, ownerId)
          .some((run) => run.id === discoveryId)
      )
        throw new Error("Discovery not found in this project");

      const llmMode = req.body?.llmMode;
      if (
        (llmMode !== "grounded" && llmMode !== "generative") ||
        !process.env.OPENAI_API_KEY
      ) {
        // Off, or no key configured — exactly today's synchronous,
        // deterministic-only path. Zero behavior change for the dashboard's
        // old one-click call (empty body).
        mineForDiscovery(store, project.id, discoveryId, ownerId);
        return res.json(capabilitiesWithFlows(store, project.id, discoveryId));
      }
      if (isMiningJobActive(discoveryId))
        return res.status(409).json({
          error: "A mining job is already running for this discovery.",
        });

      const evidenceScope: EvidenceScope = (
        ["api", "ui", "both"] as const
      ).includes(req.body?.evidenceScope)
        ? req.body.evidenceScope
        : "both";
      // Falls back to the configured default rather than rejecting, same as
      // before — mining shouldn't 400 just because the client sent a model
      // choice that's since fallen out of the live catalog.
      const model =
        (await resolveAllowedModel(req.body?.model)) ||
        process.env.OPENAI_MODEL ||
        agentModels[0].id;

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      emit = (value: unknown) =>
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      try {
        await mineWithLlm(
          store,
          project.id,
          discoveryId,
          ownerId,
          { llmMode, evidenceScope, model },
          emit,
        );
        emit({
          type: "done",
          capabilities: capabilitiesWithFlows(store, project.id, discoveryId),
        });
      } catch (error) {
        emit({
          type: "error",
          message:
            error instanceof MiningJobConflictError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Mining failed",
        });
      }
      res.end();
    } catch (error) {
      if (res.headersSent) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "Mining failed",
        });
        res.end();
      } else next(error);
    }
  },
);
function requireOwnedCapability(
  projectId: string,
  ownerId: string,
  capabilityId: string,
) {
  const project = store.project(projectId, ownerId);
  const capability = store.capability(capabilityId);
  if (!capability || capability.projectId !== project.id)
    throw new Error("Capability not found in this project");
  return { project, capability };
}
app.get(
  "/api/projects/:id/capabilities/:capId/verification-runs",
  (req, res) => {
    const { capability } = requireOwnedCapability(
      req.params.id,
      userId(res),
      req.params.capId,
    );
    res.json(store.verificationRuns(capability.id));
  },
);
/** Shared by both verify routes below: validates the optional `flowId`/`headless` body fields against one already-owned capability. Throws (caught by Express's default error handler / the SSE route's own try/catch) rather than returning a Response, since the two callers send the error differently (plain JSON vs. an SSE `error` frame). */
function parseVerifyOptions(
  req: express.Request,
  capability: ReturnType<typeof requireOwnedCapability>["capability"],
): {
  flowId?: string;
  headless?: boolean;
  navigationTimeoutMs?: number;
  expectTimeoutMs?: number;
  actionTimeoutMs?: number;
} {
  const flowId = req.body?.flowId;
  if (
    flowId !== undefined &&
    flowId !== capability.flowId &&
    flowId !== capability.secondaryFlowId
  )
    throw new Error("flowId must be one of this capability's flows.");
  const headless = req.body?.headless;
  if (headless !== undefined && typeof headless !== "boolean")
    throw new Error("headless must be a boolean.");
  const timeout = (field: string): number | undefined => {
    const value = req.body?.[field];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || value < 1000 || value > 120_000)
      throw new Error(`${field} must be a number between 1000 and 120000.`);
    return value;
  };
  return {
    flowId,
    headless,
    navigationTimeoutMs: timeout("navigationTimeoutMs"),
    expectTimeoutMs: timeout("expectTimeoutMs"),
    actionTimeoutMs: timeout("actionTimeoutMs"),
  };
}
app.post("/api/projects/:id/capabilities/:capId/verify", (req, res) => {
  const ownerId = userId(res);
  const { capability } = requireOwnedCapability(
    req.params.id,
    ownerId,
    req.params.capId,
  );
  if (!canStartVerification(capability))
    return res.status(409).json({ error: "Verification already in progress" });
  const {
    flowId,
    headless,
    navigationTimeoutMs,
    expectTimeoutMs,
    actionTimeoutMs,
  } = parseVerifyOptions(req, capability);
  void verificationRunner
    .run(capability.id, {
      flowId,
      headless,
      navigationTimeoutMs,
      expectTimeoutMs,
      actionTimeoutMs,
      ownerId,
    })
    .catch((e) => console.error("Verification failed:", e.message));
  res.json(store.capability(capability.id));
});
/**
 * Streaming sibling of the route above, for the dashboard's verification
 * wizard: instead of firing the run and returning immediately, this keeps
 * the connection open for the run's full duration and relays
 * `VerificationRunner.run`'s `onEvent` callback as SSE frames — the same
 * `data: {...}\n\n` idiom `.../capabilities/mine` already uses for LLM
 * mining, so the wizard can reuse that stream-reading code. Bulk re-verify
 * (`bulkRefresh` in flow-capabilities-views.tsx) deliberately keeps using
 * the fire-and-forget route above — a live log view only makes sense for
 * one capability at a time.
 */
app.post(
  "/api/projects/:id/capabilities/:capId/verify/stream",
  async (req, res, next) => {
    let emit = (_value: unknown) => {};
    try {
      const ownerId = userId(res);
      const { capability } = requireOwnedCapability(
        req.params.id,
        ownerId,
        req.params.capId,
      );
      if (!canStartVerification(capability))
        return res
          .status(409)
          .json({ error: "Verification already in progress" });
      const {
        flowId,
        headless,
        navigationTimeoutMs,
        expectTimeoutMs,
        actionTimeoutMs,
      } = parseVerifyOptions(req, capability);

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      // The run itself (a real browser replaying a flow) keeps going
      // server-side regardless of whether anyone's still reading this
      // stream — e.g. the wizard switched to a different capability via its
      // drawer, or the tab closed. Once the client's gone, every further
      // `emit` becomes a no-op instead of writing to a dead connection.
      let clientGone = false;
      res.on("close", () => {
        clientGone = true;
      });
      emit = (value: unknown) => {
        if (clientGone) return;
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      };
      try {
        await verificationRunner.run(capability.id, {
          flowId,
          headless,
          navigationTimeoutMs,
          expectTimeoutMs,
          actionTimeoutMs,
          ownerId,
          onEvent: emit,
        });
        emit({
          type: "capability",
          capability: store.capability(capability.id),
        });
        emit({ type: "done" });
      } catch (error) {
        emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Verification failed",
        });
      }
      res.end();
    } catch (error) {
      if (res.headersSent) {
        emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Verification failed",
        });
        res.end();
      } else next(error);
    }
  },
);
app.post("/api/projects/:id/capabilities/:capId/approve", (req, res) => {
  const { capability } = requireOwnedCapability(
    req.params.id,
    userId(res),
    req.params.capId,
  );
  if (!canApprove(capability))
    return res
      .status(409)
      .json({ error: "Capability must be verified before it can be approved" });
  // There is no separate "approved" status in the schema (only `verified`
  // and then `published` exist in that part of the chain — plan §9) — this
  // endpoint exists purely as a distinct reviewer confirmation step/audit
  // point, not a state transition, so it validates eligibility and returns
  // the capability unchanged rather than mutating it.
  res.json(capability);
});
app.post("/api/projects/:id/capabilities/:capId/publish", (req, res) => {
  const { capability } = requireOwnedCapability(
    req.params.id,
    userId(res),
    req.params.capId,
  );
  if (!canPublish(capability))
    return res.status(409).json({
      error: "Capability must be verified before it can be published",
    });
  res.json(publishCapability(store, capability));
});
app.put(
  "/api/projects/:id/capabilities/:capId/required-capabilities",
  (req, res) => {
    const { capability } = requireOwnedCapability(
      req.params.id,
      userId(res),
      req.params.capId,
    );
    const ids = req.body?.requiredCapabilityIds;
    if (!Array.isArray(ids) || !ids.every((v) => typeof v === "string"))
      return res
        .status(400)
        .json({ error: "requiredCapabilityIds must be an array of strings." });
    res.json(setRequiredCapabilities(store, capability, ids));
  },
);
app.post("/api/projects/:id/capabilities/:capId/disable", (req, res) => {
  const { capability } = requireOwnedCapability(
    req.params.id,
    userId(res),
    req.params.capId,
  );
  res.json(disableCapability(store, capability));
});
app.delete("/api/projects/:id/capabilities/:capId", (req, res) => {
  const { capability } = requireOwnedCapability(
    req.params.id,
    userId(res),
    req.params.capId,
  );
  deleteCapability(store, capability);
  res.json({ ok: true });
});
// Automation: Workflow tab — see apps/server/src/automation-workflows.ts and
// packages/worker/src/workflow-runner.ts.
app.get("/api/projects/:id/automation/workflows", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res.json(listWorkflows(store, req.params.id, ownerId));
});
app.post("/api/projects/:id/automation/workflows", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res
    .status(201)
    .json(createWorkflow(store, req.params.id, ownerId, req.body || {}));
});
app.get("/api/projects/:id/automation/workflows/:workflowId", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res.json(getWorkflow(store, req.params.workflowId, ownerId));
});
app.put("/api/projects/:id/automation/workflows/:workflowId", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res.json(
    updateWorkflow(store, req.params.workflowId, ownerId, req.body || {}),
  );
});
app.delete("/api/projects/:id/automation/workflows/:workflowId", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  deleteWorkflow(store, req.params.workflowId, ownerId);
  res.json({ ok: true });
});
app.post(
  "/api/projects/:id/automation/workflows/:workflowId/run",
  (req, res) => {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    res.json(runWorkflow(store, project, req.params.workflowId, ownerId));
  },
);
app.get(
  "/api/projects/:id/automation/workflows/:workflowId/runs/:runId",
  (req, res) => {
    const ownerId = userId(res);
    store.project(req.params.id, ownerId);
    res.json(getWorkflowRun(store, req.params.runId, ownerId));
  },
);
// Automation: Framework tab — see apps/server/src/automation-framework.ts,
// automation-execution.ts, automation-github.ts, automation-suggest-fix.ts.
function requireFrameworkProject(projectId: string, ownerId: string) {
  store.project(projectId, ownerId);
  const frameworkProject = store.frameworkProject(projectId, ownerId);
  if (!frameworkProject) throw new Error("Framework project not found");
  return frameworkProject;
}
app.get("/api/projects/:id/automation/framework", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res.json(store.frameworkProject(req.params.id, ownerId) || null);
});
app.post("/api/projects/:id/automation/framework", async (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  res.json(
    await getOrCreateFrameworkProject(
      store,
      req.params.id,
      ownerId,
      req.body || {},
    ),
  );
});
app.put("/api/projects/:id/automation/framework", (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  const { packageManager } = req.body || {};
  if (!["npm", "yarn", "pnpm"].includes(packageManager))
    return res
      .status(400)
      .json({ error: "packageManager must be npm, yarn, or pnpm." });
  res.json(
    store.updateFrameworkProject(
      frameworkProject.id,
      { packageManager },
      ownerId,
    ),
  );
});
app.get("/api/projects/:id/automation/framework/files", async (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  const path = typeof req.query.path === "string" ? req.query.path : undefined;
  if (path === undefined) res.json(await listFrameworkFiles(frameworkProject));
  else
    res.json({
      path,
      content: await readFrameworkFile(frameworkProject, path),
    });
});
app.put("/api/projects/:id/automation/framework/files", async (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  const { path, content } = req.body || {};
  if (typeof path !== "string" || typeof content !== "string")
    return res.status(400).json({ error: "path and content must be strings." });
  await writeFrameworkFile(frameworkProject, path, content);
  res.json({ path });
});
app.post("/api/projects/:id/automation/framework/run", (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  res.json(runFrameworkTests(store, frameworkProject, ownerId));
});
app.get("/api/projects/:id/automation/framework/runs/:runId", (req, res) => {
  const ownerId = userId(res);
  store.project(req.params.id, ownerId);
  const run = store.testRun(req.params.runId, ownerId);
  if (!run) throw new Error("Test run not found");
  res.json(run);
});
app.get("/api/projects/:id/automation/framework/packages", async (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  res.json(await listPackages(frameworkProject));
});
app.post("/api/projects/:id/automation/framework/packages", (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  const { name, version, dev } = req.body || {};
  if (typeof name !== "string" || !name.trim())
    return res.status(400).json({ error: "name is required." });
  if (version !== undefined && typeof version !== "string")
    return res.status(400).json({ error: "version must be a string." });
  if (dev !== undefined && typeof dev !== "boolean")
    return res.status(400).json({ error: "dev must be a boolean." });
  res.json(
    addPackage(store, frameworkProject, ownerId, { name, version, dev }),
  );
});
app.delete("/api/projects/:id/automation/framework/packages", (req, res) => {
  const ownerId = userId(res);
  const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) return res.status(400).json({ error: "name is required." });
  res.json(removePackage(store, frameworkProject, ownerId, name));
});
app.get(
  "/api/projects/:id/automation/framework/packages/operations/:opId",
  (req, res) => {
    const ownerId = userId(res);
    store.project(req.params.id, ownerId);
    const op = store.packageOperation(req.params.opId, ownerId);
    if (!op) throw new Error("Package operation not found");
    res.json(op);
  },
);
app.post(
  "/api/projects/:id/automation/framework/github/connect",
  async (req, res) => {
    const ownerId = userId(res);
    const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
    const { repoUrl, token, defaultBranch } = req.body || {};
    if (typeof repoUrl !== "string" || typeof token !== "string")
      return res.status(400).json({ error: "repoUrl and token are required." });
    res.json(
      await connectGithub(store, frameworkProject, ownerId, {
        repoUrl,
        token,
        defaultBranch,
      }),
    );
  },
);
app.post(
  "/api/projects/:id/automation/framework/github/sync",
  async (req, res) => {
    const ownerId = userId(res);
    const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
    const { direction, message } = req.body || {};
    if (direction !== "pull" && direction !== "push")
      return res
        .status(400)
        .json({ error: "direction must be 'pull' or 'push'." });
    await syncGithub(store, frameworkProject, ownerId, { direction, message });
    res.json({ ok: true });
  },
);
app.post(
  "/api/projects/:id/automation/framework/suggest-fix",
  async (req, res) => {
    const ownerId = userId(res);
    const frameworkProject = requireFrameworkProject(req.params.id, ownerId);
    const { runId, caseName, filePath } = req.body || {};
    if (
      typeof runId !== "string" ||
      typeof caseName !== "string" ||
      typeof filePath !== "string"
    )
      return res
        .status(400)
        .json({ error: "runId, caseName, and filePath are required." });
    const testRun = store.testRun(runId, ownerId);
    if (!testRun) return res.status(404).json({ error: "Test run not found" });
    res.json(await suggestFix(frameworkProject, testRun, caseName, filePath));
  },
);
app.post("/api/projects/:id/mcp", async (req, res, next) => {
  try {
    const ownerId = userId(res);
    store.project(req.params.id, ownerId);
    await handleProjectMcp(
      store,
      req.params.id,
      req,
      res,
      ({ name, seeds }) => {
        const project = store.project(req.params.id, ownerId);
        if (project.archivedAt)
          throw new Error("Archived projects cannot start a discovery");
        const defaults = store.userSettings(ownerId).discovery;
        const config = ConfigSchema.parse({
          ...project.scanConfig,
          ...defaults,
          name: name || project.name,
          seeds: seeds ?? project.scanConfig.seeds,
          denyActionKeywords: [
            ...new Set([
              ...project.scanConfig.denyActionKeywords,
              ...defaults.denyActionKeywords,
            ]),
          ],
        });
        const run = store.createRun(config, project.id, ownerId);
        void coordinator
          .start(run.id)
          .catch((error) =>
            console.error("MCP discovery failed:", error.message),
          );
        return store.summary(run.id, ownerId);
      },
    );
  } catch (error) {
    next(error);
  }
});
app.get("/api/projects/:id/mcp", (_req, res) =>
  res.status(405).json({ error: "Use MCP Streamable HTTP POST" }),
);
app.delete("/api/projects/:id/mcp", (_req, res) =>
  res
    .status(405)
    .json({ error: "This stateless MCP endpoint has no sessions" }),
);
// AppMCP: this project's published capabilities as directly-callable MCP
// tools (packages/mcp/src/app-server.ts) — a stateful session (unlike the
// stateless /mcp above), so GET and DELETE are real operations here (the SSE
// notification stream and explicit session termination), not 405s.
app.post("/api/projects/:id/appmcp", async (req, res, next) => {
  try {
    const ownerId = userId(res);
    const project = store.project(req.params.id, ownerId);
    await handleProjectAppMcpPost(
      store,
      project.id,
      ownerId,
      project.appMcpHeaded,
      req,
      res,
    );
  } catch (error) {
    next(error);
  }
});
app.get("/api/projects/:id/appmcp", async (req, res, next) => {
  try {
    store.project(req.params.id, userId(res));
    await handleProjectAppMcpGet(req, res);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/projects/:id/appmcp", async (req, res, next) => {
  try {
    store.project(req.params.id, userId(res));
    await handleProjectAppMcpDelete(req, res);
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/projects/:id/discoveries/:discoveryId/export",
  async (req, res) => {
    if (
      !store
        .discoveries(req.params.id, userId(res))
        .some((run) => run.id === req.params.discoveryId)
    )
      throw new Error("Discovery not found in this project");
    await exportRun(store, req.params.discoveryId);
    res.json({
      url: `/api/projects/${req.params.id}/discoveries/${req.params.discoveryId}/download`,
    });
  },
);
app.get(
  "/api/projects/:id/discoveries/:discoveryId/files",
  async (req, res) => {
    if (
      !store
        .discoveries(req.params.id, userId(res))
        .some((run) => run.id === req.params.discoveryId)
    )
      throw new Error("Discovery not found in this project");
    const root = resolve(artifactRoot(), req.params.discoveryId);
    const out: { path: string; size: number }[] = [];
    const { stat } = await import("node:fs/promises");
    async function walk(dir: string) {
      if (!existsSync(dir)) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (!path.includes(`${sep}evidence${sep}`))
          out.push({
            path: relative(root, path),
            size: (await stat(path)).size,
          });
      }
    }
    await walk(root);
    res.json(out);
  },
);
app.get(
  "/api/projects/:id/discoveries/:discoveryId/download",
  async (req, res) => {
    if (
      !store
        .discoveries(req.params.id, userId(res))
        .some((run) => run.id === req.params.discoveryId)
    )
      throw new Error("Discovery not found in this project");
    await exportRun(store, req.params.discoveryId);
    const root = resolve(artifactRoot(), req.params.discoveryId);
    const files: Record<string, Uint8Array> = {};
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files[relative(root, path)] = new Uint8Array(await readFile(path));
      }
    }
    await walk(root);
    res
      .type("application/zip")
      .attachment(`unfold-${req.params.discoveryId.slice(0, 8)}.zip`)
      .send(Buffer.from(zipSync(files)));
  },
);
app.get("/api/runs", (_req, res) => res.json(store.list(userId(res))));
app.post("/api/runs", (req, res) => {
  const { projectId, ...configInput } = req.body;
  const ownerId = userId(res);
  const defaults = store.userSettings(ownerId).discovery;
  const project = projectId ? store.project(projectId, ownerId) : undefined;
  const config = ConfigSchema.parse({
    ...(project?.scanConfig || {}),
    ...defaults,
    ...configInput,
    denyActionKeywords: [
      ...new Set([
        ...(project?.scanConfig.denyActionKeywords || []),
        ...defaults.denyActionKeywords,
        ...(configInput.denyActionKeywords || []),
      ]),
    ],
  });
  const run = store.createRun(config, projectId, ownerId);
  res.status(201).json(store.summary(run.id, ownerId));
  void coordinator
    .start(run.id)
    .catch((e) => console.error("Scan failed:", e.message));
});
app.get("/api/runs/:id", (req, res) =>
  res.json(store.data(req.params.id, userId(res))),
);
app.post("/api/runs/:id/pause", (req, res) => {
  const ownerId = userId(res);
  store.run(req.params.id, ownerId);
  coordinator.pause(req.params.id);
  res.json(store.summary(req.params.id, ownerId));
});
app.post("/api/runs/:id/resume", (req, res) => {
  const ownerId = userId(res);
  const run = store.run(req.params.id, ownerId);
  if (["running", "pausing", "completed"].includes(run.status)) {
    res
      .status(409)
      .json({ error: "This run cannot be resumed in its current state" });
    return;
  }
  if (req.body.budgets) {
    const config = ConfigSchema.parse({
      ...run.config,
      ...Object.fromEntries(
        Object.entries(req.body.budgets).filter(([key]) =>
          [
            "maxActions",
            "maxStates",
            "maxDurationMinutes",
            "maxDepth",
          ].includes(key),
        ),
      ),
    });
    store.updateRun(run.id, { config }, ownerId);
  }
  void coordinator.start(run.id).catch((e) => console.error(e.message));
  res.json(store.summary(run.id, ownerId));
});
app.get("/api/runs/:id/files", async (req, res) => {
  const root = resolve(artifactRoot(), req.params.id);
  store.run(req.params.id, userId(res));
  const out: { path: string; size: number }[] = [];
  const { stat } = await import("node:fs/promises");
  async function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (!p.includes(`${sep}evidence${sep}`))
        out.push({ path: relative(root, p), size: (await stat(p)).size });
    }
  }
  await walk(root);
  res.json(out);
});
app.post("/api/runs/:id/export", async (req, res) => {
  store.run(req.params.id, userId(res));
  await exportRun(store, req.params.id);
  res.json({ url: `/api/runs/${req.params.id}/download` });
});
app.get("/api/runs/:id/download", async (req, res) => {
  const id = req.params.id;
  store.run(id, userId(res));
  await exportRun(store, id);
  const root = resolve(artifactRoot(), id);
  const files: Record<string, Uint8Array> = {};
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files[relative(root, p)] = new Uint8Array(await readFile(p));
    }
  }
  await walk(root);
  res
    .type("application/zip")
    .attachment(`unfold-${id.slice(0, 8)}.zip`)
    .send(Buffer.from(zipSync(files)));
});
app.use(
  "/artifacts",
  auth.requireAuth,
  (req, res, next) => {
    // Discovery screenshots etc live at <runId>/..., so the first path
    // segment is normally a Run id. Automation evidence (workflow step
    // screenshots, framework test logs) instead nests under a fixed
    // "automation-workflows"/"automation-framework" prefix with the actual
    // owned id as the *second* segment — check ownership against the right
    // record for each shape rather than always assuming a Run.
    const [first, second] = req.path.split("/").filter(Boolean);
    try {
      if (first === "automation-workflows") {
        if (!store.workflowRun(second, userId(res))) throw new Error();
      } else if (first === "automation-framework") {
        if (!store.frameworkProjectById(second, userId(res))) throw new Error();
      } else store.run(first, userId(res));
      next();
    } catch {
      res.status(404).json({ error: "Artifact not found" });
    }
  },
  express.static(artifactRoot(), {
    setHeaders(res, path) {
      if (path.endsWith(".html"))
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts",
        );
    },
  }),
);
if (existsSync(resolve("dist/dashboard"))) {
  app.use(express.static(resolve("dist/dashboard")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/dashboard/index.html")),
  );
}
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(
        [
          "Run not found",
          "Project not found",
          "Workflow not found",
          "Workflow run not found",
          "Framework project not found",
          "Test run not found",
          "Package operation not found",
        ].includes(err.message)
          ? 404
          : 400,
      )
      .json({ error: err.message });
  },
);
const server = app.listen(
  port,
  process.env.HOST || "127.0.0.1",
  (error?: Error) => {
    if (error) throw error;
    console.log(`Unfold API: http://127.0.0.1:${port}`);
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const r of store.list())
      if (r.ownerPid === process.pid && r.status === "running")
        coordinator.pause(r.id);
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  });
