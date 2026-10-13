import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  CircleDot,
  Layers3,
  MousePointerClick,
  Search,
  Share2,
  Waypoints,
} from "lucide-react";
import type {
  ActionEdge,
  AppState,
  Component as UIComponent,
  RunData,
} from "../../../packages/shared/src/index";
import "./flow-structure-views.css";

export type FlowStructureViewProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (s: { kind: "state" | "action"; id: string }) => void;
};

const stateTitle = (state?: AppState) => state?.title?.trim() || state?.routeKey || "Untitled screen";
const stateRoute = (state?: AppState) => state?.routeKey || state?.url || "Unknown route";
const stateUrl = (state?: AppState) => {
  if (!state?.url) return "";
  try {
    const url = new URL(state.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return state.url;
  }
};

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="structure-empty"><CircleDot size={18} /><strong>{title}</strong><span>{children}</span></div>;
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <div className="structure-stat"><strong>{value}</strong><span>{label}</span></div>;
}

/** Shows recurring discovered component families across the selected run. */
export function ComponentReuseMap({ data, states, actions, onSelect }: FlowStructureViewProps) {
  const stateById = useMemo(() => new Map(states.map((state) => [state.id, state])), [states]);
  const families = useMemo(() => {
    const grouped = new Map<string, UIComponent[]>();
    for (const component of data.components) {
      const key = component.familyId || `${component.kind}:${component.name.trim().toLowerCase()}`;
      const list = grouped.get(key) ?? [];
      list.push(component);
      grouped.set(key, list);
    }
    return [...grouped.entries()]
      .map(([key, components]) => ({ key, components, states: [...new Set(components.map((item) => item.stateId))] }))
      .sort((a, b) => b.states.length - a.states.length || a.components[0].name.localeCompare(b.components[0].name));
  }, [data.components]);
  const sharedFamilies = families.filter((family) => family.states.length > 1);

  if (!states.length || !data.components.length) {
    return <section className="structure-view"><ViewHeading icon={<Layers3 size={16} />} title="Component Reuse Map" description="See discovered component families and the screens where they appear." />
      <Empty title="No component reuse data yet">This run has no discovered components to compare.</Empty>
    </section>;
  }

  return <section className="structure-view">
    <ViewHeading icon={<Layers3 size={16} />} title="Component Reuse Map" description="Repeated families are inferred from discovery metadata; names and family IDs are observational, not source-code guarantees." />
    <div className="structure-stats"><Stat value={data.components.length} label="instances" /><Stat value={families.length} label="families" /><Stat value={sharedFamilies.length} label="seen on multiple screens" /><Stat value={actions.length} label="observed actions" /></div>
    <div className="structure-family-list">
      {families.map((family) => <article className="structure-family" key={family.key}>
        <div className="structure-family-head"><span className="structure-kind">{family.components[0].kind}</span><div><h3>{family.components[0].name || "Unnamed component"}</h3><p>{family.states.length > 1 ? `Observed on ${family.states.length} screens` : "Observed on one screen"} · {family.components.length} {family.components.length === 1 ? "instance" : "instances"}</p></div><span className="structure-family-count">{family.states.length}</span></div>
        <div className="structure-screen-list">{family.states.map((stateId) => {
          const state = stateById.get(stateId);
          return <button key={stateId} className="structure-screen-chip" onClick={() => onSelect({ kind: "state", id: stateId })} title={state?.url}>
            <span>{stateTitle(state)}</span><small>{stateRoute(state)}</small><ArrowRight size={13} />
          </button>;
        })}</div>
      </article>)}
    </div>
  </section>;
}

/** Summarizes visible interactive controls and observed outcomes by screen. */
export function ControlSurfaceMap({ data, states, actions, onSelect }: FlowStructureViewProps) {
  const [query, setQuery] = useState("");
  const elementsById = useMemo(() => new Map(data.elements.map((element) => [element.id, element])), [data.elements]);
  const actionsByState = useMemo(() => {
    const map = new Map<string, ActionEdge[]>();
    actions.forEach((action) => map.set(action.fromStateId, [...(map.get(action.fromStateId) ?? []), action]));
    return map;
  }, [actions]);
  const rows = useMemo(() => states.map((state) => {
    const controls = state.interactiveElementIds.map((id) => elementsById.get(id)).filter((item) => item !== undefined);
    const observedActions = actionsByState.get(state.id) ?? [];
    const searchable = `${stateTitle(state)} ${stateRoute(state)} ${controls.map((control) => `${control.accessibleName} ${control.role} ${control.tag}`).join(" ")}`.toLowerCase();
    return { state, controls, actions: observedActions, searchable };
  }).filter((row) => !query || row.searchable.includes(query.trim().toLowerCase())), [states, elementsById, actionsByState, query]);
  const uniqueControls = new Set(rows.flatMap((row) => row.controls.map((control) => control.id))).size;
  const totalControls = rows.reduce((sum, row) => sum + row.controls.length, 0);

  return <section className="structure-view">
    <ViewHeading icon={<MousePointerClick size={16} />} title="Control Surface Map" description="Inventory of discovered interactive controls and the actions observed from each screen." />
    <div className="structure-stats"><Stat value={states.length} label="screens" /><Stat value={uniqueControls} label="unique controls" /><Stat value={totalControls} label="control appearances" /><Stat value={actions.length} label="observed actions" /></div>
    <label className="structure-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter screens and controls" /></label>
    {!data.elements.length ? <Empty title="No control inventory available">This run has no captured interactive element records.</Empty> : rows.length === 0 ? <Empty title="No matching controls">Try a different screen, route, or control name.</Empty> : <div className="structure-control-list">
      {rows.map(({ state, controls, actions: screenActions }) => <article className="structure-control-screen" key={state.id}>
        <button className="structure-screen-heading" onClick={() => onSelect({ kind: "state", id: state.id })}><span><strong>{stateTitle(state)}</strong><small>{stateUrl(state) || stateRoute(state)}</small></span><span className="structure-screen-metrics">{controls.length} controls · {screenActions.length} actions</span><ArrowRight size={14} /></button>
        <div className="structure-control-grid">{controls.length ? controls.map((control) => {
          const related = screenActions.filter((action) => action.elementId === control.id);
          return <div className="structure-control" key={control.id}>
            <span className="structure-control-icon"><MousePointerClick size={13} /></span>
            <span className="structure-control-copy"><strong>{control.accessibleName || control.textSnippet || control.tag || "Unnamed control"}</strong><small>{control.role || control.tag}{control.inputType ? ` · ${control.inputType}` : ""}{control.disabled ? " · disabled" : ""}</small></span>
            {related.length ? <span className="structure-control-actions">{related.map((action) => <button key={action.id} onClick={() => onSelect({ kind: "action", id: action.id })}>{action.action} <ArrowRight size={11} /></button>)}</span> : <span className="structure-unobserved">No action observed</span>}
          </div>;
        }) : <p className="structure-no-controls">No interactive elements were recorded for this screen.</p>}</div>
      </article>)}
    </div>}
  </section>;
}

