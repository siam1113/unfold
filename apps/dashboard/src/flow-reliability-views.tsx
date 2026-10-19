import React from "react";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  RunData,
} from "../../../packages/shared/src/index";
import "./flow-reliability-views.css";

export type ReliabilityViewProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: { kind: "state" | "action"; id: string }) => void;
};

const nameOf = (state?: AppState) => {
  if (!state) return "Unknown screen";
  const region = state.visibleRegionSummary.find((entry) =>
    /^(dialog|drawer|menu|tab|details):/.test(entry),
  );
  if (region)
    return region.split(":").slice(1).join(":") || region.split(":")[0];
  try {
    const path = new URL(state.url).pathname;
    return path === "/"
      ? "Overview"
      : path.split("/").filter(Boolean).pop() || state.title || path;
  } catch {
    return state.title || state.routeKey || "Observed screen";
  }
};

const pathOf = (value?: string) => {
  if (!value) return "Unknown route";
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value;
  }
};

const pretty = (value?: string) =>
  (value || "unknown").replaceAll("_", " ").replace(/\s+/g, " ").trim();

const ms = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? "Not recorded"
    : value >= 1000
      ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
      : `${Math.round(value)} ms`;

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flow-reliability-empty">
      <span className="flow-reliability-empty-mark" aria-hidden="true">
        —
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`flow-reliability-stat is-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SelectButton({
  kind,
  id,
  onSelect,
  children,
  className = "",
}: {
  kind: "state" | "action";
  id: string;
  onSelect: ReliabilityViewProps["onSelect"];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`flow-reliability-select ${className}`}
      onClick={() => onSelect({ kind, id })}
    >
      {children}
    </button>
  );
}

/** Summarizes the observed action outcomes without inferring unobserved stages. */
export function OutcomeFunnelView({ actions, onSelect }: ReliabilityViewProps) {
  if (!actions.length)
    return (
      <Empty
        title="No observed actions"
        detail="Outcome counts appear after discovery records action attempts."
      />
    );

  const executed = actions.filter((action) => action.decision === "executed");
  const failed = actions.filter((action) => action.decision === "failed");
  const gated = actions.filter(
    (action) => action.decision === "skipped_policy",
  );
  const reached = executed.filter((action) => Boolean(action.toStateId));
  const values = [
    {
      key: "executed",
      label: "Executed",
      count: executed.length,
      tone: "good",
    },
    { key: "failed", label: "Failed", count: failed.length, tone: "bad" },
    {
      key: "policy",
      label: "Skipped by policy",
      count: gated.length,
      tone: "warn",
    },
  ];

  return (
    <section className="flow-reliability-view" aria-label="Outcome funnel">
      <header className="flow-reliability-heading">
        <div>
          <span className="flow-reliability-eyebrow">Observed outcomes</span>
          <h2>Action outcome funnel</h2>
        </div>
        <span className="flow-reliability-total">
          {actions.length} attempts
        </span>
      </header>
      <div className="flow-reliability-stats">
        <Stat label="Observed attempts" value={actions.length} />
        <Stat label="Executed" value={executed.length} tone="good" />
        <Stat
          label="Reached another state"
          value={reached.length}
          tone="good"
        />
        <Stat
          label="Failed"
          value={failed.length}
          tone={failed.length ? "bad" : "neutral"}
        />
        <Stat
          label="Policy skipped"
          value={gated.length}
          tone={gated.length ? "warn" : "neutral"}
        />
      </div>
      <div className="flow-reliability-panel">
        <h3>Observed action outcomes</h3>
        <div
          className="flow-reliability-outcome-bar"
          role="img"
          aria-label={values
            .map((v) => `${v.count} ${v.label.toLowerCase()}`)
            .join(", ")}
        >
          {values.map((value) => (
            <span
              key={value.key}
              className={`tone-${value.tone}`}
              style={{ width: `${(value.count / actions.length) * 100}%` }}
            />
          ))}
        </div>
        <div className="flow-reliability-legend">
          {values.map((value) => (
            <div key={value.key} className={`tone-${value.tone}`}>
              <i /> <span>{value.label}</span>
              <strong>{value.count}</strong>
            </div>
          ))}
        </div>
      </div>
      {(failed.length > 0 || gated.length > 0) && (
        <div className="flow-reliability-panel">
          <h3>Actions needing attention</h3>
          <div className="flow-reliability-list">
            {[...failed, ...gated].slice(0, 8).map((action) => (
              <SelectButton
                key={action.id}
                kind="action"
                id={action.id}
                onSelect={onSelect}
                className="flow-reliability-row"
              >
                <span
                  className={`flow-reliability-status ${action.decision === "failed" ? "is-bad" : "is-warn"}`}
                >
                  {action.decision === "failed" ? "Failed" : "Policy"}
                </span>
                <span className="flow-reliability-row-main">
                  <strong>{action.targetName || pretty(action.action)}</strong>
                  <small>
                    {action.error ||
                      action.policy.reason ||
                      `From ${pathOf(action.beforeUrl)}`}
                  </small>
                </span>
                <span className="flow-reliability-row-meta">
                  {pretty(action.action)}
                </span>
              </SelectButton>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Groups observed failed actions by the screen where they originated. */
export function FailureHotspotsView({
  actions,
  states,
  onSelect,
}: ReliabilityViewProps) {
  const failed = actions.filter((action) => action.decision === "failed");
  const stateById = new Map(states.map((state) => [state.id, state]));
  const grouped = new Map<string, ActionEdge[]>();
  for (const action of failed) {
    const key = action.fromStateId || "unknown";
    grouped.set(key, [...(grouped.get(key) || []), action]);
  }
  const hotspots = [...grouped.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  return (
    <section className="flow-reliability-view" aria-label="Failure hotspots">
      <header className="flow-reliability-heading">
        <div>
          <span className="flow-reliability-eyebrow">Observed failures</span>
          <h2>Failure hotspots</h2>
        </div>
        <span className="flow-reliability-total">
          {failed.length} failed actions
        </span>
      </header>
      {!failed.length ? (
        <Empty
          title="No failed actions observed"
          detail="This run contains no actions recorded with a failed outcome."
        />
      ) : (
        <div className="flow-reliability-hotspots">
          {hotspots.map(([stateId, group]) => {
            const state = stateById.get(stateId);
            return (
              <article className="flow-reliability-hotspot" key={stateId}>
                <div className="flow-reliability-hotspot-head">
                  <SelectButton
                    kind="state"
                    id={stateId}
                    onSelect={onSelect}
                    className="flow-reliability-screen-link"
                  >
                    <span className="flow-reliability-route">
                      {state?.routeKey ||
                        pathOf(state?.url || group[0]?.beforeUrl)}
                    </span>
                    <strong>{nameOf(state)}</strong>
                  </SelectButton>
                  <span className="flow-reliability-failure-count">
                    {group.length} {group.length === 1 ? "failure" : "failures"}
                  </span>
                </div>
                <div className="flow-reliability-list">
                  {group.slice(0, 4).map((action) => (
                    <SelectButton
                      key={action.id}
                      kind="action"
                      id={action.id}
                      onSelect={onSelect}
                      className="flow-reliability-row"
                    >
                      <span
                        className="flow-reliability-failure-dot"
                        aria-hidden="true"
                      />
                      <span className="flow-reliability-row-main">
                        <strong>
                          {action.targetName || pretty(action.action)}
                        </strong>
                        <small>
                          {action.error ||
                            action.errorCode ||
                            "Failure recorded without an error message"}
                        </small>
                      </span>
                      <span className="flow-reliability-row-meta">
                        {action.errorCode || pretty(action.action)}
                      </span>
                    </SelectButton>
                  ))}
                  {group.length > 4 && (
                    <p className="flow-reliability-more">
                      {group.length - 4} more failures at this screen
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Shows observed policy decisions and their recorded rules and reasons. */
export function PolicyGatesView({ actions, onSelect }: ReliabilityViewProps) {
  const gated = actions.filter(
    (action) => action.decision === "skipped_policy" || !action.policy.allowed,
  );
  const allowed = actions.filter(
    (action) => action.decision === "executed" && action.policy.allowed,
  );
  const byRule = new Map<string, ActionEdge[]>();
  for (const action of gated) {
    const key = action.policy.rule || "Unspecified rule";
    byRule.set(key, [...(byRule.get(key) || []), action]);
  }
  const rules = [...byRule.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <section className="flow-reliability-view" aria-label="Policy gates">
      <header className="flow-reliability-heading">
        <div>
          <span className="flow-reliability-eyebrow">
            Recorded policy decisions
          </span>
          <h2>Policy gates</h2>
        </div>
        <span className="flow-reliability-total">
          {gated.length} gated actions
        </span>
      </header>
      <div className="flow-reliability-stats">
        <Stat
          label="Actions gated"
          value={gated.length}
          tone={gated.length ? "warn" : "neutral"}
        />
        <Stat
          label="Policy allowed, executed"
          value={allowed.length}
          tone="good"
        />
        <Stat label="Rules observed" value={rules.length} />
      </div>
      {!gated.length ? (
        <Empty
          title="No policy gates observed"
          detail="No action in this data was skipped or marked as disallowed by policy."
        />
      ) : (
        <div className="flow-reliability-hotspots">
          {rules.map(([rule, group]) => (
            <article className="flow-reliability-hotspot is-policy" key={rule}>
              <div className="flow-reliability-hotspot-head">
                <div>
                  <span className="flow-reliability-route">
                    Recorded policy rule
                  </span>
                  <strong>{pretty(rule)}</strong>
                </div>
                <span className="flow-reliability-policy-count">
                  {group.length} gated
                </span>
              </div>
              <div className="flow-reliability-list">
                {group.slice(0, 5).map((action) => (
                  <SelectButton
                    key={action.id}
                    kind="action"
                    id={action.id}
                    onSelect={onSelect}
                    className="flow-reliability-row"
                  >
                    <span className="flow-reliability-status is-warn">
                      Skipped
                    </span>
                    <span className="flow-reliability-row-main">
                      <strong>
                        {action.targetName || pretty(action.action)}
                      </strong>
                      <small>
                        {action.policy.reason ||
                          "No policy reason was recorded"}
                      </small>
                    </span>
                    <span className="flow-reliability-row-meta">
                      {pathOf(action.beforeUrl)}
                    </span>
                  </SelectButton>
                ))}
                {group.length > 5 && (
                  <p className="flow-reliability-more">
                    {group.length - 5} more gated actions for this rule
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

type TimedObservation = {
  id: string;
  selectId?: string;
  label: string;
  detail: string;
  route: string;
  duration: number;
  kind: "state" | "action";
  failed: boolean;
};

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];

function apiLabel(call: ApiCall) {
  let path = call.url;
  try {
    path = new URL(call.url).pathname;
  } catch {
    /* retain observed URL */
  }
  return `${call.method.toUpperCase()} ${path}`;
}

/** Summarizes recorded action and API durations by source route. */
export function LatencyPathView({
  data,
  states,
  actions,
  onSelect,
}: ReliabilityViewProps) {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const observations: TimedObservation[] = [
    ...actions
      .filter(
        (action) =>
          action.elapsedMs !== undefined && Number.isFinite(action.elapsedMs),
      )
      .map((action) => ({
        id: action.id,
        selectId: action.id,
        label: action.targetName || pretty(action.action),
        detail: `${pretty(action.action)} action${action.error ? ` · ${action.error}` : ""}`,
        route:
          stateById.get(action.fromStateId)?.routeKey ||
          pathOf(action.beforeUrl),
        duration: action.elapsedMs!,
        kind: "action" as const,
        failed: action.decision === "failed",
      })),
    ...data.apiCalls
      .filter(
        (call) =>
          call.durationMs !== undefined && Number.isFinite(call.durationMs),
      )
      .map((call) => {
        const action = call.actionId
          ? actionById.get(call.actionId)
          : undefined;
        const state = call.fromStateId
          ? stateById.get(call.fromStateId)
          : action
            ? stateById.get(action.fromStateId)
            : undefined;
        return {
          id: call.id,
          selectId: action?.id,
          label: apiLabel(call),
          detail: `API ${call.status === undefined ? "status not recorded" : `status ${call.status}`}${call.failed ? " · request failed" : ""}`,
          route: state?.routeKey || pathOf(state?.url || action?.beforeUrl),
          duration: call.durationMs!,
          kind: "action" as const,
          failed:
            call.failed || (call.status !== undefined && call.status >= 400),
        };
      }),
  ];
  const sortedDurations = observations
    .map((item) => item.duration)
    .sort((a, b) => a - b);
  const byRoute = new Map<string, TimedObservation[]>();
  for (const item of observations)
    byRoute.set(item.route, [...(byRoute.get(item.route) || []), item]);
  const routes = [...byRoute.entries()].sort(
    (a, b) =>
      Math.max(...b[1].map((item) => item.duration)) -
      Math.max(...a[1].map((item) => item.duration)),
  );
  const slowest = [...observations]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  return (
    <section className="flow-reliability-view" aria-label="Latency path">
      <header className="flow-reliability-heading">
        <div>
          <span className="flow-reliability-eyebrow">Recorded durations</span>
          <h2>Latency path</h2>
        </div>
        <span className="flow-reliability-total">
          {observations.length} timed observations
        </span>
      </header>
      {!observations.length ? (
        <Empty
          title="No timing data recorded"
          detail="Action elapsed time and API call duration values are absent from the selected run."
        />
      ) : (
        <>
          <div className="flow-reliability-stats">
            <Stat label="Timed observations" value={observations.length} />
            <Stat
              label="Median recorded duration"
              value={ms(percentile(sortedDurations, 0.5))}
            />
            <Stat
              label="Longest recorded duration"
              value={ms(sortedDurations[sortedDurations.length - 1])}
              tone="warn"
            />
            <Stat
              label="Recorded errors"
              value={observations.filter((item) => item.failed).length}
              tone={
                observations.some((item) => item.failed) ? "bad" : "neutral"
              }
            />
          </div>
          <div className="flow-reliability-latency-grid">
            <div className="flow-reliability-panel">
              <h3>By observed route</h3>
              <div className="flow-reliability-route-list">
                {routes.map(([route, items]) => {
                  const values = items
                    .map((item) => item.duration)
                    .sort((a, b) => a - b);
                  return (
                    <div className="flow-reliability-route-metric" key={route}>
                      <div>
                        <strong>{route}</strong>
                        <span>{items.length} timed observations</span>
                      </div>
                      <div className="flow-reliability-route-values">
                        <span>
                          Median <b>{ms(percentile(values, 0.5))}</b>
                        </span>
                        <span>
                          Max <b>{ms(values[values.length - 1])}</b>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flow-reliability-panel">
              <h3>Slowest recorded observations</h3>
              <div className="flow-reliability-list">
                {slowest.map((item) =>
                  item.selectId ? (
                    <SelectButton
                      key={`${item.kind}:${item.id}`}
                      kind={item.kind}
                      id={item.selectId}
                      onSelect={onSelect}
                      className="flow-reliability-row"
                    >
                      <span
                        className={`flow-reliability-duration${item.failed ? " is-bad" : ""}`}
                      >
                        {ms(item.duration)}
                      </span>
                      <span className="flow-reliability-row-main">
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <span className="flow-reliability-row-meta">
                        {item.route}
                      </span>
                    </SelectButton>
                  ) : (
                    <div
                      key={`${item.kind}:${item.id}`}
                      className="flow-reliability-row"
                    >
                      <span
                        className={`flow-reliability-duration${item.failed ? " is-bad" : ""}`}
                      >
                        {ms(item.duration)}
                      </span>
                      <span className="flow-reliability-row-main">
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <span className="flow-reliability-row-meta">
                        {item.route}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
