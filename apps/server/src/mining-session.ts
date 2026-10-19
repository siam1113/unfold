// LLM-driven capability mining orchestration: runs the pure authoring layer
// (packages/capability-core/src/authoring.ts) through an OpenAI tool-calling
// loop, mirroring the exact shape of the project Assistant's agent/chat loop
// in apps/server/src/index.ts (raw fetch, no SDK, SSE emit). Persistence and
// the discovery-scoped dedupe-by-name check reuse apps/server/src/capabilities.ts's
// existing `capabilitiesForDiscovery` exactly as `mineForDiscovery` does.
//
// Deliberately does NOT seed from the deterministic miners
// (packages/capability-core/src/miner.ts, via mineForDiscovery) — that's a
// separate, explicit action (the dashboard's plain "Mine" button /
// llmMode:"off"). LLM-mode mining starts from an EMPTY candidate pool and
// explores the run's raw evidence itself (list_states/list_elements/
// list_actions/list_api_calls + propose_capability, packages/mcp/src/mining-tools.ts)
// — the LLM finds and composes capabilities directly from real evidence,
// the same mechanical correlation guarantees as the deterministic miners
// (every id real, every selector/URL resolved server-side, never invented)
// but without being limited to — or anchored on — whatever the
// deterministic pass already found.
import { Store } from "../../../packages/storage/src/index.js";
import {
  connectMiningMcpClient,
  type GenerativeContext,
} from "../../../packages/mcp/src/mining-tools.js";
import {
  validateAndMergeGroups,
  type AuthoredCandidate,
  type CandidatePool,
  type EvidenceScope,
  type FinalizeGroup,
} from "../../../packages/capability-core/src/authoring.js";
import type {
  Capability,
  CapabilityCandidate,
} from "../../../packages/capability-core/src/types.js";
import { capabilitiesForDiscovery } from "./capabilities.js";

export class MiningJobConflictError extends Error {}

// One active LLM-mode mining job per discovery at a time — prevents two
// concurrent `POST .../mine` calls from both reading the same
// "existing names" snapshot and double-persisting (the deterministic-only
// `llmMode:"off"` path is fast/synchronous enough not to need this, same as
// today).
const activeMiningJobs = new Set<string>();

/** Read-only pre-check so a route can return a real 409 before committing to an SSE response — `mineWithLlm` itself still does the authoritative reserve/release. */
export function isMiningJobActive(discoveryId: string): boolean {
  return activeMiningJobs.has(discoveryId);
}

// The 4 stages the dashboard's mining wizard renders as a pipeline (plan:
// "show progress and the things it's found instead of throwing all at
// once" — apps/dashboard/src/flow-mine-wizard.tsx). Named explicitly rather
// than left for the client to infer from status-message text, so the UI
// never has to pattern-match prose to know which step is active.
export type MiningStage = "evidence" | "authoring" | "merge" | "persist";

export type MiningEvent =
  | { type: "stage"; stage: MiningStage; status: "active" | "done" }
  | { type: "status"; message: string }
  | { type: "tool"; name: string; status: "running" | "done" | "failed" }
  // One per capability as it's actually persisted (not for ones skipped by
  // the dedupe-by-name check below) — lets the wizard reveal results live,
  // during the "persist" stage, rather than only at the final `done`.
  | { type: "candidate"; capability: Capability }
  | { type: "error"; message: string }
  | { type: "done"; capabilities: Capability[] };

export interface MineWithLlmOptions {
  llmMode: "grounded" | "generative";
  evidenceScope: EvidenceScope;
  model: string;
}

function persistAuthored(
  store: Store,
  projectId: string,
  discoveryId: string,
  authored: AuthoredCandidate[],
  onPersisted?: (capability: Capability) => void,
): Capability[] {
  const existing = capabilitiesForDiscovery(store, projectId, discoveryId);
  const existingNames = new Set(existing.map((c) => c.name));
  for (const item of authored) {
    if (existingNames.has(item.capability.name)) continue;
    existingNames.add(item.capability.name);
    store.saveFlow(item.flow);
    if (item.secondaryFlow) store.saveFlow(item.secondaryFlow);
    store.saveCapability(item.capability);
    onPersisted?.(item.capability);
  }
  return capabilitiesForDiscovery(store, projectId, discoveryId);
}

