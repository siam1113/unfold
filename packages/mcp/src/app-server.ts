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
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Store, artifactRoot } from "../../storage/src/index.js";
import type {
  CapabilityCandidate,
  Flow,
} from "../../capability-core/src/types.js";
import {
  replayCapability,
  type RequiredFlowResolution,
} from "../../capability-runtime/src/replay.js";
import { runSetupSteps } from "../../worker/src/workflow-runner.js";
import { toModelContextTool } from "../../adapters/webmcp/src/index.js";

// Always-available tool name (not a mined Capability/Flow at all — WorkflowStep's
// navigate/waitFor steps have no equivalent in FlowStep's click/hover/fill/
// select-only vocabulary, so a login recipe can't be represented as a
// replayCapability()-executed Flow the way a discovered capability is; this
// runs via runSetupSteps instead, the same engine discovery's own setup
// steps already use). Offered whenever the project has a saved login
// recipe — see the ListToolsRequestSchema handler below.
const AUTHENTICATE_TOOL = "Authenticate";

/** Exported for tests (tests/app-mcp-authenticate.test.ts), which builds one directly rather than going through handleProjectAppMcpPost's real HTTP session bootstrap. */
export interface AppMcpSession {
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

// Resolved once per session, from whichever tool call happens first — a
// session's browser context has exactly one cookie jar, so later calls
// against a differently-authenticated flow (or a call to "Authenticate",
// below) in the same session reuse whatever context already exists rather
// than opening a second one.
async function ensureSessionPage(
  session: AppMcpSession,
  headed: boolean,
  authStatePath: string | undefined,
): Promise<Page> {
  if (session.page) return session.page;
  session.browser = await chromium.launch({ headless: !headed });
  session.context = await session.browser.newContext(
    authStatePath ? { storageState: authStatePath } : undefined,
  );
  session.page = await session.context.newPage();
  return session.page;
}

/**
 * The "Authenticate" tool's definition, or `undefined` if this project has
 * no saved login recipe yet (scanConfig.setupSteps — see
 * apps/dashboard/src/flow-auth-capture-views.tsx's "Save as project login
 * recipe"). Exported so apps/server/src/index.ts's `/appmcp-tools` route
 * (the dashboard AppMCP panel's "Tools" list) shows exactly the same tool
 * a real MCP client's tools/list would see — one definition, not two
 * independently-maintained copies that can drift.
 */
export function authenticateToolDefinition(
  store: Store,
  projectId: string,
  ownerId?: string,
):
  | {
      name: string;
      description: string;
      inputSchema: { type: "object"; properties: Record<string, never> };
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    }
  | undefined {
  if (!store.project(projectId, ownerId).scanConfig.setupSteps.length)
    return undefined;
  return {
    name: AUTHENTICATE_TOOL,
    description:
      "Log into the target application using this project's saved login steps. Call this first if other tool calls are failing because the page isn't signed in (e.g. landing on a login/home page, or a target element not being found).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  };
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

/** Exported for tests (tests/app-mcp-authenticate.test.ts) — connects directly via the MCP SDK's InMemoryTransport, same proven pattern packages/mcp/src/mining-tools.ts's connectMiningMcpClient uses, rather than needing a real HTTP request/response pair. */
export function buildAppMcpServer(
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
    tools: [
      // Only offered once a project has a saved login recipe at all —
      // always available, no verify/approve/publish gate — it isn't a
      // discovered capability, it's infrastructure for using the others.
      ...(() => {
        const tool = authenticateToolDefinition(
          store,
          projectId,
          session.ownerId,
        );
        return tool ? [tool] : [];
      })(),
      ...publishedCandidates(store, projectId).map(({ capability }) => {
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    session.lastActivity = Date.now();
    const { name, arguments: args } = request.params;

    if (name === AUTHENTICATE_TOOL) {
      const project = store.project(projectId, session.ownerId);
      const steps = project.scanConfig.setupSteps;
      if (!steps.length)
        return {
          content: [
            {
              type: "text" as const,
              text: "This project has no saved login steps yet — capture a login session and save it as the project's recipe first.",
            },
          ],
          isError: true,
        };
      try {
        // Starts fresh rather than seeding from whatever (possibly stale)
        // session already exists — the whole point of calling this is to
        // establish a known-good one. Harmless if the session's context was
        // already created by an earlier capability call in this same
        // connection: ensureSessionPage only creates it once, so this just
        // runs the recipe on top of whatever cookies that context already
        // had, same as a human re-logging-in on an already-open tab.
        const page = await ensureSessionPage(session, headed, undefined);
        await runSetupSteps(
          session.context!,
          page,
          project.baseUrl,
          steps,
          undefined,
          store.projectAuthSecrets(projectId),
        );
        // Persisted as the project's canonical session too, so a later
        // capability call in a DIFFERENT connection — or a verification
        // run — benefits from this login without needing its own
        // Authenticate call.
        const state = await session.context!.storageState();
        const path = resolve(
          artifactRoot(),
          "projects",
          projectId,
          "auth-state.json",
        );
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, JSON.stringify(state));
        await chmod(path, 0o600);
        store.updateProjectAuthStatePath(projectId, path, session.ownerId);
        return { content: [{ type: "text" as const, text: "Signed in." }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    const found = publishedCandidates(store, projectId).find(
      ({ capability }) => toModelContextTool(capability).name === name,
    );
    if (!found)
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    let lastStep:
      | {
          index: number;
          action: Flow["steps"][number]["action"];
          requiresUrl?: string;
        }
      | undefined;
    try {
      const page = await ensureSessionPage(
        session,
        headed,
        store.resolveFlowAuthStatePath(found.flow.runId, session.ownerId),
      );
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
          ? {
              url: page.url(),
              title: await page.title().catch(() => undefined),
            }
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

export async function handleProjectAppMcpGet(
  req: any,
  res: any,
): Promise<void> {
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
