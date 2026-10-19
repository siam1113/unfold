// AppMCP: exposes this project's *published* capabilities directly as MCP
// tools, bypassing the browser/Chrome WebMCP standard entirely
// (packages/adapters/webmcp's document.modelContext injection). Unlike the
// generic project MCP server (packages/mcp/src/server.ts, a fixed,
// stateless discovery-analysis toolset), AppMCP behaves like the
// browser-automation MCP servers agents already use (e.g. the official
// Playwright-MCP): each MCP *connection* gets its own browser, launched
// lazily on first use and kept alive across that connection's later tool
// calls, closed when the session ends. Fully independent of
// apps/server/src/browse-session.ts's live/visible AI-Browse sessions — no
// shared state, no "one session per project" conflict.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Store } from "../../storage/src/index.js";
import type {
  CapabilityCandidate,
  Flow,
} from "../../capability-core/src/types.js";
import {
  replayCapability,
  type RequiredFlowResolution,
} from "../../capability-runtime/src/replay.js";
import { toModelContextTool } from "../../adapters/webmcp/src/index.js";

interface AppMcpSession {
  projectId: string;
  ownerId: string;
  transport: StreamableHTTPServerTransport;
  server: Server;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  lastActivity: number;
}

// In-memory liveness map, mirroring apps/server/src/browse-session.ts's
// `live` pattern — but fully separate: AppMCP's browser belongs to one MCP
// connection, never to a dashboard-visible browse session.
const sessions = new Map<string, AppMcpSession>();

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  await session?.context?.close().catch(() => {});
  await session?.browser?.close().catch(() => {});
}

// A client that disconnects without a clean session-close (crash, killed
// process, network drop) would otherwise leak a browser process forever —
// sweep sessions idle longer than this.
const IDLE_LIMIT_MS = 20 * 60_000;
const idleSweep = setInterval(() => {
  const cutoff = Date.now() - IDLE_LIMIT_MS;
  for (const [id, session] of sessions)
    if (session.lastActivity < cutoff) void closeSession(id);
}, 60_000);
// Purely a background maintenance timer — must never be the thing keeping
// the process alive (matters for short-lived scripts/tests importing this
// module; a no-op for the long-running server, which has its own HTTP
// listener keeping the event loop open regardless).
idleSweep.unref();

/**
 * The discovery run's saved login session (same field `VerificationRunner`
 * reads — `packages/verification/src/runner.ts`'s private
 * `resolveAuthStatePath`), so a capability mined from an authenticated
 * crawl replays authenticated here too. Resolved once per session, from
 * whichever capability's flow is called first — a session's browser
 * context has exactly one cookie jar, so later calls against a
 * differently-authenticated flow in the same session fall back to
 * whatever context already exists.
 */
function resolveAuthStatePath(
  store: Store,
  flow: Flow,
  ownerId?: string,
): string | undefined {
  try {
    const path = store.run(flow.runId, ownerId).config.authStatePath;
    return path && existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

async function ensureSessionPage(
  store: Store,
  session: AppMcpSession,
  headed: boolean,
  flow: Flow,
): Promise<Page> {
  if (session.page) return session.page;
  session.browser = await chromium.launch({ headless: !headed });
  const authStatePath = resolveAuthStatePath(store, flow, session.ownerId);
  session.context = await session.browser.newContext(
    authStatePath ? { storageState: authStatePath } : undefined,
  );
  session.page = await session.context.newPage();
  return session.page;
}

/** Deliberate small duplicate of apps/server/src/capabilities.ts's `publishedCandidatesForProject` — packages/mcp must not import from apps/server (packages depend on packages, never the reverse); packages/mcp/src/server.ts already takes Store+Project directly, so this follows that same precedent instead of inventing a new layering. */
function publishedCandidates(
  store: Store,
  projectId: string,
): CapabilityCandidate[] {
  return store
    .capabilities(projectId)
    .filter((capability) => capability.status === "published")
    .flatMap((capability) => {
      const flow = store.flow(capability.flowId);
      return flow ? [{ capability, flow }] : [];
    });
}

/** A short, targeted suggestion for the calling agent — not a stack trace dump. */
function suggestionFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/PRECONDITION_UNMET/.test(message))
    return "A required prior step hasn't happened yet — check this capability's preconditions.";
  if (/waitForResponse|Timeout.*waiting for event/i.test(message))
    return "The expected network response never arrived — the action may not have actually triggered it, or the app is slow.";
  if (/locator|selector|strict mode|No element/i.test(message))
    return "The target element couldn't be found on the current page — the UI may have changed, or a prior step didn't land where expected.";
  return "The flow failed; inspect the page state above and consider retrying or using a different input.";
}