/** Compares screens by overlap in observed structure tokens (a heuristic). */
export function StateSimilarityReview({ data, states, actions, onSelect }: FlowStructureViewProps) {
  const [minimum, setMinimum] = useState(0.2);
  const pairs = useMemo(() => {
    const result: Array<{ a: AppState; b: AppState; score: number; shared: string[]; connecting: ActionEdge[] }> = [];
    for (let i = 0; i < states.length; i += 1) {
      const a = states[i];
      const aTokens = new Set(a.structureTokens.map((token) => token.toLowerCase()).filter(Boolean));
      for (let j = i + 1; j < states.length; j += 1) {
        const b = states[j];
        const bTokens = new Set(b.structureTokens.map((token) => token.toLowerCase()).filter(Boolean));
        const union = new Set([...aTokens, ...bTokens]);
        const shared = [...aTokens].filter((token) => bTokens.has(token));
        const score = union.size ? shared.length / union.size : 0;
        if (score < minimum) continue;
        const connecting = actions.filter((action) => (action.fromStateId === a.id && action.toStateId === b.id) || (action.fromStateId === b.id && action.toStateId === a.id));
        result.push({ a, b, score, shared, connecting });
      }
    }
    return result.sort((a, b) => b.score - a.score).slice(0, 80);
  }, [states, actions, minimum]);
  const averageTokens = states.length ? Math.round(states.reduce((sum, state) => sum + state.structureTokens.length, 0) / states.length) : 0;

  return <section className="structure-view">
    <ViewHeading icon={<Share2 size={16} />} title="State Similarity Review" description="Similarity is a heuristic Jaccard overlap of observed structure tokens; it does not establish that screens are equivalent." />
    <div className="structure-stats"><Stat value={states.length} label="screens" /><Stat value={averageTokens} label="avg. structure tokens" /><Stat value={pairs.length} label="pairs above threshold" /><Stat value={data.components.length} label="component observations" /></div>
    <div className="structure-similarity-controls"><label>Minimum token overlap <strong>{Math.round(minimum * 100)}%</strong><input type="range" min="0" max="0.8" step="0.05" value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} /></label><span>Pairs are ranked by shared structure tokens / all distinct tokens.</span></div>
    {!states.length ? <Empty title="No screens to compare">Run discovery to collect screen structure observations.</Empty> : states.length < 2 ? <Empty title="Need at least two screens">Similarity review compares each screen with the others.</Empty> : pairs.length === 0 ? <Empty title="No similar pairs at this threshold">Lower the minimum overlap to see more candidate pairs.</Empty> : <div className="structure-similarity-list">
      {pairs.map(({ a, b, score, shared, connecting }) => <article className="structure-similarity-pair" key={`${a.id}:${b.id}`}>
        <div className="structure-similarity-score"><strong>{Math.round(score * 100)}%</strong><small>token overlap</small></div>
        <div className="structure-pair-screens"><button onClick={() => onSelect({ kind: "state", id: a.id })}><strong>{stateTitle(a)}</strong><small>{stateRoute(a)}</small></button><ArrowRight size={14} /><button onClick={() => onSelect({ kind: "state", id: b.id })}><strong>{stateTitle(b)}</strong><small>{stateRoute(b)}</small></button></div>
        <div className="structure-pair-detail"><span>{shared.length} shared structure tokens</span>{connecting.length ? <span>{connecting.length} observed transition{connecting.length === 1 ? "" : "s"}</span> : <span>No observed transition between pair</span>}</div>
        {connecting.length > 0 && <div className="structure-pair-actions">{connecting.slice(0, 3).map((action) => <button key={action.id} onClick={() => onSelect({ kind: "action", id: action.id })}>{action.action}: {action.targetName || "unnamed target"}</button>)}</div>}
      </article>)}
    </div>}
  </section>;
}

function ViewHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <header className="structure-view-heading"><span className="structure-heading-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div><Waypoints size={17} className="structure-heading-mark" /></header>;
}
