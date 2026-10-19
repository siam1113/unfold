// AI-authored capability mining's tool surface. `finalize_capabilities` is
// always available. `list_actions`/`list_elements`/`list_api_calls`/
// `list_states`/`propose_capability` require a `GenerativeContext` — as of
// the evidence-first mining design (apps/server/src/mining-session.ts),
// `mineWithLlm` passes one for both grounded and generative modes, since the
// candidate pool now starts empty for LLM-mode mining and these are the only
// tools that can populate it; the two modes differ only in how much
// exploration the system prompt asks for, not in which tools are offered.
// `list_candidate_evidence` reads whatever is in the pool at call time —
// before any `propose_capability` calls, that's nothing.
//
// Non-negotiable safety constraint (see packages/capability-core/src/authoring.ts's
// doc comment and hynix_webmcp_extension_plan.md): the LLM never supplies a
// raw selector or URL. `list_candidate_evidence` never exposes
// `Capability.dependencies[0]`/locator data. `propose_capability` only
// accepts real, already-recorded element/apiCall/state IDs — every
// mechanical FlowStep/expectedRequest/expectedNavigation is resolved
// server-side from the real stored record, and the call is rejected outright
// if any id doesn't exist.
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { RunData } from "../../shared/src/index.js";
import {
  summarizePool,
  type CandidatePool,
  type FinalizeGroup,
} from "../../capability-core/src/authoring.js";
import {
  RiskSchema,
  type CapabilityCandidate,
} from "../../capability-core/src/types.js";
import { pathnameOf } from "../../capability-core/src/correlation.js";
import { slug } from "../../capability-core/src/miner.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export type MiningToolCallRecorder = (
  name: string,
  args: Record<string, unknown>,
  status: "running" | "done" | "failed",
  result?: unknown,
) => void;

/** Only present when mining in generative mode — gates the extra lookup/propose tools. */
export interface GenerativeContext {
  run: RunData;
  projectId: string;
  /** Adds a synthetic single-flow candidate (from `propose_capability`) to the pool under a fresh id, returning that id so `finalize_capabilities` can reference it like any mined candidate. */
  addCandidate: (candidate: CapabilityCandidate) => string;
  /** Caps total `propose_capability` calls per session (cost/latency bound — see plan). */
  maxProposals?: number;
}

