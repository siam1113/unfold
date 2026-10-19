import { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Check,
  CircleDot,
  Circle,
  TriangleAlert,
} from "lucide-react";
import "./flow-mine-wizard.css";

type LlmMode = "off" | "grounded" | "generative";
type EvidenceScope = "api" | "ui" | "both";
type StageId = "evidence" | "authoring" | "merge" | "persist";
type StageState = "pending" | "active" | "done" | "error";

interface AgentStatus {
  configured: boolean;
  defaultModel: string;
  models: { id: string; label: string; detail: string }[];
}

interface FoundCapability {
  id: string;
  name: string;
  risk: string;
  evidenceKinds: string[];
}

const CONFIG_STEPS = ["Mode", "Evidence scope", "Model"];
const STAGES: { id: StageId; label: string }[] = [
  { id: "evidence", label: "Gather evidence" },
  { id: "authoring", label: "LLM authoring" },
  { id: "merge", label: "Merge & validate" },
  { id: "persist", label: "Persist" },
];
const emptyStageMap = <T,>(value: T): Record<StageId, T> => ({
  evidence: value,
  authoring: value,
  merge: value,
  persist: value,
});

// Server contract (apps/server/src/index.ts + apps/server/src/mining-session.ts):
//   POST /api/projects/:projectId/discoveries/:discoveryId/capabilities/mine
//     body {} or omitted                     -> today's synchronous, deterministic-only JSON response
//     body { llmMode, evidenceScope, model }  -> SSE pipeline:
//       {type:"stage", stage, status:"active"|"done"}  — one of the 4 named stages below
//       {type:"status", message} / {type:"tool", name, status}  — log lines, attributed to the current stage
//       {type:"candidate", capability}  — one per capability as it's actually persisted (during "persist")
//       {type:"error", message} / {type:"done", capabilities}
export function MineWizard({
  projectId,
  discoveryId,
  close,
  onMined,
}: {
  projectId: string;
  discoveryId: string;
  close: () => void;
  onMined: (capabilities: unknown[]) => void;
}) {
  const [configStep, setConfigStep] = useState(0);
  const [llmMode, setLlmMode] = useState<LlmMode>("off");
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope>("both");
  const [model, setModel] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>();

  const [phase, setPhase] = useState<"configure" | "running">("configure");
  const [stageStates, setStageStates] = useState<Record<StageId, StageState>>(
    emptyStageMap("pending"),
  );
  const [stageLogs, setStageLogs] = useState<Record<StageId, string[]>>(
    emptyStageMap<string[]>([]),
  );
  const [found, setFound] = useState<FoundCapability[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const currentStageRef = useRef<StageId>("evidence");

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/agent/status`)
      .then((r) => r.json())
      .then((value: AgentStatus) => {
        if (!alive) return;
        setAgentStatus(value);
        setModel((current) => current || value.defaultModel);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  const isMultiStep = llmMode !== "off";
  const onLastConfigStep = configStep >= CONFIG_STEPS.length - 1;
  const running = phase === "running" && !finished && !error;

  const appendLog = (stage: StageId, line: string) =>
    setStageLogs((logs) => ({
      ...logs,
      [stage]: [...logs[stage].slice(-30), line],
    }));

  const runLlmMining = async () => {
    setPhase("running");
    setStageStates(emptyStageMap("pending"));
    setStageLogs(emptyStageMap<string[]>([]));
    setFound([]);
    setFinished(false);
    setError("");
    currentStageRef.current = "evidence";
    try {
      const response = await fetch(
        `/api/projects/${projectId}/discoveries/${discoveryId}/capabilities/mine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ llmMode, evidenceScope, model }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Mining failed");
      }
      if (!response.body) throw new Error("The mining stream is unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            const event = JSON.parse(line.slice(6));
            if (event.type === "stage") {
              currentStageRef.current = event.stage;
              setStageStates((s) => ({
                ...s,
                [event.stage]: event.status === "active" ? "active" : "done",
              }));
            } else if (event.type === "status") {
              appendLog(currentStageRef.current, event.message);
            } else if (event.type === "tool") {
              appendLog(
                currentStageRef.current,
                `${event.name} · ${event.status}`,
              );
            } else if (event.type === "candidate") {
              setFound((f) => [...f, event.capability as FoundCapability]);
            } else if (event.type === "error") {
              setStageStates((s) => ({
                ...s,
                [currentStageRef.current]: "error",
              }));
              throw new Error(event.message);
            } else if (event.type === "done") {
              sawDone = true;
              onMined(event.capabilities);
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!sawDone) throw new Error("The mining stream ended before finishing");
      setFinished(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitConfig = async () => {
    if (isMultiStep && !onLastConfigStep) {
      setConfigStep((s) => s + 1);
      return;
    }
    if (llmMode === "off") {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/discoveries/${discoveryId}/capabilities/mine`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        const list = await res.json();
        if (!res.ok) throw new Error(list.error || "Mining failed");
        onMined(list);
        close();
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    void runLlmMining();
  };

  const stageIcon = (state: StageState) => {
    if (state === "done") return <Check size={14} />;
    if (state === "active")
      return <Loader2 size={14} className="flow-cap-spin" />;
    if (state === "error") return <TriangleAlert size={14} />;
    return <Circle size={14} />;
  };

  return (
    <div
      className="mine-wizard-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) close();
      }}
    >
      <div
        className="mine-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="Mine capabilities"
      >
        <div className="mine-wizard-head">
          <h3>Mine capabilities</h3>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={running}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {phase === "configure" && (
          <>
            {isMultiStep && (
              <div className="mine-wizard-steps">
                {CONFIG_STEPS.map((s, i) => (
                  <span
                    key={s}
                    className={
                      i === configStep ? "active" : i < configStep ? "done" : ""
                    }
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {configStep === 0 && (
              <div className="mine-wizard-body">
                <label
                  className={`mine-wizard-option ${llmMode === "off" ? "active" : ""}`}
                >
                  <input
                    type="radio"
                    name="llmMode"
                    checked={llmMode === "off"}
                    onChange={() => setLlmMode("off")}
                  />
                  <div>
                    <strong>Off</strong>
                    <small>Deterministic only — instant, no LLM.</small>
                  </div>
                </label>
                <label
                  className={`mine-wizard-option ${llmMode === "grounded" ? "active" : ""}`}
                >
                  <input
                    type="radio"
                    name="llmMode"
                    checked={llmMode === "grounded"}
                    onChange={() => setLlmMode("grounded")}
                  />
                  <div>
                    <strong>Grounded</strong>
                    <small>
                      LLM explores the run's recorded evidence directly and
                      proposes what it finds — quick pass, never invents
                      selectors or URLs.
                    </small>
                  </div>
                </label>
                <label
                  className={`mine-wizard-option ${llmMode === "generative" ? "active" : ""}`}
                >
                  <input
                    type="radio"
                    name="llmMode"
                    checked={llmMode === "generative"}
                    onChange={() => setLlmMode("generative")}
                  />
                  <div>
                    <strong>Generative</strong>
                    <small>
                      Same evidence-driven exploration, more thorough — composes
                      multi-step flows across the full recorded run.
                    </small>
                  </div>
                </label>
                {llmMode !== "off" &&
                  agentStatus &&
                  !agentStatus.configured && (
                    <p className="mine-wizard-notice">
                      Configure OPENAI_API_KEY on the server to use
                      grounded/generative mining.
                    </p>
                  )}
              </div>
            )}
            {configStep === 1 && isMultiStep && (
              <div className="mine-wizard-body">
                <label className="field-label">Evidence scope</label>
                <select
                  value={evidenceScope}
                  onChange={(event) =>
                    setEvidenceScope(event.target.value as EvidenceScope)
                  }
                >
                  <option value="both">API + UI</option>
                  <option value="api">API only</option>
                  <option value="ui">UI only</option>
                </select>
              </div>
            )}
            {configStep === 2 && isMultiStep && (
              <div className="mine-wizard-body">
                <label className="field-label">Model</label>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {(agentStatus?.models || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && <p className="mine-wizard-error">{error}</p>}
            <div className="mine-wizard-actions">
              <button type="button" className="button" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                onClick={submitConfig}
                disabled={llmMode !== "off" && !agentStatus?.configured}
              >
                <Sparkles size={14} />
                {isMultiStep && !onLastConfigStep ? "Next" : "Mine"}
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <ol className="mine-wizard-pipeline">
              {STAGES.map((stage) => (
                <li key={stage.id} className={`stage-${stageStates[stage.id]}`}>
                  <div className="mine-wizard-pipeline-head">
                    <span className="mine-wizard-pipeline-icon">
                      {stageIcon(stageStates[stage.id])}
                    </span>
                    <strong>{stage.label}</strong>
                  </div>
                  {stageLogs[stage.id].length > 0 && (
                    <div className="mine-wizard-log">
                      {stageLogs[stage.id].map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {found.length > 0 && (
              <div className="mine-wizard-found">
                <div className="mine-wizard-found-head">
                  <CircleDot size={12} />
                  Found {found.length} capabilit
                  {found.length === 1 ? "y" : "ies"}
                </div>
                <ul>
                  {found.map((c) => (
                    <li key={c.id}>
                      <strong>{c.name}</strong>
                      <span className="mine-wizard-found-tags">
                        {c.risk}
                        {c.evidenceKinds?.length
                          ? ` · ${c.evidenceKinds.join("+")}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="mine-wizard-error">{error}</p>}
            {finished && !error && (
              <p className="mine-wizard-finished">
                Done — {found.length} capabilit
                {found.length === 1 ? "y" : "ies"} found.
              </p>
            )}
            <div className="mine-wizard-actions">
              {running ? (
                <span className="mine-wizard-running-hint">
                  Mining in progress…
                </span>
              ) : (
                <button
                  type="button"
                  className="button primary"
                  onClick={close}
                >
                  Done
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
