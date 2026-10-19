import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleHelp,
  Globe2,
  MousePointerClick,
  Network,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type {
  ActionEdge,
  AppState,
  RunData,
  UIElement,
} from "../../../packages/shared/src/index";
import "./flow-execution-analysis.css";

export type FlowExecutionAnalysisViewProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (s: { kind: "state" | "action"; id: string }) => void;
};

type Mode =
  | "outcomes"
  | "policy"
  | "origins"
  | "lifecycle"
  | "effects"
  | "provenance";
const MODES: Array<{
  id: Mode;
  title: string;
  summary: string;
  icon: React.ReactNode;
}> = [
  {
    id: "outcomes",
    title: "Interaction outcome heatmap",
    summary:
      "Counts recorded action outcomes by source route and interaction type. An empty cell means no matching action record was captured.",
    icon: <Activity size={14} />,
  },
  {
    id: "policy",
    title: "Policy impact map",
    summary:
      "Links recorded policy decisions to source routes, controls, and rule names. It reports stored decisions without estimating what would have happened if a policy changed.",
    icon: <ShieldCheck size={14} />,
  },
  {
    id: "origins",
    title: "Origin boundary map",
    summary:
      "Shows network requests captured in the run and compares their origins with the configured app base and allowed origins.",
    icon: <Globe2 size={14} />,
  },
  {
    id: "lifecycle",
    title: "Within-page UI lifecycle",
    summary:
      "Compares component observations across recorded same-route state transitions. This shows snapshot differences, not a continuous DOM lifecycle timeline.",
    icon: <Workflow size={14} />,
  },
  {
    id: "effects",
    title: "Control-to-effect impact",
    summary:
      "Connects discovered controls to actions, action signals, effect flags, and network calls explicitly linked to those actions.",
    icon: <MousePointerClick size={14} />,
  },
  {
    id: "provenance",
    title: "Navigation provenance",
    summary:
      "Connects a screen's observed arrival to a configured start route or recorded action, and uses tab-scoped history and popup signals when available.",
    icon: <Workflow size={14} />,
  },
];

const title = (state?: AppState) =>
  state?.title?.trim() || state?.routeKey || "Untitled screen";
const route = (state?: AppState) => state?.routeKey || "Unknown route";
const host = (raw: string) => {
  try {
    return new URL(raw).host;
  } catch {
    return "Unparseable URL";
  }
};
const hostOnly = (raw?: string) => {
  try {
    return raw ? new URL(raw).host : "";
  } catch {
    return "";
  }
};
const origin = (raw: string) => {
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
};
const outcomeLabel = (decision: ActionEdge["decision"]) =>
  decision === "skipped_policy" ? "policy skipped" : decision;

export function FlowExecutionAnalysisView({
  data,
  states,
  actions,
  onSelect,
}: FlowExecutionAnalysisViewProps) {
  const [mode, setMode] = useState<Mode>("outcomes");
  const [filter, setFilter] = useState("");
  const byState = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const byElement = useMemo(
    () => new Map(data.elements.map((element) => [element.id, element])),
    [data.elements],
  );
  const byAction = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions],
  );
  const callsByAction = useMemo(() => {
    const map = new Map<string, typeof data.apiCalls>();
    data.apiCalls.forEach((call) => {
      if (call.actionId)
        map.set(call.actionId, [...(map.get(call.actionId) ?? []), call]);
    });
    return map;
  }, [data.apiCalls]);
  const setView = (next: Mode) => {
    setMode(next);
    setFilter("");
  };

  return (
    <section className="execution-view">
      <header className="execution-heading">
        <span>
          <Network size={16} />
        </span>
        <div>
          <h2>Execution and impact analysis</h2>
          <p>
            Follow captured actions, policy outcomes, UI snapshots, and network
            evidence.
          </p>
        </div>
        <small>
          {actions.length} actions · {data.apiCalls.length} network records
        </small>
      </header>
      <nav className="execution-tabs" aria-label="Execution analyses">
        {MODES.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={mode === item.id ? "active" : ""}
            title={item.summary}
          >
            {item.icon}
            <span>{item.title}</span>
          </button>
        ))}
      </nav>
      <div className="execution-panel">
        <header className="execution-panel-heading">
          <div>
            <h3>{MODES.find((item) => item.id === mode)?.title}</h3>
            <p>{MODES.find((item) => item.id === mode)?.summary}</p>
          </div>
        </header>
        {states.length === 0 && (
          <Empty title="No screen records">
            Run discovery to collect action and screen evidence.
          </Empty>
        )}
        {states.length > 0 && mode === "outcomes" && (
          <OutcomeHeatmap
            actions={actions}
            byState={byState}
            onSelect={onSelect}
          />
        )}
        {states.length > 0 && mode === "policy" && (
          <PolicyImpact
            actions={actions}
            byState={byState}
            byElement={byElement}
            onSelect={onSelect}
          />
        )}
        {states.length > 0 && mode === "origins" && (
          <OriginBoundary
            data={data}
            actions={actions}
            byState={byState}
            byAction={byAction}
            onSelect={onSelect}
          />
        )}
        {states.length > 0 && mode === "lifecycle" && (
          <WithinPageLifecycle
            data={data}
            actions={actions}
            byState={byState}
            onSelect={onSelect}
          />
        )}
        {states.length > 0 && mode === "effects" && (
          <ControlEffects
            data={data}
            actions={actions}
            byState={byState}
            byElement={byElement}
            callsByAction={callsByAction}
            query={filter}
            setQuery={setFilter}
            onSelect={onSelect}
          />
        )}
        {states.length > 0 && mode === "provenance" && (
          <NavigationProvenance
            data={data}
            states={states}
            actions={actions}
            onSelect={onSelect}
          />
        )}
      </div>
    </section>
  );
}

