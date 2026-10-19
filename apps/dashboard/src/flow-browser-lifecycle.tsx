import React, { useMemo, useState } from "react";
import { Activity, CircleHelp, ShieldCheck } from "lucide-react";
import type { ActionEdge } from "../../../packages/shared/src/index";
import "./flow-browser-lifecycle.css";

export type FlowBrowserLifecycleViewProps = {
  actions: ActionEdge[];
  onSelect?: (s: { kind: "action"; id: string }) => void;
};

type Cue = { category: string; value: string; kind?: string; raw: string };
type LifecycleAction = { action: ActionEdge; cues: Cue[]; inferred: string[] };
type Filter = "all" | "observed" | "unknown";
const TIMING_KINDS = [
  ["navigation_duration_ms", "Navigation duration"],
  ["dom_content_loaded_ms", "DOMContentLoaded"],
  ["load_ms", "Load event"],
  ["first_paint_ms", "First Paint"],
  ["first_contentful_paint_ms", "First Contentful Paint"],
] as const;

function parseCue(raw: string): Cue | undefined {
  const match = raw.match(
    /^tab:tab-\d+:lifecycle:(document|navigation|aria_busy|alert|live_region):([a-z_]+)$/,
  );
  if (match) return { category: match[1], value: match[2], raw };
  const permission = raw.match(
    /^tab:tab-\d+:lifecycle:(permission_query|permission_request):([a-z-]+):(prompt|granted|denied|other)$/,
  );
  if (permission)
    return {
      category: permission[1],
      kind: permission[2],
      value: permission[3],
      raw,
    };
  const timing = raw.match(
    /^tab:tab-\d+:lifecycle:timing:(navigation_duration_ms|dom_content_loaded_ms|load_ms|first_paint_ms|first_contentful_paint_ms):(\d{1,8})$/,
  );
  if (timing && Number(timing[2]) <= 86_400_000)
    return { category: "timing", kind: timing[1], value: timing[2], raw };
  return undefined;
}

function cueLabel(cue: Cue) {
  if (cue.category === "document") return `Document ready state · ${cue.value}`;
  if (cue.category === "navigation")
    return `Performance navigation type · ${cue.value.replace("_", " ")}`;
  if (cue.category === "aria_busy") return `aria-busy · ${cue.value}`;
  if (cue.category === "alert") return `Visible alert · ${cue.value}`;
  if (cue.category === "live_region")
    return `Visible live region · ${cue.value}`;
  if (cue.category === "timing") {
    const name =
      TIMING_KINDS.find(([kind]) => kind === cue.kind)?.[1] ||
      "Rendering timing";
    return `Browser timing · ${name} · ${cue.value} ms`;
  }
  const operation =
    cue.category === "permission_query"
      ? "Permission state queried"
      : "Permission request outcome";
  return `${operation} · ${cue.kind} · ${cue.value}`;
}

function inferLabels(cues: Cue[]) {
  const labels: string[] = [];
  const values = (category: string) =>
    cues.filter((cue) => cue.category === category).map((cue) => cue.value);
  if (values("navigation").includes("back_forward"))
    labels.push("History restoration lifecycle observed");
  if (values("navigation").includes("reload"))
    labels.push("Reload lifecycle observed");
  if (values("navigation").includes("navigate"))
    labels.push("New navigation lifecycle observed");
  if (
    values("document").includes("interactive") &&
    values("document").includes("complete")
  )
    labels.push("Document readiness progressed to complete");
  if (
    values("alert").includes("present") ||
    values("live_region").includes("present")
  )
    labels.push("Visible feedback cue observed");
  if (
    values("aria_busy").includes("present") &&
    values("aria_busy").includes("absent")
  )
    labels.push("Busy cue changed during the action window");
  return labels;
}

function evidenceEventLabel(
  event: NonNullable<ActionEdge["browserEvidence"]>["events"][number],
) {
  const count =
    event.count && event.count > 1 ? ` · ${event.count} observed` : "";
  switch (event.kind) {
    case "navigation_request":
      return `Navigation requested · ${event.navigationReason || "reason unknown"} · ${event.disposition || "disposition unknown"}${count}`;
    case "navigation_start":
      return `Navigation started · ${event.navigationType || "type unknown"}${count}`;
    case "redirect":
      return `Redirect hop · HTTP ${event.status ?? "unknown"} · ${event.origin || "origin unknown"}${count}`;
    case "network_request":
      return `Request · ${event.method || "method unknown"} ${event.resourceType || "resource"} · ${event.origin || "origin unknown"}${count}`;
    case "network_response":
      return `Response · HTTP ${event.status ?? (event.failed ? "failed" : "unknown")} · ${event.origin || "origin unknown"}${count}`;
    case "tab_opened":
      return `Tab opened · ${event.tabId || "unknown tab"}${event.parentTabId ? ` from ${event.parentTabId}` : ""}`;
    case "tab_closed":
      return `Tab closed · ${event.tabId || "unknown tab"}`;
    case "tab_activated":
      return `Tab activated · ${event.tabId || "unknown tab"}${event.parentTabId ? ` from ${event.parentTabId}` : ""}`;
    case "download":
      return `Download · ${event.outcome || "observed"}${count}`;
    case "dialog":
      return `Browser dialog · ${event.dialogType || "unknown"} · ${event.outcome || "observed"}`;
    case "permission_query":
      return `Permission API status query · ${event.permission || "other"} · ${event.permissionState || "state unknown"}`;
    case "permission_request":
      return `Permission API request · ${event.permission || "other"} · ${event.permissionState || "state unknown"}`;
  }
}

