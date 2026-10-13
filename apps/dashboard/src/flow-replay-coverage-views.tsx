import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  RunData,
  UIElement,
} from "../../../packages/shared/src/index";
import "./flow-replay-coverage-views.css";

export type ReplayStoryboardViewProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: { kind: "state" | "action"; id: string }) => void;
};

export type CoverageOutcomeMapViewProps = ReplayStoryboardViewProps;

function routePath(state?: AppState) {
  if (!state) return "Unknown route";
  if (state.routeKey) return state.routeKey;
  try {
    return new URL(state.url).pathname || "/";
  } catch {
    return state.url || "Unknown route";
  }
}

function stateTitle(state: AppState) {
  const region = state.visibleRegionSummary.find((value) =>
    /^(dialog|drawer|menu|tab|details):/.test(value),
  );
  if (region)
    return region.split(":").slice(1).join(":") || region.split(":")[0];
  const path = routePath(state);
  return path === "/"
    ? "Overview"
    : path.split("/").filter(Boolean).pop() || state.title || "Observed screen";
}

function routeOnly(url?: string) {
  if (!url) return "Route not recorded";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url.split("?")[0];
  }
}

function pretty(value: string) {
  return value.replaceAll("_", " ");
}
function isControl(element: UIElement) {
  return Boolean(
    element.href ||
    element.inputType ||
    element.isSubmit ||
    (element.role && element.role !== "generic") ||
    /^(button|input|textarea|select|a)$/.test(element.tag.toLowerCase()),
  );
}

