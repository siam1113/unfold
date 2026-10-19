import { useRef, useState } from "react";
import {
  X,
  Loader2,
  Check,
  Circle,
  TriangleAlert,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RotateCcw,
  FlaskConical,
  FlaskConicalOff,
} from "lucide-react";
import type {
  Capability,
  VerificationRun,
} from "../../../packages/capability-core/src/types";
import "./flow-verification-wizard.css";

type StageId =
  | "preconditions"
  | "attempt-1"
  | "attempt-2"
  | "attempt-3"
  | "adapter-contract";
type StageState = "pending" | "active" | "done" | "error";

const STAGES: { id: StageId; label: string }[] = [
  { id: "preconditions", label: "Preconditions" },
  { id: "attempt-1", label: "Attempt 1" },
  { id: "attempt-2", label: "Attempt 2" },
  { id: "attempt-3", label: "Attempt 3" },
  { id: "adapter-contract", label: "Adapter contract" },
];
const emptyStageMap = <T,>(value: T): Record<StageId, T> => ({
  preconditions: value,
  "attempt-1": value,
  "attempt-2": value,
  "attempt-3": value,
  "adapter-contract": value,
});

/** Plain-language explanation for each `VerificationRun.failureCategories` string the runner can emit (packages/verification/src/runner.ts). */
const FAILURE_EXPLANATIONS: Record<string, string> = {
  missing_capability: "The capability no longer exists.",
  missing_flow: "The flow this capability points to no longer exists.",
  contract_invalid:
    "The capability's input schema or flow steps failed a static check.",
  environment_unavailable: "The target site could not be reached.",
  no_matching_network_response:
    "No network response matched the expected proof-of-success call in time.",
  locator_unreachable:
    "A step's element could not be found or interacted with on the page.",
  replay_error: "An unexpected error interrupted the replay.",
  insufficient_correlation:
    "The observed network response couldn't be confidently tied to this action.",
  non_2xx_response: "The server responded with an error status.",
  malformed_response: "The response body wasn't well-formed.",
  adapter_registration_failed:
    "The capability could not be registered as a WebMCP tool.",
  adapter_execution_error:
    "Calling executeTool() threw an error — see the adapter-contract log for the exact message.",
  adapter_contract_mismatch:
    "The tool ran, but its response didn't match the expected outcome — see the adapter-contract log for the actual status/result.",
  adapter_setup_error:
    "Something failed before the tool could even be invoked (navigation, registration) — see the adapter-contract log for the exact message.",
  repeatability_gate_incomplete: "Fewer than 3 consecutive attempts passed.",
};

/** Dot tone for one capability's status in the left drawer — a compact echo of flow-capabilities-views.tsx's `statusTone`. */
const statusDotTone: Record<Capability["status"], string> = {
  candidate: "",
  testing: "is-warn",
  verified: "is-good",
  published: "is-good",
  inconclusive: "is-warn",
  failed: "is-bad",
  stale: "is-warn",
  disabled: "is-bad",
};

