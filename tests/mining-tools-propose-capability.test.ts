import { describe, it, expect } from "vitest";
import {
  connectMiningMcpClient,
  type GenerativeContext,
} from "../packages/mcp/src/mining-tools.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import type {
  AppState,
  RunData,
  UIElement,
} from "../packages/shared/src/index.js";
import type { CandidatePool } from "../packages/capability-core/src/authoring.js";
import type { CapabilityCandidate } from "../packages/capability-core/src/types.js";

// Proves propose_capability (packages/mcp/src/mining-tools.ts) sanitizes an
// LLM-supplied inputField into a safe identifier the same way every
// deterministically-mined one already is (packages/capability-core/src/miner.ts's
// slug()) — an LLM has no reason to know `inputField` ends up both a JSON
// Schema property key AND a dot-notation reference in generated sample code
// (apps/dashboard/src/flow-capabilities-views.tsx's `input.${inputField}`),
// so a human-readable label like "patient name or ID" it freely chooses
// would otherwise silently produce a FlowStep/inputSchema whose generated
// code (`input.patient name or ID`) is invalid JavaScript.
const config = ConfigSchema.parse({ baseUrl: "http://127.0.0.1:4174" });
const runId = "run-1";
const box = { x: 0, y: 0, width: 10, height: 10 };
const recipe = { id: "r1", seed: "http://127.0.0.1:4174/patients", steps: [] };

const searchState: AppState = {
  id: "state-search",
  runId,
  url: "http://127.0.0.1:4174/patients",
  routeKey: "/patients",
  fingerprint: "fp-search",
  fingerprintVersion: 1,
  fingerprintReason: "structure",
  structureTokens: [],
  title: "Patients",
  visibleRegionSummary: [],
  interactiveElementIds: ["search-box"],
  discoveredAt: new Date().toISOString(),
  depth: 0,
  worker: 0,
  recipe,
  mainText: "Patients",
};

const searchBox: UIElement = {
  id: "search-box",
  stateId: searchState.id,
  role: "combobox",
  accessibleName: "Search",
  tag: "input",
  textSnippet: "",
  structuralSignature: "input#search",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  inputType: "text",
  box,
};

const run: RunData = {
  run: {
    id: runId,
    name: "test run",
    status: "completed",
    config,
    createdAt: new Date().toISOString(),
    elapsedMs: 0,
    stats: {
      states: 1,
      routes: 1,
      actions: 0,
      executed: 0,
      blocked: 0,
      failed: 0,
      components: 0,
      elements: 1,
      verified: 0,
      pending: 0,
      active: 0,
    },
  },
  states: [searchState],
  elements: [searchBox],
  components: [],
  actions: [],
  apiCalls: [],
  tasks: [],
  events: [],
};

describe("propose_capability: inputField sanitization", () => {
  it("slugifies a human-readable inputField into a safe identifier, consistently across the flow step and the inputSchema", async () => {
    const pool: CandidatePool = new Map();
    const captured: CapabilityCandidate[] = [];
    const generative: GenerativeContext = {
      run,
      projectId: "project-1",
      addCandidate: (candidate) => {
        const id = `g${pool.size + 1}`;
        pool.set(id, candidate);
        captured.push(candidate);
        return id;
      },
    };
    const connection = await connectMiningMcpClient(
      pool,
      { generative },
      () => {},
      () => {},
    );
    try {
      const result = await connection.client.callTool({
        name: "propose_capability",
        arguments: {
          name: "Search Patients",
          description: "Search for a patient by name or ID.",
          risk: "read",
          startStateId: searchState.id,
          steps: [
            {
              elementId: searchBox.id,
              action: "fill",
              inputField: "patient name or ID",
            },
          ],
        },
      });
      expect(result.isError).toBeFalsy();
      expect(captured).toHaveLength(1);
      const [candidate] = captured;
      expect(candidate.flow.steps[0].inputField).toBe("patient_name_or_id");
      expect(candidate.capability.inputSchema).toEqual({
        type: "object",
        properties: { patient_name_or_id: { type: "string" } },
        required: ["patient_name_or_id"],
      });
    } finally {
      await connection.close();
    }
  });
});
