import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Compass,
  GitBranch,
  GitMerge,
  Layers,
  MapPinned,
  MousePointer2,
  Network,
  Search,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { ActionEdge, AppState, RunData } from "../../../packages/shared/src/index";
import "./flow-topology-analysis.css";

export type TopologyAnalysisViewProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (s: { kind: "state" | "action"; id: string }) => void;
};

type Mode = "zoom" | "hierarchy" | "deadends" | "complexity" | "entryexit" | "reachability" | "variants" | "branches" | "convergence" | "provenance" | "aliases" | "paths" | "spotlight";
type GraphEdge = ActionEdge & { target: AppState };

const MODES: Array<{ id: Mode; label: string; title: string; explanation: string; icon: React.ReactNode }> = [
  { id: "zoom", label: "Zoom", title: "Semantic zoom", explanation: "Switch between route summaries and screen-level details. Counts summarize recorded states and transitions.", icon: <Layers size={14} /> },
  { id: "hierarchy", label: "Hierarchy", title: "URL path tree", explanation: "Nests observed URL paths by path segment and shows recorded links between branches. The tree is derived from captured URLs, not the app's source hierarchy.", icon: <Network size={14} /> },
  { id: "deadends", label: "Dead ends & loops", title: "Dead ends and loops", explanation: "Dead ends have no recorded outgoing transition in this run. Loops are observed transitions that return to an earlier screen or self-loop.", icon: <Waypoints size={14} /> },
  { id: "complexity", label: "Complexity", title: "Route complexity comparison", explanation: "Compares routes using recorded screen count, branching, incoming links, and failed actions. This heuristic is not a code or UX quality score.", icon: <Activity size={14} /> },
  { id: "entryexit", label: "Entry / exit", title: "Entry and exit points", explanation: "Entry candidates have no recorded incoming transitions; exit candidates have no recorded outgoing transitions. Discovery may not have exercised every path.", icon: <Compass size={14} /> },
  { id: "reachability", label: "Reachability", title: "Reachability from observed starts", explanation: "Traces states from screens with no recorded incoming link, and flags states with no observed path from those starts. A missing path may reflect incomplete discovery.", icon: <MapPinned size={14} /> },
  { id: "variants", label: "Variants", title: "Dynamic URL variants and redirect clues", explanation: "Groups URL paths that differ in likely identifier segments. Grouping is heuristic and inferred from captured URLs; query strings are omitted.", icon: <ArrowDownRight size={14} /> },
  { id: "branches", label: "Branches", title: "Branch comparison", explanation: "Compares recorded outgoing actions from a screen, including destinations and outcomes.", icon: <GitBranch size={14} /> },
  { id: "convergence", label: "Convergence", title: "Convergence points", explanation: "Finds screens reached by multiple distinct source screens through recorded transitions.", icon: <GitMerge size={14} /> },
  { id: "provenance", label: "Provenance", title: "Discovery provenance", explanation: "Connects a screen to the action recorded as discovering it, alongside stored worker, depth, and timestamp metadata.", icon: <Search size={14} /> },
  { id: "aliases", label: "Aliases", title: "Route aliases", explanation: "Surfaces different route keys that resolve to the same normalized URL path. This is a heuristic and ignores query strings and fragments.", icon: <Waypoints size={14} /> },
  { id: "paths", label: "Path finder", title: "Path finder", explanation: "Finds a shortest recorded successful action path between two screens using breadth-first search.", icon: <MousePointer2 size={14} /> },
  { id: "spotlight", label: "Spotlight", title: "Control and action spotlight", explanation: "Select an observed control action to highlight matching actions, connected states, and affected routes across this discovery.", icon: <Sparkles size={14} /> },
];