function buildSystemPrompt(
  llmMode: "grounded" | "generative",
  evidenceScope: EvidenceScope,
): string {
  const scopeNote =
    evidenceScope === "api"
      ? " Only propose capabilities you can prove with a real API call (propose_capability's apiCall proof) — skip pure UI/navigation flows this pass."
      : evidenceScope === "ui"
        ? " Only propose capabilities you can prove with a real page/state transition (propose_capability's stateTransition proof) — skip API-correlated flows this pass."
        : "";
  const depth =
    llmMode === "generative"
      ? "Explore thoroughly: walk EVERY state, call list_elements on EVERY one of them (not just the ones you already saw an action for), and look at list_actions/list_api_calls for how they connect. Propose every distinct capability you find — evidenced or inferred (see below) — not just the first one or two."
      : "Be efficient but not shallow: call list_elements on every state (not just the first few), and look at list_actions/list_api_calls for how they connect, to find the real capabilities on this discovery, evidenced or inferred — don't stop after the very first one if more are clearly there.";
  return (
    "You are finding real, replayable browser-automation capabilities for Unfold directly from a discovery run's raw recorded evidence — there is no pre-mined candidate list to curate; you do the finding. " +
    "Call list_states (pass limit:200 — the default of 50 may hide real pages on a large discovery) to see every page, list_elements(stateId) for a page's interactive elements, list_actions/list_api_calls to see what happened and what it proved. For each distinct real user action you find, call propose_capability with its steps (every elementId must be real, from list_elements — in the SAME state). " +
    "IMPORTANT — don't let this turn into a sitemap: a plain 'click this link to navigate to that page' capability is the lowest-value, easiest thing to find, and it's tempting to sweep through list_states proposing one of those per page and call it done. Resist that. The valuable, harder-to-find capabilities are forms and multi-step flows — a search box, a filter panel, a login form, a settings form, anything with a fillable input/select. For EVERY state whose list_elements shows a fillable field (input/textarea/select), propose a fill(+submit, if there's an adjacent submit/trigger control) capability for it specifically — this matters more than another navigation capability, and a discovery full of forms/search boxes/filters should produce mostly those, not a list of page-to-page links. " +
    "Prefer a real proof whenever you have one: a real apiCallId (an action that fired a request), or a real toStateId (an action that navigated somewhere). But discovery's own safety policy skips plenty of real actions outright before they ever execute — most commonly form fills/submits, which require an explicit per-field/per-button allowlist entry the project may not have set; list_actions' `decision` field tells you exactly which ones: `executed` has real proof (a toStateId or a correlated apiCall) to use, while `skipped_policy` or `failed` means the action is real (the elementId is real) but was never allowed to run — THIS is where most of a form's real capabilities will show up, so check list_actions for these specifically, don't rely on list_elements alone. Don't let that hide the capability: when you can see the real elements for a plausible action (e.g. a fillable search field and an adjacent submit/trigger control, together in list_elements, possibly also a skipped_policy action for it in list_actions) but there's no matching action/apiCall/state-transition recorded for it, propose it anyway with `proof` omitted — it's kept and clearly marked as inferred/unevidenced rather than dropped. Never invent an element either way, in either case — every elementId you reference must be real, from list_elements, in that same state; `proof` being absent only means 'nobody saw this execute,' never 'guess the target.' " +
    "A capability's flow may legitimately be more than one step — filling several fields before a submit, or a sequence of clicks through a dialog before the real action — represent the complete realistic path when the evidence (or the page's real structure, for an inferred one) shows one, not just the final click. When a state has several fillable fields that belong to the same form, fill ALL of them in one capability's steps, not just the first one. " +
    `${depth}${scopeNote} ` +
    "Once you've proposed what you can find, call finalize_capabilities exactly once: for each proposed candidate (referenced by the id propose_capability returned), give it a clear name and description, group a UI-evidenced and an API-evidenced proposal together ONLY if they clearly represent the same real action (when in doubt, keep them separate; an inferred proposal never groups with anything else — it always stands alone), and set requiredCandidateIds when a capability only works once another one's action has already happened (e.g. its target element only exists after navigating somewhere else first) — only when the evidence actually shows that, not speculatively. " +
    'Name is a short, human-readable TITLE shown directly to end users in a dashboard — NOT a code identifier, NOT snake_case, NOT a tool name. Title Case, like a product feature name: "Apply Date Range Filter" or "Click Multiple Race Selections Allowed" — never "apply_date_filter" or "ui_search". ' +
    "Never invent a URL or selector — every one comes from a real id you looked up. propose_capability rejects unknown ids outright."
  );
}

