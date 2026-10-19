import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, FileSearch, Network, Route } from "lucide-react";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  RunData,
  RunSummary,
} from "../../../packages/shared/src/index";
import "./flow-dependency-views.css";

type SelectItem = { kind: "state" | "action"; id: string };
type Props = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: SelectItem) => void;
};

const pathFor = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
};

const methodTone = (method: string) =>
  `flow-api-method flow-api-method-${method.toLowerCase()}`;

export function RouteApiMapView({ data, states }: Props) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const groups = new Map<
    string,
    { route: string; method: string; endpoint: string; calls: ApiCall[] }
  >();
  for (const call of data.apiCalls) {
    const source = call.fromStateId
      ? stateById.get(call.fromStateId)
      : undefined;
    if (!source) continue;
    const endpoint = pathFor(call.url);
    const key = `${source.routeKey}\u0000${call.method}\u0000${endpoint}`;
    const group = groups.get(key) || {
      route: source.routeKey,
      method: call.method,
      endpoint,
      calls: [],
    };
    group.calls.push(call);
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort(
    (a, b) =>
      a.route.localeCompare(b.route) || a.endpoint.localeCompare(b.endpoint),
  );
  return (
    <div className="flow-dependency-scroll">
      <div className="flow-dependency-document">
        <header className="flow-dependency-intro">
          <h2>Observed route to API connections</h2>
          <p>
            Requests are grouped by the route of their recorded source screen.
            Calls without a matching visible source screen are not included.
          </p>
        </header>
        {rows.length ? (
          <div className="flow-api-list">
            {rows.map((row) => {
              const failures = row.calls.filter(
                (call) => call.failed || (call.status || 0) >= 400,
              ).length;
              return (
                <article
                  className="flow-api-row"
                  key={`${row.route}:${row.method}:${row.endpoint}`}
                >
                  <span className="flow-api-route">
                    <Route size={13} /> {row.route}
                  </span>
                  <ArrowRight size={14} className="flow-dependency-arrow" />
                  <span className={methodTone(row.method)}>{row.method}</span>
                  <strong className="flow-api-endpoint" title={row.endpoint}>
                    {row.endpoint}
                  </strong>
                  <span className="flow-api-count">
                    {row.calls.length} calls
                    {failures > 0 && <small>{failures} failed</small>}
                  </span>
                  <div className="flow-api-statuses">
                    {row.calls.slice(0, 6).map((call) => (
                      <span
                        className={
                          call.failed || (call.status || 0) >= 400
                            ? "failed"
                            : ""
                        }
                        key={call.id}
                        title={`${call.status ?? "No status"} · ${call.resourceType}`}
                      >
                        {call.status ?? "—"}
                      </span>
                    ))}
                    {row.calls.length > 6 && (
                      <small>+{row.calls.length - 6}</small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flow-dependency-empty">
            <Network size={20} />
            <strong>No route-linked API calls</strong>
            <span>Observed calls with a source screen will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActionRequestTraceView({ data, actions, onSelect }: Props) {
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  const callsByAction = new Map<string, ApiCall[]>();
  const unlinked: ApiCall[] = [];
  for (const call of data.apiCalls) {
    if (!call.actionId) {
      unlinked.push(call);
      continue;
    }
    callsByAction.set(call.actionId, [
      ...(callsByAction.get(call.actionId) || []),
      call,
    ]);
  }
  const rows = actions
    .map((action) => ({ action, calls: callsByAction.get(action.id) || [] }))
    .filter((row) => row.calls.length)
    .sort((a, b) => a.action.createdAt.localeCompare(b.action.createdAt));
  return (
    <div className="flow-dependency-scroll">
      <div className="flow-dependency-document">
        <header className="flow-dependency-intro">
          <h2>Requests correlated to actions</h2>
          <p>
            Only calls carrying the action ID are assigned to an interaction.
            Unlinked calls are listed separately so their trigger is not
            guessed.
          </p>
        </header>
        <div className="flow-request-traces">
          {rows.map(({ action, calls }) => {
            const source = stateById.get(action.fromStateId);
            return (
              <article className="flow-request-trace" key={action.id}>
                <button
                  className="flow-request-trigger"
                  onClick={() => onSelect({ kind: "action", id: action.id })}
                >
                  <span>
                    {source?.title || source?.routeKey || "Observed action"}
                  </span>
                  <strong>
                    {action.action} “{action.targetName || "Control"}”
                  </strong>
                  <small>{action.decision.replace("_", " ")}</small>
                </button>
                <ol>
                  {calls
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((call) => (
                      <li key={call.id}>
                        <span className={methodTone(call.method)}>
                          {call.method}
                        </span>
                        <strong title={call.url}>{pathFor(call.url)}</strong>
                        <span className={call.failed ? "failed" : ""}>
                          {call.status ??
                            (call.failed ? "Failed" : "No status")}
                        </span>
                        <small>
                          {call.durationMs == null
                            ? "Timing unavailable"
                            : `${Math.round(call.durationMs)} ms`}
                        </small>
                      </li>
                    ))}
                </ol>
              </article>
            );
          })}
        </div>
        {unlinked.length > 0 && (
          <section className="flow-unlinked-calls">
            <h3>{unlinked.length} calls without an action link</h3>
            <p>
              These requests have no recorded action ID, so their trigger is
              unknown.
            </p>
            <ul>
              {unlinked.slice(0, 30).map((call) => (
                <li key={call.id}>
                  <span className={methodTone(call.method)}>{call.method}</span>
                  <span title={call.url}>{pathFor(call.url)}</span>
                  <small>{call.status ?? "No status"}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!rows.length && !unlinked.length && (
          <div className="flow-dependency-empty">
            <Activity size={20} />
            <strong>No request traces recorded</strong>
            <span>Requests correlated to actions will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidenceTrailView({ data, states, actions, onSelect }: Props) {
  const stateIds = new Set(states.map((state) => state.id));
  const actionByState = new Map<string, ActionEdge[]>();
  for (const action of actions) {
    actionByState.set(action.fromStateId, [
      ...(actionByState.get(action.fromStateId) || []),
      action,
    ]);
  }
  const evidenceStates = states.filter(
    (state) =>
      state.screenshotPath ||
      (actionByState.get(state.id) || []).some((a) => a.evidencePaths.length),
  );
  return (
    <div className="flow-dependency-scroll">
      <div className="flow-dependency-document">
        <header className="flow-dependency-intro">
          <h2>Evidence trail</h2>
          <p>
            Browse screenshots and action evidence attached to visible screens.
            Available artifacts depend on capture settings and run results.
          </p>
        </header>
        {evidenceStates.length ? (
          <div className="flow-evidence-list">
            {evidenceStates.map((state) => {
              const stateActions = actionByState.get(state.id) || [];
              return (
                <article className="flow-evidence-card" key={state.id}>
                  <button
                    className="flow-evidence-heading"
                    onClick={() => onSelect({ kind: "state", id: state.id })}
                  >
                    <FileSearch size={15} />
                    <strong>{state.title || state.routeKey}</strong>
                    <span>{state.routeKey}</span>
                  </button>
                  {state.screenshotPath && (
                    <a
                      className="flow-evidence-shot"
                      href={`/artifacts/${state.screenshotPath}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        loading="lazy"
                        src={`/artifacts/${state.screenshotPath}`}
                        alt={`Screenshot evidence for ${state.title || state.routeKey}`}
                      />
                      <span>Open screen capture</span>
                    </a>
                  )}
                  {stateActions.some(
                    (action) => action.evidencePaths.length,
                  ) && (
                    <ul>
                      {stateActions.flatMap((action) =>
                        action.evidencePaths.map((path) => (
                          <li key={`${action.id}:${path}`}>
                            <button
                              onClick={() =>
                                onSelect({ kind: "action", id: action.id })
                              }
                            >
                              {action.action} “{action.targetName || "Control"}”
                            </button>
                            <a
                              href={`/artifacts/${path}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {path.split("/").pop() || path}
                            </a>
                          </li>
                        )),
                      )}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flow-dependency-empty">
            <FileSearch size={20} />
            <strong>No evidence artifacts are available</strong>
            <span>
              Try another filter or inspect whether screenshot and trace capture
              were enabled.
            </span>
          </div>
        )}
        <small className="flow-evidence-count">
          {
            data.apiCalls.filter(
              (call) => call.fromStateId && stateIds.has(call.fromStateId),
            ).length
          }{" "}
          related API calls are available in the request views.
        </small>
      </div>
    </div>
  );
}

export function RunComparisonView({ data }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [comparison, setComparison] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/runs", { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load discoveries.");
        return response.json() as Promise<RunSummary[]>;
      })
      .then(
        (result) =>
          alive && setRuns(result.filter((run) => run.id !== data.run.id)),
      )
      .catch(
        (cause) =>
          alive &&
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load discoveries.",
          ),
      );
    return () => {
      alive = false;
    };
  }, [data.run.id]);
  useEffect(() => {
    if (!selectedId) {
      setComparison(null);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/runs/${encodeURIComponent(selectedId)}`, {
      credentials: "same-origin",
      signal: abort.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error("Could not load the selected discovery.");
        return response.json() as Promise<RunData>;
      })
      .then(setComparison)
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the selected discovery.",
          );
      })
      .finally(() => !abort.signal.aborted && setLoading(false));
    return () => abort.abort();
  }, [selectedId]);
  const summary = useMemo(() => {
    if (!comparison) return [];
    const routeCounts = (run: RunData) => {
      const map = new Map<string, number>();
      for (const state of run.states)
        map.set(state.routeKey, (map.get(state.routeKey) || 0) + 1);
      return map;
    };
    const currentRoutes = routeCounts(data);
    const otherRoutes = routeCounts(comparison);
    const routes = [
      ...new Set([...currentRoutes.keys(), ...otherRoutes.keys()]),
    ].sort();
    return routes.map((route) => ({
      route,
      current: currentRoutes.get(route) || 0,
      other: otherRoutes.get(route) || 0,
    }));
  }, [comparison, data]);
  return (
    <div className="flow-dependency-scroll">
      <div className="flow-dependency-document">
        <header className="flow-dependency-intro">
          <h2>Compare discoveries</h2>
          <p>
            Compare observed screen counts by route between this run and another
            discovery.
          </p>
        </header>
        <label className="flow-compare-picker">
          Discovery to compare
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Choose a discovery</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} · {new Date(run.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        {loading && (
          <p className="flow-compare-message">Loading discovery data…</p>
        )}
        {error && (
          <p className="flow-compare-error" role="alert">
            {error}
          </p>
        )}
        {comparison && (
          <>
            <div className="flow-compare-summary">
              <span>
                {data.run.name}: {data.states.length} screens,{" "}
                {data.actions.length} actions
              </span>
              <span>
                {comparison.run.name}: {comparison.states.length} screens,{" "}
                {comparison.actions.length} actions
              </span>
            </div>
            <div className="flow-compare-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>{data.run.name}</th>
                    <th>{comparison.run.name}</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.route}>
                      <th>{row.route}</th>
                      <td>{row.current}</td>
                      <td>{row.other}</td>
                      <td
                        className={
                          row.other - row.current > 0
                            ? "positive"
                            : row.other - row.current < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {row.other - row.current > 0 ? "+" : ""}
                        {row.other - row.current}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
