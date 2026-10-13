import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { Store } from "../../storage/src/index.js";
import type { Project, RunData, RunSummary } from "../../shared/src/index.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const contains = (value: string, q: string) =>
  value.toLowerCase().includes(q.toLowerCase());
type StartDiscovery = (input: {
  name?: string;
  seeds?: string[];
}) => RunSummary;
function registerTools(
  server: McpServer,
  store: Store,
  project: Project,
  startDiscovery?: StartDiscovery,
) {
  const discoveries = () => store.discoveries(project.id);
  const data = (runId: string): RunData => {
    if (!discoveries().some((run) => run.id === runId))
      throw new Error("Discovery not found in this project");
    return store.data(runId);
  };
  const inDiscoveries = <T>(collect: (run: RunSummary) => T[]) =>
    discoveries().flatMap((run) => collect(run));
  const registeredFlowTools = new Set<string>();
  const registerObservedFlowTools = () => {
    const names: string[] = [];
    const latestRuns = discoveries().slice(0, 5);
    const candidates = latestRuns.flatMap((run) => {
      const calls = store.data(run.id).apiCalls;
      const grouped = new Map<string, typeof calls>();
      for (const call of calls) {
        const flow = grouped.get(call.taskId) || [];
        flow.push(call);
        grouped.set(call.taskId, flow);
      }
      return [...grouped.entries()].map(([taskId, flow]) => ({
        run,
        taskId,
        calls: flow.sort((a, b) => a.sequence - b.sequence),
        observedAt: flow.at(-1)?.observedAt || "",
      }));
    });
    candidates.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    for (const candidate of candidates.slice(0, 75)) {
      const first = candidate.calls[0];
      const action = first?.actionId
        ? store
            .data(candidate.run.id)
            .actions.find((item) => item.id === first.actionId)
        : undefined;
      const route = first?.fromStateId
        ? store
            .data(candidate.run.id)
            .states.find((state) => state.id === first.fromStateId)?.url
        : candidate.run.config.baseUrl;
      const label =
        action?.targetName ||
        `route_${route ? new URL(route).pathname : "entry"}`;
      const slug =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 28) || "observed";
      const toolName = `observed_flow_${slug}_${candidate.taskId.slice(-8)}`;
      if (registeredFlowTools.has(toolName)) continue;
      registeredFlowTools.add(toolName);
      names.push(toolName);
      server.registerTool(
        toolName,
        {
          title: `Observed flow: ${label}`,
          description: `Read the captured API request sequence for ${label} on ${route ? new URL(route).pathname : "the seed route"}. This tool returns evidence only and does not call the application's APIs.`,
          inputSchema: {},
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async () => {
          const run = data(candidate.run.id);
          const flows = run.apiCalls
            .filter((call) => call.taskId === candidate.taskId)
            .sort((a, b) => a.sequence - b.sequence);
          const flowAction = flows[0]?.actionId
            ? run.actions.find((item) => item.id === flows[0].actionId)
            : undefined;
          const stateRef = (id?: string) => {
            const state = run.states.find((item) => item.id === id);
            if (!state) return undefined;
            let url = state.url;
            try {
              const parsed = new URL(url);
              parsed.search = [...parsed.searchParams.keys()]
                .map((key) => `${encodeURIComponent(key)}=[redacted]`)
                .join("&");
              parsed.hash = "";
              url = parsed.toString();
            } catch {}
            return { id: state.id, title: state.title, url };
          };
          return text({
            discovery: {
              id: run.run.id,
              name: run.run.name,
              status: run.run.status,
            },
            flow: {
              taskId: candidate.taskId,
              trigger: flowAction
                ? {
                    actionId: flowAction.id,
                    action: flowAction.action,
                    target: flowAction.targetName,
                  }
                : { type: "route_probe" },
              from: stateRef(flows[0]?.fromStateId),
              to: stateRef(flows[0]?.toStateId),
              calls: flows,
            },
          });
        },
      );
    }
    return names;
  };
  server.registerTool(
    "refresh_flow_tools",
    {
      title: "Refresh observed flow tools",
      description:
        "Register dedicated read-only MCP tools for API flows captured in the latest project discoveries. Call after a discovery completes.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      text({
        newlyRegistered: registerObservedFlowTools(),
        available: [...registeredFlowTools],
      }),
  );
  server.registerTool(
    "project_overview",
    {
      title: "Project overview",
      description:
        "Summarize this project and its discoveries. No other project is accessible.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(store.projectData(project.id)),
  );
  server.registerTool(
    "list_discoveries",
    {
      title: "List discoveries",
      description: "List discovery runs belonging to this project.",
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) =>
      text(
        discoveries()
          .filter((run) => !status || run.status === status)
          .slice(0, limit),
      ),
  );
  server.registerTool(
    "search_states",
    {
      title: "Search observed states",
      description:
        "Search routes, page titles, visible regions, or observed text inside this project.",
      inputSchema: {
        query: z.string().min(1).max(240),
        discoveryId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, discoveryId, limit }) => {
      const runs = discoveryId ? [data(discoveryId).run] : discoveries();
      const results = runs
        .flatMap((run) =>
          store
            .data(run.id)
            .states.filter((state) =>
              contains(
                [
                  state.url,
                  state.title,
                  ...state.visibleRegionSummary,
                  state.mainText,
                ].join(" "),
                query,
              ),
            )
            .map((state) => ({
              discoveryId: run.id,
              discoveryName: run.name,
              stateId: state.id,
              url: state.url,
              title: state.title,
              depth: state.depth,
              visibleRegions: state.visibleRegionSummary,
              controls: state.interactiveElementIds.length,
              screenshotPath: state.screenshotPath,
              provenanceActionId: state.provenanceActionId,
            })),
        )
        .slice(0, limit);
      return text(results);
    },
  );
  server.registerTool(
    "get_state",
    {
      title: "Get state evidence",
      description:
        "Read a state, visible regions, controls, locator candidates, actions, and replay provenance from this project.",
      inputSchema: {
        discoveryId: z.string().uuid(),
        stateId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ discoveryId, stateId }) => {
      const run = data(discoveryId);
      const state = run.states.find((item) => item.id === stateId);
      if (!state) throw new Error("State not found in this discovery");
      return text({
        discovery: run.run,
        state,
        controls: run.elements.filter((element) => element.stateId === stateId),
        components: run.components.filter(
          (component) => component.stateId === stateId,
        ),
        actions: run.actions.filter(
          (action) =>
            action.fromStateId === stateId || action.toStateId === stateId,
        ),
        apiCalls: run.apiCalls.filter(
          (call) => call.fromStateId === stateId || call.toStateId === stateId,
        ),
      });
    },
  );
  server.registerTool(
    "search_components",
    {
      title: "Search components",
      description:
        "Search observed component names, kinds, and structural family evidence within this project.",
      inputSchema: {
        query: z.string().min(1).max(240),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) =>
      text(
        inDiscoveries((run) =>
          store
            .data(run.id)
            .components.filter((component) =>
              contains(
                `${component.name} ${component.kind} ${component.classificationEvidence.join(" ")}`,
                query,
              ),
            )
            .map((component) => ({
              discoveryId: run.id,
              discoveryName: run.name,
              ...component,
            })),
        ).slice(0, limit),
      ),
  );
  server.registerTool(
    "get_component",
    {
      title: "Get component evidence",
      description:
        "Read one component and its observed controls, locators, and incoming actions from this project.",
      inputSchema: {
        discoveryId: z.string().uuid(),
        componentId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ discoveryId, componentId }) => {
      const run = data(discoveryId);
      const component = run.components.find((item) => item.id === componentId);
      if (!component) throw new Error("Component not found in this discovery");
      const elements = run.elements.filter((item) =>
        component.elementIds.includes(item.id),
      );
      return text({
        discovery: { id: run.run.id, name: run.run.name },
        component,
        elements,
        observedActions: run.actions.filter((action) =>
          component.elementIds.includes(action.elementId),
        ),
      });
    },
  );
  server.registerTool(
    "search_interactions",
    {
      title: "Search observed interactions",
      description:
        "Search action targets, observed effects, policy decisions, and errors inside this project.",
      inputSchema: {
        query: z.string().max(240).default(""),
        effect: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, effect, limit }) =>
      text(
        inDiscoveries((run) =>
          store
            .data(run.id)
            .actions.filter(
              (action) =>
                (!effect || action.effectFlags.includes(effect)) &&
                (!query ||
                  contains(
                    `${action.targetName} ${action.action} ${action.effectFlags.join(" ")} ${action.policy.reason} ${action.error || ""}`,
                    query,
                  )),
            )
            .map((action) => ({
              discoveryId: run.id,
              discoveryName: run.name,
              ...action,
            })),
        ).slice(0, limit),
      ),
  );
  server.registerTool(
    "search_api_calls",
    {
      title: "Search observed API calls",
      description:
        "Search captured in-scope fetch and XHR calls across this project's discoveries by endpoint, method, status, or resource type.",
      inputSchema: {
        query: z.string().max(240).default(""),
        method: z.string().max(12).optional(),
        discoveryId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, method, discoveryId, limit }) => {
      const runs = discoveryId ? [data(discoveryId).run] : discoveries();
      const results = runs.flatMap((run) =>
        store
          .data(run.id)
          .apiCalls.filter(
            (call) =>
              (!method || call.method.toLowerCase() === method.toLowerCase()) &&
              (!query ||
                contains(
                  `${call.method} ${call.url} ${call.status ?? ""} ${call.resourceType}`,
                  query,
                )),
          )
          .map((call) => ({
            discoveryId: run.id,
            discoveryName: run.name,
            ...call,
          })),
      );
      return text(results.slice(0, limit));
    },
  );
  server.registerTool(
    "get_api_flow",
    {
      title: "Get observed API flow",
      description:
        "Read an ordered API call sequence for a discovery, optionally narrowed to one interaction, route state, or probe task. Includes linked interaction and state evidence.",
      inputSchema: {
        discoveryId: z.string().uuid(),
        actionId: z.string().optional(),
        stateId: z.string().optional(),
        taskId: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ discoveryId, actionId, stateId, taskId }) => {
      const run = data(discoveryId);
      if (stateId && !run.states.some((state) => state.id === stateId))
        throw new Error("State not found in this discovery");
      if (actionId && !run.actions.some((action) => action.id === actionId))
        throw new Error("Interaction not found in this discovery");
      const calls = run.apiCalls
        .filter(
          (call) =>
            (!actionId || call.actionId === actionId) &&
            (!stateId ||
              call.fromStateId === stateId ||
              call.toStateId === stateId) &&
            (!taskId || call.taskId === taskId),
        )
        .sort(
          (a, b) =>
            (a.observedAt || "").localeCompare(b.observedAt || "") ||
            a.taskId.localeCompare(b.taskId) ||
            a.sequence - b.sequence,
        );
      const flows = new Map<string, typeof calls>();
      for (const call of calls) {
        const entries = flows.get(call.taskId) || [];
        entries.push(call);
        flows.set(call.taskId, entries);
      }
      return text({
        discovery: {
          id: run.run.id,
          name: run.run.name,
          status: run.run.status,
        },
        flows: [...flows.entries()].map(([id, entries]) => {
          const first = entries[0];
          const action = first?.actionId
            ? run.actions.find((item) => item.id === first.actionId)
            : undefined;
          return {
            taskId: id,
            trigger: action
              ? {
                  actionId: action.id,
                  target: action.targetName,
                  action: action.action,
                }
              : { type: "route_probe" },
            from: run.states.find((state) => state.id === first?.fromStateId),
            to: run.states.find((state) => state.id === first?.toStateId),
            calls: entries,
          };
        }),
      });
    },
  );
  if (startDiscovery)
    server.registerTool(
      "start_discovery",
      {
        title: "Start a fresh discovery",
        description:
          "Start a new browser discovery for this project using its saved configuration. Use this when the project's stored evidence is missing or stale. Optional seeds must be within the project's configured origins.",
        inputSchema: {
          name: z.string().min(1).max(100).optional(),
          seeds: z.array(z.string().url()).max(100).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      async ({ name, seeds }) => {
        const active = discoveries().find((run) =>
          ["queued", "running", "pausing"].includes(run.status),
        );
        if (active)
          return text({
            discovery: active,
            alreadyRunning: true,
            next: "Poll list_discoveries until this discovery finishes, then inspect its API calls.",
          });
        const run = startDiscovery({ name, seeds });
        return text({
          discovery: run,
          next: "Call list_discoveries with this discovery's status as needed; inspect its API calls with search_api_calls and get_api_flow after it finishes.",
        });
      },
    );
  server.registerTool(
    "get_interaction",
    {
      title: "Get interaction evidence",
      description:
        "Read an interaction, before/after states, policy evidence, and replay recipe from this project.",
      inputSchema: {
        discoveryId: z.string().uuid(),
        actionId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ discoveryId, actionId }) => {
      const run = data(discoveryId);
      const action = run.actions.find((item) => item.id === actionId);
      if (!action) throw new Error("Interaction not found in this discovery");
      const before = run.states.find(
        (state) => state.id === action.fromStateId,
      );
      const after = run.states.find((state) => state.id === action.toStateId);
      return text({
        discovery: { id: run.run.id, name: run.run.name },
        action,
        before,
        after,
        control: run.elements.find(
          (element) => element.id === action.elementId,
        ),
        apiCalls: run.apiCalls.filter((call) => call.actionId === actionId),
        evidencePaths: action.evidencePaths,
      });
    },
  );
  server.registerTool(
    "compare_discoveries",
    {
      title: "Compare discoveries",
      description:
        "Compare observed states, routes, components, and interactions between two discoveries in this project.",
      inputSchema: { earlierId: z.string().uuid(), laterId: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ earlierId, laterId }) => {
      const earlier = data(earlierId),
        later = data(laterId);
      const oldStates = new Set(
        earlier.states.map((state) => state.fingerprint),
      );
      const newStates = new Set(later.states.map((state) => state.fingerprint));
      const oldComponents = new Set(
        earlier.components.map(
          (component) =>
            `${component.familyId || component.name}:${component.kind}`,
        ),
      );
      const newComponents = new Set(
        later.components.map(
          (component) =>
            `${component.familyId || component.name}:${component.kind}`,
        ),
      );
      const routes = (run: RunData) =>
        new Set(run.states.map((state) => new URL(state.url).pathname));
      const oldRoutes = routes(earlier),
        newRoutes = routes(later);
      return text({
        earlier: { id: earlierId, name: earlier.run.name },
        later: { id: laterId, name: later.run.name },
        states: {
          added: [...newStates].filter((key) => !oldStates.has(key)).length,
          removed: [...oldStates].filter((key) => !newStates.has(key)).length,
        },
        routes: {
          added: [...newRoutes].filter((key) => !oldRoutes.has(key)),
          removed: [...oldRoutes].filter((key) => !newRoutes.has(key)),
        },
        components: {
          added: [...newComponents].filter((key) => !oldComponents.has(key)),
          removed: [...oldComponents].filter((key) => !newComponents.has(key)),
        },
        actions: {
          earlier: earlier.run.stats.executed,
          later: later.run.stats.executed,
        },
      });
    },
  );
  registerObservedFlowTools();
  const resourceUri = `unfold://projects/${project.id}/context`;
  server.registerResource(
    "project-context",
    resourceUri,
    {
      title: `${project.name} expert context`,
      description:
        "The isolated agent instructions and discovery summary for this project.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: "application/json",
          text: JSON.stringify(store.projectData(project.id), null, 2),
        },
      ],
    }),
  );
  server.registerPrompt(
    "project-expert",
    {
      title: `${project.name} project expert`,
      description: "Work as an evidence-grounded expert for this project only.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: store.projectData(project.id).agent.systemPrompt,
          },
        },
      ],
    }),
  );
}

/** Connect an in-process MCP client to the same project-scoped tools exposed over HTTP. */
export async function connectProjectMcpClient(
  store: Store,
  projectId: string,
  startDiscovery?: StartDiscovery,
) {
  const project = store.project(projectId);
  const server = new McpServer({
    name: `unfold-${project.id}`,
    version: "1.0.0",
  });
  registerTools(server, store, project, startDiscovery);
  const client = new Client({ name: "unfold-project-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

export async function handleProjectMcp(
  store: Store,
  projectId: string,
  req: any,
  res: any,
  startDiscovery?: StartDiscovery,
) {
  const project = store.project(projectId);
  const server = new McpServer({
    name: `unfold-${project.id}`,
    version: "1.0.0",
  });
  registerTools(server, store, project, startDiscovery);
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }
}

export async function startProjectStdioMcp(
  store: Store,
  projectId: string,
  startDiscovery?: StartDiscovery,
) {
  const project = store.project(projectId);
  const server = new McpServer({
    name: `unfold-${project.id}`,
    version: "1.0.0",
  });
  registerTools(server, store, project, startDiscovery);
  await server.connect(new StdioServerTransport());
  return server;
}