/** Reasoning models (o-series, gpt-5 family) reject/ignore `temperature` and use `reasoning_effort` instead to control how much work they put in. */
const isReasoningModel = (model: string) => /^(o\d|gpt-5)/.test(model);

/**
 * Runs grounded or generative LLM mining for one discovery, emitting
 * `MiningEvent`s as it goes (same `{type:"status"|"tool"|"done"}` shape the
 * agent/chat SSE route already uses, for apps/server/src/index.ts to relay
 * verbatim). Starts from an empty candidate pool and relies entirely on the
 * model exploring raw evidence and calling `propose_capability` /
 * `finalize_capabilities` itself (see the module doc comment above) — if the
 * model never proposes or finalizes anything, this persists zero
 * capabilities for the run. There is no deterministic-floor fallback here;
 * that's `mineForDiscovery` (apps/server/src/capabilities.ts), a separate,
 * explicit path (`llmMode:"off"`).
 */
export async function mineWithLlm(
  store: Store,
  projectId: string,
  discoveryId: string,
  ownerId: string,
  options: MineWithLlmOptions,
  emit: (event: MiningEvent) => void,
): Promise<Capability[]> {
  if (activeMiningJobs.has(discoveryId))
    throw new MiningJobConflictError(
      "A mining job is already running for this discovery",
    );
  activeMiningJobs.add(discoveryId);
  try {
    emit({ type: "stage", stage: "evidence", status: "active" });
    const run = store.data(discoveryId, ownerId);
    // Starts empty — unlike the old pool-curation design, there is nothing
    // to seed from here. The LLM populates this itself via propose_capability
    // (generative.addCandidate below) as it explores list_states/list_elements/
    // list_actions/list_api_calls.
    const pool: CandidatePool = new Map();
    emit({
      type: "status",
      message: "Exploring the discovery's recorded evidence…",
    });
    emit({ type: "stage", stage: "evidence", status: "done" });

    let finalGroups: FinalizeGroup[] | undefined;
    // Always on for both LLM modes now — grounded and generative differ only
    // in exploration depth/effort (buildSystemPrompt's `depth` instruction and
    // stepBudget below), not in whether the model gets to look at raw evidence.
    const generative: GenerativeContext = {
      run,
      projectId,
      addCandidate: (candidate: CapabilityCandidate) => {
        const id = `g${pool.size + 1}`;
        pool.set(id, candidate);
        return id;
      },
      // Default (10) was sized for the old curate-a-pre-mined-pool design —
      // far too low now that every candidate, including every form/inferred
      // one across a potentially large discovery, has to come from
      // propose_capability itself. Sized generously (not just "a bit more")
      // since a real discovery can easily have 50+ states each with their
      // own form — the goal is one pass covering most of a large discovery,
      // not forcing several repeat "Mine with AI" runs to get full coverage.
      maxProposals: options.llmMode === "generative" ? 120 : 60,
    };

    // The "evidence" stage stays active for the entire tool-calling loop below
    // — that's genuinely where the exploration happens (list_states/
    // list_elements/list_actions/list_api_calls, then propose_capability per
    // finding) — and only flips to "authoring" the moment the model actually
    // calls finalize_capabilities (its naming/grouping judgment call on what
    // it found). Without this, "evidence" and "authoring" would both be
    // emitted back-to-back before the loop even starts, making "Gather
    // evidence" flash past in under a second regardless of how long the real
    // exploration actually takes — exactly the illusion a user watching the
    // wizard would (rightly) distrust.
    let enteredAuthoring = false;
    const connection = await connectMiningMcpClient(
      pool,
      { generative },
      (groups) => {
        finalGroups = groups;
      },
      (name, _args, status) => {
        if (
          name === "finalize_capabilities" &&
          status === "running" &&
          !enteredAuthoring
        ) {
          enteredAuthoring = true;
          emit({ type: "stage", stage: "evidence", status: "done" });
          emit({ type: "stage", stage: "authoring", status: "active" });
        }
        emit({ type: "tool", name, status });
      },
    );
    try {
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
          content: buildSystemPrompt(options.llmMode, options.evidenceScope),
        },
        {
          role: "user",
          content: "Mine and author the capabilities for this discovery run.",
        },
      ];
      const endpoint = `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
      // Mining burns more turns than agent/chat's 8-step budget once lookup
      // tools are in play — both modes now explore raw evidence via
      // list_states/list_elements/list_actions/list_api_calls before
      // proposing, and the prompt now asks for list_elements on EVERY state
      // plus a list_actions pass for skipped_policy fills. Sized for real
      // coverage of a large discovery (50-100+ states) in one pass rather
      // than requiring several repeat "Mine with AI" runs — each "step" here
      // is one model round-trip, and the model can (and does) batch many
      // tool calls into a single round-trip, so this isn't 1:1 with tool
      // calls, but a large discovery still needs real room.
      const stepBudget = options.llmMode === "generative" ? 80 : 50;
      for (let step = 0; step < stepBudget; step++) {
        emit({ type: "status", message: "Thinking through the evidence…" });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages,
            tools,
            tool_choice: "auto",
            ...(isReasoningModel(options.model)
              ? { reasoning_effort: "high" }
              : { temperature: 0.2 }),
          }),
          // Wider than agent/chat's request timeout: the raised stepBudget/
          // maxProposals above mean `messages` keeps growing across a long
          // session (tens of list_elements/propose_capability round trips on
          // a large discovery), and later calls over that bigger context
          // genuinely take longer to generate.
          signal: AbortSignal.timeout(150000),
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
        if (!message.tool_calls?.length) break;
        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments || "{}");
          const toolResult = await connection.client.callTool({
            name: call.function.name,
            arguments: args,
          });
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
        }
        if (finalGroups) break;
      }
    } finally {
      await connection.close();
      // The model may legitimately never call finalize_capabilities at all
      // (budget exhausted, an error, or it just stops) — enteredAuthoring
      // only flips on that call, so without this fallback "evidence" would
      // stay stuck "active" forever and "authoring" would never even start.
      if (!enteredAuthoring) {
        emit({ type: "stage", stage: "evidence", status: "done" });
        emit({ type: "stage", stage: "authoring", status: "active" });
      }
      emit({ type: "stage", stage: "authoring", status: "done" });
    }

    emit({ type: "stage", stage: "merge", status: "active" });
    const authored = validateAndMergeGroups(pool, finalGroups ?? []);
    emit({
      type: "status",
      message: `Merged into ${authored.length} capabilit${authored.length === 1 ? "y" : "ies"}…`,
    });
    emit({ type: "stage", stage: "merge", status: "done" });

    emit({ type: "stage", stage: "persist", status: "active" });
    const capabilities = persistAuthored(
      store,
      projectId,
      discoveryId,
      authored,
      (capability) => emit({ type: "candidate", capability }),
    );
    emit({ type: "stage", stage: "persist", status: "done" });
    return capabilities;
  } finally {
    activeMiningJobs.delete(discoveryId);
  }
}