function snapshotRows(
  snapshot: NonNullable<ActionEdge["browserEvidence"]>["before"],
  after: NonNullable<ActionEdge["browserEvidence"]>["after"],
) {
  const values = [
    ["History length", "historyLength"],
    ["Navigation entry index", "navigationEntryIndex"],
    ["Forms", "formCount"],
    ["Visible fields", "fieldCount"],
    ["Native invalid fields", "invalidFieldCount"],
    ["Search controls", "searchControlCount"],
    ["Filter controls", "filterControlCount"],
    ["Result candidates", "resultItemCount"],
    ["Busy regions", "busyCount"],
    ["Alerts", "alertCount"],
    ["Status regions", "statusCount"],
    ["Empty-state cues", "emptyCueCount"],
    ["Success-like status cues", "successCueCount"],
    ["Error-like status cues", "errorCueCount"],
    ["Sign-in controls", "signInControlCount"],
    ["Sign-out controls", "signOutControlCount"],
    ["Password fields", "passwordControlCount"],
    ["Identifier fields", "identifierControlCount"],
    ["Local storage entries", "localStorageEntryCount"],
    ["Session storage entries", "sessionStorageEntryCount"],
    ["Cookies", "cookieCount"],
    ["Secure cookies", "secureCookieCount"],
    ["HTTP-only cookies", "httpOnlyCookieCount"],
    ["Session cookies", "sessionCookieCount"],
  ] as const;
  return values.map(([label, key]) => ({
    label,
    before: snapshot[key],
    after: after[key],
  }));
}