// Server contract (apps/server/src/index.ts, apps/server/src/capabilities.ts,
// packages/verification/src/runner.ts):
//   POST /api/projects/:projectId/capabilities/:capId/verify/stream -> SSE:
//     {type:"stage", stage, status:"active"|"done"|"error"}
//     {type:"log", stage, message}
//     {type:"screenshot", stage, path}        — path is relative to /artifacts
//     {type:"result", run}                    — the finished VerificationRun
//     {type:"capability", capability}         — the capability's rolled-up status
//     {type:"error", message} / {type:"done"}
export function VerificationWizard({
  projectId,
  capabilities,
  initialCapabilityId,
  initialFlowId,
  close,
  onFinished,
}: {
  projectId: string;
  /** Every capability available to switch to from the drawer — disabled ones are filtered out internally. */
  capabilities: Capability[];
  initialCapabilityId: string;
  initialFlowId?: string;
  close: () => void;
  onFinished: (capability: Capability | null) => void;
}) {
  const [activeId, setActiveId] = useState(initialCapabilityId);
  const [activeFlowId, setActiveFlowId] = useState(initialFlowId);
  const [headed, setHeaded] = useState(false);
  const [navigationSeconds, setNavigationSeconds] = useState(10);
  const [expectSeconds, setExpectSeconds] = useState(10);
  const [actionSeconds, setActionSeconds] = useState(30);
  const [stageStates, setStageStates] = useState<Record<StageId, StageState>>(
    emptyStageMap("pending"),
  );
  const [stageLogs, setStageLogs] = useState<Record<StageId, string[]>>(
    emptyStageMap<string[]>([]),
  );
  const [stageShots, setStageShots] = useState<Record<StageId, string[]>>(
    emptyStageMap<string[]>([]),
  );
  const [run, setRun] = useState<VerificationRun | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [phase, setPhase] = useState<"configure" | "running">("configure");
  const capabilityRef = useRef<Capability | null>(null);

  const drawerCapabilities = capabilities.filter(
    (c) => c.status !== "disabled",
  );
  const active = capabilities.find((c) => c.id === activeId) || null;
  const running = phase === "running" && !finished;

  const appendLog = (stage: StageId, line: string) =>
    setStageLogs((logs) => ({
      ...logs,
      [stage]: [...logs[stage].slice(-30), line],
    }));

  const resetForNewTarget = () => {
    setPhase("configure");
    setStageStates(emptyStageMap("pending"));
    setStageLogs(emptyStageMap<string[]>([]));
    setStageShots(emptyStageMap<string[]>([]));
    setRun(null);
    setError("");
    setFinished(false);
  };

  const selectCapability = (id: string) => {
    if (running || id === activeId) return;
    const next = capabilities.find((c) => c.id === id);
    setActiveId(id);
    setActiveFlowId(next?.flowId);
    resetForNewTarget();
  };

  const runVerification = async () => {
    if (!active) return;
    setPhase("running");
    setStageStates(emptyStageMap("pending"));
    setStageLogs(emptyStageMap<string[]>([]));
    setStageShots(emptyStageMap<string[]>([]));
    setRun(null);
    setError("");
    setFinished(false);
    capabilityRef.current = null;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/capabilities/${active.id}/verify/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flowId: activeFlowId,
            headless: !headed,
            navigationTimeoutMs: navigationSeconds * 1000,
            expectTimeoutMs: expectSeconds * 1000,
            actionTimeoutMs: actionSeconds * 1000,
          }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Verification failed");
      }
      if (!response.body)
        throw new Error("The verification stream is unavailable");
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
              setStageStates((s) => ({ ...s, [event.stage]: event.status }));
            } else if (event.type === "log") {
              appendLog(event.stage, event.message);
            } else if (event.type === "screenshot") {
              const stage = event.stage as StageId;
              setStageShots((s) => ({
                ...s,
                [stage]: [...s[stage], event.path],
              }));
            } else if (event.type === "result") {
              setRun(event.run as VerificationRun);
            } else if (event.type === "capability") {
              capabilityRef.current = event.capability as Capability;
            } else if (event.type === "error") {
              throw new Error(event.message);
            } else if (event.type === "done") {
              sawDone = true;
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!sawDone)
        throw new Error("The verification stream ended before finishing");
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Could not reach the Unfold server. Check that it's running and reload the page."
          : (e as Error).message,
      );
    } finally {
      setFinished(true);
      onFinished(capabilityRef.current);
    }
  };

  const retry = () => setPhase("configure");
  /** Colors a log line green/red by sniffing its own wording — every outcome line the runner emits (packages/verification/src/runner.ts) says one of these somewhere in it. */
  const logTone = (line: string): "is-good" | "is-bad" | undefined => {
    if (/^Passed|matches the expected outcome\.$/.test(line)) return "is-good";
    if (
      /^(Failed|Inconclusive|Could not reach)|does NOT match|threw:|Setup failed|unavailable/.test(
        line,
      )
    )
      return "is-bad";
    return undefined;
  };
  const stageIcon = (state: StageState) => {
    if (state === "done") return <Check size={14} />;
    if (state === "active")
      return <Loader2 size={14} className="flow-cap-spin" />;
    if (state === "error") return <TriangleAlert size={14} />;
    return <Circle size={14} />;
  };

  const outcomeTone =
    run?.status === "verified"
      ? "is-good"
      : run?.status === "inconclusive"
        ? "is-warn"
        : "is-bad";
  const OutcomeIcon =
    run?.status === "verified"
      ? ShieldCheck
      : run?.status === "inconclusive"
        ? ShieldAlert
        : ShieldX;
  const durationSeconds =
    run?.finishedAt &&
    Math.round(
      (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
        1000,
    );

  return (
    <div
      className="verify-wizard-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) close();
      }}
    >
      <div
        className="verify-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="Verify capability"
      >
        <aside className="verify-wizard-drawer">
          <div className="verify-wizard-drawer-head">Capabilities</div>
          <ul>
            {drawerCapabilities.map((capability) => (
              <li key={capability.id}>
                <button
                  type="button"
                  className={`verify-wizard-drawer-card ${capability.id === activeId ? "active" : ""}`}
                  disabled={running && capability.id !== activeId}
                  onClick={() => selectCapability(capability.id)}
                  title={capability.name}
                >
                  <span className="verify-wizard-drawer-card-name">
                    {capability.name}
                  </span>
                  <span
                    className={`verify-wizard-drawer-status ${statusDotTone[capability.status]}`}
                  >
                    {capability.status}
                  </span>
                </button>
              </li>
            ))}
            {!drawerCapabilities.length && (
              <li className="verify-wizard-drawer-empty">
                No other capabilities to verify.
              </li>
            )}
          </ul>
        </aside>

        <div className="verify-wizard-main">
          <div className="verify-wizard-head">
            <div className="verify-wizard-head-title">
              <span className="verify-wizard-mark">
                <FlaskConical size={16} />
              </span>
              <div>
                <span className="verify-wizard-eyebrow">Verification</span>
                <h3>{active?.name ?? "Select a capability"}</h3>
              </div>
            </div>
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

          {!active ? (
            <div className="verify-wizard-empty">
              <FlaskConicalOff size={20} />
              <span>This capability is no longer available.</span>
            </div>
          ) : phase === "configure" ? (
            <div className="verify-wizard-setup">
              <div className="verify-wizard-setup-main">
                <p className="verify-wizard-setup-intro">
                  This replays the capability's flow up to 3 times against a
                  real browser, then checks it still works as a WebMCP tool.
                  Each attempt opens a fresh browser context, so earlier state
                  never leaks between attempts.
                </p>
                <dl className="verify-wizard-setup-summary">
                  <div>
                    <dt>Flow</dt>
                    <dd>
                      {activeFlowId && activeFlowId !== active.flowId
                        ? "Secondary"
                        : "Primary"}
                    </dd>
                  </div>
                </dl>
              </div>
              <aside className="verify-wizard-setup-settings">
                <label className="verify-wizard-headed-toggle">
                  <input
                    type="checkbox"
                    checked={headed}
                    onChange={(event) => setHeaded(event.target.checked)}
                  />
                  Headed (watch the browser)
                </label>

                <h4>Timeouts</h4>
                <p>
                  Raise these if a slow real app is causing timeout failures.
                </p>

                <div className="verify-wizard-timeout-row">
                  <span className="verify-wizard-timeout-label">
                    Navigation
                    <small>Waiting for a page to load.</small>
                  </span>
                  <div className="verify-wizard-timeout-field">
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={navigationSeconds}
                      onChange={(event) =>
                        setNavigationSeconds(Number(event.target.value))
                      }
                      aria-label="Navigation timeout in seconds"
                    />
                    <span className="verify-wizard-timeout-value">
                      {navigationSeconds}s
                    </span>
                  </div>
                </div>

                <div className="verify-wizard-timeout-row">
                  <span className="verify-wizard-timeout-label">
                    Expect
                    <small>Waiting for the proof-of-success response.</small>
                  </span>
                  <div className="verify-wizard-timeout-field">
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={expectSeconds}
                      onChange={(event) =>
                        setExpectSeconds(Number(event.target.value))
                      }
                      aria-label="Expect timeout in seconds"
                    />
                    <span className="verify-wizard-timeout-value">
                      {expectSeconds}s
                    </span>
                  </div>
                </div>

                <div className="verify-wizard-timeout-row">
                  <span className="verify-wizard-timeout-label">
                    Action
                    <small>Waiting for a click, fill, or select.</small>
                  </span>
                  <div className="verify-wizard-timeout-field">
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={actionSeconds}
                      onChange={(event) =>
                        setActionSeconds(Number(event.target.value))
                      }
                      aria-label="Action timeout in seconds"
                    />
                    <span className="verify-wizard-timeout-value">
                      {actionSeconds}s
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="button primary verify-wizard-run-button"
                  onClick={() => void runVerification()}
                >
                  <FlaskConical size={14} />
                  Run verification
                </button>
              </aside>
            </div>
          ) : (
            <>
              <ol className="verify-wizard-pipeline">
                {STAGES.map((stage, index) => (
                  <li
                    key={stage.id}
                    className={`stage-${stageStates[stage.id]}`}
                  >
                    <div className="verify-wizard-pipeline-head">
                      <span className="verify-wizard-pipeline-icon">
                        {stageIcon(stageStates[stage.id])}
                      </span>
                      <span className="verify-wizard-pipeline-index">
                        {index + 1}
                      </span>
                      <strong>{stage.label}</strong>
                    </div>
                    {stageLogs[stage.id].length > 0 && (
                      <div className="verify-wizard-log">
                        {stageLogs[stage.id].map((line, i) => (
                          <div key={i} className={logTone(line)}>
                            <span className="verify-wizard-log-caret">›</span>
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                    {stageShots[stage.id].length > 0 && (
                      <div className="verify-wizard-thumbs">
                        {stageShots[stage.id].map((path) => (
                          <button
                            key={path}
                            type="button"
                            className="verify-wizard-thumb"
                            onClick={() => setZoomed(path)}
                          >
                            <img
                              src={`/artifacts/${path}`}
                              alt={`${stage.label} screenshot`}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              {error && <p className="verify-wizard-error">{error}</p>}

              {run && (
                <div className={`verify-wizard-outcome ${outcomeTone}`}>
                  <OutcomeIcon size={18} />
                  <div>
                    <strong>
                      {run.status === "verified"
                        ? "Verified"
                        : run.status === "inconclusive"
                          ? "Inconclusive"
                          : "Failed"}
                    </strong>
                    <span className="verify-wizard-outcome-meta">
                      {run.passCount} of 3 attempts passed
                      {durationSeconds !== undefined
                        ? ` · ${durationSeconds}s`
                        : ""}
                    </span>
                    {run.failureCategories.length > 0 && (
                      <ul className="verify-wizard-reasons">
                        {run.failureCategories.map((category) => (
                          <li key={category}>
                            <code>{category}</code>
                            {FAILURE_EXPLANATIONS[category]
                              ? ` — ${FAILURE_EXPLANATIONS[category]}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {run.notes && (
                      <p className="verify-wizard-notes">{run.notes}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="verify-wizard-actions">
                {running ? (
                  <span className="verify-wizard-running-hint">Verifying…</span>
                ) : (
                  <>
                    <button type="button" className="button" onClick={retry}>
                      <RotateCcw size={14} />
                      Retry
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={close}
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {zoomed && (
        <div
          className="verify-wizard-zoom-backdrop"
          onMouseDown={() => setZoomed(null)}
        >
          <img src={`/artifacts/${zoomed}`} alt="Verification screenshot" />
          <button
            type="button"
            className="verify-wizard-zoom-close"
            onClick={() => setZoomed(null)}
            aria-label="Close screenshot"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