function Selectable({
  kind,
  id,
  onSelect,
  className = "",
  children,
}: {
  kind: "state" | "action";
  id: string;
  onSelect: ReplayStoryboardViewProps["onSelect"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flow-story-select ${className}`}
      onClick={() => onSelect({ kind, id })}
    >
      {children}
    </button>
  );
}

function OutcomeBadge({ value }: { value: ActionEdge["decision"] }) {
  const label =
    value === "executed"
      ? "Executed"
      : value === "failed"
        ? "Failed"
        : "Skipped by policy";
  return <span className={`flow-story-outcome is-${value}`}>{label}</span>;
}

type ProvenanceStep = { state: AppState; enteredBy?: ActionEdge };
type ReconstructedPath = {
  steps: ProvenanceStep[];
  complete: boolean;
  reason?: string;
};

function reconstructPath(
  target: AppState,
  stateById: Map<string, AppState>,
  actionById: Map<string, ActionEdge>,
): ReconstructedPath {
  const reverse: ProvenanceStep[] = [{ state: target }];
  const visited = new Set<string>([target.id]);
  let current = target;
  let complete = true;
  let reason: string | undefined;
  while (current.provenanceActionId) {
    const action = actionById.get(current.provenanceActionId);
    if (!action || action.toStateId !== current.id) {
      complete = false;
      reason =
        "The recorded provenance action is unavailable or does not point to this screen.";
      break;
    }
    const parent = stateById.get(action.fromStateId);
    if (!parent) {
      complete = false;
      reason =
        "A prior screen referenced by the discovery action is not in the available data.";
      reverse[reverse.length - 1].enteredBy = action;
      break;
    }
    if (visited.has(parent.id)) {
      complete = false;
      reason = "A loop was found in the recorded provenance links.";
      break;
    }
    reverse[reverse.length - 1].enteredBy = action;
    reverse.push({ state: parent });
    visited.add(parent.id);
    current = parent;
  }
  if (!current.provenanceActionId && current.depth > 0 && !reason) {
    complete = false;
    reason =
      "This screen has no recorded provenance action; earlier steps may not be reconstructable.";
  }
  return { steps: reverse.reverse(), complete, reason };
}

function actionName(action: ActionEdge) {
  return `${pretty(action.action)}${action.targetName ? ` · ${action.targetName}` : ""}`;
}

function apiLabel(call: ApiCall) {
  let path = call.url.split("?")[0];
  try {
    path = new URL(call.url).pathname || "/";
  } catch {
    /* keep query-free observed path */
  }
  return `${call.method.toUpperCase()} ${path}`;
}

/** Storyboard of a selected first-discovery journey, reconstructed through state provenance. */
export function ReplayStoryboardView({
  data,
  states,
  actions,
  onSelect,
}: ReplayStoryboardViewProps) {
  const [targetId, setTargetId] = useState("");
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const actionById = useMemo(
    () => new Map(data.actions.map((action) => [action.id, action])),
    [data.actions],
  );
  const candidates = useMemo(
    () =>
      [...states].sort(
        (a, b) =>
          a.depth - b.depth || a.discoveredAt.localeCompare(b.discoveredAt),
      ),
    [states],
  );
  const selected = stateById.get(targetId) || candidates[candidates.length - 1];
  const path = selected
    ? reconstructPath(selected, stateById, actionById)
    : undefined;
  const apiByAction = useMemo(() => {
    const grouped = new Map<string, ApiCall[]>();
    for (const call of data.apiCalls)
      if (call.actionId)
        grouped.set(call.actionId, [
          ...(grouped.get(call.actionId) || []),
          call,
        ]);
    return grouped;
  }, [data.apiCalls]);
  const elementsById = useMemo(
    () => new Map(data.elements.map((element) => [element.id, element])),
    [data.elements],
  );

  return (
    <section className="flow-story-view" aria-label="Replay storyboard">
      <header className="flow-story-heading">
        <div>
          <span className="flow-story-eyebrow">Observed journey</span>
          <h2>Replay storyboard</h2>
          <p>
            Step through the recorded first-discovery path to a selected screen.
          </p>
        </div>
        <label className="flow-story-picker">
          <span>Select a discovered destination</span>
          <select
            value={selected?.id || ""}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={!candidates.length}
          >
            {!candidates.length && (
              <option value="">No screens available</option>
            )}
            {candidates.map((state) => (
              <option key={state.id} value={state.id}>
                {"· ".repeat(Math.min(state.depth, 4))}
                {routePath(state)} — {stateTitle(state)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!selected || !path ? (
        <div className="flow-story-empty">
          <strong>No journey available</strong>
          <p>Discovered screens are needed to build a storyboard.</p>
        </div>
      ) : (
        <>
          <div
            className={`flow-story-notice${path.complete ? " is-complete" : " is-incomplete"}`}
            role="status"
          >
            <strong>
              {path.complete
                ? "First-discovery path reconstructed"
                : "First-discovery path is incomplete"}
            </strong>
            <span>
              {path.reason ||
                "Only the first-discovery chain is shown. Other observed transitions and alternate routes are not represented in this storyboard."}
            </span>
          </div>
          <ol
            className="flow-story-steps"
            aria-label={`First-discovery steps to ${stateTitle(selected)}`}
          >
            {path.steps.map(({ state, enteredBy }, index) => {
              const outgoingDiscoveryAction = path.steps[index + 1]?.enteredBy;
              const action =
                outgoingDiscoveryAction || (index > 0 ? enteredBy : undefined);
              // Reconstructed entries attach the transition to the destination step.
              const trigger =
                index < path.steps.length - 1
                  ? path.steps[index + 1].enteredBy
                  : undefined;
              const apis = trigger ? apiByAction.get(trigger.id) || [] : [];
              const matchingEvidence = trigger?.evidencePaths || [];
              const element = trigger
                ? elementsById.get(trigger.elementId)
                : undefined;
              return (
                <li className="flow-story-step" key={`${state.id}:${index}`}>
                  <div className="flow-story-step-index" aria-hidden="true">
                    {index + 1}
                  </div>
                  <div className="flow-story-step-content">
                    <div className="flow-story-state-head">
                      <Selectable
                        kind="state"
                        id={state.id}
                        onSelect={onSelect}
                        className="flow-story-state-link"
                      >
                        <span>{routePath(state)}</span>
                        <strong>{stateTitle(state)}</strong>
                      </Selectable>
                      <time dateTime={state.discoveredAt}>
                        {Number.isFinite(new Date(state.discoveredAt).getTime())
                          ? new Date(state.discoveredAt).toLocaleString()
                          : "Discovery time not recorded"}
                      </time>
                    </div>
                    <div className="flow-story-screenshot">
                      {state.screenshotPath ? (
                        <a
                          href={`/artifacts/${state.screenshotPath}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            loading="lazy"
                            src={`/artifacts/${state.screenshotPath}`}
                            alt={`Captured screen: ${stateTitle(state)}`}
                          />
                          <span>Open screenshot</span>
                        </a>
                      ) : (
                        <div className="flow-story-no-screenshot">
                          Screenshot not captured for this screen.
                        </div>
                      )}
                    </div>
                    {trigger ? (
                      <div className="flow-story-trigger">
                        <div className="flow-story-trigger-head">
                          <span className="flow-story-trigger-label">
                            Next observed transition
                          </span>
                          <OutcomeBadge value={trigger.decision} />
                        </div>
                        <Selectable
                          kind="action"
                          id={trigger.id}
                          onSelect={onSelect}
                          className="flow-story-action-link"
                        >
                          <strong>{actionName(trigger)}</strong>
                          <small>
                            {element?.role
                              ? `${element.role} control`
                              : "Control role not recorded"}
                            {trigger.elapsedMs === undefined
                              ? " · duration not recorded"
                              : ` · ${Math.round(trigger.elapsedMs)} ms`}
                          </small>
                        </Selectable>
                        {trigger.decision === "failed" && (
                          <p className="flow-story-error">
                            <strong>Failure recorded:</strong>{" "}
                            {trigger.error ||
                              trigger.errorCode ||
                              "Error detail not recorded"}
                          </p>
                        )}
                        {trigger.decision === "skipped_policy" && (
                          <p className="flow-story-policy">
                            <strong>Not executed:</strong>{" "}
                            {trigger.policy.reason ||
                              trigger.policy.rule ||
                              "Policy reason not recorded"}
                          </p>
                        )}
                        {apis.length > 0 ? (
                          <div className="flow-story-evidence-group">
                            <strong>API calls linked to this action</strong>
                            {apis.map((call) => (
                              <div
                                className={`flow-story-api${call.failed || (call.status !== undefined && call.status >= 400) ? " is-failed" : ""}`}
                                key={call.id}
                              >
                                <span>{apiLabel(call)}</span>
                                <small>
                                  {call.status === undefined
                                    ? "Status not recorded"
                                    : `Status ${call.status}`}
                                  {call.durationMs === undefined
                                    ? ""
                                    : ` · ${Math.round(call.durationMs)} ms`}
                                  {call.failed ? " · request failed" : ""}
                                </small>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="flow-story-muted">
                            No API calls are linked to this transition in the
                            captured data.
                          </p>
                        )}
                        {matchingEvidence.length > 0 && (
                          <div className="flow-story-evidence-group">
                            <strong>Action evidence</strong>
                            {matchingEvidence.map((evidence) => (
                              <a
                                href={`/artifacts/${evidence}`}
                                target="_blank"
                                rel="noreferrer"
                                key={evidence}
                              >
                                {evidence.split("/").pop() || "Open evidence"}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : action && index === 0 && !path.complete ? (
                      <div className="flow-story-trigger">
                        <div className="flow-story-trigger-head">
                          <span className="flow-story-trigger-label">
                            Recorded incoming transition · source unavailable
                          </span>
                          <OutcomeBadge value={action.decision} />
                        </div>
                        <Selectable
                          kind="action"
                          id={action.id}
                          onSelect={onSelect}
                          className="flow-story-action-link"
                        >
                          <strong>{actionName(action)}</strong>
                          <small>
                            Source screen was not available in the reconstructed
                            path.
                          </small>
                        </Selectable>
                        {action.error && (
                          <p className="flow-story-error">
                            <strong>Failure recorded:</strong> {action.error}
                          </p>
                        )}
                      </div>
                    ) : index === path.steps.length - 1 ? (
                      <div className="flow-story-destination">
                        Selected journey destination
                      </div>
                    ) : action ? (
                      <p className="flow-story-muted">
                        A transition was recorded, but this path link could not
                        be resolved.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flow-story-recipe">
            <div>
              <span className="flow-story-eyebrow">
                Recorded restore recipe
              </span>
              <h3>
                {selected.recipe.steps.length} recipe step(s) · seed{" "}
                {routeOnly(selected.recipe.seed)}
              </h3>
            </div>
            {selected.recipe.steps.length ? (
              <ol>
                {selected.recipe.steps.map((step, index) => (
                  <li key={`${step.elementSignature}:${index}`}>
                    <span>
                      {index + 1}. {pretty(step.action)}
                    </span>
                    <small>
                      Expected route: {routeOnly(step.expectedUrl)} ·{" "}
                      {step.locators.length} locator candidate(s)
                    </small>
                    <span className="flow-story-recipe-verification">
                      {
                        step.locators.filter(
                          (locator) => locator.verifiedAfterRestore,
                        ).length
                      }
                      /{step.locators.length} verified after restore
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No restore steps were recorded for this destination.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Screenshot-by-screenshot playback with the recorded source control highlighted. */
export function FlowRecordingView({
  data,
  states,
  actions,
  onSelect,
}: ReplayStoryboardViewProps) {
  const [targetId, setTargetId] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [imageSize, setImageSize] = useState<{
    stateId: string;
    width: number;
    height: number;
  } | null>(null);
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const actionById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions],
  );
  const elementById = useMemo(
    () => new Map(data.elements.map((element) => [element.id, element])),
    [data.elements],
  );
  const candidates = useMemo(
    () =>
      [...states].sort(
        (a, b) =>
          a.depth - b.depth || a.discoveredAt.localeCompare(b.discoveredAt),
      ),
    [states],
  );
  const selected = stateById.get(targetId) || candidates[candidates.length - 1];
  const path = selected
    ? reconstructPath(selected, stateById, actionById)
    : undefined;
  const safeStepIndex = path?.steps.length
    ? Math.min(stepIndex, path.steps.length - 1)
    : 0;
  const current = path?.steps[safeStepIndex];
  const nextTransition = path?.steps[safeStepIndex + 1]?.enteredBy;
  const highlightedElement = nextTransition
    ? elementById.get(nextTransition.elementId)
    : undefined;
  const hasHighlight = Boolean(
    highlightedElement &&
    highlightedElement.box.width > 0 &&
    highlightedElement.box.height > 0,
  );

  useEffect(() => {
    setStepIndex(0);
    setPlaying(false);
  }, [selected?.id]);
  useEffect(() => {
    if (!playing) return;
    if (safeStepIndex >= (path?.steps.length || 1) - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setStepIndex(safeStepIndex + 1),
      1800,
    );
    return () => window.clearTimeout(timer);
  }, [playing, safeStepIndex, path?.steps.length]);

  const goToStep = (next: number) => {
    setPlaying(false);
    setStepIndex(Math.max(0, Math.min(next, (path?.steps.length || 1) - 1)));
  };

  return (
    <section className="flow-recording-view" aria-label="Flow recordings">
      <header className="flow-recording-heading">
        <div>
          <span className="flow-story-eyebrow">Captured browser evidence</span>
          <h2>Flow recording</h2>
          <p>
            Step through captured screens. The marker identifies the recorded
            control for the next action.
          </p>
        </div>
        <label className="flow-recording-picker">
          <span>Choose a destination screen</span>
          <select
            value={selected?.id || ""}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={!candidates.length}
          >
            {!candidates.length && (
              <option value="">No screens available</option>
            )}
            {candidates.map((state) => (
              <option key={state.id} value={state.id}>
                {"· ".repeat(Math.min(state.depth, 4))}
                {routePath(state)} — {stateTitle(state)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!selected || !path || !current ? (
        <div className="flow-recording-empty">
          <strong>No recording is available for this selection</strong>
          <p>
            Discovered screens are needed to build a step-by-step recording.
          </p>
        </div>
      ) : (
        <>
          <div
            className={`flow-story-notice${path.complete ? " is-complete" : " is-incomplete"}`}
            role="status"
          >
            <strong>
              {path.complete
                ? "Recorded path reconstructed"
                : "Recording path is partial"}
            </strong>
            <span>
              {path.reason ||
                "This view follows the first-discovery path captured for the selected screen."}
            </span>
          </div>
          <div className="flow-recording-progress" aria-label="Recording steps">
            {path.steps.map(({ state }, index) => (
              <button
                type="button"
                key={`${state.id}:${index}`}
                className={index === safeStepIndex ? "active" : ""}
                aria-label={`Show step ${index + 1}: ${stateTitle(state)}`}
                aria-current={index === safeStepIndex ? "step" : undefined}
                onClick={() => goToStep(index)}
              >
                <span>{index + 1}</span>
                <small>{stateTitle(state)}</small>
              </button>
            ))}
          </div>
          <article className="flow-recording-frame">
            <header className="flow-recording-frame-heading">
              <div>
                <span>{routePath(current.state)}</span>
                <strong>{stateTitle(current.state)}</strong>
              </div>
              <span className="flow-recording-step-count">
                Screen {safeStepIndex + 1} of {path.steps.length}
              </span>
            </header>
            {current.state.screenshotPath ? (
              <div className="flow-recording-screen">
                <div className="flow-recording-image-wrap">
                  <img
                    key={current.state.id}
                    src={`/artifacts/${current.state.screenshotPath}`}
                    alt={`Recorded screen ${safeStepIndex + 1}: ${stateTitle(current.state)}`}
                    onLoad={(event) =>
                      setImageSize({
                        stateId: current.state.id,
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {hasHighlight && imageSize?.stateId === current.state.id && (
                    <span
                      className="flow-recording-highlight"
                      aria-label={`Recorded control: ${highlightedElement!.accessibleName || highlightedElement!.tag}`}
                      style={{
                        left: `${(highlightedElement!.box.x / imageSize.width) * 100}%`,
                        top: `${(highlightedElement!.box.y / imageSize.height) * 100}%`,
                        width: `${(highlightedElement!.box.width / imageSize.width) * 100}%`,
                        height: `${(highlightedElement!.box.height / imageSize.height) * 100}%`,
                      }}
                    >
                      <span>
                        {nextTransition?.decision === "executed"
                          ? "Clicked control"
                          : nextTransition?.decision === "failed"
                            ? "Attempted control"
                            : "Skipped target"}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flow-recording-no-screen">
                Screenshot not captured for this screen.
              </div>
            )}
            <div className="flow-recording-action">
              {nextTransition ? (
                <>
                  <div className="flow-recording-action-copy">
                    <span>
                      {nextTransition.decision === "executed"
                        ? "Next recorded action"
                        : nextTransition.decision === "failed"
                          ? "Attempted action"
                          : "Action skipped by policy"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({ kind: "action", id: nextTransition.id })
                      }
                    >
                      {actionName(nextTransition)}
                    </button>
                    {hasHighlight && (
                      <small>
                        Highlighted control:{" "}
                        {highlightedElement!.accessibleName ||
                          highlightedElement!.tag}
                      </small>
                    )}
                    {!hasHighlight && (
                      <small>
                        The clicked control’s screen position was not captured.
                      </small>
                    )}
                  </div>
                  <OutcomeBadge value={nextTransition.decision} />
                </>
              ) : (
                <div className="flow-recording-action-copy">
                  <span>End of recorded path</span>
                  <strong>Selected destination reached</strong>
                </div>
              )}
            </div>
          </article>
          <div className="flow-recording-controls">
            <button
              type="button"
              onClick={() => goToStep(safeStepIndex - 1)}
              disabled={safeStepIndex === 0}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              className="flow-recording-play"
              onClick={() =>
                safeStepIndex === path.steps.length - 1
                  ? (setStepIndex(0), setPlaying(true))
                  : setPlaying((value) => !value)
              }
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
              {playing
                ? "Pause"
                : safeStepIndex === path.steps.length - 1
                  ? "Replay"
                  : "Play"}
            </button>
            <button
              type="button"
              onClick={() => goToStep(safeStepIndex + 1)}
              disabled={safeStepIndex >= path.steps.length - 1}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
          <p className="flow-recording-disclaimer">
            This is a screenshot-based walkthrough, not a video capture. The
            highlight marks the recorded control bounds when available.
          </p>
        </>
      )}
    </section>
  );
}

type CoverageStatus = "executed" | "failed" | "skipped_policy" | "no_action";
function statusesFor(actions: ActionEdge[]): CoverageStatus[] {
  if (!actions.length) return ["no_action"];
  const values: CoverageStatus[] = [];
  if (actions.some((action) => action.decision === "executed"))
    values.push("executed");
  if (actions.some((action) => action.decision === "failed"))
    values.push("failed");
  if (actions.some((action) => action.decision === "skipped_policy"))
    values.push("skipped_policy");
  return values;
}

function StatusList({ values }: { values: CoverageStatus[] }) {
  return (
    <span className="flow-coverage-statuses">
      {values.map((status) => (
        <span className={`flow-coverage-status is-${status}`} key={status}>
          {status === "skipped_policy"
            ? "Skipped by policy"
            : status === "no_action"
              ? "No action recorded"
              : pretty(status)}
        </span>
      ))}
    </span>
  );
}

/** Route, state, and control matrix of observed action outcomes and evidence gaps. */
export function CoverageOutcomeMapView({
  data,
  states,
  actions,
  onSelect,
}: CoverageOutcomeMapViewProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const relevantElements = useMemo(
    () =>
      data.elements.filter(
        (element) => stateById.has(element.stateId) && isControl(element),
      ),
    [data.elements, stateById],
  );
  const actionByElement = useMemo(() => {
    const result = new Map<string, ActionEdge[]>();
    for (const action of actions)
      result.set(action.elementId, [
        ...(result.get(action.elementId) || []),
        action,
      ]);
    return result;
  }, [actions]);
  const stateActions = useMemo(() => {
    const result = new Map<string, ActionEdge[]>();
    for (const action of actions)
      result.set(action.fromStateId, [
        ...(result.get(action.fromStateId) || []),
        action,
      ]);
    return result;
  }, [actions]);
  const queryText = query.trim().toLowerCase();
  const routes = new Map<string, AppState[]>();
  for (const state of states)
    if (
      `${routePath(state)} ${stateTitle(state)}`
        .toLowerCase()
        .includes(queryText)
    )
      routes.set(routePath(state), [
        ...(routes.get(routePath(state)) || []),
        state,
      ]);
  const statusCounts = (items: AppState[]) => {
    const all = items.flatMap((state) => stateActions.get(state.id) || []);
    const controls = relevantElements.filter((element) =>
      items.some((state) => state.id === element.stateId),
    );
    const controlActions = controls.flatMap(
      (element) => actionByElement.get(element.id) || [],
    );
    return {
      states: items.length,
      controls: controls.length,
      executed: all.filter((action) => action.decision === "executed").length,
      failed: all.filter((action) => action.decision === "failed").length,
      skipped: all.filter((action) => action.decision === "skipped_policy")
        .length,
      controlsWithActions: controls.filter(
        (element) => (actionByElement.get(element.id) || []).length > 0,
      ).length,
      controlActions,
    };
  };
  const toggle = (route: string) =>
    setExpanded((current) =>
      current.includes(route)
        ? current.filter((item) => item !== route)
        : [...current, route],
    );
  const totals = statusCounts(states);

  return (
    <section className="flow-coverage-view" aria-label="Coverage outcome map">
      <header className="flow-coverage-heading">
        <div>
          <span className="flow-coverage-eyebrow">
            Observed action coverage
          </span>
          <h2>Coverage outcome map</h2>
          <p>Recorded results by route, screen, and captured control.</p>
        </div>
        <label className="flow-coverage-search">
          <span className="sr-only">Filter routes and screens</span>
          <input
            type="search"
            placeholder="Filter routes or screens"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      <div className="flow-coverage-note" role="note">
        “No action recorded” means this run has no matching action record for
        that captured item. It does not mean the control or behavior is absent.
        Controls not captured by discovery cannot be assessed here.
      </div>
      <div
        className="flow-coverage-summary"
        aria-label="Observed outcome totals"
      >
        <div>
          <strong>{totals.states}</strong>
          <span>screens</span>
        </div>
        <div>
          <strong>{totals.controls}</strong>
          <span>captured controls</span>
        </div>
        <div className="is-executed">
          <strong>{totals.executed}</strong>
          <span>executed actions</span>
        </div>
        <div className="is-failed">
          <strong>{totals.failed}</strong>
          <span>failed actions</span>
        </div>
        <div className="is-skipped">
          <strong>{totals.skipped}</strong>
          <span>policy skipped</span>
        </div>
        <div>
          <strong>{totals.controls - totals.controlsWithActions}</strong>
          <span>controls with no action record</span>
        </div>
      </div>
      {routes.size ? (
        <div className="flow-coverage-routes">
          {[...routes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([route, routeStates]) => {
              const open = expanded.includes(route);
              const summary = statusCounts(routeStates);
              return (
                <article className="flow-coverage-route" key={route}>
                  <button
                    className="flow-coverage-route-toggle"
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(route)}
                  >
                    <span className="flow-coverage-route-title">
                      <strong>{route}</strong>
                      <small>
                        {summary.states} screen(s) · {summary.controls} captured
                        control(s)
                      </small>
                    </span>
                    <span className="flow-coverage-route-counts">
                      <i className="is-executed">{summary.executed} executed</i>
                      <i className="is-failed">{summary.failed} failed</i>
                      <i className="is-skipped">{summary.skipped} skipped</i>
                    </span>
                    <span aria-hidden="true" className="flow-coverage-chevron">
                      {open ? "−" : "+"}
                    </span>
                  </button>
                  {open && (
                    <div className="flow-coverage-route-body">
                      {routeStates.map((state) => {
                        const currentActions = stateActions.get(state.id) || [];
                        const controls = relevantElements.filter(
                          (element) => element.stateId === state.id,
                        );
                        return (
                          <section
                            className="flow-coverage-state"
                            key={state.id}
                            aria-label={`Screen ${stateTitle(state)}`}
                          >
                            <header>
                              <Selectable
                                kind="state"
                                id={state.id}
                                onSelect={onSelect}
                                className="flow-coverage-state-select"
                              >
                                <strong>{stateTitle(state)}</strong>
                                <small>
                                  Depth {state.depth} · {currentActions.length}{" "}
                                  action record(s)
                                </small>
                              </Selectable>
                              <StatusList
                                values={statusesFor(currentActions)}
                              />
                            </header>
                            {controls.length ? (
                              <div className="flow-coverage-controls">
                                {controls.map((element: UIElement) => {
                                  const matching =
                                    actionByElement.get(element.id) || [];
                                  return (
                                    <div
                                      className="flow-coverage-control"
                                      key={element.id}
                                    >
                                      <span className="flow-coverage-control-label">
                                        <small>
                                          {element.role || element.tag}
                                          {element.inputType
                                            ? ` · ${element.inputType}`
                                            : ""}
                                        </small>
                                        <strong>
                                          {element.accessibleName ||
                                            "Control name not captured"}
                                        </strong>
                                      </span>
                                      <StatusList
                                        values={statusesFor(matching)}
                                      />
                                      {matching.length > 0 && (
                                        <div className="flow-coverage-action-list">
                                          {matching.map((action) => (
                                            <Selectable
                                              key={action.id}
                                              kind="action"
                                              id={action.id}
                                              onSelect={onSelect}
                                              className="flow-coverage-action"
                                            >
                                              <OutcomeBadge
                                                value={action.decision}
                                              />
                                              <span>
                                                {action.targetName ||
                                                  pretty(action.action)}
                                              </span>
                                              {action.error && (
                                                <small>{action.error}</small>
                                              )}
                                            </Selectable>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="flow-coverage-no-controls">
                                No controls were captured for this screen;
                                control-level outcomes cannot be assessed.
                              </p>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      ) : (
        <div className="flow-coverage-empty">
          <strong>
            {states.length ? "No routes match" : "No screens captured"}
          </strong>
          <p>
            {states.length
              ? "Adjust the route or screen filter."
              : "The current run has no screen records to map."}
          </p>
        </div>
      )}
    </section>
  );
}