export function FlowBrowserLifecycleView({
  actions,
  onSelect,
}: FlowBrowserLifecycleViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const records = useMemo<LifecycleAction[]>(
    () =>
      actions.map((action) => {
        const cues = action.signals
          .map(parseCue)
          .filter((cue): cue is Cue => Boolean(cue));
        const inferred = inferLabels(cues);
        const evidence = action.browserEvidence;
        if (evidence) {
          const { before, after } = evidence;
          if (after.invalidFieldCount < before.invalidFieldCount)
            inferred.push(
              "Fewer native-invalid fields after the action (observed counts)",
            );
          if (
            after.alertCount > before.alertCount ||
            after.statusCount > before.statusCount
          )
            inferred.push(
              "A live status or alert region appeared after the action",
            );
          if (after.emptyCueCount > before.emptyCueCount)
            inferred.push(
              "An empty-state cue appeared after the action (selector heuristic)",
            );
          if (after.errorCueCount > before.errorCueCount)
            inferred.push(
              "Error-like wording appeared in a status region (classified locally; wording not stored)",
            );
          if (after.successCueCount > before.successCueCount)
            inferred.push(
              "Success-like wording appeared in a status region (classified locally; wording not stored)",
            );
        }
        return { action, cues, inferred };
      }),
    [actions],
  );
  const hasEvidence = (record: LifecycleAction) =>
    record.cues.length > 0 || Boolean(record.action.browserEvidence);
  const observedCount = records.filter(hasEvidence).length;
  const visible = records.filter(
    (record) =>
      filter === "all" ||
      (filter === "observed" ? hasEvidence(record) : !hasEvidence(record)),
  );

  return (
    <section className="browser-life">
      <header className="browser-life-heading">
        <span className="browser-life-heading-icon">
          <Activity size={17} />
        </span>
        <div>
          <h2>Browser lifecycle evidence</h2>
          <p>
            Fixed browser, UI, and rendering cues recorded during each action.
            Missing timing entries stay unknown.
          </p>
        </div>
        <span className="browser-life-count">
          {observedCount} of {actions.length} actions with lifecycle cues
        </span>
      </header>
      <div className="browser-life-note">
        <CircleHelp size={15} />
        <span>
          Event origins are browser-observed origins, and repeated network
          events are grouped by origin, method, resource type, and response.
          Renderer navigation reasons and Chromium traversal types improve
          source attribution, but “other” and history traversal do not prove
          which browser UI control was used. The UI status labels are local
          classifications, not page text saved as evidence.
        </span>
      </div>
      <div className="browser-life-note browser-life-privacy">
        <ShieldCheck size={15} />
        <span>
          Stored evidence contains aggregate counts, fixed event categories,
          origins, and statuses. URL paths and query strings, page text, field
          values, cookie names/contents, and request headers/bodies are
          excluded. Status text is classified inside the page and discarded.
        </span>
      </div>
      <nav
        className="browser-life-filters"
        aria-label="Lifecycle evidence filter"
      >
        {(["all", "observed", "unknown"] as const).map((value) => (
          <button
            key={value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {value === "all"
              ? `All actions · ${actions.length}`
              : value === "observed"
                ? `With cues · ${observedCount}`
                : `Unknown · ${actions.length - observedCount}`}
          </button>
        ))}
      </nav>
      {!actions.length ? (
        <div className="browser-life-empty">
          <strong>No action records</strong>
          <span>
            Run discovery to collect action-window lifecycle evidence.
          </span>
        </div>
      ) : !visible.length ? (
        <div className="browser-life-empty">
          <strong>No matching actions</strong>
          <span>Change the filter to see another group.</span>
        </div>
      ) : (
        <div className="browser-life-list">
          {visible.map(({ action, cues, inferred }) => (
            <article className="browser-life-card" key={action.id}>
              <header className="browser-life-card-head">
                {onSelect ? (
                  <button
                    onClick={() => onSelect({ kind: "action", id: action.id })}
                  >
                    {action.action} · {action.targetName || "Unnamed control"}
                  </button>
                ) : (
                  <strong>
                    {action.action} · {action.targetName || "Unnamed control"}
                  </strong>
                )}
                <span
                  className={`browser-life-outcome outcome-${action.decision}`}
                >
                  {action.decision.replace("_", " ")}
                </span>
              </header>
              {action.browserEvidence ? (
                <>
                  <div className="browser-life-direct">
                    <h3>Before and after browser snapshot</h3>
                    <ul>
                      {snapshotRows(
                        action.browserEvidence.before,
                        action.browserEvidence.after,
                      ).map((row) => (
                        <li key={row.label}>
                          <span>{row.label}</span>
                          <code>
                            {row.before ?? "unknown"} → {row.after ?? "unknown"}
                          </code>
                        </li>
                      ))}
                    </ul>
                    <p className="browser-life-unknown">
                      Form validity reason counts:{" "}
                      {Object.entries(
                        action.browserEvidence.before.invalidReasons,
                      )
                        .filter(([, value]) => value)
                        .map(([key, value]) => `${key} ${value}`)
                        .join(" · ") || "none recorded"}{" "}
                      →{" "}
                      {Object.entries(
                        action.browserEvidence.after.invalidReasons,
                      )
                        .filter(([, value]) => value)
                        .map(([key, value]) => `${key} ${value}`)
                        .join(" · ") || "none recorded"}
                    </p>
                  </div>
                  <div className="browser-life-direct">
                    <h3>
                      Chromium browser event trace (
                      {action.browserEvidence.events.length} grouped records)
                    </h3>
                    {action.browserEvidence.events.length ? (
                      <ol>
                        {action.browserEvidence.events.map((event, index) => (
                          <li key={`${event.kind}:${event.offsetMs}:${index}`}>
                            <span>
                              {event.offsetMs} ms ·{" "}
                              {event.tabId || "tab unknown"}
                            </span>
                            <code>{evidenceEventLabel(event)}</code>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="browser-life-unknown">
                        No browser-level event was recorded during this action.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="browser-life-direct">
                  <h3>Browser snapshot</h3>
                  <p className="browser-life-unknown">
                    This action predates versioned browser evidence. Its
                    detailed browser state is unknown.
                  </p>
                </div>
              )}
              <div className="browser-life-direct">
                <h3>Legacy lifecycle cues</h3>
                {cues.some((cue) => cue.category !== "timing") ? (
                  <ul>
                    {cues
                      .filter((cue) => cue.category !== "timing")
                      .map((cue, index) => (
                        <li key={`${cue.raw}:${index}`}>
                          <span>{cueLabel(cue)}</span>
                          <code>
                            {cue.raw.slice(cue.raw.indexOf(":lifecycle:") + 11)}
                          </code>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="browser-life-unknown">
                    No legacy non-timing lifecycle cue was captured for this
                    action.
                  </p>
                )}
              </div>
              <div className="browser-life-timings">
                <h3>Rendering timing entries</h3>
                <ul>
                  {TIMING_KINDS.map(([kind, label]) => {
                    const cue = cues.find(
                      (item) =>
                        item.category === "timing" && item.kind === kind,
                    );
                    return (
                      <li key={kind}>
                        <span>{label}</span>
                        <strong>{cue ? `${cue.value} ms` : "Unknown"}</strong>
                      </li>
                    );
                  })}
                </ul>
                <p className="browser-life-unknown">
                  A metric may be unavailable for this page or action.
                </p>
              </div>
              <div className="browser-life-derived">
                <h3>Derived lifecycle labels</h3>
                {inferred.length ? (
                  <ul>
                    {inferred.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="browser-life-unknown">
                    No label derived from the available cues.
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
