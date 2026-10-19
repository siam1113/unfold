import { Activity, ArrowRight, Cable, Globe2, ShieldAlert } from "lucide-react";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  RunData,
} from "../../../packages/shared/src/index";
import "./flow-evidence-views.css";

type Selection = { kind: "state" | "action"; id: string };
type Props = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: Selection) => void;
};

const endpoint = (raw: string) => {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return raw.split("?")[0];
  }
};

export function UiApiSwimlane({ data, states, actions, onSelect }: Props) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const callsByAction = new Map<string, ApiCall[]>();
  for (const call of data.apiCalls) {
    if (!call.actionId) continue;
    callsByAction.set(call.actionId, [
      ...(callsByAction.get(call.actionId) || []),
      call,
    ]);
  }
  const rows = actions
    .map((action) => ({
      action,
      calls: (callsByAction.get(action.id) || []).sort(
        (a, b) => a.sequence - b.sequence,
      ),
    }))
    .filter(({ calls }) => calls.length > 0);
  return (
    <div className="flow-evidence-scroll">
      <div className="flow-evidence-document">
        <header className="flow-evidence-intro">
          <h2>Screen actions and observed API calls</h2>
          <p>
            Each row aligns an action with requests that carry its action ID.
            Unlinked requests are not assigned to a screen action.
          </p>
        </header>
        {rows.length ? (
          <div className="flow-swimlane-table">
            <div className="flow-swimlane-head">
              <span>Screen action</span>
              <span>Observed API calls</span>
            </div>
            {rows.map(({ action, calls }) => {
              const source = stateById.get(action.fromStateId);
              return (
                <article className="flow-swimlane-row" key={action.id}>
                  <button
                    className="flow-swimlane-action"
                    onClick={() => onSelect({ kind: "action", id: action.id })}
                  >
                    <small>
                      {source?.routeKey || "Source screen unavailable"}
                    </small>
                    <strong>
                      {action.action} · {action.targetName || "Unnamed control"}
                    </strong>
                    <span>
                      {action.decision.replaceAll("_", " ")}
                      {action.elapsedMs == null
                        ? ""
                        : ` · ${Math.round(action.elapsedMs)} ms`}
                    </span>
                  </button>
                  <ArrowRight size={15} className="flow-evidence-arrow" />
                  <ol className="flow-swimlane-calls">
                    {calls.map((call) => (
                      <li key={call.id}>
                        <span className="flow-evidence-method">
                          {call.method}
                        </span>
                        <strong title={call.url}>{endpoint(call.url)}</strong>
                        <span
                          className={
                            call.failed || (call.status || 0) >= 400
                              ? "is-failed"
                              : ""
                          }
                        >
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
        ) : (
          <div className="flow-evidence-empty">
            <Cable size={19} />
            <strong>No action-linked API calls</strong>
            <span>
              Requests appear here when discovery records their triggering
              action ID.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ServiceDependencyMap({ data, states }: Props) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const groups = new Map<
    string,
    { calls: ApiCall[]; routes: Set<string>; actions: Set<string> }
  >();
  for (const call of data.apiCalls) {
    let host = "Unknown service";
    try {
      host = new URL(call.url).host;
    } catch {
      /* retain unknown host */
    }
    const group = groups.get(host) || {
      calls: [],
      routes: new Set<string>(),
      actions: new Set<string>(),
    };
    group.calls.push(call);
    const state = call.fromStateId
      ? stateById.get(call.fromStateId)
      : undefined;
    if (state) group.routes.add(state.routeKey);
    if (call.actionId) group.actions.add(call.actionId);
    groups.set(host, group);
  }
  const rows = [...groups.entries()].sort(
    (a, b) => b[1].calls.length - a[1].calls.length,
  );
  return (
    <div className="flow-evidence-scroll">
      <div className="flow-evidence-document">
        <header className="flow-evidence-intro">
          <h2>Observed service dependencies</h2>
          <p>
            Hosts are grouped from captured request URLs and connected to
            routes/actions only when the capture includes those IDs. These
            counts are discovery evidence, not service popularity.
          </p>
        </header>
        {rows.length ? (
          <div className="flow-service-list">
            {rows.map(([host, group]) => (
              <article key={host}>
                <span className="flow-service-icon">
                  <Globe2 size={16} />
                </span>
                <div className="flow-service-name">
                  <strong>{host}</strong>
                  <small>
                    {group.calls.length} calls · {group.actions.size} linked
                    actions
                  </small>
                </div>
                <ArrowRight size={15} className="flow-evidence-arrow" />
                <div className="flow-service-routes">
                  {[...group.routes].sort().map((route) => (
                    <span key={route}>{route}</span>
                  ))}
                  {!group.routes.size && <small>No route link recorded</small>}
                </div>
                <div className="flow-service-status">
                  {
                    group.calls.filter(
                      (call) => call.failed || (call.status || 0) >= 400,
                    ).length
                  }{" "}
                  failed
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flow-evidence-empty">
            <Globe2 size={19} />
            <strong>No service calls recorded</strong>
            <span>Observed requests will be grouped by host here.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const effectNames: Record<string, string> = {
  download: "Download",
  open_new_tab: "New tab",
  external_navigation: "External navigation",
  page_script_error: "Page script error",
  submit_form: "Form submission",
  browser_dialog: "Browser prompt",
  popup_opened: "New tab opened",
  popup_active: "New tab became active",
};

export function BrowserSideEffectMap({ actions, states }: Props) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const rows = actions.flatMap((action) => {
    const effects = action.signals.filter((signal) =>
      /^(?:tab:tab-\d+:(?:download|dialog:|popup_opened|popup_active|external_navigation|history:)|download$|open_new_tab$|external_navigation$|page_script_error$|submit_form$|browser_dialog:|blocked_origin:|blocked_risky_navigation)/.test(
        signal,
      ),
    );
    return effects.map((signal) => ({ action, signal }));
  });
  return (
    <div className="flow-evidence-scroll">
      <div className="flow-evidence-document">
        <header className="flow-evidence-intro">
          <h2>Browser side effects observed during actions</h2>
          <p>
            These events come from worker signals attached to actions. Empty
            results mean no matching side-effect signal was recorded in this
            run.
          </p>
        </header>
        {rows.length ? (
          <div className="flow-side-effect-list">
            {rows.map(({ action, signal }, index) => {
              const state = stateById.get(action.fromStateId);
              const tabEvent = signal.match(/^tab:(tab-\d+):(.+)$/);
              const event = tabEvent?.[2] || signal;
              const historyEvent = event.startsWith("history:");
              const [kind, ...detailParts] = event.split(":");
              const detail = [
                ...detailParts,
                ...(tabEvent ? [tabEvent[1]] : []),
              ].join(" · ");
              const heading = historyEvent
                ? `Browser history · ${event.slice("history:".length).replaceAll("_", " ")}`
                : effectNames[kind] || kind.replaceAll("_", " ");
              return (
                <article key={`${action.id}-${signal}-${index}`}>
                  <span className="flow-side-effect-icon">
                    <ShieldAlert size={15} />
                  </span>
                  <div>
                    <strong>{heading}</strong>
                    <small>
                      {detail || state?.routeKey || "Observed browser event"}
                    </small>
                  </div>
                  <ArrowRight size={14} className="flow-evidence-arrow" />
                  <span className="flow-side-effect-action">
                    {action.action} · {action.targetName || "control"}
                  </span>
                  <small>
                    {state?.title || state?.routeKey || "Unknown screen"}
                  </small>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flow-evidence-empty">
            <Activity size={19} />
            <strong>No side-effect signals recorded</strong>
            <span>
              Downloads, new tabs, browser dialogs, and external navigation are
              listed when captured by the worker.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function RequestLifecycleTrace({ data, states }: Props) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const calls = [...data.apiCalls].sort(
    (a, b) =>
      (a.observedAt || "").localeCompare(b.observedAt || "") ||
      a.sequence - b.sequence,
  );
  const healthGroups = new Map<
    string,
    { host: string; route: string; status: string; calls: ApiCall[] }
  >();
  for (const call of calls) {
    let host = "Unknown host";
    let path = endpoint(call.url);
    try {
      const url = new URL(call.url);
      host = url.host;
      path = url.pathname || "/";
    } catch {
      /* retain the safely shortened endpoint */
    }
    const route = call.fromStateId
      ? stateById.get(call.fromStateId)?.routeKey || "Route not linked"
      : "Route not linked";
    const status =
      call.status == null
        ? call.failed
          ? "Failed"
          : "Unknown"
        : String(call.status);
    const key = `${host}\u0000${path}\u0000${route}\u0000${status}`;
    const group = healthGroups.get(key) || { host, route, status, calls: [] };
    group.calls.push(call);
    healthGroups.set(key, group);
  }
  const healthRows = [...healthGroups.values()].sort(
    (a, b) =>
      b.calls.length - a.calls.length ||
      a.host.localeCompare(b.host) ||
      a.route.localeCompare(b.route),
  );
  return (
    <div className="flow-evidence-scroll">
      <div className="flow-evidence-document">
        <header className="flow-evidence-intro">
          <h2>Request lifecycle evidence</h2>
          <p>
            Requests are ordered by captured start time when available, then
            request sequence. Phase durations use the browser timing fields
            recorded for each request; unavailable phases remain unknown. Health
            summaries describe this discovery run only.
          </p>
        </header>
        {calls.length ? (
          <>
            <section
              className="flow-api-health"
              aria-label="Observed API health summary"
            >
              <div className="flow-api-health-heading">
                <div>
                  <h3>Observed API health</h3>
                  <p>
                    Grouped by host, path, linked source route, and status.
                    Duration buckets include only requests with a recorded total
                    duration.
                  </p>
                </div>
                <span>{calls.length} captured requests</span>
              </div>
              <div
                className="flow-api-health-table"
                role="table"
                aria-label="API health by endpoint and status"
              >
                <div className="flow-api-health-head" role="row">
                  <span>Host and endpoint</span>
                  <span>Source route</span>
                  <span>Status</span>
                  <span>Calls / failures</span>
                  <span>Duration distribution</span>
                </div>
                {healthRows.map((group) => {
                  const durations = group.calls
                    .map((call) => call.durationMs)
                    .filter(
                      (duration): duration is number =>
                        duration != null &&
                        Number.isFinite(duration) &&
                        duration >= 0,
                    )
                    .sort((a, b) => a - b);
                  const failureCount = group.calls.filter(
                    (call) =>
                      call.failed ||
                      (call.status != null && call.status >= 400),
                  ).length;
                  const bins = [0, 0, 0, 0];
                  for (const duration of durations)
                    bins[
                      duration < 100
                        ? 0
                        : duration < 500
                          ? 1
                          : duration < 1000
                            ? 2
                            : 3
                    ]++;
                  const median = durations.length
                    ? durations[Math.floor((durations.length - 1) / 2)]
                    : undefined;
                  const p95 = durations.length
                    ? durations[Math.ceil(durations.length * 0.95) - 1]
                    : undefined;
                  return (
                    <article
                      className="flow-api-health-row"
                      role="row"
                      key={`${group.host}-${group.route}-${group.status}`}
                    >
                      <div className="flow-api-health-endpoint">
                        <strong title={group.host}>{group.host}</strong>
                        <span title={endpoint(group.calls[0].url)}>
                          {endpoint(group.calls[0].url).replace(
                            group.host,
                            "",
                          ) || "/"}
                        </span>
                      </div>
                      <span
                        className="flow-api-health-route"
                        title={group.route}
                      >
                        {group.route}
                      </span>
                      <span
                        className={`flow-api-health-status${group.status === "Failed" || group.status === "Unknown" || Number(group.status) >= 400 ? " is-failed" : ""}`}
                      >
                        {group.status}
                      </span>
                      <span className="flow-api-health-count">
                        {group.calls.length} calls <small>·</small>{" "}
                        <b className={failureCount ? "is-failed" : ""}>
                          {failureCount} failed
                        </b>
                      </span>
                      <div className="flow-api-duration-cell">
                        {durations.length ? (
                          <>
                            <div
                              className="flow-api-duration-bar"
                              role="img"
                              aria-label={`${bins[0]} under 100 ms, ${bins[1]} from 100 to 499 ms, ${bins[2]} from 500 to 999 ms, ${bins[3]} at least 1000 ms`}
                            >
                              {bins.map((count, index) => (
                                <span
                                  key={index}
                                  className={`bucket-${index}`}
                                  style={{ flexGrow: count }}
                                  title={`${["<100 ms", "100–499 ms", "500–999 ms", "≥1000 ms"][index]}: ${count}`}
                                />
                              ))}
                            </div>
                            <small>
                              {durations.length} timed · median{" "}
                              {Math.round(median!)} ms · p95 {Math.round(p95!)}{" "}
                              ms
                            </small>
                          </>
                        ) : (
                          <small>
                            Duration unknown for all {group.calls.length} calls
                          </small>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <ol className="flow-request-lifecycle">
              {calls.map((call) => {
                const from = call.fromStateId
                  ? stateById.get(call.fromStateId)
                  : undefined;
                const to = call.toStateId
                  ? stateById.get(call.toStateId)
                  : undefined;
                const timing = call.timings || {};
                const phaseRows = [
                  [
                    "DNS",
                    timing.domainLookupEnd != null &&
                    timing.domainLookupStart != null
                      ? timing.domainLookupEnd - timing.domainLookupStart
                      : undefined,
                  ],
                  [
                    "Connect",
                    timing.connectEnd != null && timing.connectStart != null
                      ? timing.connectEnd - timing.connectStart
                      : undefined,
                  ],
                  [
                    "TLS",
                    timing.secureConnectionStart != null &&
                    timing.connectEnd != null
                      ? timing.connectEnd - timing.secureConnectionStart
                      : undefined,
                  ],
                  [
                    "TTFB",
                    timing.responseStart != null && timing.requestStart != null
                      ? timing.responseStart - timing.requestStart
                      : undefined,
                  ],
                  [
                    "Download",
                    timing.responseEnd != null && timing.responseStart != null
                      ? timing.responseEnd - timing.responseStart
                      : undefined,
                  ],
                ] as const;
                return (
                  <li key={call.id}>
                    <div className="flow-request-summary">
                      <time>
                        {call.observedAt
                          ? new Date(call.observedAt).toLocaleTimeString()
                          : "Time unavailable"}
                      </time>
                      <span className="flow-evidence-method">
                        {call.method}
                      </span>
                      <strong title={call.url}>{endpoint(call.url)}</strong>
                      <span
                        className={
                          call.failed ||
                          (call.status != null && call.status >= 400)
                            ? "is-failed"
                            : ""
                        }
                      >
                        {call.status ??
                          (call.failed
                            ? "Request failed"
                            : "Response unavailable")}
                      </span>
                      <small>
                        {call.durationMs == null
                          ? "Total unknown"
                          : `${Math.round(call.durationMs)} ms total`}
                      </small>
                      <small>
                        {from?.routeKey || "Source not recorded"} →{" "}
                        {to?.routeKey ||
                          (call.toStateId
                            ? "Destination unavailable"
                            : "No destination state")}
                      </small>
                    </div>
                    <div
                      className="flow-request-phases"
                      aria-label="Captured network phases"
                    >
                      {phaseRows.map(([name, duration]) => (
                        <div
                          className={duration == null ? "is-unknown" : ""}
                          key={name}
                        >
                          <span>{name}</span>
                          <strong>
                            {duration == null ||
                            !Number.isFinite(duration) ||
                            duration < 0
                              ? "Unknown"
                              : `${Math.round(duration)} ms`}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <div className="flow-evidence-empty">
            <Activity size={19} />
            <strong>No request lifecycle records</strong>
            <span>Request timing and status appear when captured.</span>
          </div>
        )}
      </div>
    </div>
  );
}