function buildAppMcpServer(
  store: Store,
  projectId: string,
  session: AppMcpSession,
  headed: boolean,
): Server {
  const server = new Server(
    { name: `unfold-appmcp-${projectId}`, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const resolveRequiredFlow = async (
    capabilityId: string,
  ): Promise<RequiredFlowResolution | undefined> =>
    publishedCandidates(store, projectId).find(
      (candidate) => candidate.capability.id === capabilityId,
    );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: publishedCandidates(store, projectId).map(({ capability }) => {
      const tool = toModelContextTool(capability);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema as { type: "object" } | undefined) ?? {
          type: "object" as const,
          properties: {},
        },
        // MCP's own annotation vocabulary has no exact equivalent of
        // WebMCP's `consequentialHint` — `destructiveHint` is the closest
        // (both flag "this action has side effects beyond reading").
        annotations: {
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.consequentialHint,
        },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    session.lastActivity = Date.now();
    const { name, arguments: args } = request.params;
    const found = publishedCandidates(store, projectId).find(
      ({ capability }) => toModelContextTool(capability).name === name,
    );
    if (!found)
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    let lastStep:
      | { index: number; action: Flow["steps"][number]["action"]; requiresUrl?: string }
      | undefined;
    try {
      const page = await ensureSessionPage(store, session, headed, found.flow);
      const result = await replayCapability(
        page,
        found.capability,
        found.flow,
        (args as Record<string, unknown>) ?? {},
        undefined,
        undefined,
        undefined,
        resolveRequiredFlow,
        (step) => {
          lastStep = step;
        },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      const page = session.page;
      const context = {
        error: error instanceof Error ? error.message : String(error),
        step: lastStep,
        page: page
          ? { url: page.url(), title: await page.title().catch(() => undefined) }
          : undefined,
        suggestion: suggestionFor(error),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(context) }],
        isError: true,
      };
    }
  });

  return server;
}

function sessionFor(req: {
  headers: Record<string, string | string[] | undefined>;
}): AppMcpSession | undefined {
  const header = req.headers["mcp-session-id"];
  const sessionId = typeof header === "string" ? header : undefined;
  return sessionId ? sessions.get(sessionId) : undefined;
}

export async function handleProjectAppMcpPost(
  store: Store,
  projectId: string,
  ownerId: string,
  headed: boolean,
  req: any,
  res: any,
): Promise<void> {
  const existing = sessionFor(req);
  if (existing) {
    existing.lastActivity = Date.now();
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }
  // No (or unrecognized) session id: this must be an initialize request —
  // stand up a fresh session. `session.server` is filled in right after
  // construction since `buildAppMcpServer` needs the session object to
  // close over, and the session needs the server it's paired with.
  const session = {
    projectId,
    ownerId,
    lastActivity: Date.now(),
  } as AppMcpSession;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, session);
    },
    onsessionclosed: (sessionId: string) => {
      void closeSession(sessionId);
    },
  });
  session.transport = transport;
  session.server = buildAppMcpServer(store, projectId, session, headed);
  try {
    await session.server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    await session.server.close().catch(() => {});
    throw error;
  }
}

export async function handleProjectAppMcpGet(req: any, res: any): Promise<void> {
  const existing = sessionFor(req);
  if (!existing) {
    res.status(400).json({ error: "Unknown or missing MCP session." });
    return;
  }
  existing.lastActivity = Date.now();
  await existing.transport.handleRequest(req, res);
}

export async function handleProjectAppMcpDelete(
  req: any,
  res: any,
): Promise<void> {
  const existing = sessionFor(req);
  if (!existing) {
    res.status(400).json({ error: "Unknown or missing MCP session." });
    return;
  }
  await existing.transport.handleRequest(req, res);
}