const titleOf = (state?: AppState) => state?.title?.trim() || state?.routeKey || "Untitled screen";
const routeOf = (state?: AppState) => state?.routeKey || "Unknown route";
const pathOf = (raw?: string) => {
  if (!raw) return "";
  try { return new URL(raw).pathname.replace(/\/$/, "") || "/"; } catch { return raw.split(/[?#]/)[0].replace(/\/$/, "") || "/"; }
};
const timeOf = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "Unknown time" : date.toLocaleString();
};

export function TopologyAnalysisView({ data, states, actions, onSelect }: TopologyAnalysisViewProps) {
  const [mode, setMode] = useState<Mode>("zoom");
  const [sourceId, setSourceId] = useState(states[0]?.id ?? "");
  const [targetId, setTargetId] = useState(states[1]?.id ?? states[0]?.id ?? "");
  const graph = useMemo(() => {
    const byId = new Map(states.map((state) => [state.id, state]));
    const outgoing = new Map<string, GraphEdge[]>();
    const incoming = new Map<string, GraphEdge[]>();
    const edges = actions.flatMap((action) => {
      const target = action.toStateId ? byId.get(action.toStateId) : undefined;
      if (!target || !byId.has(action.fromStateId) || action.decision !== "executed") return [];
      const edge = { ...action, target };
      outgoing.set(action.fromStateId, [...(outgoing.get(action.fromStateId) ?? []), edge]);
      incoming.set(target.id, [...(incoming.get(target.id) ?? []), edge]);
      return [edge];
    });
    return { byId, outgoing, incoming, edges };
  }, [states, actions]);
  const routeGroups = useMemo(() => {
    const grouped = new Map<string, AppState[]>();
    states.forEach((state) => grouped.set(routeOf(state), [...(grouped.get(routeOf(state)) ?? []), state]));
    return [...grouped.entries()].map(([route, items]) => ({ route, items: items.sort((a, b) => a.depth - b.depth || a.discoveredAt.localeCompare(b.discoveredAt)) })).sort((a, b) => a.route.localeCompare(b.route));
  }, [states]);
  const roots = states.filter((state) => !(graph.incoming.get(state.id)?.length));
  const exits = states.filter((state) => !(graph.outgoing.get(state.id)?.length));
  const source = graph.byId.get(sourceId);
  const target = graph.byId.get(targetId);

  return <section className="topology-view">
    <header className="topology-heading"><span><Network size={17} /></span><div><h2>Topology analysis</h2><p>Explore navigation structure from the states and actions captured in this run.</p></div><small>{states.length} screens · {actions.length} action records</small></header>
    <nav className="topology-mode-list" aria-label="Topology analysis modes">{MODES.map((item) => <button key={item.id} className={mode === item.id ? "active" : ""} onClick={() => setMode(item.id)} title={item.explanation}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="topology-mode-content">
      <header className="topology-mode-heading"><div><h3>{MODES.find((item) => item.id === mode)?.title}</h3><p>{MODES.find((item) => item.id === mode)?.explanation}</p></div></header>
      {states.length === 0 ? <Empty title="No screens available">Run discovery to collect screen and transition observations.</Empty> : <>
        {mode === "zoom" && <SemanticZoom groups={routeGroups} outgoing={graph.outgoing} onSelect={onSelect} />}
        {mode === "hierarchy" && <Hierarchy states={states} groups={routeGroups} outgoing={graph.outgoing} onSelect={onSelect} />}
        {mode === "deadends" && <DeadEnds states={states} outgoing={graph.outgoing} incoming={graph.incoming} edges={graph.edges} onSelect={onSelect} />}
        {mode === "complexity" && <Complexity states={states} outgoing={graph.outgoing} incoming={graph.incoming} actions={actions} onSelect={onSelect} />}
        {mode === "entryexit" && <EntryExit roots={roots} exits={exits} actions={actions} baseUrl={data.run.config.baseUrl} onSelect={onSelect} />}
        {mode === "reachability" && <Reachability states={states} graph={graph} roots={roots} onSelect={onSelect} />}
        {mode === "variants" && <Variants states={states} groups={routeGroups} actions={actions} onSelect={onSelect} />}
        {mode === "branches" && <Branches states={states} outgoing={graph.outgoing} actions={actions} selectedId={sourceId} setSelectedId={setSourceId} onSelect={onSelect} />}
        {mode === "convergence" && <Convergence states={states} incoming={graph.incoming} onSelect={onSelect} />}
        {mode === "provenance" && <Provenance states={states} actions={actions} onSelect={onSelect} />}
        {mode === "aliases" && <Aliases states={states} onSelect={onSelect} />}
        {mode === "paths" && <PathFinder states={states} outgoing={graph.outgoing} sourceId={sourceId} targetId={targetId} setSourceId={setSourceId} setTargetId={setTargetId} onSelect={onSelect} />}
        {mode === "spotlight" && <Spotlight states={states} outgoing={graph.outgoing} incoming={graph.incoming} actions={actions} onSelect={onSelect} />}
      </>}
      {mode === "reachability" && <div className="topology-note">Starts are screens with no successful incoming transition. Reachability uses only successful actions linked to a known destination state.</div>}
      {mode === "paths" && source && target && <div className="topology-note">Path search uses successful actions with known destination state IDs. It does not infer unrecorded steps.</div>}
    </div>
  </section>;
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="topology-empty"><Compass size={18} /><strong>{title}</strong><span>{children}</span></div>;
}

function StateButton({ state, detail, onSelect }: { state: AppState; detail?: React.ReactNode; onSelect: TopologyAnalysisViewProps["onSelect"] }) {
  return <button className="topology-state" onClick={() => onSelect({ kind: "state", id: state.id })}><span><strong>{titleOf(state)}</strong><small>{routeOf(state)}</small></span>{detail && <span className="topology-state-detail">{detail}</span>}<ArrowRight size={13} /></button>;
}

function ActionButton({ action, onSelect }: { action: ActionEdge; onSelect: TopologyAnalysisViewProps["onSelect"] }) {
  return <button className="topology-action" onClick={() => onSelect({ kind: "action", id: action.id })}><MousePointer2 size={12} /><span>{action.action}: {action.targetName || "unnamed target"}</span><small>{action.decision.replace("skipped_policy", "policy skipped")}</small></button>;
}

function SemanticZoom({ groups, outgoing, onSelect }: { groups: Array<{route:string;items:AppState[]}>; outgoing:Map<string,GraphEdge[]>; onSelect:TopologyAnalysisViewProps["onSelect"] }) {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const selected = groups.find((group) => group.route === selectedRoute);
  const transitions = selected?.items.flatMap((state) => outgoing.get(state.id) ?? []) ?? [];
  return <div className="topology-zoom">
    <div className="topology-zoom-overview"><div className="topology-section-label">Route overview <small>Select a route to zoom into its screens</small></div><div className="topology-route-tiles">{groups.map((group) => <button className={selectedRoute === group.route ? "selected" : ""} key={group.route} onClick={() => setSelectedRoute(selectedRoute === group.route ? null : group.route)}><strong>{group.route}</strong><span>{group.items.length} screens</span><small>{group.items.reduce((sum, item) => sum + (outgoing.get(item.id)?.length ?? 0), 0)} outgoing observed transitions</small></button>)}</div></div>
    {selected && <div className="topology-zoom-detail"><div className="topology-section-label">{selected.route}<small>Screen-level view</small></div><div className="topology-zoom-screens">{selected.items.map((state) => <StateButton key={state.id} state={state} detail={`${outgoing.get(state.id)?.length ?? 0} outgoing`} onSelect={onSelect} />)}</div>{transitions.length > 0 && <div className="topology-zoom-links"><strong>Recorded destinations</strong>{transitions.slice(0, 12).map((edge) => <div key={edge.id}><span>{titleOf(edge.target)}</span><small>{edge.action} · {edge.target.routeKey}</small></div>)}</div>}</div>}
  </div>;
}

type PathNode = { name: string; path: string; states: AppState[]; children: Map<string, PathNode> };
function Hierarchy({ states, groups, outgoing, onSelect }: {states:AppState[];groups:Array<{route:string;items:AppState[]}>;outgoing:Map<string,GraphEdge[]>;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const root: PathNode = { name: "/", path: "/", states: [], children: new Map() };
  for (const state of states) {
    const path = pathOf(state.url) || routeOf(state);
    const segments = path.split("/").filter(Boolean);
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) { const childPath = `${node.path.replace(/\/$/, "")}/${segment}`; child = { name: segment, path: childPath, states: [], children: new Map() }; node.children.set(segment, child); }
      node = child;
    }
    node.states.push(state);
  }
  const routeByState = new Map(states.map((state) => [state.id, routeOf(state)]));
  const links = groups.flatMap((group) => group.items.flatMap((state) => (outgoing.get(state.id) ?? []).flatMap((edge) => {
    const fromRoute = routeByState.get(state.id) ?? group.route, toRoute = routeByState.get(edge.target.id) ?? routeOf(edge.target);
    return fromRoute !== toRoute ? [{ fromRoute, toRoute, edge }] : [];
  })));
  return <div className="topology-hierarchy-layout"><section className="topology-hierarchy"><div className="topology-path-tree"><PathTreeNode node={root} depth={0} outgoing={outgoing} onSelect={onSelect} /></div></section><section className="topology-path-links"><SectionHeading title="Observed links between routes" count={links.length} /><p className="topology-explainer">Only successful actions with a captured destination state are included.</p><div className="topology-list">{links.length ? links.slice(0, 100).map(({fromRoute,toRoute,edge}) => <article className="topology-record" key={edge.id}><div className="topology-route-link"><code>{fromRoute}</code><ArrowRight size={12}/><code>{toRoute}</code></div><ActionButton action={edge} onSelect={onSelect}/></article>) : <Empty title="No cross-route links recorded">Observed transitions either stay within a route or lack a linked destination.</Empty>}</div></section></div>;
}
function PathTreeNode({node,depth,outgoing,onSelect}:{node:PathNode;depth:number;outgoing:Map<string,GraphEdge[]>;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const children = [...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name));
  return <div className="topology-path-node" style={{"--path-depth": depth} as React.CSSProperties}><div className="topology-path-node-heading"><span className="topology-path-segment">{node.path}</span><small>{node.states.length ? `${node.states.length} screen${node.states.length === 1 ? "" : "s"}` : "path segment"}</small></div>{node.states.map((state) => <StateButton key={state.id} state={state} detail={`${outgoing.get(state.id)?.length ?? 0} next`} onSelect={onSelect} />)}{children.map((child) => <PathTreeNode key={child.path} node={child} depth={depth+1} outgoing={outgoing} onSelect={onSelect}/>)}</div>;
}

function DeadEnds({ states, outgoing, incoming, edges, onSelect }: { states:AppState[];outgoing:Map<string,GraphEdge[]>;incoming:Map<string,GraphEdge[]>;edges:GraphEdge[];onSelect:TopologyAnalysisViewProps["onSelect"] }) {
  const dead = states.filter((state) => !outgoing.get(state.id)?.length);
  const loops = edges.filter((edge) => edge.fromStateId === edge.target.id || reaches(edge.target.id, edge.fromStateId, outgoing));
  return <div className="topology-columns"><section><SectionHeading title="No recorded outgoing transitions" count={dead.length} /><div className="topology-list">{dead.length ? dead.map((state) => <StateButton key={state.id} state={state} detail={`${incoming.get(state.id)?.length ?? 0} incoming`} onSelect={onSelect} />) : <Empty title="No dead ends found">Every observed screen has at least one successful outgoing transition.</Empty>}</div></section><section><SectionHeading title="Transitions that return to a seen screen" count={loops.length} /><div className="topology-list">{loops.length ? loops.slice(0, 50).map((edge) => <div className="topology-loop" key={edge.id}><StateButton state={graphState(edge.fromStateId, states)!} detail="source" onSelect={onSelect} /><ArrowRight size={13} /><StateButton state={edge.target} detail={edge.action} onSelect={onSelect} /><ActionButton action={edge} onSelect={onSelect} /></div>) : <Empty title="No observed loops">No successful transition forms a cycle within the recorded graph.</Empty>}</div></section></div>;
}

function graphState(id: string, states: AppState[]) { return states.find((state) => state.id === id); }
function reaches(start: string, target: string, outgoing: Map<string, GraphEdge[]>) {
  const queue = [start], visited = new Set<string>();
  while (queue.length) { const current = queue.shift()!; if (current === target) return true; if (visited.has(current)) continue; visited.add(current); (outgoing.get(current) ?? []).forEach((edge) => queue.push(edge.target.id)); }
  return false;
}

function Complexity({ states, outgoing, incoming, actions, onSelect }: {states:AppState[];outgoing:Map<string,GraphEdge[]>;incoming:Map<string,GraphEdge[]>;actions:ActionEdge[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const ranked = useMemo(() => {
    const byRoute = new Map<string, AppState[]>();
    states.forEach((state) => byRoute.set(routeOf(state), [...(byRoute.get(routeOf(state)) ?? []), state]));
    return [...byRoute.entries()].map(([route,items]) => {
      const stateIds = new Set(items.map((state) => state.id));
      const branches = items.reduce((sum,state) => sum + (outgoing.get(state.id)?.length ?? 0),0);
      const linkedArrivals = items.reduce((sum,state) => sum + (incoming.get(state.id)?.length ?? 0),0);
      const failures = actions.filter((action) => stateIds.has(action.fromStateId) && action.decision === "failed").length;
      const outgoingRoutes = new Set(items.flatMap((state) => outgoing.get(state.id) ?? []).map((edge) => routeOf(edge.target))).size;
      const score = items.length + branches * 2 + Math.max(0, linkedArrivals - items.length) + failures * 2 + outgoingRoutes * 2;
      return { route, items, branches, linkedArrivals, failures, outgoingRoutes, score };
    }).sort((a,b) => b.score-a.score || b.branches-a.branches || a.route.localeCompare(b.route));
  },[states,outgoing,incoming,actions]);
  const max = Math.max(1,...ranked.map((row)=>row.score));
  return <><p className="topology-explainer">Inferred score = screens + 2×successful transitions + excess incoming links + 2×failed actions + 2×distinct destination routes. Counts are evidence volume, not quality.</p><div className="topology-list">{ranked.map(({route,items,branches,linkedArrivals,failures,outgoingRoutes,score})=><article className="topology-route-complexity" key={route}><div className="topology-route-complexity-head"><span className="topology-complexity-score">{score}</span><strong>{route}</strong><small>{items.length} screens · {branches} transitions · {failures} failed</small></div><span className="topology-complexity-meter"><i style={{width:`${Math.min(100,score/max*100)}%`}}/></span><div className="topology-route-complexity-foot"><span>{linkedArrivals} arrivals</span><span>{outgoingRoutes} linked destination routes</span></div><div className="topology-route-complexity-states">{items.slice(0,8).map((state)=><StateButton key={state.id} state={state} detail={`${outgoing.get(state.id)?.length??0} next`} onSelect={onSelect}/>)}</div></article>)}</div></>;
}

function originOf(raw: string) { try { return new URL(raw, "https://invalid.local").origin; } catch { return ""; } }
function EntryExit({ roots, exits, actions, baseUrl, onSelect }: {roots:AppState[];exits:AppState[];actions:ActionEdge[];baseUrl:string;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const baseOrigin = originOf(baseUrl);
  const boundaryActions = actions.filter((action) => {
    const changedHost = action.afterUrl && originOf(action.afterUrl) !== originOf(action.beforeUrl);
    return Boolean(changedHost || action.signals.some((signal) => signal.includes("external_navigation")) || action.browserEvidence?.events.some((event) => event.kind === "navigation_request" && (event.disposition === "newTab" || event.disposition === "newWindow")) || action.browserEvidence?.events.some((event) => event.kind === "network_request" && event.origin && originOf(event.origin) !== baseOrigin));
  });
  return <div className="topology-columns"><section><SectionHeading title="Entry candidates" count={roots.length} /><p className="topology-explainer">No successful incoming transition was captured.</p><div className="topology-list">{roots.length?roots.map((state)=><StateButton key={state.id} state={state} detail={`depth ${state.depth}`} onSelect={onSelect} />):<Empty title="No candidate entry">Every screen has a recorded incoming transition.</Empty>}</div></section><section><SectionHeading title="Exit candidates" count={exits.length} /><p className="topology-explainer">No successful outgoing transition was captured.</p><div className="topology-list">{exits.length?exits.map((state)=><StateButton key={state.id} state={state} detail={`depth ${state.depth}`} onSelect={onSelect} />):<Empty title="No candidate exit">Every screen has a recorded outgoing transition.</Empty>}</div><SectionHeading title="Observed app boundary exits" count={boundaryActions.length}/><p className="topology-explainer">Cross-origin document navigation, new-window disposition, and outside-origin browser requests recorded around the action.</p><div className="topology-list">{boundaryActions.length?boundaryActions.map((action)=><ActionButton key={action.id} action={action} onSelect={onSelect}/>):<Empty title="No outside boundary event">No cross-origin browser boundary was captured.</Empty>}</div></section></div>;
}

function Reachability({ states, graph, roots, onSelect }: {states:AppState[];graph:{byId:Map<string,AppState>;outgoing:Map<string,GraphEdge[]>};roots:AppState[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const reachable = useMemo(() => { const all = new Set<string>(); roots.forEach((root)=>walk(root.id,graph.outgoing).forEach((id)=>all.add(id))); return all; },[roots,graph.outgoing]);
  const reached = states.filter((state)=>reachable.has(state.id));
  const absent = states.filter((state)=>!reachable.has(state.id));
  return <><div className="topology-reachability-starts"><SectionHeading title="Observed start candidates" count={roots.length}/><div className="topology-list">{roots.length?roots.map((state)=><StateButton key={state.id} state={state} detail="no successful incoming link" onSelect={onSelect}/>):<Empty title="No start candidate">Every captured state has a successful incoming transition.</Empty>}</div></div><div className="topology-columns"><section><SectionHeading title="Traceable from a start" count={reached.length}/><div className="topology-list">{reached.map((state)=><StateButton key={state.id} state={state} detail={roots.some((root)=>root.id===state.id)?"start":"reachable"} onSelect={onSelect}/>)}</div></section><section><SectionHeading title="No observed path from a start" count={absent.length}/><p className="topology-explainer">These states may be orphaned in the recorded graph, or their incoming path may not have been captured.</p><div className="topology-list">{absent.map((state)=><StateButton key={state.id} state={state} onSelect={onSelect}/>)}</div></section></div></>;
}
function walk(start:string, outgoing:Map<string,GraphEdge[]>) {const visited=new Set<string>();if(!start)return visited;const queue=[start];while(queue.length){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);(outgoing.get(id)??[]).forEach((edge)=>queue.push(edge.target.id));}return visited;}

function pathPattern(path:string) {
  return path.split("/").map((segment) => !segment ? segment : /^[0-9]+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[A-Za-z0-9_-]{16,}$/.test(segment) ? ":id" : segment).join("/") || "/";
}
const SENSITIVE_PARAM_NAME = /(?:pass(?:word)?|token|secret|auth|credential|session|cookie|api[_-]?key|access[_-]?key|private[_-]?key|signature|jwt|(?:^|[_-])sig(?:nature)?(?:$|[_-])|(?:^|[_-])code(?:$|[_-]))/i;
function queryParamNames(raw:string) {
  try {
    const params = new URL(raw, "https://redacted.invalid").searchParams;
    const safe = [...new Set([...params.keys()].map((name) => SENSITIVE_PARAM_NAME.test(name) ? "[sensitive parameter name redacted]" : name))].sort((a,b)=>a.localeCompare(b));
    return safe;
  } catch { return []; }
}
function queryValueShapes(raw:string) {
  const shape = (value: string) => {
    if (!value) return "empty";
    if (/^(?:true|false)$/i.test(value)) return "boolean";
    if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return "numeric";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "UUID-like";
    if (/^\d{4}-\d{2}-\d{2}(?:t.*)?$/i.test(value)) return "date-like";
    if (value.includes(",")) return "list-like";
    return value.length > 64 ? "long text" : "short text";
  };
  try {
    const params = new URL(raw, "https://redacted.invalid").searchParams;
    return [...new Set([...params.entries()].map(([name, value]) =>
      `${SENSITIVE_PARAM_NAME.test(name) ? "[sensitive name omitted]" : name} · ${shape(value)}`,
    ))].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}
function Variants({ states, groups, actions, onSelect }: {states:AppState[];groups:Array<{route:string;items:AppState[]}>;actions:ActionEdge[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const dynamicGroups = useMemo(() => {
    const grouped = new Map<string,AppState[]>();
    states.forEach((state) => { const path = pathOf(state.url) || routeOf(state); const pattern = pathPattern(path); grouped.set(pattern,[...(grouped.get(pattern)??[]),state]); });
    return [...grouped.entries()].map(([pattern,items])=>({pattern,items})).filter(({pattern,items})=>items.length>1&&items.some((state)=>(pathOf(state.url)||routeOf(state))!==pattern)).sort((a,b)=>b.items.length-a.items.length);
  },[states]);
  const queryVariants = useMemo(() => {
    const byPath = new Map<string,Map<string,{names:string[];shapes:string[];items:AppState[]}>>();
    states.forEach((state) => {
      const path = pathOf(state.url) || routeOf(state);
      const names = queryParamNames(state.url);
      const shapes = queryValueShapes(state.url);
      const profile = JSON.stringify([names, shapes]);
      const profiles = byPath.get(path) ?? new Map<string,{names:string[];shapes:string[];items:AppState[]}>();
      const row = profiles.get(profile) ?? { names, shapes, items: [] };
      row.items.push(state);
      profiles.set(profile,row);
      byPath.set(path,profiles);
    });
    return [...byPath.entries()].flatMap(([path,profiles]) => profiles.size>1 ? [{path,profiles:[...profiles.values()]}] : []).sort((a,b)=>a.path.localeCompare(b.path));
  },[states]);
  const rows=groups.filter((group)=>group.items.length>1);
  const redirects=actions.filter((action)=>(action.afterUrl&&pathOf(action.beforeUrl)!==pathOf(action.afterUrl)) || action.browserEvidence?.events.some((event)=>event.kind==="redirect"));
  return <div className="topology-columns"><section><SectionHeading title="Inferred dynamic path groups" count={dynamicGroups.length}/><p className="topology-explainer">Numeric, UUID-like, and long identifier-looking path segments are grouped as <code>:id</code>. This grouping is inferred from URL shape.</p><div className="topology-list">{dynamicGroups.length?dynamicGroups.map(({pattern,items})=><article className="topology-record" key={pattern}><strong><code>{pattern}</code></strong><small>{items.length} states grouped by inferred path pattern</small>{items.map((state)=><StateButton key={state.id} state={state} detail={pathOf(state.url)} onSelect={onSelect}/>)}</article>):<Empty title="No dynamic path variants inferred">No repeated identifier-like path pattern was found in captured URLs.</Empty>}</div><SectionHeading title="Query parameter variants" count={queryVariants.length}/><p className="topology-explainer">Compares parameter names and coarse value shapes on the same path. Raw values are never displayed, stored in these profiles, or used for exact matching; sensitive-looking names are hidden.</p><div className="topology-list">{queryVariants.length?queryVariants.map(({path,profiles})=><article className="topology-record topology-query-variant" key={path}><strong><code>{path}</code></strong>{profiles.map(({names,shapes,items})=><div className="topology-query-profile" key={`${path}:${JSON.stringify([names,shapes])}`}><div><span>Observed parameter names and coarse shapes</span><div className="topology-alias-keys">{names.length?names.map((name,index)=><span key={`${name}-${index}`}>{name}</span>):<span>No visible parameter names</span>}{shapes.map((shape,index)=><span key={`${shape}-${index}`}>{shape}</span>)}</div></div><small>{items.length} captured state{items.length===1?"":"s"}</small>{items.map((state)=><StateButton key={state.id} state={state} onSelect={onSelect}/>)}</div>)}</article>):<Empty title="No query parameter variants">No path was observed with multiple query parameter name or shape profiles.</Empty>}</div><SectionHeading title="Multiple states for one route key" count={rows.length}/><div className="topology-list">{rows.length?rows.map((group)=><article className="topology-record" key={group.route}><strong>{group.route}</strong><small>{group.items.length} captured variants</small>{group.items.map((state)=><StateButton key={state.id} state={state} detail={`${state.fingerprintReason} · depth ${state.depth}`} onSelect={onSelect} />)}</article>):<Empty title="No route variants found">No route key has multiple captured states.</Empty>}</div></section><section><SectionHeading title="Navigation and redirect evidence" count={redirects.length}/><p className="topology-explainer">Chromium redirect responses are recorded by status and origin; the action before/after URL shows the resulting route. Redirect paths and query strings are not copied into browser evidence.</p><div className="topology-list">{redirects.length?redirects.map((action)=><div className="topology-record" key={action.id}><div className="topology-url-change"><code>{pathOf(action.beforeUrl)}</code><ArrowRight size={12}/><code>{action.afterUrl?pathOf(action.afterUrl):"destination unknown"}</code></div>{(action.browserEvidence?.events||[]).filter((event)=>event.kind==="redirect").map((event,index)=><small key={`${event.offsetMs}:${index}`}>Redirect hop · HTTP {event.status||"unknown"} · {event.origin||"origin unknown"} · {event.count||1} response(s)</small>)}<ActionButton action={action} onSelect={onSelect}/></div>):<Empty title="No URL or redirect changes recorded">No action URL transition or redirect response was observed.</Empty>}</div></section></div>;
}

function Branches({ states, outgoing, actions, selectedId, setSelectedId, onSelect }: {states:AppState[];outgoing:Map<string,GraphEdge[]>;actions:ActionEdge[];selectedId:string;setSelectedId:(id:string)=>void;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const selected=states.find((state)=>state.id===selectedId);
  const edges=outgoing.get(selectedId)??[];
  const records=actions.filter((action)=>action.fromStateId===selectedId);
  const targets=new Map(edges.map((edge)=>[edge.id,edge.target]));
  return <><StatePicker states={states} value={selectedId} onChange={setSelectedId} label="Compare branches from" />{selected&&<div className="topology-branch-summary"><strong>{titleOf(selected)}</strong><span>{records.length} action records · {edges.length} successful destinations.</span></div>}<div className="topology-list">{records.length?records.map((action,index)=>{const destination=targets.get(action.id);return <article className="topology-branch" key={action.id}><span className="topology-branch-index">{index+1}</span><div><small>Observed action</small><ActionButton action={action} onSelect={onSelect}/></div><ArrowRight size={14}/>{destination?<StateButton state={destination} detail={destination.url} onSelect={onSelect}/>:<span className="topology-no-destination">No destination state recorded</span>}<span className="topology-branch-meta">{action.error||action.effectFlags.join(" · ")||"No effect flags recorded"}</span></article>;}) : <Empty title="No actions recorded from this screen">Try another starting screen.</Empty>}</div></>;
}

function Convergence({ states, incoming, onSelect }: {states:AppState[];incoming:Map<string,GraphEdge[]>;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const convergent=states.map((state)=>({state,edges:incoming.get(state.id)??[]})).filter((item)=>new Set(item.edges.map((edge)=>edge.fromStateId)).size>1).sort((a,b)=>b.edges.length-a.edges.length);
  return <div className="topology-list">{convergent.length?convergent.map(({state,edges})=><article className="topology-record" key={state.id}><StateButton state={state} detail={`${new Set(edges.map((edge)=>edge.fromStateId)).size} distinct sources`} onSelect={onSelect}/><div className="topology-source-list">{edges.map((edge)=><button key={edge.id} onClick={()=>onSelect({kind:"state",id:edge.fromStateId})}><span>{titleOf(states.find((item)=>item.id===edge.fromStateId))}</span><small>{edge.action}</small></button>)}</div></article>):<Empty title="No convergence point found">No screen has successful incoming transitions from more than one distinct source screen.</Empty>}</div>;
}

function Provenance({ states, actions, onSelect }: {states:AppState[];actions:ActionEdge[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const actionById=new Map(actions.map((action)=>[action.id,action]));
  return <div className="topology-list">{states.map((state)=>{const cause=state.provenanceActionId?actionById.get(state.provenanceActionId):undefined;return <article className="topology-provenance" key={state.id}><StateButton state={state} detail={`worker ${state.worker} · depth ${state.depth}`} onSelect={onSelect}/><div className="topology-provenance-meta"><span>Discovered {timeOf(state.discoveredAt)}</span><span>{state.fingerprintReason||"No fingerprint reason stored"}</span>{state.recipe?.steps?.length>0&&<span>{state.recipe.steps.length} restore steps</span>}</div>{cause?<div className="topology-origin"><span>Found by</span><ActionButton action={cause} onSelect={onSelect}/></div>:<div className="topology-origin topology-origin-empty">No provenance action is linked to this state record.</div>}</article>;})}</div>;
}

function tokenSimilarity(left:string[],right:string[]) {
  const a=new Set(left),b=new Set(right);
  if(!a.size||!b.size)return 0;
  let shared=0;a.forEach((value)=>{if(b.has(value))shared++;});
  return shared/(a.size+b.size-shared);
}
function normalizedTitle(state:AppState) { return (state.title||"").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim(); }
function Aliases({ states, onSelect }: {states:AppState[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const groups=new Map<string,AppState[]>();
  states.forEach((state)=>{const path=pathOf(state.url);groups.set(path,[...(groups.get(path)??[]),state]);});
  const aliases=[...groups.entries()].map(([path,items])=>({path,items,keys:[...new Set(items.map((item)=>item.routeKey))]})).filter((item)=>item.keys.length>1).sort((a,b)=>b.keys.length-a.keys.length);
  const candidates=useMemo(()=>{
    const found:Array<{left:AppState;right:AppState;structure:number;controls:number;score:number}> = [];
    for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
      const left=states[i],right=states[j];
      if(pathOf(left.url)===pathOf(right.url))continue;
      const title=normalizedTitle(left);
      if(title.length<4||title!==normalizedTitle(right))continue;
      if(left.structureTokens.length<5||right.structureTokens.length<5||left.interactiveElementIds.length<3||right.interactiveElementIds.length<3)continue;
      const structure=tokenSimilarity(left.structureTokens,right.structureTokens);
      const controls=tokenSimilarity(left.interactiveElementIds,right.interactiveElementIds);
      if(structure<0.85||controls<0.8)continue;
      found.push({left,right,structure,controls,score:(structure+controls)/2});
    }
    return found.sort((a,b)=>b.score-a.score).slice(0,100);
  },[states]);
  return <div className="topology-alias-view"><section><SectionHeading title="Same normalized path, different route keys" count={aliases.length}/><p className="topology-explainer">Exact captured path matches only; query strings are omitted.</p><div className="topology-list">{aliases.length?aliases.map(({path,items,keys})=><article className="topology-record" key={path}><strong>Observed path: <code>{path}</code></strong><small>{items.length} states · {keys.length} route keys</small><div className="topology-alias-keys">{keys.map((key)=><span key={key}>{key}</span>)}</div>{items.map((state)=><StateButton key={state.id} state={state} detail={pathOf(state.url)} onSelect={onSelect}/>)}</article>):<Empty title="No exact-path route aliases">No normalized path appears under multiple route keys in this run.</Empty>}</div></section><section><SectionHeading title="Inferred cross-path screen candidates" count={candidates.length}/><p className="topology-explainer">Candidate only: requires the same captured screen title, at least 5 structure tokens and 3 interactive controls, with Jaccard similarity ≥ 0.85 for structure and ≥ 0.80 for controls. Similarity does not confirm routes are aliases.</p><div className="topology-list">{candidates.length?candidates.map(({left,right,structure,controls})=><article className="topology-alias-candidate" key={`${left.id}:${right.id}`}><div className="topology-alias-candidate-label"><Sparkles size={12}/><strong>Inferred screen match</strong><span>structure {Math.round(structure*100)}% · controls {Math.round(controls*100)}%</span></div><div className="topology-alias-pair"><div><StateButton state={left} detail={pathOf(left.url)} onSelect={onSelect}/></div><ArrowRight size={13}/><div><StateButton state={right} detail={pathOf(right.url)} onSelect={onSelect}/></div></div></article>):<Empty title="No strong cross-path candidates">No pair met the conservative title, structure, and control similarity thresholds.</Empty>}</div></section></div>;
}

function PathFinder({ states, outgoing, sourceId, targetId, setSourceId, setTargetId, onSelect }: {states:AppState[];outgoing:Map<string,GraphEdge[]>;sourceId:string;targetId:string;setSourceId:(id:string)=>void;setTargetId:(id:string)=>void;onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const path=useMemo(()=>shortestPath(sourceId,targetId,outgoing),[sourceId,targetId,outgoing]);
  return <><div className="topology-path-pickers"><StatePicker states={states} value={sourceId} onChange={setSourceId} label="From"/><ArrowRight size={14}/><StatePicker states={states} value={targetId} onChange={setTargetId} label="To"/></div>{sourceId===targetId?<Empty title="Choose two different screens">The path finder looks for a transition path between distinct screens.</Empty>:path===null?<Empty title="No recorded path found">There is no successful state-linked path between these screens in the current observations.</Empty>:<div className="topology-path-result"><strong>Shortest recorded path · {path.length} action{path.length===1?"":"s"}</strong>{path.map((edge,index)=><div className="topology-path-step" key={edge.id}><span>{index+1}</span><StateButton state={states.find((state)=>state.id===edge.fromStateId)!} detail={index===0?"start":"screen"} onSelect={onSelect}/><ActionButton action={edge} onSelect={onSelect}/><StateButton state={edge.target} detail={index===path.length-1?"destination":"next"} onSelect={onSelect}/></div>)}</div>}</>;
}
function shortestPath(source:string,target:string,outgoing:Map<string,GraphEdge[]>) {if(!source||!target)return null;const queue=[source],previous=new Map<string,{from:string;edge:GraphEdge}>(),visited=new Set([source]);while(queue.length){const id=queue.shift()!;if(id===target)break;for(const edge of outgoing.get(id)??[]){if(visited.has(edge.target.id))continue;visited.add(edge.target.id);previous.set(edge.target.id,{from:id,edge});queue.push(edge.target.id);}}if(!visited.has(target))return null;const result:GraphEdge[]=[];let current=target;while(current!==source){const item=previous.get(current);if(!item)return null;result.unshift(item.edge);current=item.from;}return result;}

function Spotlight({ states, outgoing, incoming, actions, onSelect }: {states:AppState[];outgoing:Map<string,GraphEdge[]>;incoming:Map<string,GraphEdge[]>;actions:ActionEdge[];onSelect:TopologyAnalysisViewProps["onSelect"]}) {
  const [selectedId,setSelectedId]=useState(actions[0]?.id??"");
  const selected=actions.find((action)=>action.id===selectedId)??actions[0];
  const controlKey=(action:ActionEdge)=>`${action.action.trim().toLowerCase()}|${(action.targetName||"").trim().toLowerCase()}`;
  const related=selected?actions.filter((action)=>controlKey(action)===controlKey(selected)):[];
  const linkedStates=new Set(related.flatMap((action)=>[action.fromStateId,...(action.toStateId?[action.toStateId]:[])]));
  const routes=[...new Set(states.filter((state)=>linkedStates.has(state.id)).map(routeOf))];
  const hotspots=states.map((state)=>({state,branches:outgoing.get(state.id)?.length??0,arrivals:new Set((incoming.get(state.id)??[]).map((edge)=>edge.fromStateId)).size,failed:actions.filter((action)=>action.fromStateId===state.id&&action.decision==="failed").length}));
  const ranked=hotspots.map((item)=>({...item,score:item.branches*2+item.arrivals+item.failed})).filter((item)=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,6);
  const dead=hotspots.filter((item)=>!item.branches);
  return <div className="topology-spotlight-layout"><section className="topology-spotlight-selector"><label className="topology-picker"><span>Observed control action</span><select value={selected?.id??""} onChange={(event)=>setSelectedId(event.target.value)}>{actions.map((action)=><option key={action.id} value={action.id}>{action.action} · {action.targetName||"unnamed target"} · {titleOf(states.find((state)=>state.id===action.fromStateId))} ({action.decision})</option>)}</select></label>{selected?<><div className="topology-spotlight-summary"><strong>{related.length} matching action records</strong><span>Matched by action type and captured target name. This is a label-based heuristic.</span></div><div className="topology-spotlight-routes"><strong>Connected routes</strong>{routes.length?routes.map((route)=><span key={route}>{route}</span>):<small>No route linked to this action.</small>}</div><div className="topology-list">{related.map((action)=>{const from=states.find((state)=>state.id===action.fromStateId);const to=action.toStateId?states.find((state)=>state.id===action.toStateId):undefined;return <article className={`topology-spotlight-edge ${action.id===selected.id?"selected":""}`} key={action.id}>{from?<StateButton state={from} detail="source" onSelect={onSelect}/>:<span className="topology-no-destination">No source state</span>}<ActionButton action={action} onSelect={onSelect}/>{to?<StateButton state={to} detail="destination" onSelect={onSelect}/>:<span className="topology-no-destination">No linked destination</span>}</article>;})}</div><div className="topology-spotlight-matches"><strong>Highlighted states ({linkedStates.size})</strong>{states.filter((state)=>linkedStates.has(state.id)).map((state)=><StateButton key={state.id} state={state} detail={routeOf(state)} onSelect={onSelect}/>)}</div></>:<Empty title="No action records">This run has no control actions to spotlight.</Empty>}</section><div className="topology-columns"><section><SectionHeading title="High-activity screens" count={ranked.length}/><p className="topology-explainer">Combined observational rank: branching + distinct incoming sources + failed actions.</p><div className="topology-list">{ranked.map(({state,branches,arrivals,failed,score})=><div className="topology-spotlight" key={state.id}><span>{score}</span><StateButton state={state} detail={`${branches} branches · ${arrivals} sources · ${failed} failed`} onSelect={onSelect}/></div>)}</div></section><section><SectionHeading title="Screens with no successful next step" count={dead.length}/><div className="topology-list">{dead.map(({state,arrivals})=><StateButton key={state.id} state={state} detail={`${arrivals} incoming sources`} onSelect={onSelect}/>)}</div></section></div></div>;
}

function StatePicker({states,value,onChange,label}:{states:AppState[];value:string;onChange:(id:string)=>void;label:string}) {
  return <label className="topology-picker"><span>{label}</span><select value={value} onChange={(event)=>onChange(event.target.value)}>{states.map((state)=><option key={state.id} value={state.id}>{titleOf(state)} · {routeOf(state)}</option>)}</select></label>;
}
function SectionHeading({title,count}:{title:string;count:number}) {return <header className="topology-section-heading"><strong>{title}</strong><span>{count}</span></header>;}