function OutcomeHeatmap({
  actions,
  byState,
  onSelect,
}: {
  actions: ActionEdge[];
  byState: Map<string, AppState>;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const actionKinds = [
    ...new Set(actions.map((action) => action.action.trim() || "unknown")),
  ].sort();
  const routes = [
    ...new Set(actions.map((action) => route(byState.get(action.fromStateId)))),
  ].sort();
  const matrix = useMemo(() => {
    const cells = new Map<string, ActionEdge[]>();
    actions.forEach((action) => {
      const key = `${route(byState.get(action.fromStateId))}\u0000${action.action.trim() || "unknown"}`;
      cells.set(key, [...(cells.get(key) ?? []), action]);
    });
    return cells;
  }, [actions, byState]);
  if (!actions.length)
    return (
      <Empty title="No interaction records">
        No actions were recorded for these screens.
      </Empty>
    );
  return (
    <div className="execution-scroll">
      <table className="execution-heatmap">
        <thead>
          <tr>
            <th>Route</th>
            {actionKinds.map((kind) => (
              <th key={kind}>{kind}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {routes.map((routeName) => (
            <tr key={routeName}>
              <th>{routeName}</th>
              {actionKinds.map((kind) => {
                const records = matrix.get(`${routeName}\u0000${kind}`) ?? [];
                const counts = { executed: 0, skipped_policy: 0, failed: 0 };
                records.forEach((action) => {
                  counts[action.decision] += 1;
                });
                return (
                  <td
                    key={kind}
                    className={
                      records.length ? `heat-${dominant(counts)}` : "heat-empty"
                    }
                    title={
                      records.length
                        ? `${records.length} recorded action(s): ${counts.executed} executed, ${counts.skipped_policy} policy skipped, ${counts.failed} failed`
                        : "No matching action record captured"
                    }
                  >
                    {records.length ? (
                      <div className="execution-cell">
                        <strong>{records.length}</strong>
                        <span>
                          {counts.executed ? `${counts.executed} run` : ""}
                          {counts.skipped_policy
                            ? `${counts.executed ? " · " : ""}${counts.skipped_policy} blocked`
                            : ""}
                          {counts.failed
                            ? `${counts.executed || counts.skipped_policy ? " · " : ""}${counts.failed} failed`
                            : ""}
                        </span>
                        <div>
                          {records.slice(0, 4).map((action) => (
                            <button
                              key={action.id}
                              onClick={() =>
                                onSelect({ kind: "action", id: action.id })
                              }
                            >
                              {action.targetName || action.action}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="execution-no-record">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="execution-footnote">
        Empty cells indicate no matching action record in this run. They do not
        establish that an interaction is unavailable.
      </p>
    </div>
  );
}
function dominant(counts: {
  executed: number;
  skipped_policy: number;
  failed: number;
}) {
  if (
    counts.failed >= counts.executed &&
    counts.failed >= counts.skipped_policy
  )
    return "failed";
  if (counts.skipped_policy > counts.executed) return "blocked";
  return "run";
}

type TabSignal = { tabId: string; event: string };
type NavigationProvenanceRecord = {
  key: string;
  category: string;
  action?: ActionEdge;
  state?: AppState;
  signals: TabSignal[];
};
function tabSignals(signals: string[]): TabSignal[] {
  return signals.flatMap((signal) => {
    const match = signal.match(/^tab:(tab-\d+):(.+)$/);
    return match ? [{ tabId: match[1], event: match[2] }] : [];
  });
}
function safeLocation(raw?: string) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/$/, "") || "/"}`;
  } catch {
    return "";
  }
}

function NavigationProvenance({
  data,
  states,
  actions,
  onSelect,
}: {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const byState = new Map(states.map((state) => [state.id, state]));
  const byActionId = new Map(actions.map((action) => [action.id, action]));
  const startRoutes = new Set(
    [data.run.config.baseUrl, ...data.run.config.seeds]
      .map(safeLocation)
      .filter(Boolean),
  );
  const incomingActionIds = new Set(
    actions
      .map((action) => action.toStateId)
      .filter((id): id is string => Boolean(id)),
  );
  const provenanceActionIds = new Set(
    states
      .map((state) => state.provenanceActionId)
      .filter((id): id is string => Boolean(id)),
  );
  const records: NavigationProvenanceRecord[] = actions
    .filter((action) =>
      Boolean(
        action.toStateId ||
        action.afterUrl ||
        provenanceActionIds.has(action.id) ||
        tabSignals(action.signals).some(
          (item) =>
            item.event.startsWith("history:") ||
            item.event.startsWith("popup_") ||
            item.event.startsWith("external_navigation"),
        ) ||
        action.browserEvidence?.events.some((event) =>
          [
            "navigation_request",
            "navigation_start",
            "redirect",
            "tab_opened",
            "tab_activated",
          ].includes(event.kind),
        ),
      ),
    )
    .map((action) => {
      const signals = tabSignals(action.signals);
      const popupHandoff = signals.some(
        (item) => item.event === "popup_active",
      );
      const history = signals.filter((item) =>
        item.event.startsWith("history:"),
      );
      const browserEvents = action.browserEvidence?.events || [];
      const redirect = browserEvents.some((item) => item.kind === "redirect");
      const navRequest = browserEvents.find(
        (item) => item.kind === "navigation_request",
      );
      const browserTraversal = browserEvents.find(
        (item) => item.kind === "navigation_start",
      );
      const category = redirect
        ? "redirect response"
        : navRequest
          ? "renderer navigation request"
          : browserTraversal
            ? "browser navigation traversal"
            : popupHandoff
              ? "popup handoff"
              : history.length
                ? "History API"
                : action.toStateId ||
                    action.afterUrl ||
                    provenanceActionIds.has(action.id)
                  ? "action"
                  : "unknown source";
      return {
        key: `action:${action.id}`,
        category,
        action,
        state: action.toStateId ? byState.get(action.toStateId) : undefined,
        signals: [
          ...signals,
          ...browserEvents.flatMap((item) => {
            if (
              ![
                "navigation_request",
                "navigation_start",
                "redirect",
                "tab_opened",
                "tab_activated",
              ].includes(item.kind)
            )
              return [];
            const detail =
              item.kind === "redirect"
                ? `redirect HTTP ${item.status || "unknown"} · ${item.origin || "origin unknown"}`
                : item.kind === "navigation_request"
                  ? `navigation ${item.navigationReason || "reason unknown"} · ${item.disposition || "unknown"}`
                  : item.kind === "navigation_start"
                    ? `browser ${item.navigationType || "unknown"}`
                    : item.kind;
            return [{ tabId: item.tabId || "tab unknown", event: detail }];
          }),
        ],
      };
    });
  states
    .filter((state) => !incomingActionIds.has(state.id))
    .forEach((state) => {
      const matchedAction = state.provenanceActionId
        ? byActionId.get(state.provenanceActionId)
        : undefined;
      if (matchedAction) return;
      const category = startRoutes.has(safeLocation(state.url))
        ? "observed start route"
        : "unknown source";
      records.push({
        key: `state:${state.id}`,
        category,
        action: undefined,
        state,
        signals: [],
      });
    });
  const order = [
    "observed start route",
    "action",
    "History API",
    "popup handoff",
    "renderer navigation request",
    "browser navigation traversal",
    "redirect response",
    "unknown source",
  ];
  records.sort(
    (a, b) =>
      order.indexOf(a.category) - order.indexOf(b.category) ||
      (a.state?.url || a.action?.beforeUrl || "").localeCompare(
        b.state?.url || b.action?.beforeUrl || "",
      ),
  );

  if (!records.length)
    return (
      <Empty title="No navigation provenance evidence">
        No start route or destination action could be matched to the supplied
        screen records.
      </Empty>
    );
  return (
    <>
      <div className="execution-caveat">
        <CircleHelp size={14} /> History and popup categories use tab-scoped
        signals from the action task. Signals are aggregated on an action and do
        not include event timestamps or destination origins.
      </div>
      <div className="execution-record-list">
        {records.map((record) => (
          <article className="execution-provenance-card" key={record.key}>
            <header>
              <span
                className={`execution-provenance-category category-${record.category.replaceAll(" ", "-")}`}
              >
                {record.category}
              </span>
              {record.state ? (
                <button
                  className="execution-state-link"
                  onClick={() =>
                    onSelect({ kind: "state", id: record.state!.id })
                  }
                >
                  {title(record.state)}
                  <small>{route(record.state)}</small>
                </button>
              ) : (
                <span className="execution-unlinked">
                  No destination state was recorded
                </span>
              )}
            </header>
            {record.action && (
              <div className="execution-provenance-action">
                <button
                  className="execution-action-link"
                  onClick={() =>
                    onSelect({ kind: "action", id: record.action!.id })
                  }
                >
                  {record.action.action}: {record.action.targetName}
                </button>
                <span>
                  {safeLocation(record.action.beforeUrl) || "Unknown start URL"}
                  <ArrowRight size={12} />
                  {safeLocation(record.action.afterUrl) ||
                    (record.state
                      ? safeLocation(record.state.url)
                      : "Unknown destination URL") ||
                    "Unknown destination URL"}
                </span>
              </div>
            )}
            {record.state && !record.action && (
              <div className="execution-provenance-action">
                <span>
                  {safeLocation(record.state.url) || "URL unavailable"}
                </span>
                <small>
                  {record.category === "observed start route"
                    ? "Matches a configured base or seed route."
                    : "No linked incoming action record or configured start-route match."}
                </small>
              </div>
            )}
            {record.action && (
              <div className="execution-provenance-signals">
                {record.signals.length ? (
                  record.signals.map((signal, index) => (
                    <span key={`${signal.tabId}:${signal.event}:${index}`}>
                      <small>{signal.tabId}</small>
                      {formatNavigationSignal(signal.event)}
                    </span>
                  ))
                ) : (
                  <small>
                    No tab-scoped history, popup, or external-navigation signal
                    was recorded.
                  </small>
                )}
                {record.action.signals.includes("external_navigation") && (
                  <span className="execution-external-mark">
                    External navigation was blocked; target origin is not
                    included.
                  </span>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
function formatNavigationSignal(event: string) {
  if (event.startsWith("history:"))
    return `History API · ${event.slice("history:".length)}`;
  if (event === "popup_opened") return "Popup opened";
  if (event === "popup_active") return "Popup became active";
  if (event === "external_navigation") return "External navigation observed";
  if (event === "external_navigation_blocked")
    return "External navigation blocked";
  return event;
}

function PolicyImpact({
  actions,
  byState,
  byElement,
  onSelect,
}: {
  actions: ActionEdge[];
  byState: Map<string, AppState>;
  byElement: Map<string, UIElement>;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const [selectedRule, setSelectedRule] = useState("all");
  const policyRecords = actions.filter(
    (action) =>
      Boolean(action.policy?.rule) || action.decision === "skipped_policy",
  );
  const rules = [
    ...new Set(
      policyRecords.map((action) => action.policy?.rule || "Unspecified rule"),
    ),
  ].sort();
  const filtered = policyRecords.filter(
    (action) =>
      selectedRule === "all" ||
      (action.policy?.rule || "Unspecified rule") === selectedRule,
  );
  const summary = new Map<
    string,
    {
      count: number;
      routes: Set<string>;
      controls: Set<string>;
      decisions: Set<string>;
    }
  >();
  policyRecords.forEach((action) => {
    const key = action.policy?.rule || "Unspecified rule";
    const row = summary.get(key) ?? {
      count: 0,
      routes: new Set(),
      controls: new Set(),
      decisions: new Set(),
    };
    row.count++;
    row.routes.add(route(byState.get(action.fromStateId)));
    row.controls.add(
      byElement.get(action.elementId)?.accessibleName ||
        action.targetName ||
        "Unnamed control",
    );
    row.decisions.add(outcomeLabel(action.decision));
    summary.set(key, row);
  });
  return (
    <>
      <div className="execution-summary-strip">
        <Metric
          value={policyRecords.length}
          label="actions with policy evidence"
        />
        <Metric value={rules.length} label="recorded rule labels" />
        <Metric
          value={
            policyRecords.filter(
              (action) => action.decision === "skipped_policy",
            ).length
          }
          label="skipped by policy"
        />
      </div>
      {!policyRecords.length ? (
        <Empty title="No policy decision records">
          No action contains a policy rule label or policy-skipped outcome.
        </Empty>
      ) : (
        <>
          <label className="execution-filter">
            Rule
            <select
              value={selectedRule}
              onChange={(event) => setSelectedRule(event.target.value)}
            >
              <option value="all">All recorded rules</option>
              {rules.map((rule) => (
                <option key={rule}>{rule}</option>
              ))}
            </select>
          </label>
          <div className="execution-rule-list">
            {[...summary.entries()].map(([rule, row]) => (
              <button
                key={rule}
                className={`execution-rule-summary ${selectedRule === rule ? "selected" : ""}`}
                onClick={() =>
                  setSelectedRule(selectedRule === rule ? "all" : rule)
                }
              >
                <strong>{rule}</strong>
                <span>{row.count} actions</span>
                <small>
                  {row.routes.size} routes · {row.controls.size} controls ·{" "}
                  {Array.from(row.decisions).join(", ")}
                </small>
              </button>
            ))}
          </div>
          <div className="execution-record-list">
            {filtered.map((action) => (
              <ActionEvidence
                key={action.id}
                action={action}
                state={byState.get(action.fromStateId)}
                element={byElement.get(action.elementId)}
                onSelect={onSelect}
              >
                <div className="execution-policy-copy">
                  <span>
                    {action.policy?.allowed ? "Allowed" : "Not allowed"} ·{" "}
                    {action.policy?.rule || "Unspecified rule"}
                  </span>
                  <small>
                    {action.policy?.reason || "No policy reason recorded"}
                  </small>
                </div>
              </ActionEvidence>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function OriginBoundary({
  data,
  actions,
  byState,
  byAction,
  onSelect,
}: {
  data: RunData;
  actions: ActionEdge[];
  byState: Map<string, AppState>;
  byAction: Map<string, ActionEdge>;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const baseOrigin = origin(data.run.config.baseUrl);
  const baseHost = hostOnly(baseOrigin);
  const allowed = new Set([
    baseOrigin,
    ...(data.run.config.allowedOrigins ?? []).map(origin),
  ]);
  const states = [...byState.values()];
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { calls: typeof data.apiCalls; configured: boolean }
    >();
    data.apiCalls.forEach((call) => {
      const key = hostOnly(call.url) || "Unknown API host";
      const row = groups.get(key) ?? {
        calls: [],
        configured: allowed.has(origin(call.url)),
      };
      row.calls.push(call);
      groups.set(key, row);
    });
    return [...groups.entries()]
      .map(([service, captured]) => ({
        service,
        calls: captured.calls,
        kind: captured.configured
          ? "configured app origin"
          : "other observed origin",
      }))
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.service.localeCompare(b.service),
      );
  }, [data.apiCalls, baseOrigin, data.run.config.allowedOrigins]);
  const linkedCalls = data.apiCalls.filter((call) => call.actionId);
  const unlinkedCalls = data.apiCalls.filter((call) => !call.actionId);
  const boundarySignals = actions.flatMap((action) =>
    tabSignals(action.signals)
      .filter((signal) => signal.event.startsWith("external_navigation"))
      .map((signal) => ({ action, signal })),
  );
  const routeMap = useMemo(() => {
    type Boundary = {
      kind: "host-change" | "blocked-host" | "observed-origin" | "unknown";
      fromHost?: string;
      toHost?: string;
      tabId?: string;
      action: ActionEdge;
    };
    type RouteRow = {
      states: AppState[];
      services: Map<string, typeof data.apiCalls>;
      boundaries: Boundary[];
    };
    const rows = new Map<string, RouteRow>();
    const rowFor = (name: string) => {
      const row = rows.get(name) ?? {
        states: [],
        services: new Map<string, typeof data.apiCalls>(),
        boundaries: [],
      };
      rows.set(name, row);
      return row;
    };
    states.forEach((state) => rowFor(route(state)).states.push(state));
    data.apiCalls.forEach((call) => {
      const action = call.actionId ? byAction.get(call.actionId) : undefined;
      const state =
        (call.fromStateId ? byState.get(call.fromStateId) : undefined) ||
        (action ? byState.get(action.fromStateId) : undefined);
      const row = rowFor(state ? route(state) : "Unknown source route");
      const service = hostOnly(call.url) || "Unknown API host";
      row.services.set(service, [...(row.services.get(service) ?? []), call]);
    });
    actions.forEach((action) => {
      const state = byState.get(action.fromStateId);
      const row = rowFor(state ? route(state) : "Unknown source route");
      const beforeHost = hostOnly(action.beforeUrl);
      const afterHost = hostOnly(action.afterUrl);
      const signals = tabSignals(action.signals);
      const directBoundary = Boolean(
        beforeHost &&
        afterHost &&
        beforeHost.toLowerCase() !== afterHost.toLowerCase(),
      );
      if (directBoundary)
        row.boundaries.push({
          kind: "host-change",
          fromHost: beforeHost,
          toHost: afterHost,
          action,
        });
      const blockedHosts = [
        ...new Set(
          action.signals.flatMap((signal) => {
            if (!signal.startsWith("blocked_origin:")) return [];
            const captured = signal.slice("blocked_origin:".length);
            return [hostOnly(captured) || "Unknown blocked host"];
          }),
        ),
      ];
      blockedHosts.forEach((blockedHost) =>
        row.boundaries.push({
          kind: "blocked-host",
          toHost: blockedHost,
          action,
        }),
      );
      const browserOrigins = [
        ...new Set(
          (action.browserEvidence?.events || [])
            .filter(
              (event) =>
                event.kind === "network_request" ||
                event.kind === "network_response",
            )
            .map((event) => (event.origin ? hostOnly(event.origin) : ""))
            .filter(
              (host) => host && host.toLowerCase() !== baseHost.toLowerCase(),
            ),
        ),
      ];
      browserOrigins.forEach((origin) =>
        row.boundaries.push({
          kind: "observed-origin",
          fromHost: beforeHost || undefined,
          toHost: origin,
          action,
        }),
      );
      const navigationSignals = signals.filter((signal) =>
        signal.event.startsWith("external_navigation"),
      );
      if (!directBoundary && navigationSignals.length)
        navigationSignals.forEach((signal) =>
          row.boundaries.push({
            kind: "unknown",
            fromHost: beforeHost || undefined,
            tabId: signal.tabId,
            action,
          }),
        );
    });
    return [...rows.entries()]
      .map(([routeName, row]) => ({ routeName, ...row }))
      .sort((a, b) => a.routeName.localeCompare(b.routeName));
  }, [states, data.apiCalls, actions, byState, byAction]);
  return (
    <>
      <div className="execution-boundary-summary">
        <div>
          <small>Configured base origin</small>
          <strong>{baseOrigin || "Not available"}</strong>
        </div>
        <Metric
          value={data.apiCalls.length}
          label="captured network requests"
        />
        <Metric value={linkedCalls.length} label="linked to an action" />
        <Metric value={unlinkedCalls.length} label="not linked to an action" />
      </div>
      <section className="execution-route-origin-map">
        <header>
          <Globe2 size={14} />
          <strong>Route to origin boundaries</strong>
          <small>
            Routes, API hosts, and navigation boundaries linked only where
            source evidence exists.
          </small>
        </header>
        {routeMap.length ? (
          <div className="execution-route-origin-list">
            {routeMap.map((row) => (
              <article
                className="execution-route-origin-row"
                key={row.routeName}
              >
                <div className="execution-route-origin-source">
                  <span>In-app source route</span>
                  <strong>{row.routeName}</strong>
                  <div>
                    {row.states.length ? (
                      row.states.slice(0, 6).map((state) => (
                        <button
                          key={state.id}
                          onClick={() =>
                            onSelect({ kind: "state", id: state.id })
                          }
                        >
                          {title(state)}
                        </button>
                      ))
                    ) : (
                      <small>Unknown source state</small>
                    )}
                    {row.states.length > 6 && (
                      <small>+{row.states.length - 6} more states</small>
                    )}
                  </div>
                </div>
                <ArrowRight size={14} />
                <div className="execution-route-origin-targets">
                  <section>
                    <strong>
                      Captured API hosts / services ({row.services.size})
                    </strong>
                    {row.services.size ? (
                      [...row.services.entries()].map(([service, calls]) => (
                        <div className="execution-origin-chip" key={service}>
                          <span
                            className={
                              calls.some((call) =>
                                allowed.has(origin(call.url)),
                              )
                                ? "origin-configured"
                                : "origin-other"
                            }
                          >
                            <Globe2 size={11} />
                            {service}
                          </span>
                          <small>
                            {calls.length} request
                            {calls.length === 1 ? "" : "s"}
                          </small>
                          <div>
                            {calls.slice(0, 3).map((call) => {
                              const action = call.actionId
                                ? byAction.get(call.actionId)
                                : undefined;
                              const state =
                                (call.fromStateId
                                  ? byState.get(call.fromStateId)
                                  : undefined) ||
                                (action
                                  ? byState.get(action.fromStateId)
                                  : undefined);
                              return action ? (
                                <button
                                  key={call.id}
                                  onClick={() =>
                                    onSelect({ kind: "action", id: action.id })
                                  }
                                >
                                  {action.action}
                                </button>
                              ) : state ? (
                                <button
                                  key={call.id}
                                  onClick={() =>
                                    onSelect({ kind: "state", id: state.id })
                                  }
                                >
                                  {title(state)}
                                </button>
                              ) : (
                                <small key={call.id}>Source link unknown</small>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <small>No captured API host linked to this route.</small>
                    )}
                  </section>
                  <section>
                    <strong>
                      External navigation / boundary evidence (
                      {row.boundaries.length})
                    </strong>
                    {row.boundaries.length ? (
                      row.boundaries.map((boundary, index) => (
                        <div
                          className={`execution-origin-boundary-chip boundary-${boundary.kind}`}
                          key={`${boundary.action.id}:${boundary.kind}:${index}`}
                        >
                          <span>
                            {boundary.kind === "host-change"
                              ? `${boundary.fromHost} → ${boundary.toHost}`
                              : boundary.kind === "blocked-host"
                                ? `Blocked host signal · ${boundary.toHost}`
                                : boundary.kind === "observed-origin"
                                  ? `${boundary.fromHost || "Action origin"} → ${boundary.toHost}`
                                  : `${boundary.fromHost ? `${boundary.fromHost} → ` : ""}Unknown destination${boundary.tabId ? ` · ${boundary.tabId}` : ""}`}
                          </span>
                          <small>
                            {boundary.kind === "host-change"
                              ? "Observed in captured before/after URLs"
                              : boundary.kind === "blocked-host"
                                ? "Host comes from a captured blocked_origin signal"
                                : boundary.kind === "observed-origin"
                                  ? "Browser request origin observed; request path and payload are not stored in this evidence"
                                  : "External navigation signal had no captured destination host"}
                          </small>
                          <button
                            onClick={() =>
                              onSelect({
                                kind: "action",
                                id: boundary.action.id,
                              })
                            }
                          >
                            {boundary.action.action}:{" "}
                            {boundary.action.targetName || "action"}
                          </button>
                        </div>
                      ))
                    ) : (
                      <small>
                        No external host comparison or navigation signal was
                        captured for this route.
                      </small>
                    )}
                  </section>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No route evidence">
            No in-app routes were captured for this boundary map.
          </Empty>
        )}
        <p>
          Unknown means the discovery record did not contain a source or
          destination link. No external destination is inferred from a signal
          alone.
        </p>
      </section>
      {!data.apiCalls.length ? (
        <Empty title="No network call records">
          This run contains no captured API call records; this does not mean the
          app made no requests.
        </Empty>
      ) : (
        <div className="execution-origin-groups">
          {grouped.map((group) => (
            <article key={group.service} className="execution-origin-group">
              <header>
                <span
                  className={
                    group.kind === "configured app origin"
                      ? "origin-configured"
                      : "origin-other"
                  }
                >
                  <Globe2 size={13} />
                  {group.kind}
                </span>
                <strong>{group.service}</strong>
                <small>{group.calls.length} requests</small>
              </header>
              <div className="execution-network-list">
                {group.calls.slice(0, 80).map((call) => {
                  const action = call.actionId
                    ? byAction.get(call.actionId)
                    : undefined;
                  const state =
                    (call.fromStateId
                      ? byState.get(call.fromStateId)
                      : undefined) ||
                    (action ? byState.get(action.fromStateId) : undefined);
                  return (
                    <div key={call.id} className="execution-network-row">
                      <span className="execution-method">{call.method}</span>
                      <span
                        className="execution-network-url"
                        title={hostOnly(call.url) || "Unknown API host"}
                      >
                        {hostOnly(call.url) || "Unknown API host"}
                      </span>
                      <span className="execution-network-meta">
                        {call.resourceType}
                        {call.status !== undefined ? ` · ${call.status}` : ""}
                        {call.failed ? " · failed" : ""}
                      </span>
                      {state && (
                        <button
                          onClick={() =>
                            onSelect({ kind: "state", id: state.id })
                          }
                          title={title(state)}
                        >
                          {route(state)}
                        </button>
                      )}
                      {action ? (
                        <button
                          className="execution-action-link"
                          onClick={() =>
                            onSelect({ kind: "action", id: action.id })
                          }
                        >
                          {action.action}: {action.targetName}
                        </button>
                      ) : (
                        <span className="execution-unlinked">
                          {call.actionId
                            ? "Action record unavailable"
                            : "Unlinked request"}
                        </span>
                      )}
                    </div>
                  );
                })}
                {group.calls.length > 80 && (
                  <div className="execution-network-truncated">
                    Showing 80 of {group.calls.length} requests for this host.
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {boundarySignals.length > 0 && (
        <section className="execution-boundary-signals">
          <header>
            <strong>Tab-scoped external navigation signals</strong>
            <small>
              {boundarySignals.length} recorded signal
              {boundarySignals.length === 1 ? "" : "s"}
            </small>
          </header>
          <p>
            Signals identify the tab and event only; they do not contain the
            destination origin.
          </p>
          {boundarySignals.map(({ action, signal }, index) => (
            <div key={`${action.id}:${signal.tabId}:${signal.event}:${index}`}>
              <span>{signal.tabId}</span>
              <strong>
                {signal.event === "external_navigation_blocked"
                  ? "External navigation blocked"
                  : "External main-frame navigation observed"}
              </strong>
              <button
                onClick={() => onSelect({ kind: "action", id: action.id })}
              >
                {action.action}: {action.targetName}
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function WithinPageLifecycle({
  data,
  actions,
  byState,
  onSelect,
}: {
  data: RunData;
  actions: ActionEdge[];
  byState: Map<string, AppState>;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const componentsByState = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data.components.forEach((component) => {
      const key =
        component.familyId ||
        `${component.kind}:${component.name.trim().toLowerCase()}`;
      map.set(
        component.stateId,
        new Set([...(map.get(component.stateId) ?? []), key]),
      );
    });
    return map;
  }, [data.components]);
  const transitions = actions.flatMap((action) => {
    if (action.decision !== "executed" || !action.toStateId) return [];
    const from = byState.get(action.fromStateId),
      to = byState.get(action.toStateId);
    if (!from || !to || route(from) !== route(to)) return [];
    const before = componentsByState.get(from.id) ?? new Set<string>(),
      after = componentsByState.get(to.id) ?? new Set<string>();
    const hasBefore = data.components.some(
        (component) => component.stateId === from.id,
      ),
      hasAfter = data.components.some(
        (component) => component.stateId === to.id,
      );
    return [
      {
        action,
        from,
        to,
        hasBefore,
        hasAfter,
        added:
          hasBefore && hasAfter
            ? [...after].filter((key) => !before.has(key))
            : [],
        missing:
          hasBefore && hasAfter
            ? [...before].filter((key) => !after.has(key))
            : [],
      },
    ];
  });
  return (
    <>
      {!data.components.length && (
        <div className="execution-caveat">
          <CircleHelp size={14} /> Component snapshots are unavailable, so
          component-level differences cannot be compared.
        </div>
      )}
      {transitions.length ? (
        <div className="execution-record-list">
          {transitions.map(
            ({ action, from, to, hasBefore, hasAfter, added, missing }) => (
              <article key={action.id} className="execution-lifecycle">
                <div className="execution-lifecycle-transition">
                  <StateLink state={from} onSelect={onSelect} />
                  <ActionLink action={action} onSelect={onSelect} />
                  <StateLink state={to} onSelect={onSelect} />
                </div>
                {hasBefore && hasAfter ? (
                  <div className="execution-diff-columns">
                    <div>
                      <strong>
                        Families recorded in destination ({added.length} newly
                        observed)
                      </strong>
                      {added.length ? (
                        added.map((key) => (
                          <span key={key} className="diff-added">
                            + {key}
                          </span>
                        ))
                      ) : (
                        <small>
                          No additional family recorded compared with source
                        </small>
                      )}
                    </div>
                    <div>
                      <strong>
                        Families recorded only in source ({missing.length})
                      </strong>
                      {missing.length ? (
                        missing.map((key) => (
                          <span key={key} className="diff-removed">
                            − {key}
                          </span>
                        ))
                      ) : (
                        <small>No source-only family recorded</small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="execution-caveat">
                    <CircleHelp size={14} />
                    {!hasBefore
                      ? "No component records were captured for the source state."
                      : "No component records were captured for the destination state."}{" "}
                    Snapshot comparison is unavailable for this transition.
                  </div>
                )}
                <p>
                  Both captured states use route key{" "}
                  <strong>{route(from)}</strong>. Family matching uses stored
                  family IDs or normalized names.
                </p>
              </article>
            ),
          )}
        </div>
      ) : (
        <Empty title="No same-route state transitions">
          This run has no successful linked action between two captured states
          sharing the same route key.
        </Empty>
      )}
    </>
  );
}

function ControlEffects({
  data,
  actions,
  byState,
  byElement,
  callsByAction,
  query,
  setQuery,
  onSelect,
}: {
  data: RunData;
  actions: ActionEdge[];
  byState: Map<string, AppState>;
  byElement: Map<string, UIElement>;
  callsByAction: Map<string, typeof data.apiCalls>;
  query: string;
  setQuery: (value: string) => void;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  const rows = actions
    .map((action) => ({
      action,
      state: byState.get(action.fromStateId),
      element: byElement.get(action.elementId),
      calls: callsByAction.get(action.id) ?? [],
    }))
    .filter((row) => {
      const text = [
        row.state?.title,
        row.state?.routeKey,
        row.element?.accessibleName,
        row.element?.textSnippet,
        row.action.targetName,
        row.action.action,
        ...row.action.effectFlags,
        ...row.action.signals,
      ]
        .join(" ")
        .toLowerCase();
      return !query || text.includes(query.trim().toLowerCase());
    });
  return (
    <>
      <label className="execution-search">
        <MousePointerClick size={13} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by route, control, effect, or signal"
        />
      </label>
      {!actions.length ? (
        <Empty title="No actions recorded">
          No controls can be linked to action outcomes or effects.
        </Empty>
      ) : rows.length ? (
        <div className="execution-record-list">
          {rows.map(({ action, state, element, calls }) => (
            <article className="execution-effect-card" key={action.id}>
              <ActionEvidence
                action={action}
                state={state}
                element={element}
                onSelect={onSelect}
              >
                <span
                  className={`execution-decision decision-${action.decision}`}
                >
                  {outcomeLabel(action.decision)}
                </span>
              </ActionEvidence>
              <div className="execution-effect-columns">
                <div>
                  <strong>Recorded signals</strong>
                  {action.effectFlags.length || action.signals.length ? (
                    <>
                      {action.effectFlags.map((flag) => (
                        <span key={`effect:${flag}`} className="execution-tag">
                          Effect: {flag}
                        </span>
                      ))}
                      {action.signals.map((signal, index) => (
                        <span
                          key={`signal:${index}:${signal}`}
                          className="execution-tag tag-signal"
                        >
                          {signal}
                        </span>
                      ))}
                    </>
                  ) : (
                    <small>
                      No effect flags or signals stored for this action.
                    </small>
                  )}
                </div>
                <div>
                  <strong>Linked network calls ({calls.length})</strong>
                  {calls.length ? (
                    calls.map((call) => (
                      <div key={call.id} className="execution-call">
                        <span>
                          {call.method} · {host(call.url)}
                        </span>
                        <small>
                          {call.resourceType}
                          {call.status !== undefined ? ` · ${call.status}` : ""}
                          {call.failed ? " · failed" : ""}
                        </small>
                      </div>
                    ))
                  ) : (
                    <small>
                      No API call record links to this action ID. Other calls
                      may be unlinked.
                    </small>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No matching action evidence">
          Try a different route, control, effect, or signal.
        </Empty>
      )}
    </>
  );
}

function ActionEvidence({
  action,
  state,
  element,
  onSelect,
  children,
}: {
  action: ActionEdge;
  state?: AppState;
  element?: UIElement;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
  children?: React.ReactNode;
}) {
  return (
    <div className="execution-action-evidence">
      <div className="execution-evidence-context">
        {state ? (
          <button onClick={() => onSelect({ kind: "state", id: state.id })}>
            {route(state)} · {title(state)}
          </button>
        ) : (
          <span>Source state unavailable</span>
        )}
        <ArrowRight size={12} />
        {element ? (
          <button
            onClick={() => onSelect({ kind: "state", id: element.stateId })}
          >
            {element.accessibleName ||
              element.textSnippet ||
              element.tag ||
              "Unnamed control"}{" "}
            <small>({element.role})</small>
          </button>
        ) : (
          <span>{action.targetName || "Unnamed control"}</span>
        )}
      </div>
      <button
        className="execution-action-button"
        onClick={() => onSelect({ kind: "action", id: action.id })}
      >
        <MousePointerClick size={13} />
        {action.action} · {action.targetName || "target"}
        <small>{outcomeLabel(action.decision)}</small>
      </button>
      {children}
    </div>
  );
}
function StateLink({
  state,
  onSelect,
}: {
  state: AppState;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  return (
    <button
      className="execution-state-link"
      onClick={() => onSelect({ kind: "state", id: state.id })}
    >
      {title(state)}
      <small>{route(state)}</small>
    </button>
  );
}
function ActionLink({
  action,
  onSelect,
}: {
  action: ActionEdge;
  onSelect: FlowExecutionAnalysisViewProps["onSelect"];
}) {
  return (
    <button
      className="execution-action-link"
      onClick={() => onSelect({ kind: "action", id: action.id })}
    >
      {action.action}: {action.targetName || "control"}
    </button>
  );
}
function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="execution-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="execution-empty">
      <CircleHelp size={17} />
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
