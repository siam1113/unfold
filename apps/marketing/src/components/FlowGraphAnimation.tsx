import { useReducedMotion } from "../hooks/useReducedMotion";

type GraphNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  kind: "route" | "state";
};

type GraphEdge = {
  from: string;
  to: string;
};

const NODES: GraphNode[] = [
  { id: "root", x: 60, y: 210, label: "/", kind: "route" },
  { id: "signin", x: 230, y: 210, label: "/sign-in", kind: "route" },
  { id: "dashboard", x: 400, y: 210, label: "/dashboard", kind: "route" },
  { id: "projects", x: 575, y: 90, label: "/projects", kind: "state" },
  { id: "reports", x: 575, y: 210, label: "/reports", kind: "state" },
  { id: "settings", x: 575, y: 330, label: "/settings", kind: "state" },
];

const EDGES: GraphEdge[] = [
  { from: "root", to: "signin" },
  { from: "signin", to: "dashboard" },
  { from: "dashboard", to: "projects" },
  { from: "dashboard", to: "reports" },
  { from: "dashboard", to: "settings" },
];

const NODE_WIDTH = 118;
const NODE_HEIGHT = 44;

function nodeById(id: string): GraphNode {
  const found = NODES.find((n) => n.id === id);
  if (!found) throw new Error(`unknown node ${id}`);
  return found;
}

function edgePath(edge: GraphEdge): string {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y;
  const x2 = to.x - NODE_WIDTH / 2;
  const y2 = to.y;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function FlowGraphAnimation() {
  const reducedMotion = useReducedMotion();

  return (
    <svg
      className="flow-graph"
      viewBox="0 0 660 420"
      role="img"
      aria-label="Animated diagram of an application's routes and states being mapped into a graph"
    >
      <defs>
        <filter id="flow-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {EDGES.map((edge, i) => {
        const d = edgePath(edge);
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <path
              d={d}
              className="flow-edge"
              pathLength={1}
              style={{ animationDelay: `${420 + i * 140}ms` }}
            />
            {!reducedMotion && (
              <circle r="3.5" className="flow-pulse" filter="url(#flow-glow)">
                <animateMotion
                  dur="2.6s"
                  begin={`${1.1 + i * 0.4}s`}
                  repeatCount="indefinite"
                  path={d}
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.15;0.85;1"
                  dur="2.6s"
                  begin={`${1.1 + i * 0.4}s`}
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        );
      })}

      {NODES.map((node, i) => (
        <g
          key={node.id}
          transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`}
        >
          <g className="flow-node" style={{ animationDelay: `${i * 110}ms` }}>
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={10}
              className={`flow-node-rect flow-node-rect--${node.kind}`}
            />
            <circle
              cx={NODE_WIDTH - 12}
              cy={10}
              r={4}
              className="flow-node-dot"
            />
            <text x={14} y={NODE_HEIGHT / 2 + 4} className="flow-node-label">
              {node.label}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
