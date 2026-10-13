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
import { createAuth } from "./auth.js";
const app = express(),
  store = new Store(),
  coordinator = new Coordinator(store);
const agentModels = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", detail: "Fast and efficient" },
  { id: "gpt-4.1", label: "GPT-4.1", detail: "Advanced reasoning-free model" },
];
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
      return /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? [host.toLowerCase()] : [];
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
app.get("/api/projects/:id/agent/status", (req, res) => {
  store.project(req.params.id, userId(res));
  const defaultModel = process.env.OPENAI_MODEL || agentModels[0].id;
  const models = agentModels.some((model) => model.id === defaultModel)
    ? agentModels
    : [
        ...agentModels,
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
    const configuredModel = process.env.OPENAI_MODEL || agentModels[0].id;
    const allowedModels = new Set([
      ...agentModels.map((model) => model.id),
      configuredModel,
    ]);
    const model = req.body.model || configuredModel;
    if (typeof model !== "string" || !allowedModels.has(model))
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
    try {
      store.run(req.path.split("/").filter(Boolean)[0], userId(res));
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
        ["Run not found", "Project not found"].includes(err.message)
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
