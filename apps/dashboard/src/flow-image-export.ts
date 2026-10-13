import type { ActionEdge } from "../../../packages/shared/src/index";

// Uses RouteNode.id/path/stateIds and ActionEdge.fromStateId/toStateId/action/decision.
// Full URLs, query strings, target labels, form values and API payloads are omitted.

/**
 * Route-level node contract for an observed-flow export. `path` should be the
 * route key (not a full URL); `stateIds` map observed action endpoints to this
 * route. Optional `label` is treated as display text and XML-escaped.
 */
export type RouteNode = {
  id: string;
  path: string;
  stateIds: string[];
  label?: string;
};

export type FlowSvgExportOptions = {
  routes: RouteNode[];
  actions: ActionEdge[];
  filename?: string;
};

type PointNode = RouteNode & { x: number; y: number; displayPath: string };

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });

/** Strip origin, query, hash and obvious identifier/secret-like route segments. */
function safePath(raw: string): string {
  let pathname = raw;
  try {
    pathname = new URL(raw, "https://flow-export.invalid").pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0];
  }
  const safeSegments = pathname.split("/").map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      /* keep encoded segment */
    }
    if (!decoded) return "";
    if (/[?&#=@]/.test(decoded)) return ":redacted";
    if (
      /token|secret|password|session|auth|api[-_]?key|access[-_]?key/i.test(
        decoded,
      )
    )
      return ":redacted";
    if (
      /^[a-f0-9]{16,}$/i.test(decoded) ||
      /^[0-9]{6,}$/.test(decoded) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)
    )
      return ":id";
    return decoded;
  });
  const path = safeSegments.join("/");
  return path || "/";
}

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const outcomeName: Record<ActionEdge["decision"], string> = {
  executed: "executed",
  failed: "failed",
  skipped_policy: "policy skipped",
};

