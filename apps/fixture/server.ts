import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
// Demo credential and session gate for /account — a dedicated, isolated
// authenticated route so the main app's login-session capture wizard
// (apps/server/src/auth-capture.ts) has something real to exercise locally,
// without needing a third-party site. Deliberately NOT applied to /projects
// or /api/projects — tests/baseline.json, tests/drift.test.ts, and several
// other suites crawl those as always-open and would break if they suddenly
// required a session. Not meant to resemble real auth: one fixed
// username/password, one in-memory session set.
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo1234";
const SESSION_COOKIE = "atlas_session";
export function startFixture(port = 4174) {
  const app = express();
  const sessions = new Set<string>();
  const readSessionId = (req: express.Request): string | undefined => {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE)
        return part.slice(eq + 1).trim();
    }
    return undefined;
  };
  const isAuthed = (req: express.Request) => {
    const id = readSessionId(req);
    return !!id && sessions.has(id);
  };
  let mutations = 0,
    requests = 0,
    errors = 0,
    responseBytes = 0;
  const projects = [
    {
      id: "proj-1",
      name: "Website redesign",
      team: "Design",
      status: "In progress",
    },
    {
      id: "proj-2",
      name: "Mobile experience",
      team: "Product",
      status: "In review",
    },
    {
      id: "proj-3",
      name: "Brand guidelines",
      team: "Marketing",
      status: "Planning",
    },
  ];
  const permissions = new Map<string, string>();
  app.use(express.json({ limit: "20kb" }));
  app.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    if (username !== DEMO_USERNAME || password !== DEMO_PASSWORD)
      return res.status(401).json({ error: "Invalid username or password" });
    const id = randomUUID();
    sessions.add(id);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`,
    );
    res.json({ ok: true });
  });
  app.get("/api/session", (req, res) =>
    res.json({ authenticated: isAuthed(req) }),
  );
  // Gate: /account and /api/account both require a logged-in session — the
  // "behind auth" surface the login-session capture wizard is meant to
  // unlock for discovery. Kept entirely separate from /projects and
  // /api/projects, which existing tests crawl as always-open.
  app.get("/account", (req, res, next) => {
    if (!isAuthed(req)) return res.redirect("/login");
    next();
  });
  app.get("/api/account", (req, res) => {
    if (!isAuthed(req))
      return res.status(401).json({ error: "Login required" });
    res.json({ email: "demo@atlas.test", plan: "Team" });
  });
  // /lab exists only to exercise the discovery worker's page-stability wait
  // (packages/worker/src/observe.ts's stabilize()) locally: an artificially
  // slow endpoint, with no DOM change until it resolves — the exact "quiet
  // DOM, pending network" case a mutation-only wait would miss.
  app.get("/api/lab-data", (_req, res) => {
    setTimeout(() => res.json({ items: 3 }), 800);
  });
  app.get("/api/projects", (req, res) => {
    const query = String(req.query.query || "").toLowerCase();
    res.json(projects.filter((p) => p.name.toLowerCase().includes(query)));
  });
  app.post("/api/projects", (req, res) => {
    mutations++;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const id = `proj-${projects.length + 1}`;
    const project = { id, name, team: "Unassigned", status: "Planning" };
    projects.push(project);
    res.status(201).json(project);
  });
  app.get("/api/projects/:id", (req, res) => {
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });
  app.delete("/api/projects/:id", (req, res) => {
    const index = projects.findIndex((p) => p.id === req.params.id);
    if (index === -1)
      return res.status(404).json({ error: "Project not found" });
    projects.splice(index, 1);
    permissions.delete(req.params.id);
    res.json({ deleted: true });
  });
  app.get("/api/projects/:id/permissions", (req, res) => {
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json({
      projectId: project.id,
      role: permissions.get(project.id) || "viewer",
    });
  });
  app.post("/api/projects/:id/permissions", (req, res) => {
    mutations++;
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const role = String(req.body?.role || "viewer");
    permissions.set(project.id, role);
    res.json({ projectId: project.id, role });
  });
  app.use((req, res, next) => {
    if (req.path !== "/api/metrics") {
      requests++;
      res.on("finish", () => {
        if (res.statusCode >= 500) errors++;
        responseBytes += Number(res.getHeader("content-length") || 0);
      });
    }
    next();
  });
  app.get("/robots.txt", (_req, res) =>
    res.type("text").send("User-agent: *\nDisallow: /robots-blocked\n"),
  );
  app.get("/robots-blocked", (_req, res) => {
    mutations++;
    res.send("Must not be visited");
  });
  app.post("/api/delete", (_req, res) => {
    mutations++;
    res.json({ deleted: true });
  });
  app.get("/api/metrics", (_req, res) =>
    res.json({ mutations, requests, errors, responseBytes }),
  );
  app.get("/download", (_req, res) =>
    res.attachment("sample.txt").send("Atlas sample report"),
  );
  app.use((_req, res) =>
    res
      .type("html")
      .send(readFileSync(resolve("apps/fixture/index.html"), "utf8")),
  );
  return app.listen(port, process.env.HOST || "127.0.0.1", (error?: Error) => {
    if (error) throw error;
    console.log(`Fixture: http://127.0.0.1:${port}`);
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  startFixture(Number(process.env.FIXTURE_PORT) || 4174);
