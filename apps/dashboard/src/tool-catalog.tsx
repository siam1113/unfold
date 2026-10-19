import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import "./tool-catalog.css";

/**
 * Shared shape across all three tool catalogs the MCP setup modal shows
 * (AppMCP, WebMCP extension, regular project MCP) — a superset of
 * flow-appmcp-views.tsx's AppMcpTool and the raw MCP SDK tool shape
 * (packages/mcp/src/server.ts's registerTool), so one component can render
 * all three consistently instead of each tab inventing its own list markup.
 */
export type ToolCatalogEntry = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown> | null;
  /** Present on capability-backed tools (AppMCP, WebMCP); absent on the fixed project MCP toolset. */
  risk?: "read" | "reversible_write" | "irreversible_write";
  /** Present on raw MCP SDK tools; used as a fallback read/write signal when `risk` isn't set. */
  annotations?: {
    readOnlyHint?: boolean;
    consequentialHint?: boolean;
    destructiveHint?: boolean;
  };
};

const riskLabel: Record<string, string> = {
  read: "Read-only",
  reversible_write: "Reversible write",
  irreversible_write: "Irreversible write",
};
const riskTone: Record<string, string> = {
  read: "is-good",
  reversible_write: "is-warn",
  irreversible_write: "is-bad",
};

function badge(tool: ToolCatalogEntry): { label: string; tone: string } {
  if (tool.risk)
    return { label: riskLabel[tool.risk], tone: riskTone[tool.risk] };
  if (tool.annotations?.readOnlyHint)
    return { label: "Read-only", tone: "is-good" };
  return { label: "Write", tone: "is-warn" };
}

function hasProperties(schema: Record<string, unknown> | null | undefined) {
  const properties = schema?.properties as Record<string, unknown> | undefined;
  return !!properties && Object.keys(properties).length > 0;
}

export function ToolCatalog({
  tools,
  outputHint,
  emptyLabel = "No tools available yet.",
}: {
  tools: ToolCatalogEntry[];
  outputHint: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q),
    );
  }, [tools, query]);

  if (!tools.length) return <p className="tool-catalog-empty">{emptyLabel}</p>;

  return (
    <div className="tool-catalog">
      <label className="tool-catalog-search">
        <Search size={13} />
        <input
          type="search"
          placeholder={`Search ${tools.length} tool${tools.length === 1 ? "" : "s"}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search tools"
        />
      </label>
      <ul className="tool-catalog-list">
        {filtered.map((tool) => {
          const isOpen = expanded === tool.name;
          const { label, tone } = badge(tool);
          return (
            <li key={tool.name} className={isOpen ? "open" : ""}>
              <button
                type="button"
                className="tool-catalog-row"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? undefined : tool.name)}
              >
                {isOpen ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                <code>{tool.name}</code>
                <span className={`tool-catalog-risk ${tone}`}>{label}</span>
                <span className="tool-catalog-desc">{tool.description}</span>
              </button>
              {isOpen && (
                <div className="tool-catalog-detail">
                  <div>
                    <span className="tool-catalog-detail-label">
                      Description
                    </span>
                    <p>{tool.description}</p>
                  </div>
                  <div>
                    <span className="tool-catalog-detail-label">Input</span>
                    {hasProperties(tool.inputSchema) ? (
                      <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    ) : (
                      <p className="tool-catalog-muted">
                        No input — call with an empty object.
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="tool-catalog-detail-label">Output</span>
                    <p className="tool-catalog-muted">{outputHint}</p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {query && filtered.length === 0 && (
        <p className="tool-catalog-empty">No tools match "{query}".</p>
      )}
    </div>
  );
}
