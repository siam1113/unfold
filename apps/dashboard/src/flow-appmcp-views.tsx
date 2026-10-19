import { useEffect, useState } from "react";
import {
  AlertCircle,
  ScanLine,
  Copy,
  Check,
  ShieldCheck,
} from "lucide-react";
import type { Project, ProjectData } from "../../../packages/shared/src/index";
import type { Risk } from "../../../packages/capability-core/src/types";
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

const riskLabel: Record<Risk, string> = {
  read: "Read-only",
  reversible_write: "Reversible write",
  irreversible_write: "Irreversible write",
};

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
  const config = JSON.stringify(
    { mcpServers: { [serverName]: { url: endpoint } } },
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
      <label className="field-label">Client configuration</label>
      <pre className="mcp-setup-code">
        <code>{config}</code>
        <CopyButton value={config} />
      </pre>
      <label className="appmcp-headed-toggle">
        <input
          type="checkbox"
          checked={project.appMcpHeaded}
          disabled={headedBusy}
          onChange={toggleHeaded}
        />
        Run headed (debug) — show the browser window on the server instead
        of running it invisibly.
      </label>
      {tools.length > 0 && (
        <>
          <label className="field-label">Tools</label>
          {tools.map((tool) => (
            <div className="mcp-item" key={tool.name}>
              <code>{tool.name}</code>
              <span>
                {tool.description} — {riskLabel[tool.risk]}
              </span>
            </div>
          ))}
        </>
      )}
      <div className="mcp-setup-auth">
        <ShieldCheck size={16} />
        <p>
          Each connection gets its own browser (headed or headless, above),
          kept alive for that connection's calls. A failed call returns page
          context and a suggestion instead of a bare error.
        </p>
      </div>
    </div>
  );
}