/** Create a deterministic, self-contained SVG of route nodes and observed transitions. */
export function createFlowSvg({
  routes,
  actions,
}: Pick<FlowSvgExportOptions, "routes" | "actions">): string {
  const sortedRoutes = [...routes].sort(
    (a, b) =>
      safePath(a.path).localeCompare(safePath(b.path)) ||
      a.id.localeCompare(b.id),
  );
  const columns = Math.max(1, Math.min(3, sortedRoutes.length));
  const nodeWidth = 300;
  const nodeHeight = 96;
  const gapX = 96;
  const gapY = 88;
  const margin = 42;
  const rows = Math.max(1, Math.ceil(sortedRoutes.length / columns));
  const width =
    margin * 2 + columns * nodeWidth + Math.max(0, columns - 1) * gapX;
  const height = margin * 2 + rows * nodeHeight + Math.max(0, rows - 1) * gapY;
  const nodes: PointNode[] = sortedRoutes.map((route, index) => ({
    ...route,
    displayPath: safePath(route.path),
    x: margin + (index % columns) * (nodeWidth + gapX),
    y: margin + Math.floor(index / columns) * (nodeHeight + gapY),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const routeForState = new Map<string, string>();
  for (const node of nodes)
    for (const stateId of node.stateIds) routeForState.set(stateId, node.id);

  const grouped = new Map<
    string,
    { from: string; to: string; actions: ActionEdge[] }
  >();
  for (const action of actions) {
    if (!action.toStateId) continue;
    const from = routeForState.get(action.fromStateId);
    const to = routeForState.get(action.toStateId);
    if (!from || !to) continue;
    const key = `${from}\u0000${to}`;
    const current = grouped.get(key) || { from, to, actions: [] };
    current.actions.push(action);
    grouped.set(key, current);
  }

  const edgeMarkup = [...grouped.values()]
    .sort((a, b) => {
      const sourceA = nodeById.get(a.from)!;
      const sourceB = nodeById.get(b.from)!;
      const targetA = nodeById.get(a.to)!;
      const targetB = nodeById.get(b.to)!;
      return (
        sourceA.displayPath.localeCompare(sourceB.displayPath) ||
        targetA.displayPath.localeCompare(targetB.displayPath) ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to)
      );
    })
    .map((edge, index) => {
      const source = nodeById.get(edge.from)!;
      const target = nodeById.get(edge.to)!;
      const same = edge.from === edge.to;
      const sourceCenterX = source.x + nodeWidth / 2;
      const sourceCenterY = source.y + nodeHeight / 2;
      const targetCenterX = target.x + nodeWidth / 2;
      const targetCenterY = target.y + nodeHeight / 2;
      const vectorX = targetCenterX - sourceCenterX;
      const vectorY = targetCenterY - sourceCenterY;
      const length = Math.hypot(vectorX, vectorY) || 1;
      const unitX = vectorX / length;
      const unitY = vectorY / length;
      const sourceInset = Math.min(
        nodeWidth / 2 / Math.max(Math.abs(unitX), 0.001),
        nodeHeight / 2 / Math.max(Math.abs(unitY), 0.001),
      );
      const targetInset = Math.min(
        nodeWidth / 2 / Math.max(Math.abs(unitX), 0.001),
        nodeHeight / 2 / Math.max(Math.abs(unitY), 0.001),
      );
      const sx = sourceCenterX + unitX * sourceInset;
      const sy = sourceCenterY + unitY * sourceInset;
      const tx = targetCenterX - unitX * targetInset;
      const ty = targetCenterY - unitY * targetInset;
      const dx = tx - sx;
      const dy = ty - sy;
      const labelX = same ? sx + nodeWidth / 2 + 32 : (sx + tx) / 2;
      const labelY = same ? sy - 48 : (sy + ty) / 2 - 8;
      const verbs = [
        ...new Set(edge.actions.map((action) => action.action || "action")),
      ]
        .sort()
        .slice(0, 3)
        .join(" / ");
      const outcomes = ["executed", "failed", "skipped_policy"]
        .map((decision) => ({
          decision,
          count: edge.actions.filter((action) => action.decision === decision)
            .length,
        }))
        .filter((item) => item.count > 0)
        .map(
          (item) =>
            `${item.count} ${outcomeName[item.decision as ActionEdge["decision"]]}`,
        )
        .join(" · ");
      const label = truncate(`${verbs || "action"} · ${outcomes}`, 42);
      const path = same
        ? `M ${sx + 30} ${source.y} C ${source.x + nodeWidth + 82} ${source.y - 74}, ${source.x + nodeWidth + 82} ${source.y + nodeHeight + 74}, ${sx + 30} ${source.y + nodeHeight}`
        : `M ${sx} ${sy} C ${sx + dx * 0.42} ${sy + dy * 0.08}, ${tx - dx * 0.42} ${ty - dy * 0.08}, ${tx} ${ty}`;
      return `<g class="edge" data-edge="${index}"><path d="${path}" marker-end="url(#arrow)"/><rect class="edge-label-bg" x="${labelX - 105}" y="${labelY - 14}" width="210" height="28" rx="6"/><text class="edge-label" x="${labelX}" y="${labelY + 4}" text-anchor="middle">${escapeXml(label)}</text></g>`;
    })
    .join("\n");

  const nodeMarkup = nodes
    .map((node, index) => {
      const pathLabel = truncate(node.displayPath, 44);
      const count = node.stateIds.length;
      return `<g class="route-node" data-node="${index}"><rect x="${node.x}" y="${node.y}" width="${nodeWidth}" height="${nodeHeight}" rx="12"/><text class="node-kicker" x="${node.x + 17}" y="${node.y + 27}">OBSERVED ROUTE ${index + 1}</text><text class="node-title" x="${node.x + 17}" y="${node.y + 54}">${escapeXml(pathLabel)}</text><text class="node-meta" x="${node.x + 17}" y="${node.y + 76}">${count} observed screen${count === 1 ? "" : "s"}</text></g>`;
    })
    .join("\n");

  const empty =
    nodes.length === 0
      ? `<text class="empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">No observed routes to export</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="flow-title flow-desc"><title id="flow-title">Observed application flow</title><desc id="flow-desc">Route-level map derived from recorded routes, screens, and action outcomes. URL query data is excluded.</desc><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#8ca1bb"/></marker></defs><style>.canvas{fill:#f7f9fc}.edge path{fill:none;stroke:#8ca1bb;stroke-width:2}.edge-label-bg{fill:#fff;stroke:#dfe7f0}.edge-label{fill:#4d627d;font:600 10px system-ui,sans-serif}.route-node rect{fill:#fff;stroke:#dce5ef;stroke-width:1.5}.node-kicker{fill:#7b8da4;font:700 8px system-ui,sans-serif;letter-spacing:1px}.node-title{fill:#2e435d;font:650 13px system-ui,sans-serif}.node-meta{fill:#7f8ea1;font:10px system-ui,sans-serif}.empty{fill:#657991;font:12px system-ui,sans-serif}</style><rect class="canvas" x="0" y="0" width="${width}" height="${height}"/>${edgeMarkup}${nodeMarkup}${empty}</svg>`;
}

/** Create the SVG, trigger a browser download when DOM APIs exist, and return the SVG string. */
export function downloadFlowSvg(options: FlowSvgExportOptions): string {
  const svg = createFlowSvg(options);
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof Blob === "undefined" ||
    !document.body
  )
    return svg;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = (options.filename || "observed-flow.svg").replace(
    /[\\/\0]/g,
    "_",
  );
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return svg;
}
