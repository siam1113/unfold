import { useEffect, useState } from "react";
import { AlertCircle, ScanLine, Copy, Check, ShieldCheck } from "lucide-react";
import type { Project, ProjectData } from "../../../packages/shared/src/index";
import type { Risk } from "../../../packages/capability-core/src/types";
import { ToolCatalog } from "./tool-catalog";
import "./flow-appmcp-views.css";

/** Same pattern as apps/dashboard/src/main.tsx's `api` (not exported from there, so kept local here too — see flow-capabilities-views.tsx's own `apiRequest` for the sibling precedent). */
const apiRequest = async <T,>(
  path: string,
  body?: unknown,
  method = "GET",
): Promise<T> => {
  const res = await fetch(
    "/api" + path,
    body === undefined
      ? { method }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((value as { error?: string }).error || "Request failed");
  return value as T;
};

/** Same pattern as flow-capabilities-views.tsx's own `CopyButton` (not exported from main.tsx, so kept local here too). */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      title="Copy to clipboard"
      onClick={() =>
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

type AppMcpTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean };
  risk: Risk;
};

export function AppMcp({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project>();
  const [tools, setTools] = useState<AppMcpTool[]>();
  const [error, setError] = useState("");
  const [headedBusy, setHeadedBusy] = useState(false);
  // VS Code's native MCP support (.vscode/mcp.json) uses a DIFFERENT schema
  // than Claude Desktop/Claude Code/most other clients: top-level `servers`
  // (not `mcpServers`), and its own `${input:...}` secret-prompting
  // mechanism rather than a hardcoded token — since that file is often
  // committed to a repo, hardcoding a real bearer token in it the way the
  // generic snippet does would be a credential leak waiting to happen.
  const [format, setFormat] = useState<"generic" | "vscode">("generic");

  useEffect(() => {
    if (!projectId) return;
    setError("");
    Promise.all([
      apiRequest<ProjectData>(`/projects/${projectId}`).then((d) => d.project),
      apiRequest<AppMcpTool[]>(`/projects/${projectId}/appmcp-tools`),
    ])
      .then(([p, t]) => {
        setProject(p);
        setTools(t);
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  const toggleHeaded = async () => {
    if (!project) return;
    setHeadedBusy(true);
    try {
      const { project: updated } = await apiRequest<{ project: Project }>(
        `/projects/${projectId}`,
        { appMcpHeaded: !project.appMcpHeaded },
        "PATCH",
      );
      setProject(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setHeadedBusy(false);
    }
  };

  if (error)
    return (
      <p className="mcp-setup-error" role="alert">
        <AlertCircle size={14} /> {error}
      </p>
    );
  if (!project || !tools)
    return (
      <div className="loading">
        <ScanLine />
        Loading AppMCP…
      </div>
    );

  const endpoint = window.location.origin + `/api/projects/${projectId}/appmcp`;
  const serverName = `unfold-appmcp-${
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  }`;
  // Every /api/projects/:id/* route (this one included) sits behind
  // requireAuth (apps/server/src/auth.ts) — a bare {url} entry with no
  // Authorization header has neither a session cookie (an external MCP
  // client is a separate process, not the browser) nor a bearer token, so
  // it 401s outright. Matches the pattern main.tsx's own MCP setup panel
  // (the project-level /mcp endpoint, used by Codex/Claude/Copilot) already
  // uses — `type: "http"` plus a bearer header with a real personal access
  // token from Settings → Extensions.
  const config = JSON.stringify(
    format === "vscode"
      ? {
          inputs: [
            {
              id: "unfold-token",
              type: "promptString",
              description: "Unfold personal access token",
              password: true,
            },
          ],
          servers: {
            [serverName]: {
              type: "http",
              url: endpoint,
              headers: { Authorization: "Bearer ${input:unfold-token}" },
            },
          },
        }
      : {
          mcpServers: {
            [serverName]: {
              type: "http",
              url: endpoint,
              headers: { Authorization: "Bearer YOUR_UNFOLD_ACCESS_TOKEN" },
            },
          },
        },
    null,
    2,
  );

  return (
    <div className="mcp-setup-appmcp">
      <div className="mcp-setup-endpoint">
        <span>Streamable HTTP endpoint</span>
        <code>{endpoint}</code>
        <CopyButton value={endpoint} />
      </div>
      <div className="mcp-setup-format-row">
        <label className="field-label">Client configuration</label>
        <div
          className="mcp-setup-clients"
          role="tablist"
          aria-label="Config format"
        >
          <button
            type="button"
            role="tab"
            aria-selected={format === "generic"}
            className={format === "generic" ? "active" : ""}
            onClick={() => setFormat("generic")}
          >
            Claude / generic
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={format === "vscode"}
            className={format === "vscode" ? "active" : ""}
            onClick={() => setFormat("vscode")}
          >
            VS Code
          </button>
        </div>
      </div>
      <pre className="mcp-setup-code">
        <code>{config}</code>
        <CopyButton value={config} />
      </pre>
      {format === "vscode" && (
        <p className="wizard-help">
          Save this as <code>.vscode/mcp.json</code>. VS Code will prompt you
          for the token (via the <code>inputs</code> block above) the first time
          it connects, rather than storing it in the file — safe even if this
          file ends up committed to the repo.
        </p>
      )}
      <label className="appmcp-headed-toggle">
        <input
          type="checkbox"
          checked={project.appMcpHeaded}
          disabled={headedBusy}
          onChange={toggleHeaded}
        />
        Run headed (debug) — show the browser window on the server instead of
        running it invisibly.
      </label>
      <label className="field-label">Tools</label>
      <ToolCatalog
        tools={tools}
        outputHint="Result of the capability's browser replay, returned as the tool call's JSON content."
        emptyLabel="No published capabilities yet — publish one from the Capabilities tab to expose it here."
      />
      <div className="mcp-setup-auth">
        <ShieldCheck size={16} />
        <div>
          <p>
            Replace <code>YOUR_UNFOLD_ACCESS_TOKEN</code> above with a real
            personal access token (Settings → Extensions → create one) — this
            endpoint requires it the same as every other Unfold API route;
            without it, the connection fails with "authentication_required".
          </p>
          <p>
            Each connection gets its own browser (headed or headless, above),
            kept alive for that connection's calls. A failed call returns page
            context and a suggestion instead of a bare error.
          </p>
        </div>
      </div>
    </div>
  );
}