export function registerMiningTools(
  server: McpServer,
  pool: CandidatePool,
  options: { generative?: GenerativeContext },
  onFinalize: (groups: FinalizeGroup[]) => void,
  recordToolCall: MiningToolCallRecorder,
) {
  const wrap =
    <A extends Record<string, unknown>>(
      name: string,
      run: (args: A) => Promise<unknown> | unknown,
    ) =>
    async (args: A) => {
      recordToolCall(name, args, "running");
      try {
        const result = await run(args);
        recordToolCall(name, args, "done", result);
        return text(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordToolCall(name, args, "failed", { error: message });
        return { ...text({ error: message }), isError: true };
      }
    };

  server.registerTool(
    "list_candidate_evidence",
    {
      title: "List candidate evidence",
      description:
        "List the raw, deterministically-mined capability candidates for this discovery — mechanical name/description/risk/evidence-kind, no selectors or URLs.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap("list_candidate_evidence", async () => summarizePool(pool)),
  );

  server.registerTool(
    "finalize_capabilities",
    {
      title: "Finalize capabilities",
      description:
        "Author the final capability list: for each group, give a clear short name/description/risk and the 1-2 candidate ids it represents (at most one api-evidenced and one ui-evidenced id — group them only when they clearly represent the same real action). If a group's capability only works once another candidate's action has already happened — e.g. its flow's page only has a resolvable target after navigating there via another capability — name that other candidate's id in requiredCandidateIds (up to 5). Call this exactly once. Any candidate you don't mention is kept standalone with its mechanical name automatically.",
      inputSchema: {
        groups: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              description: z.string().min(1).max(500),
              risk: RiskSchema,
              candidateIds: z.array(z.string()).min(1).max(2),
              requiredCandidateIds: z.array(z.string()).max(5).optional(),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    wrap(
      "finalize_capabilities",
      async ({ groups }: { groups: FinalizeGroup[] }) => {
        onFinalize(groups);
        return { accepted: groups.length };
      },
    ),
  );

  if (!options.generative) return;
  const {
    run,
    projectId,
    addCandidate,
    maxProposals = 10,
  } = options.generative;
  let proposalCount = 0;

  server.registerTool(
    "list_states",
    {
      title: "List states",
      description: "List discovered pages/routes.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap("list_states", async ({ limit }: { limit: number }) =>
      run.states.slice(0, limit).map((s) => ({
        id: s.id,
        routeKey: s.routeKey,
        title: s.title,
        urlPathname: pathnameOf(s.url),
      })),
    ),
  );

  server.registerTool(
    "list_elements",
    {
      title: "List elements",
      description: "List interactive elements observed in one state (page).",
      inputSchema: {
        stateId: z.string(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap(
      "list_elements",
      async ({ stateId, limit }: { stateId: string; limit: number }) =>
        run.elements
          .filter((e) => e.stateId === stateId)
          .slice(0, limit)
          .map((e) => ({
            id: e.id,
            tag: e.tag,
            accessibleName: e.accessibleName,
            inputType: e.inputType,
            disabled: e.disabled,
          })),
    ),
  );

  server.registerTool(
    "list_actions",
    {
      title: "List actions",
      description:
        "List observed user actions (clicks/fills), optionally filtered by origin state.",
      inputSchema: {
        stateId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap(
      "list_actions",
      async ({ stateId, limit }: { stateId?: string; limit: number }) =>
        run.actions
          .filter((a) => !stateId || a.fromStateId === stateId)
          .slice(0, limit)
          .map((a) => ({
            id: a.id,
            targetName: a.targetName,
            action: a.action,
            fromStateId: a.fromStateId,
            toStateId: a.toStateId,
            decision: a.decision,
          })),
    ),
  );

  server.registerTool(
    "list_api_calls",
    {
      title: "List API calls",
      description:
        "List observed network calls, optionally filtered by the task they occurred in.",
      inputSchema: {
        taskId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap(
      "list_api_calls",
      async ({ taskId, limit }: { taskId?: string; limit: number }) =>
        run.apiCalls
          .filter((c) => !taskId || c.taskId === taskId)
          .slice(0, limit)
          .map((c) => ({
            id: c.id,
            method: c.method,
            urlPathname: pathnameOf(c.url),
            status: c.status,
            failed: c.failed,
            taskId: c.taskId,
            actionId: c.actionId,
          })),
    ),
  );

  server.registerTool(
    "propose_capability",
    {
      title: "Propose capability",
      description:
        "Compose a new capability from real observed elements/actions — up to 6 steps, all within one state. Every id must come from list_elements/list_actions/list_api_calls/list_states; you never supply a selector or URL directly. Prefer proving it with a real API call or a real state transition (`proof`) whenever one exists. When the real elements for a plausible action ARE there (e.g. a fillable search field and an adjacent submit/trigger control, observed together in list_elements) but you never actually saw it execute — no matching action/apiCall/state-transition recorded — omit `proof` entirely: it's still proposed, marked as inferred/unevidenced rather than dropped. Never invent an element either way — every id is still real and resolved server-side. If this capability only works after another one has already put the page in the right state (e.g. this one needs to already be on the cart page, which some other candidate's state-transition navigates to), reference that other candidate's id (from list_candidate_evidence, or an id this tool already returned) in requiredCandidateIds — it'll be attempted automatically before this one runs if the page isn't already there.",
      inputSchema: {
        name: z.string().min(1).max(80),
        description: z.string().min(1).max(500),
        risk: RiskSchema,
        startStateId: z.string(),
        steps: z
          .array(
            z.object({
              elementId: z.string(),
              action: z.enum(["click", "hover", "fill", "select"]),
              inputField: z.string().optional(),
            }),
          )
          .min(1)
          .max(6),
        proof: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("apiCall"), apiCallId: z.string() }),
            z.object({
              kind: z.literal("stateTransition"),
              toStateId: z.string(),
            }),
          ])
          .optional(),
        /** Other already-known candidate ids (from list_candidate_evidence, or a prior propose_capability call this session) this capability requires to already be satisfied. Unknown ids are rejected, same as every other id this tool accepts. */
        requiredCandidateIds: z.array(z.string()).max(5).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    wrap(
      "propose_capability",
      async (args: {
        name: string;
        description: string;
        risk: "read" | "reversible_write" | "irreversible_write";
        startStateId: string;
        steps: {
          elementId: string;
          action: "click" | "hover" | "fill" | "select";
          inputField?: string;
        }[];
        proof?:
          | { kind: "apiCall"; apiCallId: string }
          | { kind: "stateTransition"; toStateId: string };
        requiredCandidateIds?: string[];
      }) => {
        if (proposalCount >= maxProposals)
          throw new Error(
            `propose_capability call limit (${maxProposals}) reached for this mining session`,
          );
        proposalCount++;

        const startState = run.states.find((s) => s.id === args.startStateId);
        if (!startState)
          throw new Error(`Unknown startStateId: ${args.startStateId}`);

        // Resolved here (not deferred to finalize time) because a pool
        // candidate's `capability.id` is already final and stable at pool-
        // build time (buildCandidatePool for deterministic candidates,
        // addCandidate for an earlier propose_capability call in this same
        // session) — buildAuthoredCandidate never changes a primary
        // candidate's id, only a merged-away secondary's. `pool` is this
        // function's own enclosing parameter, already in scope here.
        const requiredCapabilityIds = (args.requiredCandidateIds ?? []).map(
          (id) => {
            const required = pool.get(id);
            if (!required) throw new Error(`Unknown candidate id: ${id}`);
            return required.capability.id;
          },
        );

        const resolvedSteps = args.steps.map((step) => {
          const element = run.elements.find((e) => e.id === step.elementId);
          if (!element) throw new Error(`Unknown elementId: ${step.elementId}`);
          if (element.stateId !== args.startStateId)
            throw new Error(
              `Element ${step.elementId} is not in startStateId's state (V1 only supports single-state flows)`,
            );
          return {
            elementSignature: element.structuralSignature,
            locators: element.locatorCandidates,
            action: step.action,
            // Slugified the same way every deterministically-mined
            // inputField already is (packages/capability-core/src/miner.ts) —
            // the LLM names this field freely (it has no reason to know this
            // needs to be a safe identifier), but it ends up both a
            // FlowStep.inputField AND a JSON Schema / generated-sample-code
            // property name (apps/dashboard/src/flow-capabilities-views.tsx's
            // `input.${inputField}` dot-notation reference), which an
            // unsluggified human-readable label like "patient name or ID"
            // breaks.
            inputField: step.inputField ? slug(step.inputField) : undefined,
          };
        });

        let expectedRequest: { method: string; urlPattern: string } | undefined;
        let expectedNavigation: { urlPattern: string } | undefined;
        let evidenceKind: "api" | "ui" | "inferred";
        if (!args.proof) {
          // No proof offered — propose it anyway (never silently drop a
          // structurally-real, plausible action), but mark it "inferred" so
          // mining-session.ts/the dashboard can distinguish it from an
          // actually-observed outcome. Verification (packages/verification/src/runner.ts)
          // still replays it for real and reports "inconclusive" rather than
          // guessing pass/fail.
          evidenceKind = "inferred";
        } else if (args.proof.kind === "apiCall") {
          const apiCallId = args.proof.apiCallId;
          const call = run.apiCalls.find((c) => c.id === apiCallId);
          if (!call) throw new Error(`Unknown apiCallId: ${apiCallId}`);
          expectedRequest = {
            method: call.method,
            urlPattern: pathnameOf(call.url),
          };
          evidenceKind = "api";
        } else {
          const toStateId = args.proof.toStateId;
          const toState = run.states.find((s) => s.id === toStateId);
          if (!toState) throw new Error(`Unknown toStateId: ${toStateId}`);
          expectedNavigation = { urlPattern: pathnameOf(toState.url) };
          evidenceKind = "ui";
        }

        const flowId = randomUUID();
        const inputFields = [
          ...new Set(
            resolvedSteps
              .map((s) => s.inputField)
              .filter((f): f is string => Boolean(f)),
          ),
        ];
        const candidate: CapabilityCandidate = {
          flow: {
            id: flowId,
            runId: run.run.id,
            startUrl: startState.url,
            kind: "atomic",
            navigations: [],
            steps: resolvedSteps,
            expectedRequest,
            expectedNavigation,
          },
          capability: {
            id: randomUUID(),
            projectId,
            version: "1",
            name: args.name,
            description: args.description,
            inputSchema: {
              type: "object",
              properties: Object.fromEntries(
                inputFields.map((f) => [f, { type: "string" }]),
              ),
              required: inputFields,
            },
            flowId,
            risk: args.risk,
            status: "candidate",
            evidenceRunIds: [run.run.id],
            createdAt: new Date().toISOString(),
            preconditions: [],
            expectedOutcomes: [],
            requiredPermissions: [],
            dependencies: [startState.routeKey],
            requiredCapabilityIds,
            evidenceKinds: [evidenceKind],
          },
        };
        const id = addCandidate(candidate);
        return summarizePool(new Map([[id, candidate]]))[0];
      },
    ),
  );
}

export async function connectMiningMcpClient(
  pool: CandidatePool,
  options: { generative?: GenerativeContext },
  onFinalize: (groups: FinalizeGroup[]) => void,
  recordToolCall: MiningToolCallRecorder,
) {
  const server = new McpServer({ name: "unfold-mining", version: "1.0.0" });
  registerMiningTools(server, pool, options, onFinalize, recordToolCall);
  const client = new Client({ name: "unfold-mining-agent", version: "1.0.0" });
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
