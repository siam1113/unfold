import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useLocation,
  Navigate,
} from "react-router";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type NodeProps,
  type Node,
  type Edge,
  type EdgeProps,
} from "reactflow";
import {
  Layers,
  Network,
  Box,
  MousePointer2,
  FolderDown,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  Play,
  Pause,
  Check,
  X,
  MoreHorizontal,
  ShieldCheck,
  Circle,
  Route as RouteIcon,
  ArrowLeft,
  ExternalLink,
  Copy,
  FileJson,
  FileCode2,
  FileText,
  Download,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  Link2,
  Clock3,
  AlertCircle,
  CheckCircle2,
  ScanLine,
  Activity,
  Command,
  ArrowRight,
  LayoutGrid,
  List,
  Compass,
  Fingerprint,
  GitBranch,
  GitCompareArrows,
  RefreshCw,
  FolderKanban,
  Cable,
  Wrench,
  Bot,
  Archive,
  LogOut,
  Settings2,
  Send,
  MonitorPlay,
  Settings,
  Info,
  TriangleAlert,
  Image as ImageIcon,
  FileSearch,
} from "lucide-react";
import type {
  RunSummary,
  RunData,
  AppState,
  UIElement,
  ActionEdge,
  Component,
  ScanConfig,
  ProjectSummary,
  ProjectData,
  ApiCall,
  UserSettings,
} from "../../../packages/shared/src/index";
import "reactflow/dist/style.css";
import "./styles.css";
import { downloadFlowSvg } from "./flow-image-export";
const ComponentReuseMap = React.lazy(() =>
  import("./flow-structure-views").then((module) => ({
    default: module.ComponentReuseMap,
  })),
);
const ControlSurfaceMap = React.lazy(() =>
  import("./flow-structure-views").then((module) => ({
    default: module.ControlSurfaceMap,
  })),
);
const StateSimilarityReview = React.lazy(() =>
  import("./flow-structure-views").then((module) => ({
    default: module.StateSimilarityReview,
  })),
);
const OutcomeFunnelView = React.lazy(() =>
  import("./flow-reliability-views").then((module) => ({
    default: module.OutcomeFunnelView,
  })),
);
const FailureHotspotsView = React.lazy(() =>
  import("./flow-reliability-views").then((module) => ({
    default: module.FailureHotspotsView,
  })),
);
const PolicyGatesView = React.lazy(() =>
  import("./flow-reliability-views").then((module) => ({
    default: module.PolicyGatesView,
  })),
);
const LatencyPathView = React.lazy(() =>
  import("./flow-reliability-views").then((module) => ({
    default: module.LatencyPathView,
  })),
);
const WorkerSwimlanes = React.lazy(() =>
  import("./flow-ops-views").then((module) => ({
    default: module.WorkerSwimlanes,
  })),
);
const FrontierQueueMap = React.lazy(() =>
  import("./flow-ops-views").then((module) => ({
    default: module.FrontierQueueMap,
  })),
);
const ActionRequestTraceView = React.lazy(() =>
  import("./flow-dependency-views").then((module) => ({
    default: module.ActionRequestTraceView,
  })),
);
const EvidenceTrailView = React.lazy(() =>
  import("./flow-dependency-views").then((module) => ({
    default: module.EvidenceTrailView,
  })),
);
const RouteApiMapView = React.lazy(() =>
  import("./flow-dependency-views").then((module) => ({
    default: module.RouteApiMapView,
  })),
);
const RunComparisonView = React.lazy(() =>
  import("./flow-dependency-views").then((module) => ({
    default: module.RunComparisonView,
  })),
);
const UiApiSwimlane = React.lazy(() =>
  import("./flow-evidence-views").then((module) => ({
    default: module.UiApiSwimlane,
  })),
);
const ServiceDependencyMap = React.lazy(() =>
  import("./flow-evidence-views").then((module) => ({
    default: module.ServiceDependencyMap,
  })),
);
const BrowserSideEffectMap = React.lazy(() =>
  import("./flow-evidence-views").then((module) => ({
    default: module.BrowserSideEffectMap,
  })),
);
const FlowBrowserLifecycleView = React.lazy(() =>
  import("./flow-browser-lifecycle").then((module) => ({
    default: module.FlowBrowserLifecycleView,
  })),
);
const RequestLifecycleTrace = React.lazy(() =>
  import("./flow-evidence-views").then((module) => ({
    default: module.RequestLifecycleTrace,
  })),
);
const TopologyAnalysisView = React.lazy(() =>
  import("./flow-topology-analysis").then((module) => ({
    default: module.TopologyAnalysisView,
  })),
);
const WorkflowQualityLens = React.lazy(() =>
  import("./flow-workflow-quality").then((module) => ({
    default: module.WorkflowQualityLens,
  })),
);
const FlowLifecycleHub = React.lazy(() =>
  import("./flow-lifecycle-views").then((module) => ({
    default: module.FlowLifecycleHub,
  })),
);
const ReplayStoryboardView = React.lazy(() =>
  import("./flow-replay-coverage-views").then((module) => ({
    default: module.ReplayStoryboardView,
  })),
);
const CoverageOutcomeMapView = React.lazy(() =>
  import("./flow-replay-coverage-views").then((module) => ({
    default: module.CoverageOutcomeMapView,
  })),
);
const FlowExecutionAnalysisView = React.lazy(() =>
  import("./flow-execution-analysis").then((module) => ({
    default: module.FlowExecutionAnalysisView,
  })),
);
const FlowRecordingView = React.lazy(() =>
  import("./flow-replay-coverage-views").then((module) => ({
    default: module.FlowRecordingView,
  })),
);
type Icon = typeof Layers;
type FlowViewMode =
  | "canvas"
  | "blocks"
  | "text"
  | "routes"
  | "journey"
  | "matrix"
  | "timeline"
  | "coverage"
  | "actions"
  | "components"
  | "controls"
  | "similarity"
  | "outcomes"
  | "failures"
  | "policy"
  | "latency"
  | "api-map"
  | "api-trace"
  | "workers"
  | "frontier"
  | "evidence"
  | "compare"
  | "swimlane"
  | "services"
  | "side-effects"
  | "request-life"
  | "topology"
  | "workflow"
  | "lifecycle"
  | "replay"
  | "coverage-map"
  | "execution"
  | "user-flows-functional"
  | "user-flows-e2e"
  | "user-flows-recordings";
type AdditionalFlowViewMode = Exclude<
  FlowViewMode,
  | "canvas"
  | "blocks"
  | "text"
  | "routes"
  | "journey"
  | "user-flows-functional"
  | "user-flows-e2e"
  | "user-flows-recordings"
>;
function FlowLifecycleController({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: { kind: "state" | "action"; id: string }) => void;
}) {
  const [latestData, setLatestData] = useState<RunData | null>(null);
  const [availableRuns, setAvailableRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [comparison, setComparison] = useState<RunData[]>([]);
  const [repeatabilityIds, setRepeatabilityIds] = useState<string[]>([]);
  const [repeatabilityRuns, setRepeatabilityRuns] = useState<RunData[]>([]);
  const [runsIndexLoaded, setRunsIndexLoaded] = useState(false);
  const repeatabilityInitializedFor = useRef("");
  const [error, setError] = useState("");
  useEffect(() => setLatestData(data), [data]);
  const refreshCurrentRun = useCallback(async () => {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(data.run.id)}`,
      { credentials: "same-origin" },
    );
    if (!response.ok)
      throw new Error("Could not refresh the active discovery.");
    const current = (await response.json()) as RunData;
    setLatestData(current);
  }, [data.run.id]);
  useEffect(() => {
    let active = true;
    setRunsIndexLoaded(false);
    repeatabilityInitializedFor.current = "";
    fetch("/api/runs", { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not list discoveries.");
        return response.json() as Promise<RunSummary[]>;
      })
      .then((runs) => {
        if (!active) return;
        setAvailableRuns(runs.filter((run) => run.id !== data.run.id));
        setRunsIndexLoaded(true);
      })
      .catch(
        (cause) =>
          active &&
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not list discoveries.",
          ),
      );
    return () => {
      active = false;
    };
  }, [data.run.id]);
  useEffect(() => {
    if (!runsIndexLoaded || repeatabilityInitializedFor.current === data.run.id)
      return;
    const compatible = availableRuns
      .filter((run) => run.projectId === data.run.projectId)
      .filter(
        (run) =>
          (run.config.roleLabel || "") === (data.run.config.roleLabel || "") &&
          (run.config.localeLabel || "") ===
            (data.run.config.localeLabel || ""),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 4)
      .map((run) => run.id);
    setRepeatabilityIds(compatible);
    repeatabilityInitializedFor.current = data.run.id;
  }, [
    runsIndexLoaded,
    availableRuns,
    data.run.id,
    data.run.projectId,
    data.run.config.roleLabel,
    data.run.config.localeLabel,
  ]);
  useEffect(() => {
    if (!repeatabilityIds.length) {
      setRepeatabilityRuns([]);
      return;
    }
    const abort = new AbortController();
    Promise.all(
      repeatabilityIds.slice(0, 4).map(async (id) => {
        const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error("Could not load a selected repeatability discovery.");
        return response.json() as Promise<RunData>;
      }),
    )
      .then((runs) => setRepeatabilityRuns(runs))
      .catch(
        (cause) =>
          !abort.signal.aborted &&
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load selected repeatability discoveries.",
          ),
      );
    return () => abort.abort();
  }, [repeatabilityIds]);
  useEffect(() => {
    if (!selectedId) {
      setComparison([]);
      return;
    }
    const abort = new AbortController();
    setError("");
    fetch(`/api/runs/${encodeURIComponent(selectedId)}`, {
      credentials: "same-origin",
      signal: abort.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error("Could not load the selected discovery.");
        return response.json() as Promise<RunData>;
      })
      .then((run) => setComparison([run]))
      .catch(
        (cause) =>
          !abort.signal.aborted &&
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the selected discovery.",
          ),
      );
    return () => abort.abort();
  }, [selectedId]);
  return (
    <div className="flow-lifecycle-controller">
      {error && (
        <p role="alert" className="flow-lifecycle-error">
          {error}
        </p>
      )}
      <FlowLifecycleHub
        data={latestData || data}
        availableRuns={availableRuns}
        comparisonRuns={comparison}
        repeatabilityRuns={repeatabilityRuns}
        repeatabilityRunIds={repeatabilityIds}
        onRepeatabilityRunsChange={(ids) =>
          setRepeatabilityIds(ids.slice(0, 4))
        }
        selectedComparisonId={selectedId}
        onComparisonChange={setSelectedId}
        onSelect={onSelect}
        onRefresh={refreshCurrentRun}
        autoRefreshPulse={(latestData || data).run.status === "running"}
      />
    </div>
  );
}
const api = async <T,>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> => {
  const res = await fetch(
    "/api" + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || "Request failed");
  return value;
};
type AuthProfile = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};
function AuthGate() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [user, setUser] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void fetch("/auth/status")
      .then((response) => response.json())
      .then(async (status: { configured: boolean }) => {
        if (!active) return;
        setConfigured(status.configured);
        if (status.configured) {
          const response = await fetch("/auth/me");
          if (response.ok) {
            const result = (await response.json()) as { user: AuthProfile };
            if (active) setUser(result.user);
          }
        }
      })
      .catch(() => active && setConfigured(false))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  if (loading)
    return (
      <div className="auth-loading">
        <span className="brand-mark">
          <Layers size={22} />
        </span>
      </div>
    );
  if (!configured)
    return (
      <AuthPage>
        <div className="auth-brand">
          <span className="brand-mark">
            <Layers size={22} />
          </span>
          <span>UNFOLD</span>
        </div>
        <div className="auth-eyebrow">Secure workspace</div>
        <h1>Authentication needs setup</h1>
        <p>
          Connect an Auth0 Regular Web Application to enable sign in, account
          creation, and password recovery.
        </p>
        <div className="auth-setup">
          <strong>Server configuration</strong>
          <code>
            AUTH0_DOMAIN · AUTH0_CLIENT_ID · AUTH0_CLIENT_SECRET · AUTH0_SECRET
            · APP_BASE_URL
          </code>
          <small>
            Set these in .env.local and restart Unfold. An API audience is only
            needed when issuing tokens for a custom API.
          </small>
        </div>
      </AuthPage>
    );
  return user ? (
    <BrowserRouter>
      <App user={user} />
    </BrowserRouter>
  ) : (
    <BrowserRouter>
      <AuthScreen />
    </BrowserRouter>
  );
}
function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">{children}</section>
    </main>
  );
}
function AuthScreen() {
  const location = useLocation();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const authError = new URLSearchParams(location.search).has("auth_error");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthPage>
      <div className="auth-brand">
        <span className="brand-mark">
          <Layers size={22} />
        </span>
        <span>UNFOLD</span>
      </div>
      {mode === "forgot" ? (
        <>
          <div className="auth-eyebrow">Account recovery</div>
          <h1>Reset your password</h1>
          <p>
            Enter the email address on your account. Auth0 will send a reset
            link if it matches.
          </p>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
            <button className="auth-primary" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
              <ArrowRight size={16} />
            </button>
          </form>
          {message && (
            <div className="auth-message" role="status">
              {message}
            </div>
          )}
          <button
            className="auth-back"
            onClick={() => {
              setMode("signin");
              setMessage("");
            }}
          >
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <div className="auth-eyebrow">
            Your application intelligence workspace
          </div>
          <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p>
            {mode === "signup"
              ? "Create a secure workspace to map and understand your applications."
              : "Sign in to continue to your projects and discoveries."}
          </p>
          {authError && (
            <div className="auth-message" role="alert">
              Sign in could not be completed. Please try again.
            </div>
          )}
          <a
            className="auth-primary auth-link"
            href={`/auth/login${mode === "signup" ? "?mode=signup" : ""}`}
          >
            {mode === "signup" ? "Create account" : "Continue with Auth0"}
            <ArrowRight size={16} />
          </a>
          {mode === "signin" && (
            <button className="auth-back" onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          )}
          <div className="auth-switch">
            {mode === "signup" ? "Already have an account?" : "New to Unfold?"}{" "}
            <button
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </div>
          <div className="auth-legal">
            Protected sign-in and password recovery powered by Auth0.
          </div>
        </>
      )}
    </AuthPage>
  );
}
const compact = (n: number) =>
  Intl.NumberFormat("en", {
    notation: n > 9999 ? "compact" : "standard",
  }).format(n);
const duration = (ms: number) =>
  ms < 60000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
const shortPath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
const stateName = (s: AppState) => {
  const region = s.visibleRegionSummary.find((r) =>
    /^(dialog|drawer|menu|tab|details):/.test(r),
  );
  return region
    ? region.split(":").slice(1).join(":") || region.split(":")[0]
    : shortPath(s.url) === "/"
      ? "Overview"
      : shortPath(s.url).split("/").filter(Boolean).pop() || s.title;
};
const stateKind = (s: AppState) =>
  s.visibleRegionSummary.some((r) => r.startsWith("dialog:"))
    ? "dialog"
    : s.visibleRegionSummary.some((r) => r.startsWith("drawer:"))
      ? "drawer"
      : s.visibleRegionSummary.some((r) => r.startsWith("menu:"))
        ? "menu"
        : s.recipe.steps.length
          ? "interaction"
          : "page";
const effectLabel = (s: string) => s.replaceAll("_", " ");
const stateSummary = (s: AppState) => {
  const summary = s.visibleRegionSummary.find(
    (region) => !/^(dialog|drawer|menu|tab|details):/.test(region),
  );
  return summary || s.title || "Observed interface state";
};
const actionDestination = (action: ActionEdge, states: AppState[]) => {
  const destination = states.find((state) => state.id === action.toStateId);
  if (destination) return stateName(destination);
  if (action.afterUrl && action.afterUrl !== action.beforeUrl)
    return shortPath(action.afterUrl);
  return "same screen";
};
const flowLabelPart = (value: string, max = 24) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {effectLabel(value)}
    </span>
  );
}
function Empty({
  icon: Icon = Compass,
  title,
  detail,
  children,
}: {
  icon?: Icon;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={30} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children}
    </div>
  );
}
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      title="Copy to clipboard"
      onClick={() =>
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
function McpSetup({
  projects,
  initialProjectId,
  close,
}: {
  projects: ProjectSummary[];
  initialProjectId?: string;
  close: () => void;
}) {
  const [projectId, setProjectId] = useState(
    initialProjectId ||
      projects.find((project) => !project.archivedAt)?.id ||
      "",
  );
  const [client, setClient] = useState<"codex" | "claude" | "copilot">("codex");
  const project = projects.find((item) => item.id === projectId);
  const endpoint = project
    ? `${window.location.origin}/api/projects/${project.id}/mcp`
    : "https://your-unfold-host/api/projects/PROJECT_ID/mcp";
  const name = "unfold";
  const snippets = {
    codex: `# Set this in the environment before starting Codex\nexport UNFOLD_MCP_TOKEN="your-access-token"\n\n# Add this to ~/.codex/config.toml\n[mcp_servers.${name}]\nurl = "${endpoint}"\nbearer_token_env_var = "UNFOLD_MCP_TOKEN"`,
    claude: `export UNFOLD_MCP_TOKEN="your-access-token"\nclaude mcp add --transport http ${name} ${endpoint} --header "Authorization: Bearer $UNFOLD_MCP_TOKEN"`,
    copilot: JSON.stringify(
      {
        mcpServers: {
          [name]: {
            type: "http",
            url: endpoint,
            headers: {
              Authorization: "Bearer YOUR_UNFOLD_ACCESS_TOKEN",
            },
          },
        },
      },
      null,
      2,
    ),
    mcpjson: JSON.stringify(
      {
        mcpServers: {
          [name]: {
            type: "http",
            url: endpoint,
            headers: {
              Authorization: "Bearer YOUR_UNFOLD_ACCESS_TOKEN",
            },
          },
        },
      },
      null,
      2,
    ),
  };
  const instructions = {
    codex:
      "Add the server block to ~/.codex/config.toml, set the token in the environment where Codex starts, then restart Codex.",
    claude:
      "Run this command from your project. Claude Code stores the server for this project; add --scope user after mcp add if you want it available everywhere.",
    copilot:
      "Save this portable config as ~/.copilot/mcp-config.json (or under $COPILOT_HOME/mcp-config.json). Start a new Copilot session to load the Unfold tools.",
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  return (
    <div
      className="mcp-setup-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="mcp-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-setup-title"
      >
        <header className="mcp-setup-header">
          <div className="mcp-setup-mark">
            <Cable size={18} />
          </div>
          <div>
            <h2 id="mcp-setup-title">Connect an agent</h2>
            <p>
              Set up Codex, Claude Code, Copilot, VS Code, or another client for
              this project’s MCP.
            </p>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close setup"
          >
            <X size={17} />
          </button>
        </header>
        {projects.filter((item) => !item.archivedAt).length ? (
          <>
            <label className="mcp-setup-project">
              <span>Project</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {projects
                  .filter((item) => !item.archivedAt)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="mcp-setup-endpoint">
              <span>Project endpoint</span>
              <code>{endpoint}</code>
              <CopyButton value={endpoint} />
            </div>
            <div className="mcp-setup-capabilities">
              <span>
                <Check size={14} /> Read discoveries, components, routes, and
                captured flows
              </span>
              <span>
                <Check size={14} /> Start a discovery from your agent
              </span>
            </div>
            <div
              className="mcp-setup-clients"
              role="tablist"
              aria-label="Agent client"
            >
              {(["codex", "claude", "copilot"] as const).map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={client === id}
                  className={client === id ? "active" : ""}
                  onClick={() => setClient(id)}
                >
                  {id === "codex"
                    ? "Codex"
                    : id === "claude"
                      ? "Claude Code"
                      : "Copilot"}
                </button>
              ))}
            </div>
            <p className="mcp-setup-instructions">{instructions[client]}</p>
            <pre className="mcp-setup-code">
              <code>{snippets[client]}</code>
              <CopyButton value={snippets[client]} />
            </pre>
            <div className="mcp-setup-auth">
              <ShieldCheck size={16} />
              <p>
                This endpoint requires a valid Unfold access token with the
                configured API audience. Replace the placeholder before
                connecting. Ask your workspace admin if you need a token.
              </p>
            </div>
          </>
        ) : (
          <div className="mcp-setup-empty">
            <p>
              Create a project before connecting an agent. Each MCP connection
              is scoped to one project.
            </p>
            <button className="button primary" onClick={close}>
              Close setup
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
type DiscoveryHeaderActions = {
  runId: string;
  status: string;
  busy: boolean;
  running: boolean;
  controlLabel: string;
  error?: string;
  stopReason?: string;
  onControl: () => void;
  onExport: () => void;
  onInfo: () => void;
};

function App({ user }: { user: AuthProfile }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [runs, setRuns] = useState<RunSummary[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [newProject, setNewProject] = useState(false),
    [mcpSetup, setMcpSetup] = useState(false),
    [projectTool, setProjectTool] = useState<"mcp" | "agent" | null>(null),
    [flowAssistantOpen, setFlowAssistantOpen] = useState(false),
    [discoveryNoticeOpen, setDiscoveryNoticeOpen] = useState(false),
    [discoveryHeaderActions, setDiscoveryHeaderActions] =
      useState<DiscoveryHeaderActions | null>(null),
    [userSettings, setUserSettings] = useState<UserSettings>(),
    [toast, setToast] = useState("");
  const location = useLocation(),
    navigate = useNavigate();
  const closeProjectTool = useCallback(() => {
    setProjectTool(null);
    setFlowAssistantOpen(false);
  }, []);
  const openProjectTool = useCallback((tool: "mcp" | "agent") => {
    setFlowAssistantOpen(false);
    setProjectTool(tool);
  }, []);
  const openFlowAssistant = useCallback(() => {
    setProjectTool(null);
    setFlowAssistantOpen(true);
  }, []);
  const closeFlowAssistant = useCallback(() => setFlowAssistantOpen(false), []);
  const updateDiscoveryHeaderActions = useCallback(
    (actions: DiscoveryHeaderActions | null) =>
      setDiscoveryHeaderActions(actions),
    [],
  );
  const projectChoices = projects.filter((project) => !project.archivedAt);
  const selectedProject =
    projectChoices.find((project) => location.pathname.includes(project.id)) ||
    projectChoices[0];
  const refresh = useCallback(
    () =>
      Promise.all([
        api<ProjectSummary[]>("/projects"),
        api<RunSummary[]>("/runs"),
      ])
        .then(([p, r]) => {
          setProjects(p);
          setRuns(r);
          setLoaded(true);
          setError("");
        })
        .catch((e) => {
          setError(e.message);
          setLoaded(true);
        }),
    [],
  );
  useEffect(() => {
    refresh();
    api<UserSettings>("/settings")
      .then(setUserSettings)
      .catch((e) => setError(e.message));
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      const theme = userSettings?.theme ?? "system";
      root.dataset.theme =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme;
    };
    applyTheme();
    root.dataset.fontFamily = userSettings?.fontFamily ?? "ibm-plex-sans";
    root.dataset.palette = userSettings?.palette ?? "teal";
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    preference.addEventListener("change", applyTheme);
    return () => preference.removeEventListener("change", applyTheme);
  }, [userSettings?.theme, userSettings?.fontFamily, userSettings?.palette]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
      if (e.key === "Escape") {
        setNewProject(false);
        setDiscoveryNoticeOpen(false);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const breadcrumbItems: { label: string; to?: string }[] = [];
  const pathParts = location.pathname.split("/").filter(Boolean);
  const currentProject =
    pathParts[0] === "projects"
      ? projects.find((project) => project.id === pathParts[1])
      : undefined;
  const activeDiscoveryHeaderActions =
    pathParts[2] === "discoveries" &&
    discoveryHeaderActions?.runId === pathParts[3]
      ? discoveryHeaderActions
      : null;
  useEffect(() => {
    setProjectTool(null);
    setFlowAssistantOpen(false);
    setDiscoveryNoticeOpen(false);
    if (!(pathParts[2] === "discoveries" && pathParts[3])) {
      setDiscoveryHeaderActions(null);
    }
  }, [location.pathname]);
  const sectionLabels: Record<string, string> = {
    graph: "Flows",
    states: "States & routes",
    components: "Components",
    actions: "Interactions",
    api: "APIs",
    artifacts: "Artifacts",
  };
  breadcrumbItems.push({ label: "Projects", to: "/projects" });
  if (location.pathname === "/projects" || location.pathname === "/") {
    breadcrumbItems[0] = { label: "Projects" };
  } else if (location.pathname === "/activity") {
    breadcrumbItems.push({ label: "Activity" });
  } else if (location.pathname === "/settings") {
    breadcrumbItems.push({ label: "Settings" });
  } else if (currentProject) {
    const projectPath = `/projects/${currentProject.id}`;
    if (pathParts[2] === "discoveries" && pathParts[3]) {
      const runId = pathParts[3];
      const discoveryPath = `${projectPath}/discoveries/${runId}/graph`;
      breadcrumbItems.push({ label: currentProject.name, to: projectPath });
      breadcrumbItems.push({
        label: "Discovery",
        to: discoveryPath,
      });
      const section = pathParts[4] || "graph";
      breadcrumbItems.push({
        label: sectionLabels[section] || section,
      });
      if (pathParts[5]) breadcrumbItems.push({ label: pathParts[5] });
    } else if (pathParts[2] === "mcp" || pathParts[2] === "agent") {
      breadcrumbItems.push({ label: currentProject.name, to: projectPath });
      breadcrumbItems.push({
        label: pathParts[2] === "mcp" ? "MCP" : "Assistant",
      });
    } else {
      breadcrumbItems.push({ label: currentProject.name, to: projectPath });
      breadcrumbItems.push({ label: "Discoveries" });
    }
  }
  return (
    <div className="app-shell">
      <div className="main-shell">
        <header className="topbar">
          <Link
            className="brand topbar-brand"
            to="/projects"
            aria-label="Unfold home"
          >
            <span className="brand-symbol">
              <Layers size={18} />
            </span>
            unfold
          </Link>
          <nav className="topbar-primary-nav" aria-label="Main navigation">
            <Link
              className={location.pathname === "/projects" ? "active" : ""}
              to="/projects"
              viewTransition
            >
              <LayoutGrid size={15} />
              <span>Dashboard</span>
            </Link>
            <Link
              className={location.pathname === "/activity" ? "active" : ""}
              to="/activity"
              viewTransition
            >
              <Activity size={15} />
              <span>Activity</span>
            </Link>
            <button
              type="button"
              className={location.pathname === "/settings" ? "active" : ""}
              onClick={() => navigate("/settings")}
            >
              <Settings2 size={15} />
              <span>Settings</span>
            </button>
          </nav>
          <div className="topbar-actions">
            <button
              className="topbar-new-project"
              onClick={() => setNewProject(true)}
              aria-label="New project"
              title="New project"
            >
              <Plus size={15} />
            </button>
            <label className="topbar-project-picker">
              <span className="topbar-project-monogram">
                {selectedProject?.name.trim()[0]?.toUpperCase() || (
                  <FolderKanban size={13} />
                )}
              </span>
              <select
                aria-label="Switch project"
                value={selectedProject?.id || ""}
                onChange={(event) =>
                  event.target.value &&
                  navigate(`/projects/${event.target.value}`)
                }
              >
                {!selectedProject && <option value="">Choose project</option>}
                {projectChoices.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <button
              className="topbar-setup"
              onClick={() => setMcpSetup(true)}
              aria-label="Connect agent"
              title="Connect agent"
            >
              <Cable size={16} />
            </button>
            <button
              className="topbar-account"
              onClick={() => navigate("/settings")}
              aria-label={`Global settings${user.email ? ` for ${user.email}` : ""}`}
              title="Global settings"
            >
              {user.picture ? (
                <img src={user.picture} alt="" />
              ) : (
                (user.name || user.email || "U").slice(0, 1).toUpperCase()
              )}
            </button>
            <a
              className="topbar-signout"
              href="/auth/logout"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </a>
          </div>
        </header>
        <nav className="main-breadcrumbs" aria-label="Breadcrumb">
          <div className="breadcrumb-trail">
            {breadcrumbItems.map((item, index) => (
              <React.Fragment key={`${item.label}-${index}`}>
                {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
                {item.to ? (
                  <Link to={item.to} viewTransition title={item.label}>
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" title={item.label}>
                    {item.label}
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
          {currentProject &&
            activeDiscoveryHeaderActions &&
            (activeDiscoveryHeaderActions.error ||
              activeDiscoveryHeaderActions.stopReason) && (
              <div className="discovery-notice-control">
                <button
                  className={`discovery-notice-icon${activeDiscoveryHeaderActions.error ? " error" : " warning"}`}
                  type="button"
                  aria-label="Show discovery error and warning details"
                  aria-haspopup="dialog"
                  aria-expanded={discoveryNoticeOpen}
                  onClick={() => setDiscoveryNoticeOpen((open) => !open)}
                  title="Show discovery details"
                >
                  <TriangleAlert size={17} />
                </button>
                {discoveryNoticeOpen && (
                  <div
                    className="discovery-notice-popover"
                    role="dialog"
                    aria-label="Discovery status details"
                  >
                    <div className="discovery-notice-popover-heading">
                      <strong>Discovery details</strong>
                      <button
                        type="button"
                        aria-label="Close discovery details"
                        onClick={() => setDiscoveryNoticeOpen(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {activeDiscoveryHeaderActions.error && (
                      <section className="discovery-notice-detail error">
                        <strong>Error</strong>
                        <p>{activeDiscoveryHeaderActions.error}</p>
                      </section>
                    )}
                    {activeDiscoveryHeaderActions.stopReason && (
                      <section className="discovery-notice-detail warning">
                        <strong>Warning</strong>
                        <p>
                          {activeDiscoveryHeaderActions.stopReason}. Remaining
                          frontier saved.
                        </p>
                      </section>
                    )}
                  </div>
                )}
              </div>
            )}
          {currentProject && (
            <div
              className="breadcrumb-project-tools"
              aria-label="Project tools"
            >
              {pathParts[2] === "discoveries" &&
                pathParts[3] &&
                discoveryHeaderActions &&
                discoveryHeaderActions.runId === pathParts[3] &&
                discoveryHeaderActions.status !== "completed" && (
                  <button
                    className="discovery-header-icon resume"
                    type="button"
                    onClick={discoveryHeaderActions.onControl}
                    disabled={
                      discoveryHeaderActions.busy ||
                      discoveryHeaderActions.status === "pausing"
                    }
                    aria-label={discoveryHeaderActions.controlLabel}
                    title={discoveryHeaderActions.controlLabel}
                  >
                    {discoveryHeaderActions.running ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                )}
              {pathParts[2] === "discoveries" &&
                pathParts[3] &&
                activeDiscoveryHeaderActions && (
                  <button
                    className="discovery-header-icon"
                    type="button"
                    onClick={activeDiscoveryHeaderActions.onExport}
                    disabled={activeDiscoveryHeaderActions.busy}
                    aria-label="Export discovery"
                    title="Export discovery"
                  >
                    <Download size={16} />
                  </button>
                )}
              <button
                className={projectTool === "agent" ? "active" : ""}
                type="button"
                onClick={() => openProjectTool("agent")}
                aria-label="Open Assistant"
                aria-haspopup="dialog"
                aria-expanded={projectTool === "agent"}
                title="Assistant"
              >
                <Bot size={16} />
              </button>
              <button
                className={projectTool === "mcp" ? "active" : ""}
                type="button"
                onClick={() => openProjectTool("mcp")}
                aria-label="Open MCP connection"
                aria-haspopup="dialog"
                aria-expanded={projectTool === "mcp"}
                title="MCP connection"
              >
                <Wrench size={16} />
              </button>
              {pathParts[2] === "discoveries" &&
                pathParts[3] &&
                activeDiscoveryHeaderActions && (
                  <button
                    className="discovery-header-icon"
                    type="button"
                    onClick={activeDiscoveryHeaderActions.onInfo}
                    aria-label="Discovery information"
                    title="Discovery information"
                  >
                    <Info size={16} />
                  </button>
                )}
            </div>
          )}
        </nav>
        {error && (
          <div className="error-banner">
            <AlertCircle size={16} />
            {error}. Start the engine with <code>npm run server</code>.
            <button onClick={refresh}>Retry</button>
          </div>
        )}
        {!loaded ? (
          <div className="loading">
            <ScanLine />
            Connecting to your workspace…
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route
              path="/projects"
              element={
                <Projects
                  projects={projects}
                  create={() => setNewProject(true)}
                />
              }
            />
            <Route
              path="/activity"
              element={<Runs runs={runs} projects={projects} />}
            />
            <Route
              path="/settings"
              element={
                userSettings ? (
                  <SettingsPage
                    initialSettings={userSettings}
                    back={() => navigate("/projects")}
                    save={async (next) => {
                      const saved = await api<UserSettings>(
                        "/settings",
                        next,
                        "PUT",
                      );
                      setUserSettings(saved);
                      setToast("Settings saved");
                    }}
                  />
                ) : (
                  <div className="loading">Loading settings…</div>
                )
              }
            />
            <Route
              path="/projects/:projectId/discoveries/:id/*"
              element={
                <>
                  <RunView
                    key={location.pathname.split("/")[4]}
                    notify={setToast}
                    refreshRuns={refresh}
                    onOpenAssistant={openFlowAssistant}
                    assistantOpen={flowAssistantOpen}
                    onHeaderActionsChange={updateDiscoveryHeaderActions}
                  />
                  <ProjectWorkspace
                    key={`project-tools-${location.pathname.split("/")[2]}`}
                    refresh={refresh}
                    notify={setToast}
                    globalSettings={userSettings}
                    activeTool={projectTool}
                    closeTool={closeProjectTool}
                    assistantDrawerOpen={flowAssistantOpen}
                    closeAssistantDrawer={closeFlowAssistant}
                    modalHostOnly
                  />
                </>
              }
            />
            <Route
              path="/projects/:projectId"
              element={
                <ProjectWorkspace
                  key={location.pathname.split("/")[2]}
                  refresh={refresh}
                  notify={setToast}
                  globalSettings={userSettings}
                  activeTool={projectTool}
                  closeTool={closeProjectTool}
                  assistantDrawerOpen={flowAssistantOpen}
                  closeAssistantDrawer={closeFlowAssistant}
                />
              }
            />
            <Route
              path="/projects/:projectId/*"
              element={
                <ProjectWorkspace
                  key={location.pathname.split("/")[2]}
                  refresh={refresh}
                  notify={setToast}
                  globalSettings={userSettings}
                  activeTool={projectTool}
                  closeTool={closeProjectTool}
                  assistantDrawerOpen={flowAssistantOpen}
                  closeAssistantDrawer={closeFlowAssistant}
                />
              }
            />
            <Route path="/runs" element={<Navigate to="/projects" replace />} />
            <Route path="/runs/:id/*" element={<LegacyRunRedirect />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        )}
      </div>
      {newProject && (
        <NewProject
          close={() => setNewProject(false)}
          created={async (p) => {
            setNewProject(false);
            await refresh();
            navigate(`/projects/${p.project.id}`);
          }}
        />
      )}
      {mcpSetup && (
        <McpSetup
          projects={projects}
          initialProjectId={selectedProject?.id}
          close={() => setMcpSetup(false)}
        />
      )}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  initialSettings,
  back,
  save,
}: {
  initialSettings: UserSettings;
  back: () => void;
  save: (settings: UserSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "appearance" | "policy" | "defaults"
  >("appearance");
  const setDiscovery = <K extends keyof UserSettings["discovery"]>(
    key: K,
    value: UserSettings["discovery"][K],
  ) =>
    setDraft((current) => ({
      ...current,
      discovery: { ...current.discovery, [key]: value },
    }));
  const numeric = (key: keyof UserSettings["discovery"], value: number) =>
    setDiscovery(key, value as never);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(draft);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save settings",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="settings-page">
      <section
        className="settings-page-content"
        aria-labelledby="settings-title"
      >
        <header className="settings-page-header">
          <div>
            <Link className="settings-back-link" to="/projects">
              <ArrowLeft size={14} /> Dashboard
            </Link>
            <span className="eyebrow">Workspace preferences</span>
            <h1 id="settings-title">Settings</h1>
            <p>
              Choose how Unfold looks and manage defaults for future
              discoveries.
            </p>
          </div>
        </header>
        <div className="settings-page-layout">
          <nav className="settings-tabs" role="tablist" aria-label="Settings">
            {(
              [
                ["appearance", "Appearance"],
                ["policy", "Discovery policy"],
                ["defaults", "Discovery defaults"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls="settings-tab-panel"
                className={activeTab === id ? "active" : ""}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <form onSubmit={submit}>
            <div
              className="settings-tab-panel"
              id="settings-tab-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeTab}`}
            >
              {activeTab === "appearance" && (
                <section className="global-settings-section">
                  <h2>Appearance</h2>
                  <p className="settings-section-intro">
                    Set the theme and typeface used throughout your workspace.
                  </p>
                  <label>
                    <span>Theme</span>
                    <select
                      value={draft.theme}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          theme: event.target.value as UserSettings["theme"],
                        }))
                      }
                    >
                      <option value="system">Use system setting</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <label>
                    <span>Font</span>
                    <select
                      value={draft.fontFamily}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          fontFamily: event.target
                            .value as UserSettings["fontFamily"],
                        }))
                      }
                    >
                      <option value="ibm-plex-sans">IBM Plex Sans</option>
                      <option value="system">System default</option>
                      <option value="atkinson-hyperlegible">
                        Atkinson Hyperlegible
                      </option>
                      <option value="inter">Inter</option>
                      <option value="dm-sans">DM Sans</option>
                      <option value="lato">Lato</option>
                      <option value="nunito-sans">Nunito Sans</option>
                      <option value="source-sans-3">Source Sans 3</option>
                    </select>
                    <small>
                      Applies to menus, controls, and most workspace text.
                    </small>
                  </label>
                  <fieldset className="settings-palette-fieldset">
                    <legend>Color palette</legend>
                    <div className="settings-palette-options">
                      {(
                        [
                          ["teal", "Teal", "#117f83", "#42b9a5", "#dff3ef"],
                          [
                            "blue",
                            "Ocean blue",
                            "#3568c8",
                            "#70a2f4",
                            "#e5efff",
                          ],
                          ["violet", "Violet", "#7951b5", "#ae8ee8", "#f0e9fb"],
                          ["amber", "Amber", "#a66519", "#e7a844", "#fbefda"],
                          ["rose", "Rose", "#bd4f73", "#e98eaa", "#fbe8ee"],
                        ] as const
                      ).map(([id, name, primary, secondary, pale]) => (
                        <button
                          key={id}
                          type="button"
                          className={`settings-palette-option${draft.palette === id ? " selected" : ""}`}
                          onClick={() =>
                            setDraft((current) => ({ ...current, palette: id }))
                          }
                          aria-pressed={draft.palette === id}
                          aria-label={`${name} color palette`}
                          title={name}
                        >
                          <span
                            className="settings-palette-swatches"
                            aria-hidden="true"
                          >
                            <i style={{ background: primary }} />
                            <i style={{ background: secondary }} />
                            <i style={{ background: pale }} />
                          </span>
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                    <small>
                      Choose an accent color for buttons, links, and highlights.
                    </small>
                  </fieldset>
                  <div
                    className={`settings-font-preview preview-${draft.fontFamily}`}
                  >
                    <span>Preview</span>
                    <strong>The quick brown fox jumps over the lazy dog</strong>
                    <small>
                      Readable labels, routes, and discovery details
                    </small>
                  </div>
                </section>
              )}
              {activeTab === "policy" && (
                <section className="global-settings-section">
                  <h3>Discovery policy</h3>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={draft.discovery.safeMode}
                      onChange={(event) =>
                        setDiscovery("safeMode", event.target.checked)
                      }
                    />
                    <span>Safe mode</span>
                    <small>
                      Prevent actions that may change or submit data.
                    </small>
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={draft.discovery.dryRun}
                      onChange={(event) =>
                        setDiscovery("dryRun", event.target.checked)
                      }
                    />
                    <span>Dry run</span>
                    <small>Do not execute state changing actions.</small>
                  </label>
                  <label>
                    <span>Blocked action keywords</span>
                    <textarea
                      rows={4}
                      value={draft.discovery.denyActionKeywords.join("\n")}
                      onChange={(event) =>
                        setDiscovery(
                          "denyActionKeywords",
                          event.target.value
                            .split(/\r?\n/)
                            .map((word) => word.trim())
                            .filter(Boolean),
                        )
                      }
                    />
                    <small>
                      One keyword per line. These remain blocked in project
                      discoveries.
                    </small>
                  </label>
                </section>
              )}
              {activeTab === "defaults" && (
                <section className="global-settings-section">
                  <h3>Default configuration</h3>
                  <div className="settings-grid">
                    {(
                      [
                        ["concurrency", "Concurrency", 1, 16],
                        ["maxDepth", "Maximum depth", 0, 20],
                        ["maxStates", "Maximum states", 1, 10000],
                        ["maxActions", "Maximum actions", 1, 20000],
                        ["maxDurationMinutes", "Time limit (minutes)", 1, 240],
                        [
                          "actionTimeoutMs",
                          "Action timeout (ms)",
                          1000,
                          120000,
                        ],
                        ["settleMs", "Page settle time (ms)", 0, 30000],
                        [
                          "maxBrowserMemoryMB",
                          "Browser memory cap (MB)",
                          256,
                          32768,
                        ],
                        ["maxBrowserCpuPercent", "Browser CPU cap (%)", 1, 100],
                      ] as const
                    ).map(([key, label, min, max]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min={min}
                          max={max}
                          value={draft.discovery[key]}
                          onChange={(event) =>
                            numeric(key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                    <label>
                      <span>Viewport width</span>
                      <input
                        type="number"
                        min={320}
                        max={2560}
                        value={draft.discovery.viewport.width}
                        onChange={(event) =>
                          setDiscovery("viewport", {
                            ...draft.discovery.viewport,
                            width: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Viewport height</span>
                      <input
                        type="number"
                        min={400}
                        max={1600}
                        value={draft.discovery.viewport.height}
                        onChange={(event) =>
                          setDiscovery("viewport", {
                            ...draft.discovery.viewport,
                            height: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={draft.discovery.captureScreenshots}
                      onChange={(event) =>
                        setDiscovery("captureScreenshots", event.target.checked)
                      }
                    />
                    <span>Capture screenshots</span>
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={draft.discovery.captureTracesOnFailure}
                      onChange={(event) =>
                        setDiscovery(
                          "captureTracesOnFailure",
                          event.target.checked,
                        )
                      }
                    />
                    <span>Capture traces when a run fails</span>
                  </label>
                </section>
              )}
            </div>
            {error && (
              <div className="settings-error" role="alert">
                {error}
              </div>
            )}
            <footer className="global-settings-footer">
              <button type="button" className="button" onClick={back}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </main>
  );
}

function LegacyRunRedirect() {
  const { id } = useParams();
  const [projectId, setProjectId] = useState("");
  useEffect(() => {
    if (id)
      api<RunData>(`/runs/${id}`)
        .then((d) => setProjectId(d.run.projectId || ""))
        .catch(() => {});
  }, [id]);
  return projectId ? (
    <Navigate to={`/projects/${projectId}/discoveries/${id}/graph`} replace />
  ) : (
    <div className="loading">Finding project…</div>
  );
}

function Projects({
  projects,
  create,
}: {
  projects: ProjectSummary[];
  create: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const visible = projects.filter(
    (p) => Boolean(p.archivedAt) === showArchived,
  );
  const filtered = visible.filter((p) =>
    `${p.name} ${p.description} ${p.baseUrl}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <main className="runs-page dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <LayoutGrid size={15} />
            Dashboard
          </div>
          <h1>Your projects.</h1>
          <p>
            Discoveries, project context, and a dedicated MCP connection in one
            place.
          </p>
        </div>
        <button className="button primary" onClick={create}>
          <Plus size={16} />
          New project
        </button>
      </div>
      <div className="runs-summary">
        <div>
          <strong>{projects.length}</strong>
          <span>Projects</span>
        </div>
        <div>
          <strong>
            {compact(projects.reduce((s, p) => s + p.discoveryCount, 0))}
          </strong>
          <span>Discoveries</span>
        </div>
        <div>
          <strong>
            {compact(projects.reduce((s, p) => s + p.stats.states, 0))}
          </strong>
          <span>Observed states</span>
        </div>
        <div className="summary-note">
          <ShieldCheck size={25} />
          <p>
            Project-scoped context.
            <br />
            <span>Each MCP connection sees only its project.</span>
          </p>
        </div>
      </div>
      <div className="section-bar">
        <h2>
          {showArchived ? "Archived projects" : "Your projects"}{" "}
          <span>{visible.length}</span>
        </h2>
        <div className="section-actions">
          <button
            className="button"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Active projects" : "Archived"}
          </button>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Find a project…"
          />
        </div>
      </div>
      {!projects.length ? (
        <Empty
          icon={FolderKanban}
          title="Start with a project"
          detail="A project keeps one application's discoveries, MCP tools, and expert-agent context together."
        >
          <button className="button primary" onClick={create}>
            <Plus size={16} />
            Create your first project
          </button>
        </Empty>
      ) : !filtered.length ? (
        <Empty
          title={showArchived ? "No archived projects" : "No matching projects"}
          detail={
            showArchived
              ? "Archived projects will appear here."
              : "Try another name or application URL."
          }
        />
      ) : (
        <div className="run-cards">
          {filtered.map((p) => (
            <Link
              className="run-card project-card"
              to={`/projects/${p.id}`}
              key={p.id}
            >
              <div className="run-card-preview">
                <MiniAtlas states={p.stats.states} active={false} />
                <span className="preview-label">
                  {p.discoveryCount} discoveries · {p.stats.components}{" "}
                  components
                </span>
                <span className="status status-completed">
                  <span />
                  {p.archivedAt ? "archived" : "project"}
                </span>
              </div>
              <div className="run-card-body">
                <span className="app-favicon">{p.name[0]}</span>
                <div>
                  <h3>{p.name}</h3>
                  <p>{new URL(p.baseUrl).host}</p>
                </div>
                <ArrowUpRight size={19} />
              </div>
              <div className="run-card-stats">
                <span>
                  <Layers size={14} />
                  {compact(p.stats.states)} states
                </span>
                <span>
                  <MousePointer2 size={14} />
                  {compact(p.stats.actions)} interactions
                </span>
                <span>
                  {p.discoveryCount
                    ? `${p.discoveryCount} discoveries`
                    : "No discoveries yet"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function NewProject({
  close,
  created,
}: {
  close: () => void;
  created: (p: ProjectData) => void;
}) {
  const [name, setName] = useState(""),
    [url, setUrl] = useState("http://127.0.0.1:4174"),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const p = await api<ProjectData>("/projects", {
        name: name || new URL(url).hostname,
        baseUrl: url,
        description,
      });
      created(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="scan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
      >
        <div className="modal-heading">
          <span className="modal-icon">
            <FolderKanban size={24} />
          </span>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <h2 id="project-title">Create a project</h2>
        <p>
          Give one application its own discovery history, MCP connection, and
          expert-agent instructions.
        </p>
        <form onSubmit={submit}>
          <label>
            Project name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Atlas workspace"
              maxLength={100}
            />
          </label>
          <label>
            Application URL
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://staging.your-app.com"
            />
          </label>
          <label>
            Description <span>Optional</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this application do?"
            />
          </label>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              <Plus size={15} />
              {busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

type AssistantMessage = { role: "user" | "assistant"; content: string };
type AssistantSession = {
  id: string;
  title: string;
  messages: AssistantMessage[];
  updatedAt: number;
};
type AssistantSessionState = {
  sessions: AssistantSession[];
  activeSessionId: string;
};

function createAssistantSession(): AssistantSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New session",
    messages: [],
    updatedAt: Date.now(),
  };
}

function readAssistantSessionState(projectId?: string): AssistantSessionState {
  if (projectId) {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(`unfold:assistant-sessions:${projectId}`) ||
          "null",
      ) as AssistantSessionState | null;
      if (saved?.sessions?.length) {
        const sessions = saved.sessions.filter(
          (session) =>
            typeof session.id === "string" &&
            typeof session.title === "string" &&
            Array.isArray(session.messages),
        );
        if (sessions.length) {
          return {
            sessions,
            activeSessionId: sessions.some(
              (session) => session.id === saved.activeSessionId,
            )
              ? saved.activeSessionId
              : sessions[0].id,
          };
        }
      }
    } catch {
      // Start a clean project session if stored data is invalid or inaccessible.
    }
  }
  const session = createAssistantSession();
  return { sessions: [session], activeSessionId: session.id };
}

function ProjectWorkspace({
  refresh,
  notify,
  globalSettings,
  activeTool,
  closeTool,
  assistantDrawerOpen,
  closeAssistantDrawer,
  modalHostOnly = false,
}: {
  refresh: () => void;
  notify: (s: string) => void;
  globalSettings?: UserSettings;
  activeTool: "mcp" | "agent" | null;
  closeTool: () => void;
  assistantDrawerOpen: boolean;
  closeAssistantDrawer: () => void;
  modalHostOnly?: boolean;
}) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectData>();
  const [error, setError] = useState("");
  const [newDiscovery, setNewDiscovery] = useState(false);
  const [discoveryViewMode, setDiscoveryViewMode] = useState<
    "gallery" | "list"
  >("gallery");
  const [discoveriesFullscreen, setDiscoveriesFullscreen] = useState(false);
  const [assistantSessions, setAssistantSessions] = useState(() =>
    readAssistantSessionState(projectId),
  );
  const [assistantSessionsProjectId, setAssistantSessionsProjectId] =
    useState(projectId);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentActivity, setAgentActivity] = useState<string[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{
    configured: boolean;
    defaultModel: string;
    models: { id: string; label: string; detail: string }[];
  }>();
  const [agentModel, setAgentModel] = useState("");
  const [liveBrowser, setLiveBrowser] = useState<{
    run?: RunSummary;
    state?: AppState;
  }>();
  const activeSession = assistantSessions.sessions.find(
    (session) => session.id === assistantSessions.activeSessionId,
  );
  const agentChat = activeSession?.messages || [];
  const browserStreaming =
    showBrowser &&
    Boolean(
      liveBrowser?.state &&
      liveBrowser.run &&
      ["queued", "running", "pausing"].includes(liveBrowser.run.status),
    );
  useEffect(() => {
    setAssistantSessionsProjectId(projectId);
    setAssistantSessions(readAssistantSessionState(projectId));
    setAgentDraft("");
    setAgentActivity([]);
    setLiveBrowser(undefined);
    setShowBrowser(false);
  }, [projectId]);
  useEffect(() => {
    if (!activeTool && !assistantDrawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (assistantDrawerOpen) closeAssistantDrawer();
        else closeTool();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeTool, assistantDrawerOpen, closeAssistantDrawer, closeTool]);
  useEffect(() => {
    if (!discoveriesFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDiscoveriesFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [discoveriesFullscreen]);
  useEffect(() => {
    if (!projectId || assistantSessionsProjectId !== projectId) return;
    try {
      window.localStorage.setItem(
        `unfold:assistant-sessions:${projectId}`,
        JSON.stringify(assistantSessions),
      );
    } catch {
      // Keep sessions available in memory if browser storage is unavailable.
    }
  }, [assistantSessions, assistantSessionsProjectId, projectId]);
  const load = useCallback(() => {
    if (!projectId) return;
    api<ProjectData>(`/projects/${projectId}`)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => {
    load();
    if (modalHostOnly) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load, modalHostOnly]);
  useEffect(() => {
    if ((activeTool !== "agent" && !assistantDrawerOpen) || !projectId) return;
    let active = true;
    const refreshAgentView = () => {
      api<{
        configured: boolean;
        defaultModel: string;
        models: { id: string; label: string; detail: string }[];
      }>(`/projects/${projectId}/agent/status`)
        .then((value) => {
          if (!active) return;
          setAgentStatus(value);
          setAgentModel((current) =>
            value.models.some((model) => model.id === current)
              ? current
              : value.defaultModel,
          );
        })
        .catch(() => {});
      if (showBrowser) {
        api<{ run?: RunSummary; state?: AppState }>(
          `/projects/${projectId}/agent/live`,
        )
          .then((value) => active && setLiveBrowser(value))
          .catch(() => {});
      }
    };
    refreshAgentView();
    const timer = setInterval(refreshAgentView, 1600);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, activeTool, assistantDrawerOpen, showBrowser]);
  if (error && !data && modalHostOnly) return null;
  if (error && !data)
    return (
      <Empty icon={AlertCircle} title="Project unavailable" detail={error}>
        <Link className="button" to="/projects">
          Back to projects
        </Link>
      </Empty>
    );
  if (!data && modalHostOnly) return null;
  if (!data)
    return (
      <div className="loading">
        <ScanLine />
        Loading project…
      </div>
    );
  const p = data.project;
  const updateActiveSession = (
    messages: AssistantMessage[],
    firstMessage?: string,
  ) => {
    if (!activeSession) return;
    setAssistantSessions((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === activeSession.id
          ? {
              ...session,
              messages,
              title:
                session.title === "New session" && firstMessage
                  ? firstMessage.slice(0, 42)
                  : session.title,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
  };
  const startNewAssistantSession = () => {
    const session = createAssistantSession();
    setAssistantSessions((current) => ({
      sessions: [session, ...current.sessions],
      activeSessionId: session.id,
    }));
    setAgentDraft("");
    setShowBrowser(false);
    setLiveBrowser(undefined);
  };
  const sendAgentMessage = async (message = agentDraft) => {
    const content = message.trim();
    if (!content || agentBusy || !projectId || !activeSession) return;
    const nextChat = [...agentChat, { role: "user" as const, content }];
    updateActiveSession(nextChat, content);
    setAgentDraft("");
    setAgentBusy(true);
    setAgentActivity(["Starting the project agent…"]);
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: agentChat,
          model: agentModel || agentStatus?.defaultModel,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Agent request failed");
      }
      if (!response.body)
        throw new Error("The agent activity stream is unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let complete = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = frame
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (line) {
            const event = JSON.parse(line.slice(6));
            if (event.type === "status") setAgentActivity([event.message]);
            if (event.type === "tool") {
              if (
                event.name === "start_discovery" &&
                event.status === "running"
              ) {
                setShowBrowser(true);
              }
              const mark =
                event.status === "running"
                  ? "…"
                  : event.status === "failed"
                    ? "failed"
                    : "done";
              setAgentActivity((items) => [
                ...items.slice(-4),
                `${event.name} · ${mark}`,
              ]);
            }
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "done") {
              answer = event.message;
              complete = true;
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!complete)
        throw new Error(
          "The agent activity stream ended before the answer arrived",
        );
      updateActiveSession([
        ...nextChat,
        { role: "assistant", content: answer },
      ]);
      setAgentActivity([]);
    } catch (e) {
      updateActiveSession([
        ...nextChat,
        { role: "assistant", content: `Agent error: ${(e as Error).message}` },
      ]);
      setAgentActivity([]);
    } finally {
      setAgentBusy(false);
    }
  };
  const archive = async () => {
    try {
      await api(
        `/projects/${p.id}/${p.archivedAt ? "restore" : "archive"}`,
        {},
      );
      await refresh();
      notify(p.archivedAt ? "Project restored" : "Project archived");
      navigate("/projects");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const serverName = `unfold-${
    p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  }`;
  const config = JSON.stringify(
    {
      mcpServers: {
        [serverName]: { url: window.location.origin + data.mcp.endpoint },
      },
    },
    null,
    2,
  );
  const renderDiscoveryCards = () => (
    <div className={`run-cards discovery-cards ${discoveryViewMode}`}>
      {data.discoveries.map((r) => (
        <Link
          className="run-card"
          to={`/projects/${p.id}/discoveries/${r.id}/graph`}
          key={r.id}
        >
          <div className="run-card-preview">
            <MiniAtlas
              states={r.stats.states}
              active={r.status === "running"}
            />
            <span className="preview-label">{r.config.baseUrl}</span>
            <Status value={r.status} />
          </div>
          <div className="run-card-body">
            <span className="app-favicon">{r.name[0]}</span>
            <div>
              <h3>{r.name}</h3>
              <p>Web discovery · {new Date(r.createdAt).toLocaleString()}</p>
            </div>
            <ArrowUpRight size={19} />
          </div>
          <div className="project-discovery-stats">
            <DiscoveryCardMetric
              icon={RouteIcon}
              value={r.stats.routes}
              label="Routes"
              detail={`${r.stats.states} distinct UI states`}
            />
            <DiscoveryCardMetric
              icon={MousePointer2}
              value={r.stats.executed}
              label="Interactions explored"
              detail={`${r.stats.blocked} safely skipped`}
            />
            <DiscoveryCardMetric
              icon={Box}
              value={r.stats.components}
              label="Components found"
              detail={`${r.stats.elements} interactive elements`}
            />
            <DiscoveryCardMetric
              icon={Fingerprint}
              value={`${r.stats.elements ? Math.round((r.stats.verified / r.stats.elements) * 100) : 0}%`}
              label="Verified locator coverage"
              detail={`${r.stats.verified} of ${r.stats.elements} controls replayed`}
            />
          </div>
        </Link>
      ))}
    </div>
  );
  const discoveryViewControls = (fullscreen = false) => (
    <div
      className="discovery-view-controls"
      role="group"
      aria-label="Discovery view options"
    >
      <button
        type="button"
        className={discoveryViewMode === "gallery" ? "active" : ""}
        aria-label="Gallery view"
        aria-pressed={discoveryViewMode === "gallery"}
        title="Gallery view"
        onClick={() => setDiscoveryViewMode("gallery")}
      >
        <LayoutGrid size={15} />
      </button>
      <button
        type="button"
        className={discoveryViewMode === "list" ? "active" : ""}
        aria-label="List view"
        aria-pressed={discoveryViewMode === "list"}
        title="List view"
        onClick={() => setDiscoveryViewMode("list")}
      >
        <List size={15} />
      </button>
      {fullscreen ? (
        <button
          type="button"
          aria-label="Close fullscreen discoveries"
          title="Close fullscreen"
          onClick={() => setDiscoveriesFullscreen(false)}
        >
          <X size={16} />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Open fullscreen discoveries"
          title="Open fullscreen"
          onClick={() => setDiscoveriesFullscreen(true)}
        >
          <Maximize2 size={15} />
        </button>
      )}
    </div>
  );
  const mcpScreen = (
    <div
      className="project-tool-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Project MCP connection"
    >
      <div className="project-tool-modal-content">
        <header className="project-tool-modal-header">
          <div className="project-tool-modal-title">
            <span className="agent-screen-mark">
              <Cable size={18} />
            </span>
            <div>
              <h2>MCP connection</h2>
              <p>Connect a client to {p.name}.</p>
            </div>
          </div>
          <button
            type="button"
            className="button project-tool-modal-close"
            onClick={closeTool}
            aria-label="Close MCP connection"
            title="Close MCP connection"
          >
            <X size={16} />
            <span>Close</span>
          </button>
        </header>
        <section className="project-panel mcp-modal-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">
                <Cable size={14} />
                Project connection
              </div>
              <h2>Connect an MCP client</h2>
              <p>
                This endpoint exposes read-only tools for this project’s
                discoveries.
              </p>
            </div>
          </div>
          <label className="field-label">Streamable HTTP endpoint</label>
          <div className="endpoint-box">
            <code>{window.location.origin + data.mcp.endpoint}</code>
            <CopyButton value={window.location.origin + data.mcp.endpoint} />
          </div>
          <label className="field-label">Client configuration</label>
          <pre className="code-panel">
            {config}
            <CopyButton value={config} />
          </pre>
          <div className="mcp-columns">
            <div>
              <h3>Tools</h3>
              {data.mcp.tools.map((t) => (
                <div className="mcp-item" key={t}>
                  <code>{t}</code>
                  <span>
                    {t === "start_discovery"
                      ? "Project-scoped, starts a discovery"
                      : "Project-scoped, read-only"}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <h3>Context</h3>
              {data.mcp.resources.map((t) => (
                <div className="mcp-item" key={t}>
                  <code>{t}</code>
                  <span>Resource</span>
                </div>
              ))}
              {data.mcp.prompts.map((t) => (
                <div className="mcp-item" key={t}>
                  <code>{t}</code>
                  <span>Prompt</span>
                </div>
              ))}
            </div>
          </div>
          <p className="muted-note">
            The MCP endpoint is available on this local Unfold server. Clients
            may use a different configuration format; use the endpoint URL when
            prompted.
          </p>
        </section>
      </div>
    </div>
  );
  const assistantScreen = (
    <div
      className={assistantDrawerOpen ? "agent-drawer-backdrop" : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAssistantDrawer();
      }}
    >
      <section
        className={`project-panel agent-panel agent-only-panel ${assistantDrawerOpen ? "agent-drawer" : "agent-fullscreen"} ${browserStreaming ? "agent-browser-visible" : "agent-chat-only"}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          assistantDrawerOpen ? "Assistant chat drawer" : "Assistant workspace"
        }
      >
        <div className="agent-screen-toolbar">
          <div className="agent-screen-title">
            <span className="agent-screen-mark">
              <Bot size={18} />
            </span>
            <div>
              <h2>Assistant</h2>
              <p>Work with discoveries and evidence in {p.name}.</p>
            </div>
          </div>
          <div className="agent-session-controls">
            <label className="agent-session-picker">
              <span>Session</span>
              <span className="agent-select-wrap agent-session-select-wrap">
                <select
                  value={assistantSessions.activeSessionId}
                  onChange={(event) => {
                    setAssistantSessions((current) => ({
                      ...current,
                      activeSessionId: event.target.value,
                    }));
                    setAgentDraft("");
                    setShowBrowser(false);
                    setLiveBrowser(undefined);
                  }}
                  disabled={agentBusy}
                  aria-label="Assistant session"
                >
                  {assistantSessions.sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
            <button
              type="button"
              className="button"
              onClick={startNewAssistantSession}
              disabled={agentBusy}
            >
              <Plus size={15} />
              New session
            </button>
          </div>
          <button
            type="button"
            className="button project-tool-modal-close"
            aria-label="Close Assistant"
            title="Close Assistant"
            onClick={assistantDrawerOpen ? closeAssistantDrawer : closeTool}
          >
            <X size={16} />
            <span>Close</span>
          </button>
        </div>
        <div
          className={`agent-workbench ${browserStreaming ? "" : "agent-chat-only"}`}
        >
          <section className="agent-chat-panel" aria-label="Assistant chat">
            <div className="agent-runtime-status">
              <span
                className={`status-dot ${agentStatus?.configured ? "online" : "offline"}`}
              />
              {agentStatus?.configured
                ? `${agentStatus.models.find((model) => model.id === agentModel)?.label || agentModel} · project MCP tools connected`
                : "Model not configured · set OPENAI_API_KEY on the server"}
            </div>
            <div className="agent-conversation" aria-live="polite">
              {!agentChat.length && (
                <div className="agent-welcome">
                  <span className="agent-welcome-mark">
                    <Bot size={22} />
                  </span>
                  <strong>What should we explore?</strong>
                  <span>
                    Ask the assistant to inspect project evidence, run a browser
                    discovery, or draft tests and prompts.
                  </span>
                  <div
                    className="agent-starters"
                    aria-label="Suggested prompts"
                  >
                    {[
                      "Map the main user journey",
                      "Inspect recent discovery failures",
                      "Draft Playwright tests from the evidence",
                    ].map((prompt) => (
                      <button
                        type="button"
                        key={prompt}
                        onClick={() => setAgentDraft(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {agentChat.map((item, index) => (
                <article
                  className={`agent-message ${item.role}`}
                  key={`${index}-${item.role}`}
                >
                  <span>{item.role === "user" ? "You" : data.agent.name}</span>
                  <pre>{item.content}</pre>
                </article>
              ))}
              {agentBusy && (
                <div className="agent-thinking">
                  <span className="status-dot online" />
                  <div>
                    {agentActivity.map((item, index) => (
                      <span key={`${index}-${item}`}>{item}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <form
              className="agent-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendAgentMessage();
              }}
            >
              <textarea
                value={agentDraft}
                onChange={(event) => setAgentDraft(event.target.value)}
                placeholder="Ask the assistant to inspect, execute, or generate…"
                maxLength={12000}
                disabled={!agentStatus?.configured || agentBusy}
                aria-label="Message the assistant"
              />
              <div className="agent-composer-controls">
                <label className="agent-model-picker">
                  <span>Model</span>
                  <span className="agent-select-wrap agent-model-select-wrap">
                    <select
                      value={agentModel}
                      onChange={(event) => setAgentModel(event.target.value)}
                      disabled={!agentStatus || agentBusy}
                      aria-label="Assistant model"
                    >
                      {(agentStatus?.models || []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                </label>
                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    !agentDraft.trim() || !agentStatus?.configured || agentBusy
                  }
                  aria-label="Send message"
                >
                  <Send size={15} />
                </button>
              </div>
            </form>
          </section>
          {browserStreaming && (
            <section
              className="agent-browser-panel"
              aria-label="Live browser view"
            >
              <div className="agent-browser-heading">
                <div>
                  <MonitorPlay size={15} />
                  <strong>Browser view</strong>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowBrowser(false)}
                  aria-label="Hide browser view"
                  title="Hide browser view"
                >
                  <X size={14} />
                </button>
                <span
                  className={
                    liveBrowser?.run &&
                    ["queued", "running", "pausing"].includes(
                      liveBrowser.run.status,
                    )
                      ? "is-running"
                      : ""
                  }
                >
                  {liveBrowser?.run ? liveBrowser.run.status : "Ready"}
                </span>
              </div>
              <div className="agent-browser-viewport">
                {liveBrowser?.state?.screenshotPath ? (
                  <img
                    src={`/artifacts/${liveBrowser.state.screenshotPath}?v=${encodeURIComponent(liveBrowser.state.discoveredAt)}`}
                    alt={`Latest browser state: ${liveBrowser.state.title}`}
                  />
                ) : (
                  <div className="agent-browser-empty">
                    <MonitorPlay size={24} />
                    <span>
                      {liveBrowser?.run
                        ? "Waiting for the first browser observation…"
                        : "Waiting for the first browser observation…"}
                    </span>
                  </div>
                )}
              </div>
              <div className="agent-browser-caption">
                <strong>
                  {liveBrowser?.state?.title || "No browser state yet"}
                </strong>
                <span>
                  {liveBrowser?.state?.url ||
                    (liveBrowser?.run
                      ? "Browser discovery is starting"
                      : "The latest recorded frame updates during discovery")}
                </span>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
  if (modalHostOnly)
    return (
      <>
        {activeTool === "mcp" && createPortal(mcpScreen, document.body)}
        {(activeTool === "agent" || assistantDrawerOpen) &&
          createPortal(assistantScreen, document.body)}
      </>
    );
  return (
    <main className="run-page project-workspace">
      <div className="page-heading">
        <div>
          <div className="run-kicker">
            <span className="app-favicon small">{p.name[0]}</span>
            <span>{new URL(p.baseUrl).host}</span>
            <ExternalLink size={12} />
          </div>
          <h1>{p.name}</h1>
          <p>
            {p.description ||
              "Project workspace for application discovery and grounded agent context."}
          </p>
        </div>
        <div className="heading-actions">
          {!p.archivedAt && (
            <button
              className="button primary"
              onClick={() => setNewDiscovery(true)}
            >
              <Plus size={15} />
              New discovery
            </button>
          )}
          <button className="button" onClick={archive}>
            <Archive size={15} />
            {p.archivedAt ? "Restore project" : "Archive project"}
          </button>
        </div>
      </div>
      <>
        <div className="section-bar project-discoveries-bar">
          <h2>
            Discoveries <span>{data.discoveries.length}</span>
          </h2>
          {data.discoveries.length > 0 && discoveryViewControls()}
        </div>
        {!data.discoveries.length ? (
          <Empty
            icon={Compass}
            title="No discovery in this project yet"
            detail="Start an exploration to map its screens, components, and interactions."
          >
            <button
              className="button primary"
              onClick={() => setNewDiscovery(true)}
            >
              <ScanLine size={16} />
              Start discovery
            </button>
          </Empty>
        ) : (
          renderDiscoveryCards()
        )}
      </>
      {discoveriesFullscreen &&
        createPortal(
          <div className="discoveries-fullscreen-backdrop">
            <section
              className="discoveries-fullscreen"
              role="dialog"
              aria-modal="true"
              aria-label={`${p.name} discoveries`}
            >
              <header className="discoveries-fullscreen-header">
                <div>
                  <span>{p.name}</span>
                  <h2>Discoveries</h2>
                </div>
                {discoveryViewControls(true)}
              </header>
              {renderDiscoveryCards()}
            </section>
          </div>,
          document.body,
        )}
      {activeTool === "mcp" && createPortal(mcpScreen, document.body)}
      {(activeTool === "agent" || assistantDrawerOpen) &&
        createPortal(assistantScreen, document.body)}
      {newDiscovery && (
        <NewScan
          projectId={p.id}
          projectName={p.name}
          projectUrl={p.baseUrl}
          projectConfig={p.scanConfig}
          globalDefaults={globalSettings?.discovery}
          close={() => setNewDiscovery(false)}
          created={async (r) => {
            setNewDiscovery(false);
            await refresh();
            load();
            navigate(`/projects/${p.id}/discoveries/${r.id}/graph`);
          }}
        />
      )}
    </main>
  );
}
function Runs({
  runs,
  projects,
}: {
  runs: RunSummary[];
  projects: ProjectSummary[];
}) {
  const [query, setQuery] = useState("");
  const filtered = runs.filter((r) =>
    (r.name + r.config.baseUrl).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="runs-page activity-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Activity size={15} />
            Workspace activity
          </div>
          <h1>Activity</h1>
          <p>Recent discovery runs across all your projects.</p>
        </div>
      </div>
      <div className="runs-summary">
        <div>
          <strong>{runs.length}</strong>
          <span>Discoveries</span>
        </div>
        <div>
          <strong>
            {compact(runs.reduce((s, r) => s + r.stats.states, 0))}
          </strong>
          <span>States observed</span>
        </div>
        <div>
          <strong>
            {compact(runs.reduce((s, r) => s + r.stats.verified, 0))}
          </strong>
          <span>Verified controls</span>
        </div>
        <div className="summary-note">
          <ShieldCheck size={25} />
          <p>
            Project activity.
            <br />
            <span>Open a discovery to review its evidence.</span>
          </p>
        </div>
      </div>
      <div className="section-bar">
        <h2>
          Recent discoveries <span>{runs.length}</span>
        </h2>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Find a discovery…"
        />
      </div>
      {!runs.length ? (
        <Empty
          title="No activity yet"
          detail="Discovery runs from all your projects will appear here."
        ></Empty>
      ) : !filtered.length ? (
        <Empty
          title="No matching discoveries"
          detail="Try a different application name or URL."
        />
      ) : (
        <div className="run-cards">
          {filtered.map((r) => (
            <Link
              className="run-card"
              to={
                r.projectId
                  ? `/projects/${r.projectId}/discoveries/${r.id}/graph`
                  : `/runs/${r.id}/graph`
              }
              key={r.id}
            >
              <div className="run-card-preview">
                <MiniAtlas
                  states={r.stats.states}
                  active={r.status === "running"}
                />
                <span className="preview-label">
                  {projects.find((project) => project.id === r.projectId)
                    ?.name || new URL(r.config.baseUrl).host}{" "}
                  · {r.stats.routes} routes
                </span>
                <Status value={r.status} />
              </div>
              <div className="run-card-body">
                <span className="app-favicon">{r.name[0]}</span>
                <div>
                  <h3>{r.name}</h3>
                  <p>
                    {new URL(r.config.baseUrl).host} ·{" "}
                    {projects.find((project) => project.id === r.projectId)
                      ?.name || "Project"}
                  </p>
                </div>
                <ArrowUpRight size={19} />
              </div>
              <div className="run-card-stats">
                <span>
                  <Layers size={14} />
                  {r.stats.states} states
                </span>
                <span>
                  <MousePointer2 size={14} />
                  {r.stats.executed} actions
                </span>
                <span>
                  {new Date(r.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
function MiniAtlas({ states, active }: { states: number; active: boolean }) {
  return (
    <svg className="mini-atlas" viewBox="0 0 400 150" aria-hidden="true">
      {[45, 110, 175, 240, 305, 365]
        .slice(0, Math.max(1, Math.min(6, states)))
        .map((x, i) => (
          <g key={x}>
            {i > 0 && (
              <path
                d={`M ${x - 50} 75 C ${x - 30} 75 ${x - 25} ${i % 2 ? 40 : 105} ${x} ${i % 2 ? 40 : 105}`}
                fill="none"
                stroke="#afc0d6"
              />
            )}
            <rect
              x={x - 20}
              y={(i ? (i % 2 ? 40 : 105) : 75) - 13}
              width="42"
              height="27"
              rx="5"
              fill={active && i === 0 ? "#dee9ff" : "white"}
              stroke="#a9bcd4"
            />
            <path
              d={`M ${x - 11} ${(i ? (i % 2 ? 40 : 105) : 75) - 3} h 20 m -20 6 h 12`}
              stroke="#9faec2"
              strokeWidth="2"
            />
          </g>
        ))}
    </svg>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder = "Search states, routes, controls…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={15} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value ? (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={13} />
        </button>
      ) : (
        <kbd>⌘ K</kbd>
      )}
    </div>
  );
}
function RunView({
  notify,
  refreshRuns,
  onOpenAssistant,
  assistantOpen,
  onHeaderActionsChange,
}: {
  notify: (s: string) => void;
  refreshRuns: () => void;
  onOpenAssistant?: () => void;
  assistantOpen?: boolean;
  onHeaderActionsChange?: (actions: DiscoveryHeaderActions | null) => void;
}) {
  const { id, projectId } = useParams();
  const location = useLocation(),
    navigate = useNavigate();
  const section = projectId
    ? location.pathname.split("/")[5] || "graph"
    : location.pathname.split("/")[3] || "graph";
  const runApi = projectId
    ? `/projects/${projectId}/discoveries/${id}`
    : `/runs/${id}`;
  const [data, setData] = useState<RunData>(),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [selection, setSelection] = useState<{
      kind: "state" | "action";
      id: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const running = data
    ? ["running", "pausing", "queued"].includes(data.run.status)
    : false;
  const controlLabel = !data
    ? "Resume discovery"
    : data.run.status === "pausing"
      ? "Pausing discovery"
      : running
        ? "Pause discovery"
        : data.run.status === "limited"
          ? "Extend and resume discovery"
          : "Resume discovery";
  const refresh = useCallback(() => {
    if (id)
      api<RunData>(runApi)
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message));
  }, [id, runApi]);
  const onControl = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    try {
      if (["running", "pausing", "queued"].includes(data.run.status))
        await api(`${runApi}/pause`, {});
      else
        await api(
          `${runApi}/resume`,
          data.run.status === "limited"
            ? {
                budgets: {
                  maxActions: Math.min(50000, data.run.config.maxActions * 2),
                  maxStates: Math.min(10000, data.run.config.maxStates * 2),
                  maxDurationMinutes: Math.min(
                    240,
                    data.run.config.maxDurationMinutes * 2,
                  ),
                },
              }
            : {},
        );
      refresh();
      refreshRuns();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data, notify, refresh, refreshRuns, runApi]);
  const onExport = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    try {
      const result = await api<{ url: string }>(`${runApi}/export`, {});
      const a = document.createElement("a");
      a.href = result.url;
      a.download = "";
      a.click();
      notify("Export prepared with evidence and generated code");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data, notify, runApi]);
  const onInfo = useCallback(() => setShowInfo(true), []);
  useEffect(() => {
    if (!data || !onHeaderActionsChange) return;
    onHeaderActionsChange({
      runId: data.run.id,
      status: data.run.status,
      busy,
      running,
      controlLabel,
      error: data.run.error || undefined,
      stopReason: data.run.stopReason || undefined,
      onControl,
      onExport,
      onInfo,
    });
  }, [
    data,
    busy,
    running,
    controlLabel,
    onControl,
    onExport,
    onInfo,
    onHeaderActionsChange,
  ]);
  useEffect(() => {
    refresh();
    if (data && !["running", "queued", "pausing"].includes(data.run.status))
      return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh, data?.run.status]);
  useEffect(() => {
    setQuery("");
    setSelection(null);
  }, [section]);
  const statePath = projectId
    ? location.pathname.split("/")[6]
    : location.pathname.split("/")[4];
  useEffect(() => {
    if (statePath) setSelection({ kind: "state", id: statePath });
  }, [statePath]);
  useEffect(() => {
    if (!showInfo) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowInfo(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showInfo]);
  if (error && !data)
    return (
      <Empty icon={AlertCircle} title="Discovery unavailable" detail={error}>
        <Link
          className="button"
          to={projectId ? `/projects/${projectId}/discoveries` : "/projects"}
        >
          Back to discoveries
        </Link>
      </Empty>
    );
  if (!data)
    return (
      <div className="loading">
        <ScanLine />
        Loading discovery…
      </div>
    );
  const r = data.run,
    s = r.stats;
  const chooseState = (id: string) => setSelection({ kind: "state", id });
  const discoverySections = [
    { name: "Flows", path: "graph", icon: Network },
    { name: "States & routes", path: "states", icon: Layers },
    { name: "Components", path: "components", icon: Box },
    { name: "Interactions", path: "actions", icon: MousePointer2 },
    { name: "APIs", path: "api", icon: Activity },
    { name: "Artifacts", path: "artifacts", icon: FolderDown },
  ];
  return (
    <main className="run-page">
      {showInfo && (
        <div
          className="discovery-info-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowInfo(false);
          }}
        >
          <section
            className="discovery-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discovery-info-title"
          >
            <header>
              <div>
                <span className="eyebrow">Discovery overview</span>
                <h2 id="discovery-info-title">{r.name}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close discovery information"
                onClick={() => setShowInfo(false)}
              >
                <X size={16} />
              </button>
            </header>
            <p className="discovery-info-summary">
              Observed {s.routes} routes and {s.states} distinct UI states,
              recorded {s.actions} interactions, and found {s.components}{" "}
              reusable components.
            </p>
            <dl>
              <div>
                <dt>URL</dt>
                <dd>
                  <a href={r.config.baseUrl} target="_blank" rel="noreferrer">
                    {r.config.baseUrl}
                    <ExternalLink size={12} />
                  </a>
                </dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>Web application discovery</dd>
              </div>
              <div>
                <dt>Observed pages</dt>
                <dd>{s.states} distinct UI states</dd>
              </div>
              <div>
                <dt>Routes</dt>
                <dd>{s.routes}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <Status value={r.status} />
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(r.createdAt).toLocaleString()}</dd>
              </div>
              {r.config.roleLabel && (
                <div>
                  <dt>Role</dt>
                  <dd>{r.config.roleLabel}</dd>
                </div>
              )}
              {r.config.localeLabel && (
                <div>
                  <dt>Locale</dt>
                  <dd>{r.config.localeLabel}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      )}
      {projectId && (
        <nav
          className="project-tabs discovery-tabs"
          aria-label="Discovery sections"
        >
          {discoverySections.map((tab) => (
            <Link
              key={tab.path}
              className={section === tab.path ? "active" : ""}
              aria-current={section === tab.path ? "page" : undefined}
              to={`/projects/${projectId}/discoveries/${id}/${tab.path}`}
            >
              <tab.icon size={15} />
              {tab.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="view-heading">
        <div className="view-title">
          <h2>
            {(
              {
                graph: "Flow explorer",
                states: "States & routes",
                components: "Component library",
                actions: "Interaction log",
                api: "APIs",
                artifacts: "Discovery artifacts",
              } as Record<string, string>
            )[section] || "Flow explorer"}
          </h2>
          <span>
            {section === "graph"
              ? "Follow the paths. Inspect the evidence."
              : section === "components"
                ? "Reusable regions, grounded in real observations."
                : section === "actions"
                  ? "Every attempted interaction and its observed outcome."
                  : section === "api"
                    ? "Application API requests observed during routes and interactions."
                    : section === "artifacts"
                      ? "Take your findings from exploration to automation."
                      : "A closer look at every reachable interface."}
          </span>
        </div>
        <SearchBox value={query} onChange={setQuery} />
      </div>
      <div className="content-area">
        {section === "graph" ? (
          <FlowView
            data={data}
            query={query}
            selection={selection}
            onSelect={setSelection}
            onOpenAssistant={onOpenAssistant}
            assistantOpen={assistantOpen}
          />
        ) : section === "states" ? (
          <States data={data} query={query} select={chooseState} />
        ) : section === "components" ? (
          <Components data={data} query={query} select={chooseState} />
        ) : section === "actions" ? (
          <Actions
            data={data}
            query={query}
            select={(id) => setSelection({ kind: "action", id })}
          />
        ) : section === "api" ? (
          <ApiFlow data={data} query={query} />
        ) : section === "artifacts" ? (
          <Artifacts
            data={data}
            query={query}
            download={onExport}
            filesPath={`${runApi}/files`}
          />
        ) : (
          <Navigate
            to={
              projectId
                ? `/projects/${projectId}/discoveries/${id}/graph`
                : `/runs/${id}/graph`
            }
          />
        )}
      </div>
      <footer className="run-footer">
        <span>
          <span className={running ? "online" : "muted-dot"} />
          {running
            ? `${s.active} workers exploring · ${s.pending} tasks queued`
            : `${s.actions} action records collected`}
        </span>
        <span>
          <ShieldCheck size={13} />
          {r.config.safeMode ? "Safe exploration" : "Configured exploration"}
          <span className="footer-separator" />
          <Clock3 size={13} />
          {duration(r.elapsedMs)} elapsed
          <span className="footer-separator" />
          {r.resources
            ? `${r.resources.peakContexts} peak workers · ${Math.round(r.resources.peakBrowserRssMB)} MB browser`
            : `${r.config.concurrency} workers`}
        </span>
      </footer>
      {selection && (
        <Inspector
          data={data}
          selection={selection}
          close={() => {
            setSelection(null);
            if (statePath)
              navigate(
                projectId
                  ? `/projects/${projectId}/discoveries/${id}/states`
                  : `/runs/${id}/states`,
              );
          }}
          select={setSelection}
        />
      )}
    </main>
  );
}
function DiscoveryCardMetric({
  icon: IconComponent,
  value,
  label,
  detail,
}: {
  icon: Icon;
  value: number | string;
  label: string;
  detail: string;
}) {
  return (
    <div className="project-discovery-metric">
      <IconComponent size={14} aria-hidden="true" />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </div>
  );
}
const StateNode = React.memo(function StateNode({
  data,
  selected,
}: NodeProps<{ state: AppState; actions: number }>) {
  const s = data.state,
    kind = stateKind(s);
  return (
    <div className={`state-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className={`node-type ${kind}`}>
        <span>
          {kind === "page" ? (
            <LayoutGrid size={12} />
          ) : kind === "dialog" ? (
            <Box size={12} />
          ) : (
            <GitBranch size={12} />
          )}{" "}
          {effectLabel(kind)}
        </span>
        <span>{s.depth === 0 ? "Entry point" : `Depth ${s.depth}`}</span>
      </div>
      {s.screenshotPath && (
        <div className="node-thumbnail">
          <img loading="lazy" src={`/artifacts/${s.screenshotPath}`} alt="" />
        </div>
      )}
      <div className="node-content">
        <strong>{stateName(s)}</strong>
        <span>{shortPath(s.url)}</span>
        <small className="node-summary">{stateSummary(s)}</small>
        <div>
          <span>
            <MousePointer2 size={10} />
            {data.actions} actions
          </span>
          <span>{s.interactiveElementIds.length} controls</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { state: StateNode };
function ActionLabelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps<{ onSelect?: () => void }>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const labelText =
    typeof label === "string" ? label : "Inspect observed action";
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={24}
      />
      {label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="action-edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 1000,
            }}
            title={labelText}
            aria-label={`Inspect action: ${labelText}`}
            onClick={(event) => {
              event.stopPropagation();
              data?.onSelect?.();
            }}
          >
            {label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const actionEdgeTypes = { action: ActionLabelEdge };
const RouteMapNode = React.memo(function RouteMapNode({
  data,
}: NodeProps<{
  route: string;
  routeTitle?: string;
  screens: number;
  connections: number;
  summary: string;
  states: Array<{ id: string; label: string; summary: string }>;
  onOpen: () => void;
  onSelectState: (id: string) => void;
}>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="route-map-node">
      <Handle type="target" position={Position.Left} />
      <button
        className="route-map-node-button"
        onClick={(event) => {
          event.stopPropagation();
          data.onOpen();
        }}
      >
        <span className="route-map-node-heading">
          <RouteIcon size={14} />
          <strong>
            {data.routeTitle || shortPath(data.route) || data.route}
          </strong>
          <ArrowUpRight size={13} />
        </span>
        <span className="route-map-node-summary">{data.summary}</span>
        <span className="route-map-node-stats">
          <span>{data.screens} screens</span>
          <i />
          <span>{data.connections} route links</span>
        </span>
      </button>
      <button
        className="route-map-expand"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
      >
        {expanded ? "Hide screen states" : `Show ${data.screens} screen states`}
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="route-map-state-list">
          {data.states.slice(0, 8).map((state) => (
            <button
              key={state.id}
              title={state.summary}
              onClick={(event) => {
                event.stopPropagation();
                data.onSelectState(state.id);
              }}
            >
              <span>{state.label}</span>
              <small>{state.summary}</small>
            </button>
          ))}
          {data.states.length > 8 && (
            <small className="route-map-more">
              +{data.states.length - 8} more observed screens
            </small>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const routeMapNodeTypes = { route: RouteMapNode };
function UserFlowsView({
  mode,
  states,
  actions,
  selectedRoute,
  onSelect,
}: {
  mode: "user-flows-functional" | "user-flows-e2e";
  states: AppState[];
  actions: ActionEdge[];
  selectedRoute: string;
  onSelect: (selection: { kind: "state" | "action"; id: string }) => void;
}) {
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const functionalPages = useMemo(
    () =>
      [...states]
        .map((state) => ({
          state,
          actions: actions.filter((action) => action.fromStateId === state.id),
        }))
        .filter((page) => page.actions.length > 0)
        .sort(
          (a, b) =>
            a.state.routeKey.localeCompare(b.state.routeKey) ||
            a.state.depth - b.state.depth ||
            a.state.discoveredAt.localeCompare(b.state.discoveredAt),
        ),
    [states, actions],
  );
  const endToEndPaths = useMemo(() => {
    const actionById = new Map(actions.map((action) => [action.id, action]));
    const children = new Map<
      string,
      { state: AppState; action: ActionEdge }[]
    >();
    const roots: AppState[] = [];
    for (const state of [...states].sort(
      (a, b) =>
        a.depth - b.depth || a.discoveredAt.localeCompare(b.discoveredAt),
    )) {
      const action = state.provenanceActionId
        ? actionById.get(state.provenanceActionId)
        : undefined;
      const parent = action ? stateById.get(action.fromStateId) : undefined;
      if (action && parent && action.toStateId === state.id) {
        children.set(parent.id, [
          ...(children.get(parent.id) || []),
          { state, action },
        ]);
      } else {
        roots.push(state);
      }
    }
    const paths: {
      root: AppState;
      transitions: { from: AppState; to: AppState; action: ActionEdge }[];
    }[] = [];
    const walk = (
      state: AppState,
      transitions: { from: AppState; to: AppState; action: ActionEdge }[],
      ancestors: Set<string>,
    ) => {
      const branches = (children.get(state.id) || []).filter(
        ({ state: child }) => !ancestors.has(child.id),
      );
      if (!branches.length) {
        paths.push({ root: transitions[0]?.from || state, transitions });
        return;
      }
      for (const branch of branches) {
        walk(
          branch.state,
          [
            ...transitions,
            { from: state, to: branch.state, action: branch.action },
          ],
          new Set(ancestors).add(branch.state.id),
        );
      }
    };
    for (const root of roots) walk(root, [], new Set([root.id]));
    return paths;
  }, [states, actions, stateById]);
  const functionalCount = functionalPages.reduce(
    (count, page) => count + page.actions.length,
    0,
  );
  const isFunctional = mode === "user-flows-functional";
  const count = isFunctional ? functionalCount : endToEndPaths.length;
  return (
    <div className="user-flows-scroll">
      <div className="user-flows-document">
        <header className="user-flows-intro">
          <div>
            <h2>{isFunctional ? "Functional flows" : "End-to-end flows"}</h2>
            <p>
              {isFunctional
                ? "One scenario per recorded page action. Each row stands on its own; actions on the same page are not assumed to happen in sequence."
                : "Each scenario follows a recorded first-discovery path from its starting screen to a branch end."}
            </p>
          </div>
          <span className="user-flows-count">
            {count} {isFunctional ? "scenarios" : "paths"}
          </span>
        </header>
        <div className="user-flows-scope">
          <span>Scope</span>
          <strong>
            {selectedRoute
              ? shortPath(selectedRoute) || selectedRoute
              : "All observed pages"}
          </strong>
          <span className="user-flows-scope-hint">
            {selectedRoute
              ? "Choose another page in the route list to narrow these flows."
              : "Choose a page in the route list to focus on its flows."}
          </span>
        </div>
        {isFunctional ? (
          functionalPages.length ? (
            <div className="user-flow-page-list">
              {functionalPages.map(({ state, actions: pageActions }) => (
                <section className="user-flow-card" key={state.id}>
                  <header className="user-flow-card-heading">
                    <div>
                      <span className="user-flow-route">
                        {shortPath(state.routeKey) || state.routeKey}
                      </span>
                      <h3>{stateName(state)}</h3>
                      <p>{stateSummary(state)}</p>
                    </div>
                    <button
                      className="user-flow-inspect"
                      onClick={() => onSelect({ kind: "state", id: state.id })}
                    >
                      Inspect page
                    </button>
                  </header>
                  <div className="user-flow-table-scroll">
                    <table className="user-flow-table">
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Observed result</th>
                          <th>Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageActions.map((action) => (
                          <tr key={action.id}>
                            <td>
                              <button
                                className="user-flow-action-link"
                                onClick={() =>
                                  onSelect({ kind: "action", id: action.id })
                                }
                              >
                                <span className="user-flow-step-number">1</span>
                                <span>
                                  {effectLabel(action.action)}
                                  {action.targetName
                                    ? ` “${action.targetName}”`
                                    : " control"}
                                </span>
                              </button>
                            </td>
                            <td>{actionDestination(action, states)}</td>
                            <td>
                              <span
                                className={`user-flow-outcome ${action.decision}`}
                              >
                                {action.decision === "executed"
                                  ? "Completed"
                                  : action.decision === "failed"
                                    ? "Failed"
                                    : "Skipped by policy"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Empty
              icon={List}
              title="No functional scenarios in this selection"
              detail="Choose another page or clear filters to see recorded actions."
            />
          )
        ) : endToEndPaths.length ? (
          <div className="user-flow-page-list">
            {endToEndPaths.map(({ root, transitions }, index) => (
              <section
                className="user-flow-card user-flow-e2e-card"
                key={`${root.id}-${transitions.map((step) => step.to.id).join("-")}-${index}`}
              >
                <header className="user-flow-card-heading">
                  <div>
                    <span className="user-flow-route">Path {index + 1}</span>
                    <h3>
                      {stateName(root)}
                      {transitions.length > 0 && (
                        <>
                          <span className="user-flow-title-arrow"> → </span>
                          {stateName(transitions.at(-1)!.to)}
                        </>
                      )}
                    </h3>
                    <p>
                      Starts at {shortPath(root.routeKey) || root.routeKey};{" "}
                      {transitions.length} recorded{" "}
                      {transitions.length === 1 ? "transition" : "transitions"}.
                    </p>
                  </div>
                  <button
                    className="user-flow-inspect"
                    onClick={() => onSelect({ kind: "state", id: root.id })}
                  >
                    Inspect start
                  </button>
                </header>
                {transitions.length ? (
                  <div className="user-flow-table-scroll">
                    <table className="user-flow-table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Page</th>
                          <th>Do this</th>
                          <th>Observed result</th>
                          <th>Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transitions.map(({ from, to, action }, stepIndex) => (
                          <tr key={action.id}>
                            <td>
                              <span className="user-flow-step-number">
                                {stepIndex + 1}
                              </span>
                            </td>
                            <td>
                              <button
                                className="user-flow-table-link"
                                onClick={() =>
                                  onSelect({ kind: "state", id: from.id })
                                }
                              >
                                {stateName(from)}
                              </button>
                            </td>
                            <td>
                              <button
                                className="user-flow-table-link"
                                onClick={() =>
                                  onSelect({ kind: "action", id: action.id })
                                }
                              >
                                {effectLabel(action.action)}
                                {action.targetName
                                  ? ` “${action.targetName}”`
                                  : " control"}
                              </button>
                            </td>
                            <td>
                              <button
                                className="user-flow-table-link"
                                onClick={() =>
                                  onSelect({ kind: "state", id: to.id })
                                }
                              >
                                {stateName(to)}
                              </button>
                            </td>
                            <td>
                              <span
                                className={`user-flow-outcome ${action.decision}`}
                              >
                                {action.decision === "executed"
                                  ? "Completed"
                                  : action.decision === "failed"
                                    ? "Failed"
                                    : "Skipped by policy"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="user-flow-no-steps">
                    No outgoing transition was recorded from this screen.
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <Empty
            icon={GitBranch}
            title="No end-to-end paths in this selection"
            detail="Choose another page or clear filters to see recorded paths."
          />
        )}
        <p className="user-flows-evidence-note">
          These scenarios describe recorded discovery evidence. They do not
          imply traffic volume or define expected product behavior.
        </p>
      </div>
    </div>
  );
}
function FlowView({
  data,
  query,
  selection,
  onSelect,
  onOpenAssistant,
  assistantOpen = false,
}: {
  data: RunData;
  query: string;
  selection: { kind: string; id: string } | null;
  onSelect: (s: { kind: "state" | "action"; id: string }) => void;
  onOpenAssistant?: () => void;
  assistantOpen?: boolean;
}) {
  const [route, setRoute] = useState(""),
    [effect, setEffect] = useState(""),
    [worker, setWorker] = useState(""),
    [depth, setDepth] = useState(""),
    [outcome, setOutcome] = useState(""),
    [routeList, setRouteList] = useState(true),
    [routeLabelMode, setRouteLabelMode] = useState<
      "url" | "page-title" | "route-title"
    >("route-title"),
    [isFullscreen, setIsFullscreen] = useState(false),
    [allTransitions, setAllTransitions] = useState(false),
    [viewMode, setViewMode] = useState<FlowViewMode>("canvas"),
    [activeBlockId, setActiveBlockId] = useState("");
  const routes = [...new Set(data.states.map((s) => s.routeKey))];
  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assistantOpen) setIsFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFullscreen, assistantOpen]);
  const routeLabel = (path: string) => {
    const routeStates = data.states.filter((state) => state.routeKey === path);
    const state =
      routeStates.find((candidate) => candidate.title.trim()) ?? routeStates[0];
    const routeTitle = shortPath(path) === "/" ? "/ overview" : shortPath(path);
    if (routeLabelMode === "url") return state?.url || path;
    if (routeLabelMode === "page-title")
      return state?.title.trim() || routeTitle;
    return routeTitle;
  };
  const effects = [
    ...new Set(data.actions.flatMap((a) => a.effectFlags)),
  ].sort();
  const filteredEdges = useMemo(
    () =>
      data.actions.filter(
        (a) =>
          (!effect || a.effectFlags.includes(effect)) &&
          (!worker || a.worker === Number(worker)) &&
          (!outcome || a.decision === outcome),
      ),
    [data.actions, effect, worker, outcome],
  );
  const { nodes, edges, visibleStates } = useMemo(() => {
    const matches = data.states.filter(
      (s) =>
        (!route || s.routeKey === route) &&
        (!query ||
          (s.title + s.url + s.visibleRegionSummary.join(" "))
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!depth || s.depth <= Number(depth)) &&
        (!(effect || worker || outcome) ||
          filteredEdges.some(
            (e) => e.fromStateId === s.id || e.toStateId === s.id,
          )),
    );
    const perDepth = new Map<number, number>();
    const orderedStates = [...matches].sort(
      (a, b) =>
        a.depth - b.depth ||
        a.routeKey.localeCompare(b.routeKey) ||
        a.discoveredAt.localeCompare(b.discoveredAt),
    );
    const nodes: Node[] = orderedStates.map((s) => {
      const y = perDepth.get(s.depth) || 0;
      perDepth.set(s.depth, y + 1);
      return {
        id: s.id,
        type: "state",
        position: { x: s.depth * 460, y: y * 280 },
        selected: selection?.kind === "state" && selection.id === s.id,
        data: {
          state: s,
          actions: data.actions.filter((a) => a.fromStateId === s.id).length,
        },
      };
    });
    const ids = new Set(matches.map((s) => s.id));
    const grouped = new Map<string, ActionEdge>();
    for (const a of filteredEdges) {
      if (
        a.toStateId &&
        a.toStateId !== a.fromStateId &&
        ids.has(a.fromStateId) &&
        ids.has(a.toStateId)
      ) {
        const key = a.fromStateId + ":" + a.toStateId;
        if (!grouped.has(key)) grouped.set(key, a);
      }
    }
    const discovery = new Map<string, ActionEdge>();
    for (const a of grouped.values()) {
      const current = discovery.get(a.toStateId!);
      const target = data.states.find((s) => s.id === a.toStateId);
      if (!current || target?.provenanceActionId === a.id)
        discovery.set(a.toStateId!, a);
    }
    const edges: Edge[] = (
      allTransitions ? [...grouped.values()] : [...discovery.values()]
    ).map((a) => ({
      id: a.id,
      source: a.fromStateId,
      target: a.toStateId!,
      label: `${effectLabel(a.action)} “${flowLabelPart(a.targetName || "control", 16)}” → ${flowLabelPart(actionDestination(a, data.states), 16)}${
        a.decision === "failed"
          ? " · failed"
          : a.decision === "skipped_policy"
            ? " · skipped"
            : ""
      }`,
      type: "action",
      data: { onSelect: () => onSelect({ kind: "action", id: a.id }) },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 13,
        height: 13,
        color: "#9aacc5",
      },
      style: {
        stroke: selection?.id === a.id ? "#486dc6" : "#afc0d6",
        strokeWidth: selection?.id === a.id ? 2 : 1.2,
      },
    }));
    return { nodes, edges, visibleStates: matches };
  }, [
    data,
    route,
    query,
    effect,
    worker,
    depth,
    outcome,
    filteredEdges,
    selection,
    allTransitions,
    onSelect,
  ]);
  const visibleRoutes = [
    ...new Set(visibleStates.map((state) => state.routeKey)),
  ];
  const routeMap = useMemo(() => {
    const stateById = new Map(visibleStates.map((state) => [state.id, state]));
    const routePaths = [
      ...new Set(visibleStates.map((state) => state.routeKey)),
    ];
    const candidates = filteredEdges.filter((action) => {
      const source = stateById.get(action.fromStateId);
      const target = action.toStateId
        ? stateById.get(action.toStateId)
        : undefined;
      return source && target && source.routeKey !== target.routeKey;
    });
    const discoveryByTarget = new Map<string, ActionEdge>();
    for (const action of candidates) {
      const target = data.states.find((state) => state.id === action.toStateId);
      const current = discoveryByTarget.get(action.toStateId!);
      if (!current || target?.provenanceActionId === action.id)
        discoveryByTarget.set(action.toStateId!, action);
    }
    const visibleConnections = allTransitions
      ? candidates
      : [...discoveryByTarget.values()];
    const connectionsByRoute = new Map<string, ActionEdge[]>();
    for (const action of visibleConnections) {
      const source = stateById.get(action.fromStateId)!;
      const target = stateById.get(action.toStateId!)!;
      const key = `${source.routeKey}\u0000${target.routeKey}`;
      connectionsByRoute.set(key, [
        ...(connectionsByRoute.get(key) || []),
        action,
      ]);
    }
    const connectedRoutes = new Map<string, Set<string>>();
    for (const key of connectionsByRoute.keys()) {
      const [source, target] = key.split("\u0000");
      connectedRoutes.set(
        source,
        new Set([...(connectedRoutes.get(source) || []), target]),
      );
      connectedRoutes.set(
        target,
        new Set([...(connectedRoutes.get(target) || []), source]),
      );
    }
    const nodes: Node[] = routePaths.map((routePath, index) => {
      const states = visibleStates.filter(
        (state) => state.routeKey === routePath,
      );
      const summary = [...new Set(states.map(stateSummary))]
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
      return {
        id: `route:${routePath}`,
        type: "route",
        position: {
          x: (index % 3) * 420,
          y: Math.floor(index / 3) * 230,
        },
        data: {
          route: routePath,
          routeTitle: routeLabel(routePath),
          screens: states.length,
          connections: connectedRoutes.get(routePath)?.size || 0,
          summary: summary || "Observed application route",
          states: states.map((state) => ({
            id: state.id,
            label: stateName(state),
            summary: stateSummary(state),
          })),
          onOpen: () => {
            setRoute(routePath);
            setViewMode("canvas");
          },
          onSelectState: (stateId: string) =>
            onSelect({ kind: "state", id: stateId }),
        },
      };
    });
    const edges: Edge[] = [...connectionsByRoute].map(([key, actions]) => {
      const [sourceRoute, targetRoute] = key.split("\u0000");
      const first = actions[0];
      return {
        id: `route-link:${key}`,
        source: `route:${sourceRoute}`,
        target: `route:${targetRoute}`,
        type: "action",
        data: { onSelect: () => onSelect({ kind: "action", id: first.id }) },
        label: `${effectLabel(first.action)} “${flowLabelPart(first.targetName, 14)}”${actions.length > 1 ? ` +${actions.length - 1}` : ""}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: "#849ab8",
        },
        style: { stroke: "#8fa4c0", strokeWidth: 1.5 },
      };
    });
    return { nodes, edges };
  }, [
    visibleStates,
    filteredEdges,
    data.states,
    routeLabelMode,
    allTransitions,
    setRoute,
    setViewMode,
    onSelect,
  ]);
  const journeyTree = useMemo(() => {
    const stateById = new Map(visibleStates.map((state) => [state.id, state]));
    const actionById = new Map(
      data.actions.map((action) => [action.id, action]),
    );
    const visibleActionIds = new Set(filteredEdges.map((action) => action.id));
    const roots: AppState[] = [];
    const children = new Map<
      string,
      { state: AppState; action: ActionEdge }[]
    >();
    const ordered = [...visibleStates].sort(
      (a, b) =>
        a.depth - b.depth || a.discoveredAt.localeCompare(b.discoveredAt),
    );
    for (const state of ordered) {
      const action = state.provenanceActionId
        ? actionById.get(state.provenanceActionId)
        : undefined;
      const parent = action ? stateById.get(action.fromStateId) : undefined;
      if (
        action &&
        parent &&
        action.toStateId === state.id &&
        visibleActionIds.has(action.id)
      ) {
        children.set(parent.id, [
          ...(children.get(parent.id) || []),
          { state, action },
        ]);
      } else {
        roots.push(state);
      }
    }
    return { roots, children };
  }, [visibleStates, data.actions, filteredEdges]);
  const routeMatrix = useMemo(() => {
    const stateById = new Map(visibleStates.map((state) => [state.id, state]));
    const routes = [
      ...new Set(visibleStates.map((state) => state.routeKey)),
    ].sort();
    const counts = new Map<string, number>();
    const examples = new Map<string, ActionEdge>();
    for (const action of filteredEdges) {
      const source = stateById.get(action.fromStateId);
      const target = action.toStateId
        ? stateById.get(action.toStateId)
        : undefined;
      if (!source || !target) continue;
      const key = `${source.routeKey}\u0000${target.routeKey}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!examples.has(key)) examples.set(key, action);
    }
    return { routes, counts, examples, max: Math.max(1, ...counts.values()) };
  }, [visibleStates, filteredEdges]);
  const timelineActions = useMemo(() => {
    const stateIds = new Set(visibleStates.map((state) => state.id));
    return filteredEdges
      .filter((action) => stateIds.has(action.fromStateId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [filteredEdges, visibleStates]);
  const coverageByRoute = useMemo(
    () =>
      visibleRoutes.map((routePath) => {
        const states = visibleStates.filter(
          (state) => state.routeKey === routePath,
        );
        const actions = filteredEdges.filter((action) =>
          states.some((state) => state.id === action.fromStateId),
        );
        const depths = new Map<number, number>();
        for (const state of states)
          depths.set(state.depth, (depths.get(state.depth) || 0) + 1);
        return { routePath, states, actions, depths };
      }),
    [visibleRoutes, visibleStates, filteredEdges],
  );
  const additionalViewTabs: {
    id: AdditionalFlowViewMode;
    label: string;
    Icon: Icon;
    description: string;
  }[] = [
    {
      id: "matrix",
      label: "Matrix",
      Icon: GitBranch,
      description:
        "Compare how many observed transitions connect each route pair.",
    },
    {
      id: "timeline",
      label: "Timeline",
      Icon: Activity,
      description:
        "Review observed actions in time order, with worker and outcome.",
    },
    {
      id: "coverage",
      label: "Coverage",
      Icon: Layers,
      description:
        "Summarize observed screens, actions, and discovery depth by route.",
    },
    {
      id: "actions",
      label: "Actions",
      Icon: MousePointer2,
      description:
        "Browse every filtered action with its source, result, and outcome.",
    },
    {
      id: "components",
      label: "Components",
      Icon: Box,
      description:
        "See where shared component families appear across screens and routes.",
    },
    {
      id: "controls",
      label: "Controls",
      Icon: MousePointer2,
      description:
        "Review visible controls and whether discovery recorded an action for them.",
    },
    {
      id: "similarity",
      label: "Similarity",
      Icon: Compass,
      description:
        "Review screens with matching fingerprints or similar structure tokens.",
    },
    {
      id: "outcomes",
      label: "Outcomes",
      Icon: Activity,
      description:
        "Compare attempted actions by policy decision, execution, and screen change.",
    },
    {
      id: "failures",
      label: "Failures",
      Icon: AlertCircle,
      description:
        "Find failed actions and requests grouped by route and error.",
    },
    {
      id: "policy",
      label: "Policy",
      Icon: ShieldCheck,
      description:
        "See actions skipped by safety policy and the recorded rule or reason.",
    },
    {
      id: "latency",
      label: "Latency",
      Icon: Clock3,
      description:
        "Compare recorded action durations with correlated request timings.",
    },
    {
      id: "api-map",
      label: "API Map",
      Icon: Network,
      description:
        "Connect routes to observed endpoints, methods, and response statuses.",
    },
    {
      id: "api-trace",
      label: "Request Trace",
      Icon: Cable,
      description:
        "Inspect ordered API requests correlated to each observed action.",
    },
    {
      id: "workers",
      label: "Workers",
      Icon: Activity,
      description:
        "Compare worker activity over time; concurrent timestamps are not causal order.",
    },
    {
      id: "frontier",
      label: "Queue",
      Icon: FolderKanban,
      description:
        "Review pending, leased, completed, and failed discovery tasks.",
    },
    {
      id: "evidence",
      label: "Evidence",
      Icon: FileSearch,
      description:
        "Open screenshots and action artifacts recorded for visible screens.",
    },
    {
      id: "compare",
      label: "Compare",
      Icon: GitBranch,
      description:
        "Compare observed screen counts by route with another discovery run.",
    },
    {
      id: "lifecycle",
      label: "Run analysis",
      Icon: GitCompareArrows,
      description:
        "Compare discoveries and review freshness, repeatability, annotations, worker activity, browser effects, and capture-dependent areas.",
    },
    {
      id: "topology",
      label: "Route analysis",
      Icon: Compass,
      description:
        "Explore hierarchy, reachability, dead ends, branches, convergence, and paths derived from recorded transitions.",
    },
    {
      id: "workflow",
      label: "Workflow quality",
      Icon: ScanLine,
      description:
        "Review forms, controls, accessibility names, automation readiness, evidence gaps, recovery signals, and inferred clusters.",
    },
    {
      id: "coverage-map",
      label: "Coverage map",
      Icon: Layers,
      description:
        "See recorded completed, failed, skipped, and no-action statuses for screens and controls.",
    },
    {
      id: "replay",
      label: "Replay storyboard",
      Icon: MonitorPlay,
      description:
        "Follow one screen’s first-discovery path with screenshots, actions, outcomes, requests, and evidence.",
    },
    {
      id: "execution",
      label: "Execution analysis",
      Icon: Activity,
      description:
        "Inspect outcome heatmaps, policy impact, captured origins, UI state changes, and control effects.",
    },
    {
      id: "swimlane",
      label: "UI + API",
      Icon: Cable,
      description:
        "Align screen actions with API calls carrying the same recorded action ID.",
    },
    {
      id: "services",
      label: "Services",
      Icon: Network,
      description:
        "Group observed request hosts and connect them to routes when the run records a source screen.",
    },
    {
      id: "side-effects",
      label: "Browser effects",
      Icon: AlertCircle,
      description:
        "Review downloads, new tabs, browser prompts, and external navigation recorded in action signals.",
    },
    {
      id: "request-life",
      label: "Request lifecycle",
      Icon: Activity,
      description:
        "Review request time, status, duration, and linked screen transitions when captured.",
    },
  ];
  const primaryViewTabs: {
    id: FlowViewMode;
    label: string;
    Icon: Icon;
    description: string;
  }[] = [
    {
      id: "canvas",
      label: "Screen connections",
      Icon: Network,
      description: "Follow observed navigation between individual screens.",
    },
    {
      id: "routes",
      label: "Route map",
      Icon: RouteIcon,
      description:
        "See pages grouped by route and how navigation connects them.",
    },
    {
      id: "journey",
      label: "Journey tree",
      Icon: GitBranch,
      description: "Follow each first-discovery path from an entry screen.",
    },
    {
      id: "blocks",
      label: "Screen catalog",
      Icon: LayoutGrid,
      description:
        "Browse screen summaries and their recorded actions by route.",
    },
    {
      id: "text",
      label: "Flow outline",
      Icon: FileText,
      description:
        "Read each route’s screens and actions as a plain language outline.",
    },
    {
      id: "user-flows-functional",
      label: "Functional",
      Icon: List,
      description:
        "Read each recorded page action as a separate, one-step functional scenario.",
    },
    {
      id: "user-flows-e2e",
      label: "End-to-end",
      Icon: GitBranch,
      description:
        "Read recorded first-discovery paths as ordered, multi-page scenarios.",
    },
    {
      id: "user-flows-recordings",
      label: "Recordings",
      Icon: MonitorPlay,
      description:
        "Step through captured screenshots with the recorded action target highlighted.",
    },
  ];
  const flowViewGroups: { label: string; modes: FlowViewMode[] }[] = [
    {
      label: "Maps",
      modes: [
        "canvas",
        "routes",
        "blocks",
        "text",
        "matrix",
        "topology",
        "similarity",
      ],
    },
    { label: "Journeys", modes: ["journey", "timeline", "replay", "swimlane"] },
    {
      label: "User flows",
      modes: [
        "user-flows-functional",
        "user-flows-e2e",
        "user-flows-recordings",
      ],
    },
    {
      label: "Coverage",
      modes: ["coverage", "coverage-map", "controls", "components", "workflow"],
    },
    { label: "Evidence", modes: ["evidence", "actions"] },
    {
      label: "Requests",
      modes: ["api-map", "api-trace", "request-life", "services", "latency"],
    },
    {
      label: "Outcomes",
      modes: ["outcomes", "failures", "policy", "side-effects", "execution"],
    },
    {
      label: "Discovery runs",
      modes: ["compare", "lifecycle", "workers", "frontier"],
    },
  ];
  const allFlowViewTabs = [...primaryViewTabs, ...additionalViewTabs];
  const activeFlowViewGroup =
    flowViewGroups.find((group) => group.modes.includes(viewMode)) ??
    flowViewGroups[0];
  const activeFlowViewTabs = activeFlowViewGroup.modes
    .map((id) => allFlowViewTabs.find((tab) => tab.id === id))
    .filter((tab): tab is (typeof allFlowViewTabs)[number] => Boolean(tab));
  const actionStateCount = new Set(
    timelineActions.flatMap((action) =>
      action.toStateId
        ? [action.fromStateId, action.toStateId]
        : [action.fromStateId],
    ),
  ).size;
  const visibleStateIds = new Set(visibleStates.map((state) => state.id));
  const visibleElements = data.elements.filter((element) =>
    visibleStateIds.has(element.stateId),
  );
  const visibleComponents = data.components.filter((component) =>
    visibleStateIds.has(component.stateId),
  );
  const visibleApiCalls = data.apiCalls.filter(
    (call) =>
      (call.fromStateId && visibleStateIds.has(call.fromStateId)) ||
      (call.actionId &&
        filteredEdges.some((action) => action.id === call.actionId)),
  );
  const componentFamilyCount = new Set(
    visibleComponents.map((component) => component.familyId || component.name),
  ).size;
  const fingerprints = new Map<string, number>();
  for (const state of visibleStates)
    fingerprints.set(
      state.fingerprint,
      (fingerprints.get(state.fingerprint) || 0) + 1,
    );
  const similarStateCount = [...fingerprints.values()]
    .filter((count) => count > 1)
    .reduce((total, count) => total + count, 0);
  const evidenceCount = visibleStates.filter(
    (state) =>
      state.screenshotPath ||
      filteredEdges.some(
        (action) =>
          action.fromStateId === state.id && action.evidencePaths.length > 0,
      ),
  ).length;
  const countSummary: Record<
    typeof viewMode,
    [number, string, number, string]
  > = {
    canvas: [visibleStates.length, "states", edges.length, "connections"],
    routes: [
      routeMap.nodes.length,
      "routes",
      routeMap.edges.length,
      "route links",
    ],
    journey: [visibleStates.length, "states", edges.length, "connections"],
    matrix: [
      routeMatrix.routes.length,
      "routes",
      routeMatrix.counts.size,
      "connected pairs",
    ],
    timeline: [
      timelineActions.length,
      "actions",
      actionStateCount,
      "screens touched",
    ],
    coverage: [
      coverageByRoute.length,
      "routes",
      visibleStates.length,
      "screens",
    ],
    actions: [
      timelineActions.length,
      "actions",
      actionStateCount,
      "screens touched",
    ],
    blocks: [visibleStates.length, "states", edges.length, "connections"],
    text: [visibleStates.length, "states", edges.length, "connections"],
    components: [
      visibleComponents.length,
      "components",
      componentFamilyCount,
      "families",
    ],
    controls: [
      visibleElements.length,
      "controls",
      filteredEdges.length,
      "actions",
    ],
    similarity: [
      similarStateCount,
      "matching states",
      visibleStates.length,
      "states reviewed",
    ],
    outcomes: [
      filteredEdges.length,
      "actions",
      new Set(filteredEdges.map((action) => action.decision)).size,
      "outcomes",
    ],
    failures: [
      filteredEdges.filter((action) => action.decision === "failed").length,
      "failed actions",
      visibleApiCalls.filter((call) => call.failed || (call.status || 0) >= 400)
        .length,
      "failed calls",
    ],
    policy: [
      filteredEdges.filter((action) => action.decision === "skipped_policy")
        .length,
      "skipped actions",
      new Set(
        filteredEdges
          .filter((action) => action.decision === "skipped_policy")
          .map((action) => action.policy.rule),
      ).size,
      "policy rules",
    ],
    latency: [
      filteredEdges.filter((action) => action.elapsedMs != null).length,
      "timed actions",
      visibleApiCalls.filter((call) => call.durationMs != null).length,
      "timed calls",
    ],
    "api-map": [
      visibleApiCalls.length,
      "API calls",
      new Set(visibleApiCalls.map((call) => call.url)).size,
      "endpoints",
    ],
    "api-trace": [
      visibleApiCalls.filter((call) => call.actionId).length,
      "linked calls",
      new Set(
        visibleApiCalls.flatMap((call) =>
          call.actionId ? [call.actionId] : [],
        ),
      ).size,
      "actions traced",
    ],
    workers: [
      new Set(visibleStates.map((state) => state.worker)).size,
      "workers",
      data.events.length,
      "events",
    ],
    frontier: [
      data.tasks.length,
      "tasks",
      data.tasks.filter((task) => task.status === "pending").length,
      "pending",
    ],
    evidence: [
      evidenceCount,
      "screens with evidence",
      visibleApiCalls.length,
      "related calls",
    ],
    compare: [
      visibleStates.length,
      "current screens",
      filteredEdges.length,
      "actions",
    ],
    topology: [
      visibleStates.length,
      "screens",
      filteredEdges.length,
      "transitions",
    ],
    workflow: [
      visibleElements.length,
      "controls",
      visibleStates.length,
      "screens reviewed",
    ],
    lifecycle: [
      visibleStates.length,
      "screens",
      data.apiCalls.length,
      "request records",
    ],
    replay: [visibleStates.length, "screens", filteredEdges.length, "actions"],
    "coverage-map": [
      visibleElements.length,
      "controls",
      filteredEdges.length,
      "actions",
    ],
    execution: [
      filteredEdges.length,
      "actions",
      visibleApiCalls.length,
      "API calls",
    ],
    swimlane: [
      filteredEdges.filter((action) =>
        visibleApiCalls.some((call) => call.actionId === action.id),
      ).length,
      "actions with requests",
      visibleApiCalls.length,
      "calls",
    ],
    services: [
      new Set(
        visibleApiCalls.map((call) => {
          try {
            return new URL(call.url).host;
          } catch {
            return "Unknown";
          }
        }),
      ).size,
      "services",
      visibleApiCalls.length,
      "calls",
    ],
    "side-effects": [
      filteredEdges.filter((action) => action.signals.length > 0).length,
      "actions with signals",
      filteredEdges.length,
      "actions",
    ],
    "request-life": [
      visibleApiCalls.length,
      "requests",
      visibleApiCalls.filter((call) => call.durationMs != null).length,
      "with timing",
    ],
    "user-flows-functional": [
      filteredEdges.filter((action) => visibleStateIds.has(action.fromStateId))
        .length,
      "page scenarios",
      visibleStates.length,
      "screens",
    ],
    "user-flows-e2e": [
      timelineActions.length,
      "recorded steps",
      visibleStates.length,
      "screens",
    ],
    "user-flows-recordings": [
      visibleStates.filter((state) => state.screenshotPath).length,
      "captured screens",
      filteredEdges.filter((action) => visibleStateIds.has(action.fromStateId))
        .length,
      "recorded actions",
    ],
  };
  const downloadFlowExport = (format: "json" | "mermaid" | "svg") => {
    if (format === "svg") {
      downloadFlowSvg({
        routes: visibleRoutes.map((path) => ({
          id: path,
          path,
          stateIds: visibleStates
            .filter((state) => state.routeKey === path)
            .map((state) => state.id),
        })),
        actions: filteredEdges,
        filename: `flow-${data.run.id.slice(0, 8)}.svg`,
      });
      return;
    }
    const stateLabel = (state: AppState) =>
      `${state.title || shortPath(state.routeKey) || "Observed screen"} · ${shortPath(state.routeKey)}`;
    const safeUrl = (raw: string) => {
      try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
      } catch {
        return raw.split("?")[0];
      }
    };
    let contents: string;
    let mime: string;
    if (format === "json") {
      const stateIds = new Set(visibleStates.map((state) => state.id));
      const actions = filteredEdges.filter((action) =>
        stateIds.has(action.fromStateId),
      );
      const actionIds = new Set(actions.map((action) => action.id));
      contents = JSON.stringify(
        {
          evidenceScope:
            "observed discovery evidence; not user traffic analytics",
          runId: data.run.id,
          exportedAt: new Date().toISOString(),
          filters: {
            route: route || null,
            effect: effect || null,
            worker: worker || null,
            depth: depth || null,
            outcome: outcome || null,
          },
          states: visibleStates.map((state) => ({
            id: state.id,
            title: state.title,
            route: state.routeKey,
            url: safeUrl(state.url),
            depth: state.depth,
            discoveredAt: state.discoveredAt,
            screenshotAvailable: Boolean(state.screenshotPath),
          })),
          actions: actions.map((action) => ({
            id: action.id,
            fromStateId: action.fromStateId,
            toStateId: action.toStateId || null,
            control: action.targetName,
            action: action.action,
            outcome: action.decision,
            elapsedMs: action.elapsedMs ?? null,
          })),
          apiCalls: visibleApiCalls
            .filter((call) => !call.actionId || actionIds.has(call.actionId))
            .map((call) => {
              let endpoint = call.url;
              try {
                endpoint = new URL(call.url).pathname;
              } catch {
                endpoint = call.url.split("?")[0];
              }
              return {
                id: call.id,
                actionId: call.actionId || null,
                fromStateId: call.fromStateId || null,
                toStateId: call.toStateId || null,
                method: call.method,
                endpoint,
                status: call.status ?? null,
                failed: call.failed,
                durationMs: call.durationMs ?? null,
              };
            }),
          note: "Form values, request/response bodies, and query parameters are omitted.",
        },
        null,
        2,
      );
      mime = "application/json";
    } else {
      const stateById = new Map(
        visibleStates.map((state) => [state.id, state]),
      );
      const ids = new Map(
        visibleStates.map((state, index) => [state.id, `S${index + 1}`]),
      );
      const quote = (value: string) =>
        value.replace(/[\"\\\n\r]/g, " ").slice(0, 90);
      const lines = [
        "flowchart LR",
        "  %% Observed discovery evidence; not user traffic analytics",
      ];
      for (const state of visibleStates) {
        lines.push(`  ${ids.get(state.id)}[\"${quote(stateLabel(state))}\"]`);
      }
      for (const action of filteredEdges) {
        const source = ids.get(action.fromStateId);
        const target = action.toStateId ? ids.get(action.toStateId) : undefined;
        if (!source || !target || !stateById.has(action.toStateId!)) continue;
        const label = `${effectLabel(action.action)} ${action.targetName || "control"} · ${action.decision}`;
        lines.push(`  ${source} -->|\"${quote(label)}\"| ${target}`);
      }
      contents = lines.join("\n");
      mime = "text/plain";
    }
    const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flow-${data.run.id.slice(0, 8)}-${format}.${format === "json" ? "json" : "mmd"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const renderJourney = (
    state: AppState,
    ancestors = new Set<string>(),
  ): React.ReactNode => {
    if (ancestors.has(state.id)) return null;
    const nextAncestors = new Set(ancestors).add(state.id);
    const branches = journeyTree.children.get(state.id) || [];
    return (
      <div className="journey-tree" key={state.id}>
        <button
          className={`journey-screen ${selection?.kind === "state" && selection.id === state.id ? "selected" : ""}`}
          onClick={() => onSelect({ kind: "state", id: state.id })}
        >
          <span className="journey-screen-topline">
            <span className={`kind-tag ${stateKind(state)}`}>
              {state.depth === 0 ? "Entry screen" : `Depth ${state.depth}`}
            </span>
            <span className="journey-route">{routeLabel(state.routeKey)}</span>
          </span>
          <strong>{stateName(state)}</strong>
          <span className="journey-summary">{stateSummary(state)}</span>
        </button>
        {branches.length > 0 && (
          <div className="journey-branches">
            {branches.map(({ state: child, action }) => (
              <div className="journey-branch" key={child.id}>
                <div className="journey-transition">
                  <button
                    className={`journey-action ${action.decision} ${selection?.kind === "action" && selection.id === action.id ? "selected" : ""}`}
                    onClick={() => onSelect({ kind: "action", id: action.id })}
                  >
                    <span>{effectLabel(action.action)}</span>
                    <strong>{action.targetName || "Control"}</strong>
                    <ArrowRight size={13} />
                    <span className="journey-result">
                      {actionDestination(action, data.states)}
                    </span>
                  </button>
                  <span className={`journey-outcome ${action.decision}`}>
                    {action.decision === "executed"
                      ? "Opened screen"
                      : action.decision === "failed"
                        ? "Failed"
                        : "Skipped"}
                  </span>
                </div>
                {renderJourney(child, nextAncestors)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  const explorer = (
    <div
      className={`flow-explorer${isFullscreen ? " flow-explorer-fullscreen" : ""}`}
    >
      <div className="flow-view-header">
        <div className="flow-view-switcher">
          <div
            className="flow-view-groups"
            role="tablist"
            aria-label="Flow view categories"
          >
            {flowViewGroups.map((group) => {
              const selected = group === activeFlowViewGroup;
              return (
                <button
                  key={group.label}
                  id={`flow-view-group-${group.label.toLowerCase().replaceAll(" ", "-")}`}
                  className={selected ? "active" : ""}
                  role="tab"
                  aria-selected={selected}
                  aria-controls="flow-view-subtabs"
                  onClick={() => setViewMode(group.modes[0])}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
          <div
            className="flow-view-toggle"
            id="flow-view-subtabs"
            role="tablist"
            aria-label={`${activeFlowViewGroup.label} views`}
          >
            {activeFlowViewTabs.map(
              ({ id, label, Icon: ViewIcon, description }) => (
                <button
                  key={id}
                  id={`flow-view-tab-${id}`}
                  className={viewMode === id ? "active" : ""}
                  role="tab"
                  aria-selected={viewMode === id}
                  aria-controls="flow-view-content"
                  aria-describedby={`flow-view-tooltip-${id}`}
                  onClick={() => setViewMode(id)}
                >
                  <ViewIcon size={13} /> {label}
                  <span className="flow-view-info" aria-hidden="true">
                    <Info size={12} />
                  </span>
                  <span
                    id={`flow-view-tooltip-${id}`}
                    className="flow-view-tooltip"
                    role="tooltip"
                  >
                    {description}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
        <div className="flow-view-header-actions">
          {isFullscreen && onOpenAssistant && (
            <button
              type="button"
              className={`icon-button flow-assistant-toggle${assistantOpen ? " active" : ""}`}
              aria-label="Open Assistant chat"
              aria-expanded={assistantOpen}
              title="Assistant"
              onClick={onOpenAssistant}
            >
              <Bot size={17} />
            </button>
          )}
          <div
            className="route-label-switch"
            role="group"
            aria-label="Route label format"
          >
            <button
              type="button"
              className={routeLabelMode === "url" ? "active" : ""}
              aria-label="Show URLs"
              aria-pressed={routeLabelMode === "url"}
              title="Show URLs"
              onClick={() => setRouteLabelMode("url")}
            >
              <Link2 size={13} />
            </button>
            <button
              type="button"
              className={routeLabelMode === "page-title" ? "active" : ""}
              aria-label="Show page titles"
              aria-pressed={routeLabelMode === "page-title"}
              title="Show page titles"
              onClick={() => setRouteLabelMode("page-title")}
            >
              <FileText size={13} />
            </button>
            <button
              type="button"
              className={routeLabelMode === "route-title" ? "active" : ""}
              aria-label="Show route titles"
              aria-pressed={routeLabelMode === "route-title"}
              title="Show route titles"
              onClick={() => setRouteLabelMode("route-title")}
            >
              <RouteIcon size={13} />
            </button>
          </div>
          <button
            type="button"
            className="icon-button flow-fullscreen-toggle"
            aria-label={
              isFullscreen
                ? "Exit fullscreen flow explorer"
                : "Open fullscreen flow explorer"
            }
            title={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
            onClick={() => setIsFullscreen((value) => !value)}
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </div>
      <div
        className="flow-workspace"
        id="flow-view-content"
        role="tabpanel"
        aria-labelledby={`flow-view-tab-${viewMode}`}
      >
        <div className="graph-toolbar">
          <button
            className="icon-button"
            title="Toggle route list"
            onClick={() => setRouteList(!routeList)}
          >
            <PanelLeftClose size={17} />
          </button>
          <span className="toolbar-divider" />
          <select
            aria-label="Connection display"
            value={allTransitions ? "all" : "discovery"}
            onChange={(e) => setAllTransitions(e.target.value === "all")}
          >
            <option value="discovery">Discovery paths</option>
            <option value="all">All transitions</option>
          </select>
          <select
            aria-label="Filter by outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">All outcomes</option>
            <option value="executed">Executed</option>
            <option value="failed">Failed</option>
            <option value="skipped_policy">Skipped by policy</option>
          </select>
          <select
            aria-label="Filter by effect"
            value={effect}
            onChange={(e) => setEffect(e.target.value)}
          >
            <option value="">All interactions</option>
            {effects.map((e) => (
              <option key={e} value={e}>
                {effectLabel(e)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by depth"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
          >
            <option value="">Any depth</option>
            {Array.from({ length: data.run.config.maxDepth + 1 }, (_, i) => (
              <option key={i} value={String(i)}>
                Depth ≤ {i}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by worker"
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          >
            <option value="">All workers</option>
            {Array.from({ length: data.run.config.concurrency }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Worker {i + 1}
              </option>
            ))}
          </select>
          <div className="graph-count">
            {countSummary[viewMode][0]} {countSummary[viewMode][1]}
            <span />
            {countSummary[viewMode][2]} {countSummary[viewMode][3]}
          </div>
          <div
            className="flow-export-actions"
            aria-label="Export observed flow"
          >
            <button
              className="button"
              title="Download filtered flow data as JSON"
              onClick={() => downloadFlowExport("json")}
            >
              <FileJson size={14} /> JSON
            </button>
            <button
              className="button"
              title="Download filtered flow as Mermaid"
              onClick={() => downloadFlowExport("mermaid")}
            >
              <FileCode2 size={14} /> Mermaid
            </button>
            <button
              className="button"
              title="Download a sanitized route map as SVG"
              onClick={() => downloadFlowExport("svg")}
            >
              <Download size={14} /> SVG
            </button>
          </div>
        </div>
        <div className="graph-body">
          {routeList && (
            <aside className="route-panel">
              <div className="route-heading">
                Application routes<span>{routes.length}</span>
              </div>
              <div className="route-list">
                <button
                  className={!route ? "selected" : ""}
                  onClick={() => setRoute("")}
                >
                  <Network size={14} />
                  All routes<span>{data.states.length}</span>
                </button>
                {routes.map((r) => (
                  <button
                    title={routeLabel(r)}
                    aria-label={routeLabel(r)}
                    key={r}
                    className={route === r ? "selected" : ""}
                    onClick={() => setRoute(r)}
                  >
                    <RouteIcon size={13} />
                    <span className="route-name">{routeLabel(r)}</span>
                    <span>
                      {data.states.filter((s) => s.routeKey === r).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className="route-panel-note">
                <MousePointer2 size={17} />
                <p>
                  Select a state to inspect its screenshot, controls, and replay
                  path.
                </p>
              </div>
              <div className="graph-legend">
                <span>
                  <i className="page" />
                  Page
                </span>
                <span>
                  <i className="dialog" />
                  Dialog
                </span>
                <span>
                  <i className="interaction" />
                  UI state
                </span>
              </div>
            </aside>
          )}
          <div
            className={`graph-canvas${viewMode === "canvas" || viewMode === "routes" ? "" : " flow-content-inset"}`}
          >
            <React.Suspense
              fallback={
                <div className="flow-module-loading" role="status">
                  Loading view…
                </div>
              }
            >
              {viewMode === "user-flows-recordings" ? (
                <FlowRecordingView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "user-flows-functional" ||
                viewMode === "user-flows-e2e" ? (
                <UserFlowsView
                  mode={viewMode}
                  states={visibleStates}
                  actions={filteredEdges}
                  selectedRoute={route}
                  onSelect={onSelect}
                />
              ) : viewMode === "routes" ? (
                routeMap.nodes.length ? (
                  <ReactFlow
                    key={`routes-${route}-${effect}-${worker}-${depth}-${outcome}`}
                    nodes={routeMap.nodes}
                    edges={routeMap.edges}
                    nodeTypes={routeMapNodeTypes}
                    edgeTypes={actionEdgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 0.9 }}
                    minZoom={0.12}
                    maxZoom={1.3}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    onNodeClick={(_, node) => {
                      const routePath = node.id.startsWith("route:")
                        ? node.id.slice("route:".length)
                        : "";
                      if (routePath) {
                        setRoute(routePath);
                        setViewMode("canvas");
                      }
                    }}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background color="#cbd6e5" gap={20} size={1} />
                    <Controls showInteractive={false} />
                    <MiniMap
                      nodeColor="#cbd9ed"
                      maskColor="rgba(242,246,251,.8)"
                      pannable
                      zoomable
                    />
                  </ReactFlow>
                ) : (
                  <Empty
                    icon={RouteIcon}
                    title="No routes match these filters"
                    detail="Clear a filter or choose another route."
                  />
                )
              ) : viewMode === "matrix" ? (
                routeMatrix.routes.length ? (
                  <div className="flow-matrix-scroll">
                    <div className="flow-view-document">
                      <header className="flow-view-intro">
                        <h2>Route connections</h2>
                        <p>
                          Each cell counts observed screen transitions from its
                          row route to its column route. Select a nonzero cell
                          to inspect an example action.
                        </p>
                      </header>
                      <div className="flow-matrix-table-wrap">
                        <table className="flow-matrix-table">
                          <thead>
                            <tr>
                              <th scope="col">From / to</th>
                              {routeMatrix.routes.map((routePath) => (
                                <th scope="col" key={routePath}>
                                  {routeLabel(routePath)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {routeMatrix.routes.map((sourceRoute) => (
                              <tr key={sourceRoute}>
                                <th scope="row">{routeLabel(sourceRoute)}</th>
                                {routeMatrix.routes.map((targetRoute) => {
                                  const key = `${sourceRoute}\u0000${targetRoute}`;
                                  const count =
                                    routeMatrix.counts.get(key) || 0;
                                  const example = routeMatrix.examples.get(key);
                                  return (
                                    <td key={targetRoute}>
                                      <button
                                        className={`flow-matrix-cell ${count ? "has-links" : ""}`}
                                        disabled={!example}
                                        title={
                                          example
                                            ? `${count} transition${count === 1 ? "" : "s"}; inspect an example`
                                            : "No observed transitions"
                                        }
                                        style={
                                          count
                                            ? {
                                                backgroundColor: `rgba(72, 109, 198, ${0.08 + (count / routeMatrix.max) * 0.28})`,
                                              }
                                            : undefined
                                        }
                                        onClick={() =>
                                          example &&
                                          onSelect({
                                            kind: "action",
                                            id: example.id,
                                          })
                                        }
                                      >
                                        {count || "·"}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="flow-matrix-note">
                        Counts reflect only transitions visible under the
                        current filters.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={GitBranch}
                    title="No route connections to compare"
                    detail="Choose another route or clear a filter to show observed transitions."
                  />
                )
              ) : viewMode === "timeline" ? (
                timelineActions.length ? (
                  <div className="flow-timeline-scroll">
                    <div className="flow-view-document">
                      <header className="flow-view-intro">
                        <h2>Observed action timeline</h2>
                        <p>
                          Actions are ordered by recorded time. Multiple workers
                          may explore at once, so nearby events can belong to
                          different paths.
                        </p>
                      </header>
                      <ol className="flow-timeline-list">
                        {timelineActions.map((action) => {
                          const source = data.states.find(
                            (state) => state.id === action.fromStateId,
                          );
                          const target = data.states.find(
                            (state) => state.id === action.toStateId,
                          );
                          return (
                            <li className="flow-timeline-item" key={action.id}>
                              <span className="flow-timeline-marker" />
                              <time dateTime={action.createdAt}>
                                {new Date(action.createdAt).toLocaleTimeString(
                                  [],
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </time>
                              <button
                                className="flow-timeline-event"
                                onClick={() =>
                                  onSelect({ kind: "action", id: action.id })
                                }
                              >
                                <span className="flow-timeline-source">
                                  {source
                                    ? stateName(source)
                                    : "Unknown screen"}
                                </span>
                                <strong>
                                  {effectLabel(action.action)} “
                                  {action.targetName || "Control"}”
                                </strong>
                                <span className="flow-timeline-destination">
                                  {target
                                    ? `→ ${stateName(target)}`
                                    : action.decision === "failed"
                                      ? "No screen change recorded"
                                      : "No new screen recorded"}
                                </span>
                                <span
                                  className={`flow-timeline-meta ${action.decision}`}
                                >
                                  Worker {action.worker} · depth {action.depth}{" "}
                                  ·{" "}
                                  {action.decision === "skipped_policy"
                                    ? "Skipped by policy"
                                    : action.decision}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={Activity}
                    title={
                      data.actions.length
                        ? "No actions match these filters"
                        : "Waiting for the first action…"
                    }
                    detail="Recorded actions will appear here in time order."
                  />
                )
              ) : viewMode === "coverage" ? (
                coverageByRoute.length ? (
                  <div className="flow-coverage-scroll">
                    <div className="flow-view-document">
                      <header className="flow-view-intro">
                        <h2>Observed coverage by route</h2>
                        <p>
                          Compare the screens and actions discovered on each
                          route. Depth bars show where exploration reached.
                        </p>
                      </header>
                      <div className="flow-coverage-list">
                        {coverageByRoute.map(
                          ({ routePath, states, actions, depths }) => {
                            const maxDepth = Math.max(0, ...depths.keys());
                            const executed = actions.filter(
                              (action) => action.decision === "executed",
                            ).length;
                            const failed = actions.filter(
                              (action) => action.decision === "failed",
                            ).length;
                            const skipped = actions.filter(
                              (action) => action.decision === "skipped_policy",
                            ).length;
                            return (
                              <article
                                className="flow-coverage-route"
                                key={routePath}
                              >
                                <header>
                                  <RouteIcon size={14} />
                                  <strong>{routeLabel(routePath)}</strong>
                                  <span>{states.length} screens</span>
                                  <span>{actions.length} actions</span>
                                </header>
                                <div
                                  className="flow-coverage-depths"
                                  aria-label={`Observed screen counts by depth, through depth ${maxDepth}`}
                                >
                                  {Array.from(
                                    { length: maxDepth + 1 },
                                    (_, index) => {
                                      const count = depths.get(index) || 0;
                                      return (
                                        <span
                                          className={count ? "observed" : ""}
                                          key={index}
                                          style={{
                                            flex: Math.max(count, 0.35),
                                          }}
                                          title={`Depth ${index}: ${count} screen${count === 1 ? "" : "s"}`}
                                        >
                                          <i
                                            style={{
                                              opacity: count
                                                ? 0.35 +
                                                  (count /
                                                    Math.max(
                                                      1,
                                                      states.length,
                                                    )) *
                                                    0.6
                                                : 0,
                                            }}
                                          />
                                          <small>D{index}</small>
                                          <strong>{count}</strong>
                                        </span>
                                      );
                                    },
                                  )}
                                </div>
                                <footer>
                                  <span className="executed">
                                    {executed} executed
                                  </span>
                                  <span className="failed">
                                    {failed} failed
                                  </span>
                                  <span className="skipped">
                                    {skipped} skipped
                                  </span>
                                </footer>
                              </article>
                            );
                          },
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={Layers}
                    title="No routes match these filters"
                    detail="Clear a filter or choose another route to review observed coverage."
                  />
                )
              ) : viewMode === "actions" ? (
                timelineActions.length ? (
                  <div className="flow-actions-scroll">
                    <div className="flow-view-document">
                      <header className="flow-view-intro">
                        <h2>Observed interactions</h2>
                        <p>
                          Review the action, source screen, recorded result, and
                          outcome. Select a row to inspect its evidence.
                        </p>
                      </header>
                      <div className="flow-actions-list">
                        {timelineActions.map((action) => {
                          const source = data.states.find(
                            (state) => state.id === action.fromStateId,
                          );
                          const target = data.states.find(
                            (state) => state.id === action.toStateId,
                          );
                          return (
                            <button
                              className={`flow-action-row ${action.decision}`}
                              key={action.id}
                              onClick={() =>
                                onSelect({ kind: "action", id: action.id })
                              }
                            >
                              <span className="flow-action-verb">
                                {effectLabel(action.action)}
                              </span>
                              <span className="flow-action-target">
                                <strong>
                                  {action.targetName || "Control"}
                                </strong>
                                <small>
                                  {source
                                    ? stateName(source)
                                    : "Unknown screen"}
                                </small>
                              </span>
                              <ArrowRight size={14} />
                              <span className="flow-action-result">
                                {target ? stateName(target) : "No new screen"}
                                <small>
                                  {action.decision === "skipped_policy"
                                    ? "Skipped by policy"
                                    : action.decision}
                                </small>
                              </span>
                              <span className="flow-action-worker">
                                Worker {action.worker} · depth {action.depth}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={MousePointer2}
                    title={
                      data.actions.length
                        ? "No actions match these filters"
                        : "No interactions recorded yet"
                    }
                    detail="Recorded interactions will appear here as discovery explores the app."
                  />
                )
              ) : viewMode === "components" ? (
                <ComponentReuseMap
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "controls" ? (
                <ControlSurfaceMap
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "similarity" ? (
                <StateSimilarityReview
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "outcomes" ? (
                <OutcomeFunnelView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "failures" ? (
                <FailureHotspotsView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "policy" ? (
                <PolicyGatesView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "latency" ? (
                <LatencyPathView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "api-map" ? (
                <RouteApiMapView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "api-trace" ? (
                <ActionRequestTraceView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "topology" ? (
                <TopologyAnalysisView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "workflow" ? (
                <WorkflowQualityLens
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "coverage-map" ? (
                <CoverageOutcomeMapView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "replay" ? (
                <ReplayStoryboardView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "execution" ? (
                <FlowExecutionAnalysisView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "swimlane" ? (
                <UiApiSwimlane
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "services" ? (
                <ServiceDependencyMap
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "side-effects" ? (
                <>
                  <BrowserSideEffectMap
                    data={data}
                    states={visibleStates}
                    actions={filteredEdges}
                    onSelect={onSelect}
                  />
                  <FlowBrowserLifecycleView
                    actions={filteredEdges}
                    onSelect={onSelect}
                  />
                </>
              ) : viewMode === "request-life" ? (
                <RequestLifecycleTrace
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "lifecycle" ? (
                <FlowLifecycleController data={data} onSelect={onSelect} />
              ) : viewMode === "workers" ? (
                <WorkerSwimlanes
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "frontier" ? (
                <FrontierQueueMap
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "evidence" ? (
                <EvidenceTrailView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "compare" ? (
                <RunComparisonView
                  data={data}
                  states={visibleStates}
                  actions={filteredEdges}
                  onSelect={onSelect}
                />
              ) : viewMode === "journey" ? (
                journeyTree.roots.length ? (
                  <div className="flow-journey-scroll">
                    <div className="flow-journey-document">
                      <header className="flow-journey-intro">
                        <h2>How screens were reached</h2>
                        <p>
                          Follow the action that first uncovered each screen.
                          Select a screen or action to inspect its evidence.
                        </p>
                      </header>
                      <div className="flow-journey-roots">
                        {journeyTree.roots.map((state) => renderJourney(state))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={GitBranch}
                    title={
                      data.states.length
                        ? "No paths match these filters"
                        : "Mapping the first path…"
                    }
                    detail={
                      data.states.length
                        ? "Clear a filter or choose another route."
                        : "First-discovery paths will appear here as the engine explores."
                    }
                  />
                )
              ) : viewMode === "text" ? (
                visibleStates.length ? (
                  <div className="flow-text-scroll">
                    <div className="flow-text-document">
                      <header className="flow-text-intro">
                        <h2>Routes in plain language</h2>
                        <p>
                          Each route lists the screens observed and the controls
                          that move between them. Select a screen or action to
                          inspect its evidence.
                        </p>
                      </header>
                      {visibleRoutes.map((routePath) => {
                        const routeStates = visibleStates
                          .filter((state) => state.routeKey === routePath)
                          .sort(
                            (a, b) =>
                              a.depth - b.depth ||
                              a.discoveredAt.localeCompare(b.discoveredAt),
                          );
                        return (
                          <section className="flow-text-route" key={routePath}>
                            <h3>
                              <RouteIcon size={15} />
                              <span>{routeLabel(routePath)}</span>
                              <small>
                                {routeStates.length} observed screens
                              </small>
                            </h3>
                            <div className="flow-text-states">
                              {routeStates.map((state) => {
                                const outgoing = filteredEdges.filter(
                                  (action) => action.fromStateId === state.id,
                                );
                                return (
                                  <article
                                    className="flow-text-state"
                                    key={state.id}
                                  >
                                    <div className="flow-text-state-heading">
                                      <button
                                        className="flow-text-state-link"
                                        onClick={() =>
                                          onSelect({
                                            kind: "state",
                                            id: state.id,
                                          })
                                        }
                                      >
                                        <strong>{stateName(state)}</strong>
                                        <span>{shortPath(state.url)}</span>
                                      </button>
                                      <span
                                        className={`kind-tag ${stateKind(state)}`}
                                      >
                                        {state.depth === 0
                                          ? "Entry screen"
                                          : `Depth ${state.depth}`}
                                      </span>
                                    </div>
                                    <p className="flow-text-summary">
                                      {stateSummary(state)}
                                    </p>
                                    {outgoing.length ? (
                                      <ul>
                                        {outgoing.map((action) => (
                                          <li key={action.id}>
                                            <span className="flow-text-when">
                                              When you{" "}
                                              {effectLabel(action.action)}
                                              {action.targetName
                                                ? ` “${action.targetName}”`
                                                : " a control"}
                                            </span>
                                            <span className="flow-text-result">
                                              {action.decision === "executed"
                                                ? "the app shows"
                                                : action.decision === "failed"
                                                  ? "the action fails before showing"
                                                  : "the action is skipped by policy"}{" "}
                                              <strong>
                                                {actionDestination(
                                                  action,
                                                  data.states,
                                                )}
                                              </strong>
                                            </span>
                                            <button
                                              className={`flow-text-action ${action.decision}`}
                                              onClick={() =>
                                                onSelect({
                                                  kind: "action",
                                                  id: action.id,
                                                })
                                              }
                                            >
                                              View action evidence
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="flow-text-terminal">
                                        {data.actions.some(
                                          (action) =>
                                            action.fromStateId === state.id,
                                        )
                                          ? "No actions from this screen match the current filters."
                                          : "No outgoing actions were recorded from this screen."}
                                      </p>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={FileText}
                    title={
                      data.states.length
                        ? "No routes match these filters"
                        : "Mapping the first route…"
                    }
                    detail={
                      data.states.length
                        ? "Clear a filter or try another search."
                        : "Observed routes will appear here as the engine explores."
                    }
                  />
                )
              ) : viewMode === "blocks" ? (
                visibleStates.length ? (
                  <div className="flow-block-scroll">
                    <div className="flow-block-routes">
                      {visibleRoutes.map((routePath) => {
                        const routeStates = visibleStates
                          .filter((state) => state.routeKey === routePath)
                          .sort(
                            (a, b) =>
                              a.depth - b.depth ||
                              a.discoveredAt.localeCompare(b.discoveredAt),
                          );
                        const routeActions = filteredEdges.filter((action) =>
                          routeStates.some(
                            (state) => state.id === action.fromStateId,
                          ),
                        );
                        return (
                          <section className="flow-block-route" key={routePath}>
                            <header className="flow-block-route-heading">
                              <div>
                                <RouteIcon size={16} />
                                <h3>{routeLabel(routePath)}</h3>
                              </div>
                              <span>
                                {routeStates.length} screens
                                <i />
                                {routeActions.length} observed actions
                              </span>
                            </header>
                            <div className="flow-block-grid">
                              {routeStates.map((state) => {
                                const outgoing = filteredEdges.filter(
                                  (action) => action.fromStateId === state.id,
                                );
                                return (
                                  <article
                                    className="flow-block-screen"
                                    key={state.id}
                                  >
                                    <button
                                      className="flow-block-screen-button"
                                      onClick={() => setActiveBlockId(state.id)}
                                    >
                                      <span className="flow-block-screen-preview">
                                        {state.screenshotPath ? (
                                          <img
                                            src={`/artifacts/${state.screenshotPath}`}
                                            alt={`Preview of ${stateName(state)}`}
                                            loading="lazy"
                                          />
                                        ) : (
                                          <ScanLine size={22} />
                                        )}
                                      </span>
                                      <span className="flow-block-screen-copy">
                                        <span className="flow-block-screen-meta">
                                          <span
                                            className={`kind-tag ${stateKind(state)}`}
                                          >
                                            {stateKind(state)}
                                          </span>
                                          <span>
                                            {state.depth === 0
                                              ? "Entry screen"
                                              : `Depth ${state.depth}`}
                                          </span>
                                        </span>
                                        <strong>{stateName(state)}</strong>
                                        <small>{shortPath(state.url)}</small>
                                      </span>
                                      <ChevronRight size={15} />
                                    </button>
                                    <p className="flow-block-screen-summary">
                                      {stateSummary(state)}
                                    </p>
                                    <div className="flow-block-actions">
                                      {outgoing.length ? (
                                        outgoing.map((action) => (
                                          <button
                                            className="flow-block-action"
                                            key={action.id}
                                            onClick={() =>
                                              onSelect({
                                                kind: "action",
                                                id: action.id,
                                              })
                                            }
                                          >
                                            <span className="flow-block-action-verb">
                                              {effectLabel(action.action)}
                                            </span>
                                            <span className="flow-block-action-copy">
                                              <strong>
                                                {action.targetName || "Control"}
                                              </strong>
                                              <small>
                                                {action.decision === "executed"
                                                  ? `leads to ${actionDestination(action, data.states)}`
                                                  : action.decision === "failed"
                                                    ? "did not complete"
                                                    : "skipped by policy"}
                                              </small>
                                            </span>
                                            <ArrowRight size={13} />
                                          </button>
                                        ))
                                      ) : (
                                        <p className="flow-block-no-actions">
                                          {data.actions.some(
                                            (action) =>
                                              action.fromStateId === state.id,
                                          )
                                            ? "No actions match the current filters."
                                            : "No outgoing actions were recorded from this screen."}
                                        </p>
                                      )}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <Empty
                    icon={Network}
                    title={
                      data.states.length
                        ? "No states match these filters"
                        : "Mapping the first state…"
                    }
                    detail={
                      data.states.length
                        ? "Clear a filter or try another search."
                        : "Live browser observations will appear here as the engine explores."
                    }
                  />
                )
              ) : nodes.length ? (
                <ReactFlow
                  key={`${route}-${effect}-${worker}-${depth}-${outcome}-${Boolean(data.states.length)}`}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={actionEdgeTypes}
                  onlyRenderVisibleElements
                  defaultViewport={{ x: 35, y: 35, zoom: 0.72 }}
                  minZoom={0.08}
                  maxZoom={1.5}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onNodeClick={(_, n) => onSelect({ kind: "state", id: n.id })}
                  onEdgeClick={(_, e) => onSelect({ kind: "action", id: e.id })}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="#cbd6e5" gap={20} size={1} />
                  <Controls showInteractive={false} />
                  <MiniMap
                    nodeColor="#ccd9ed"
                    maskColor="rgba(242,246,251,.8)"
                    pannable
                    zoomable
                  />
                </ReactFlow>
              ) : (
                <Empty
                  icon={Network}
                  title={
                    data.states.length
                      ? "No states match these filters"
                      : "Mapping the first state…"
                  }
                  detail={
                    data.states.length
                      ? "Clear a filter or try another search."
                      : "Live browser observations will appear here as the engine explores."
                  }
                />
              )}
            </React.Suspense>
            {(
              [
                "canvas",
                "routes",
                "blocks",
                "journey",
                "text",
              ] as FlowViewMode[]
            ).includes(viewMode) && (
              <span className="canvas-caption">
                <Fingerprint size={12} />
                {viewMode === "routes"
                  ? "Routes connect where discovery observed navigation between them"
                  : viewMode === "blocks"
                    ? "Screens are grouped by route; actions describe what each control did"
                    : viewMode === "journey"
                      ? "Each branch follows the action that first uncovered a screen"
                      : viewMode === "text"
                        ? "Route descriptions reflect the observed screens and actions"
                        : "Each node names an observed screen; connections show the action and result"}
              </span>
            )}
          </div>
        </div>
        {activeBlockId &&
          data.states.some((state) => state.id === activeBlockId) && (
            <FlowBlockModal
              data={data}
              state={data.states.find((item) => item.id === activeBlockId)!}
              actions={filteredEdges}
              close={() => setActiveBlockId("")}
              onSelect={onSelect}
            />
          )}
      </div>
    </div>
  );
  return isFullscreen ? createPortal(explorer, document.body) : explorer;
}
function FlowBlockModal({
  data,
  state,
  actions,
  close,
  onSelect,
}: {
  data: RunData;
  state: AppState;
  actions: ActionEdge[];
  close: () => void;
  onSelect: (s: { kind: "state" | "action"; id: string }) => void;
}) {
  const focusRef = useDialogFocus();
  const elements = data.elements.filter(
    (element) => element.stateId === state.id,
  );
  const components = data.components.filter(
    (component) => component.stateId === state.id,
  );
  const incoming = actions.filter((action) => action.toStateId === state.id);
  const outgoing = actions.filter((action) => action.fromStateId === state.id);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  const inspectAction = (action: ActionEdge) => {
    close();
    onSelect({ kind: "action", id: action.id });
  };
  const actionRow = (
    action: ActionEdge,
    relatedState: AppState | undefined,
  ) => (
    <button
      className="flow-modal-action"
      key={action.id}
      onClick={() => inspectAction(action)}
    >
      <span className="flow-modal-action-icon">
        <MousePointer2 size={14} />
      </span>
      <span className="flow-modal-action-copy">
        <strong>
          {effectLabel(action.action)} · {action.targetName}
        </strong>
        <small>
          {relatedState
            ? stateName(relatedState)
            : action.afterUrl
              ? shortPath(action.afterUrl)
              : "No next screen observed"}
        </small>
      </span>
      <Status value={action.decision} />
      <ChevronRight size={15} />
    </button>
  );
  return (
    <div
      className="flow-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="flow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flow-modal-title"
        ref={focusRef}
      >
        <header className="flow-modal-header">
          <div>
            <span className="flow-modal-kicker">
              <Network size={14} /> Flow block · Depth {state.depth}
            </span>
            <h2 id="flow-modal-title">{stateName(state)}</h2>
            <span className="flow-modal-url">{state.url}</span>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close flow details"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flow-modal-scroll">
          <div className="flow-modal-overview">
            <div className="flow-modal-screenshot">
              {state.screenshotPath ? (
                <img
                  src={`/artifacts/${state.screenshotPath}`}
                  alt={`Observed screen: ${stateName(state)}`}
                />
              ) : (
                <div>
                  <ScanLine size={30} />
                  <span>No screenshot captured</span>
                </div>
              )}
            </div>
            <div className="flow-modal-facts">
              <span className={`kind-tag ${stateKind(state)}`}>
                {stateKind(state)}
              </span>
              <strong>{elements.length}</strong>
              <small>interactive elements</small>
              <strong>{incoming.length + outgoing.length}</strong>
              <small>connected actions</small>
            </div>
          </div>
          {state.visibleRegionSummary.length > 0 && (
            <section className="flow-modal-section">
              <h3>Visible interface regions</h3>
              <div className="flow-modal-tags">
                {state.visibleRegionSummary.map((region) => (
                  <span key={region}>{region.replaceAll(":", " · ")}</span>
                ))}
              </div>
            </section>
          )}
          <div className="flow-modal-columns">
            <section className="flow-modal-section">
              <h3>Flow into this screen</h3>
              {incoming.length ? (
                incoming.map((action) =>
                  actionRow(
                    action,
                    data.states.find((item) => item.id === action.fromStateId),
                  ),
                )
              ) : (
                <p className="flow-modal-empty">This is an entry point.</p>
              )}
            </section>
            <section className="flow-modal-section">
              <h3>Actions from this screen</h3>
              {outgoing.length ? (
                outgoing.map((action) =>
                  actionRow(
                    action,
                    data.states.find((item) => item.id === action.toStateId),
                  ),
                )
              ) : (
                <p className="flow-modal-empty">
                  No outgoing actions were observed.
                </p>
              )}
            </section>
          </div>
          <div className="flow-modal-columns">
            <section className="flow-modal-section">
              <h3>Available controls</h3>
              {elements.length ? (
                <div className="flow-modal-elements">
                  {elements.map((element) => (
                    <div key={element.id}>
                      <span>{element.role || element.tag}</span>
                      <strong>
                        {element.accessibleName || "Unnamed control"}
                      </strong>
                      {element.disabled && <small>Disabled</small>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="flow-modal-empty">
                  No interactive controls found.
                </p>
              )}
            </section>
            <section className="flow-modal-section">
              <h3>Components on this screen</h3>
              {components.length ? (
                <div className="flow-modal-tags">
                  {components.map((component) => (
                    <span key={component.id}>
                      <b>{component.name}</b> · {component.kind}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="flow-modal-empty">
                  No component regions were identified.
                </p>
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
function Pager({
  page,
  setPage,
  total,
  size = 15,
}: {
  page: number;
  setPage: (p: number) => void;
  total: number;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`
          : "No results"}
      </span>
      <div>
        <button disabled={!page} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          {page + 1} / {pages}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
function States({
  data,
  query,
  select,
}: {
  data: RunData;
  query: string;
  select: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query]);
  const states = data.states.filter((s) =>
    (s.title + s.url + s.visibleRegionSummary.join(" "))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="catalog">
      <div className="state-grid">
        {states.slice(page * 12, page * 12 + 12).map((s) => (
          <button
            className="state-card"
            key={s.id}
            onClick={() => select(s.id)}
          >
            <div className="state-card-image">
              {s.screenshotPath ? (
                <img
                  loading="lazy"
                  src={`/artifacts/${s.screenshotPath}`}
                  alt={`Captured ${stateName(s)}`}
                />
              ) : (
                <ScanLine size={35} />
              )}
              <span className={`kind-tag ${stateKind(s)}`}>{stateKind(s)}</span>
            </div>
            <div className="state-card-body">
              <h3>
                {stateName(s)}
                <ArrowUpRight size={15} />
              </h3>
              <p>{shortPath(s.url)}</p>
              <div>
                <span>{s.interactiveElementIds.length} controls</span>
                <span>Depth {s.depth}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {!states.length && (
        <Empty
          title="No matching states"
          detail="States appear after the first browser observation. Try another search if filters are active."
        />
      )}
      <Pager page={page} setPage={setPage} total={states.length} size={12} />
    </div>
  );
}
function Components({
  data,
  query,
  select,
}: {
  data: RunData;
  query: string;
  select: (id: string) => void;
}) {
  const [kind, setKind] = useState(""),
    [expanded, setExpanded] = useState(""),
    [page, setPage] = useState(0),
    [evidenceComponent, setEvidenceComponent] = useState<Component | null>(
      null,
    );
  useEffect(() => setPage(0), [query, kind]);
  const items = data.components.filter(
    (c) =>
      (!kind || c.kind === kind) &&
      (c.name + c.kind + c.rootLocator.expression)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="catalog">
      <div className="catalog-toolbar">
        <div className="filter-chips">
          {["", "navigation", "dialog", "form", "table", "card"].map((k) => (
            <button
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
              key={k}
            >
              {k || "All components"}
            </button>
          ))}
        </div>
        <span>{items.length} observed regions</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Found on</th>
              <th>Controls</th>
              <th>Confidence</th>
              <th>Root locator</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.slice(page * 15, page * 15 + 15).map((c) => {
              const state = data.states.find((s) => s.id === c.stateId);
              const elements = data.elements.filter((e) =>
                c.elementIds.includes(e.id),
              );
              const elementTypes = [
                ...elements.reduce((counts, element) => {
                  const type = element.inputType
                    ? `${element.role || element.tag} · ${element.inputType}`
                    : element.role || element.tag;
                  counts.set(type, (counts.get(type) || 0) + 1);
                  return counts;
                }, new Map<string, number>()),
              ];
              return (
                <React.Fragment key={c.id}>
                  <tr className={expanded === c.id ? "expanded-row" : ""}>
                    <td>
                      <button
                        className="table-name"
                        onClick={() =>
                          setExpanded(expanded === c.id ? "" : c.id)
                        }
                      >
                        <span className={`component-icon ${c.kind}`}>
                          <Box size={16} />
                        </span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.kind}
                            {c.familyId
                              ? ` · ${data.components.filter((other) => other.familyId === c.familyId && other.stateId === c.stateId).length} repeated instances`
                              : ""}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <button
                        className="route-link"
                        onClick={() => select(c.stateId)}
                      >
                        {state ? shortPath(state.url) : "Unknown"}
                        <ArrowUpRight size={12} />
                      </button>
                    </td>
                    <td>
                      {c.elementIds.length}
                      <small className="muted">
                        {c.childComponentIds.length
                          ? ` + ${c.childComponentIds.length} children`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <span className="confidence">
                        <span style={{ width: `${c.confidence * 100}%` }} />
                      </span>
                      {Math.round(c.confidence * 100)}%
                    </td>
                    <td>
                      <span
                        className={
                          c.rootLocator.verifiedAfterRestore
                            ? "verification verified"
                            : "verification"
                        }
                      >
                        {c.rootLocator.verifiedAfterRestore ? (
                          <CheckCircle2 size={13} />
                        ) : (
                          <Circle size={12} />
                        )}{" "}
                        {c.rootLocator.verifiedAfterRestore
                          ? "Verified on replay"
                          : "Discovery only"}
                      </span>
                    </td>
                    <td className="component-row-actions">
                      <button
                        className="icon-button component-image-button"
                        aria-label={`View ${c.name} screenshot evidence`}
                        title="View component screenshot"
                        onClick={() => setEvidenceComponent(c)}
                      >
                        <ImageIcon size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Expand ${c.name}`}
                        onClick={() =>
                          setExpanded(expanded === c.id ? "" : c.id)
                        }
                      >
                        <ChevronDown size={15} />
                      </button>
                    </td>
                  </tr>
                  {expanded === c.id && (
                    <tr>
                      <td colSpan={6} className="component-detail">
                        <div className="component-detail-header">
                          <span>{c.classificationEvidence.join(" · ")}</span>
                          <CopyButton value={c.rootLocator.expression} />
                        </div>
                        <code>{c.rootLocator.expression}</code>
                        <div className="component-element-summary">
                          <strong>Available elements</strong>
                          <span>{elements.length} total</span>
                          <div>
                            {elementTypes.map(([type, count]) => (
                              <span className="component-type-count" key={type}>
                                <b>{type}</b> {count}
                              </span>
                            ))}
                          </div>
                        </div>
                        {elements.map((e) => (
                          <div className="element-detail" key={e.id}>
                            <span className="role-label">
                              {e.role || e.tag}
                            </span>
                            <strong>
                              {e.accessibleName || "Unnamed control"}
                            </strong>
                            <LocatorList element={e} />
                          </div>
                        ))}
                        {c.childComponentIds.length > 0 && (
                          <div className="child-components">
                            Contains:{" "}
                            {c.childComponentIds
                              .map(
                                (id) =>
                                  data.components.find((c) => c.id === id)
                                    ?.name,
                              )
                              .join(", ")}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <Empty
          icon={Box}
          title="No matching components"
          detail="Try a different name or component type."
        />
      )}
      <Pager page={page} setPage={setPage} total={items.length} />
      {evidenceComponent && (
        <ComponentEvidenceModal
          component={evidenceComponent}
          state={data.states.find(
            (state) => state.id === evidenceComponent.stateId,
          )}
          elements={data.elements.filter((element) =>
            evidenceComponent.elementIds.includes(element.id),
          )}
          close={() => setEvidenceComponent(null)}
        />
      )}
    </div>
  );
}
function ComponentEvidenceModal({
  component,
  state,
  elements,
  close,
}: {
  component: Component;
  state?: AppState;
  elements: UIElement[];
  close: () => void;
}) {
  const dialogRef = useDialogFocus();
  const [crop, setCrop] = useState("");
  const [screenshotSize, setScreenshotSize] = useState({ width: 0, height: 0 });
  const imagePath = state?.screenshotPath;
  const fallbackBox = useMemo(() => {
    if (component.box) return component.box;
    const visible = elements.filter(
      (element) => element.box.width > 0 && element.box.height > 0,
    );
    if (!visible.length) return undefined;
    const left = Math.min(...visible.map((element) => element.box.x));
    const top = Math.min(...visible.map((element) => element.box.y));
    const right = Math.max(
      ...visible.map((element) => element.box.x + element.box.width),
    );
    const bottom = Math.max(
      ...visible.map((element) => element.box.y + element.box.height),
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, [component.box, elements]);
  useEffect(() => {
    if (!imagePath || !fallbackBox) {
      setCrop("");
      return;
    }
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      const viewportWidth = fallbackBox.viewportWidth || image.naturalWidth;
      const viewportHeight = fallbackBox.viewportHeight || image.naturalHeight;
      const scaleX = image.naturalWidth / viewportWidth;
      const scaleY = image.naturalHeight / viewportHeight;
      const padding = 14;
      const left = Math.max(0, Math.floor((fallbackBox.x - padding) * scaleX));
      const top = Math.max(0, Math.floor((fallbackBox.y - padding) * scaleY));
      const right = Math.min(
        image.naturalWidth,
        Math.ceil((fallbackBox.x + fallbackBox.width + padding) * scaleX),
      );
      const bottom = Math.min(
        image.naturalHeight,
        Math.ceil((fallbackBox.y + fallbackBox.height + padding) * scaleY),
      );
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, left, top, width, height, 0, 0, width, height);
      if (!cancelled) setCrop(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      if (!cancelled) setCrop("");
    };
    image.src = `/artifacts/${imagePath}`;
    return () => {
      cancelled = true;
    };
  }, [imagePath, fallbackBox]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  const viewportWidth = fallbackBox?.viewportWidth || screenshotSize.width || 1;
  const viewportHeight =
    fallbackBox?.viewportHeight || screenshotSize.height || 1;
  return createPortal(
    <div
      className="component-evidence-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="component-evidence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="component-evidence-title"
        ref={dialogRef as React.RefObject<HTMLElement>}
      >
        <header className="component-evidence-header">
          <div>
            <span>Captured component</span>
            <h2 id="component-evidence-title">{component.name}</h2>
            <p>
              {state
                ? `${shortPath(state.url)} · ${state.title || "Untitled page"}`
                : "Page screenshot unavailable"}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close component screenshot"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div className="component-evidence-panels">
          <section className="component-evidence-crop-panel">
            <div className="component-evidence-panel-heading">
              <strong>Component snapshot</strong>
              <span>
                {component.box ? "Captured bounds" : "Estimated bounds"}
              </span>
            </div>
            {crop ? (
              <img
                className="component-evidence-crop"
                src={crop}
                alt={`Cropped screenshot of ${component.name}`}
              />
            ) : (
              <div className="component-evidence-empty">
                {imagePath
                  ? "Component bounds were not recorded for this capture."
                  : "No screenshot was captured for this page."}
              </div>
            )}
          </section>
          <section className="component-evidence-page-panel">
            <div className="component-evidence-panel-heading">
              <strong>Page view</strong>
              <span>Component highlighted</span>
            </div>
            {imagePath ? (
              <div className="component-evidence-full-image">
                <img
                  src={`/artifacts/${imagePath}`}
                  alt={`Captured ${state?.title || "page"}`}
                  onLoad={(event) =>
                    setScreenshotSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                {fallbackBox &&
                  (fallbackBox.viewportWidth || screenshotSize.width > 0) &&
                  (fallbackBox.viewportHeight || screenshotSize.height > 0) && (
                    <span
                      className="component-evidence-highlight"
                      aria-hidden="true"
                      style={{
                        left: `${(fallbackBox.x / viewportWidth) * 100}%`,
                        top: `${(fallbackBox.y / viewportHeight) * 100}%`,
                        width: `${(fallbackBox.width / viewportWidth) * 100}%`,
                        height: `${(fallbackBox.height / viewportHeight) * 100}%`,
                      }}
                    >
                      <span className="component-evidence-marker-label">
                        Component - {component.name}
                      </span>
                    </span>
                  )}
              </div>
            ) : (
              <div className="component-evidence-empty">
                The page screenshot is unavailable.
              </div>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}
function LocatorList({ element }: { element: UIElement }) {
  return (
    <div className="locator-list">
      {[...element.locatorCandidates]
        .sort((a, b) => b.score - a.score)
        .map((l, i) => (
          <div className="locator" key={i}>
            <div>
              <span
                className={`verification ${l.verifiedAfterRestore ? "verified" : ""}`}
              >
                {l.verifiedAfterRestore ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <Circle size={11} />
                )}{" "}
                {l.verifiedAfterRestore
                  ? "Verified after replay"
                  : l.uniqueAtDiscovery
                    ? "Unique at discovery"
                    : "Unverified"}
              </span>
              <span>{l.score}/100</span>
              <CopyButton value={l.expression} />
            </div>
            <code>{l.expression}</code>
            {l.failures.length > 0 && (
              <small className="locator-failure">{l.failures.join("; ")}</small>
            )}
          </div>
        ))}
    </div>
  );
}
function Actions({
  data,
  query,
  select,
}: {
  data: RunData;
  query: string;
  select: (id: string) => void;
}) {
  const [decision, setDecision] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, decision]);
  const items = data.actions
    .filter(
      (a) =>
        (!decision || a.decision === decision) &&
        (a.targetName + a.effectFlags.join(" ") + a.policy.reason + a.beforeUrl)
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="catalog">
      <div className="catalog-toolbar">
        <div className="filter-chips">
          {[
            ["", "All interactions"],
            ["executed", "Executed"],
            ["skipped_policy", "Safely skipped"],
            ["failed", "Failed"],
          ].map(([v, label]) => (
            <button
              className={decision === v ? "active" : ""}
              key={v}
              onClick={() => setDecision(v)}
            >
              {label}
              <span>
                {data.actions.filter((a) => !v || a.decision === v).length}
              </span>
            </button>
          ))}
        </div>
        <span>Observed behavior, recorded live</span>
      </div>
      <div className="table-scroll">
        <table className="data-table action-table">
          <thead>
            <tr>
              <th>Interaction</th>
              <th>Route</th>
              <th>Observed outcome</th>
              <th>Decision</th>
              <th>Worker</th>
              <th>Time</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.slice(page * 15, page * 15 + 15).map((a) => (
              <tr key={a.id} onClick={() => select(a.id)}>
                <td>
                  <button className="table-name">
                    <span className={`action-icon ${a.decision}`}>
                      <MousePointer2 size={15} />
                    </span>
                    <span>
                      <strong>{a.targetName}</strong>
                      <small>{a.action}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <span className="route-link">{shortPath(a.beforeUrl)}</span>
                </td>
                <td>
                  {a.effectFlags.slice(0, 2).map((f) => (
                    <span className="effect-tag" key={f}>
                      {effectLabel(f)}
                    </span>
                  ))}
                  {!a.effectFlags.length && (
                    <span className="muted">{a.policy.rule}</span>
                  )}
                </td>
                <td>
                  <Status value={a.decision} />
                </td>
                <td>
                  <span className="worker-label">
                    <span />
                    Worker {a.worker}
                  </span>
                </td>
                <td className="muted">
                  {a.elapsedMs ? duration(a.elapsedMs) : "—"}
                </td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <Empty
          icon={MousePointer2}
          title="No matching interactions"
          detail="Try another outcome or control name."
        />
      )}
      <Pager page={page} setPage={setPage} total={items.length} />
    </div>
  );
}
function ApiFlow({ data, query }: { data: RunData; query: string }) {
  const [selectedCall, setSelectedCall] = useState<ApiCall>();
  const items = data.apiCalls.filter((call) =>
    `${call.method} ${call.url} ${call.status ?? ""} ${call.resourceType}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const actions = new Map(data.actions.map((action) => [action.id, action]));
  const grouped = new Map<string, typeof items>();
  for (const call of items) {
    const group = grouped.get(call.taskId) || [];
    group.push(call);
    grouped.set(call.taskId, group);
  }
  return (
    <div className="catalog">
      <div className="catalog-toolbar">
        <span>{items.length} observed fetch and XHR calls</span>
        <span>Select a call to inspect its request and response</span>
      </div>
      <div className="table-scroll">
        <table className="data-table action-table">
          <thead>
            <tr>
              <th>Flow</th>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {[...grouped.entries()].flatMap(([taskId, calls]) => {
              const action = actions.get(taskId);
              const trigger =
                action?.targetName ||
                (calls[0]?.fromStateId ? "Route / state replay" : "Seed route");
              return calls
                .sort((a, b) => a.sequence - b.sequence)
                .map((call, index) => (
                  <tr
                    key={call.id}
                    className="api-call-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${call.method} ${call.url}`}
                    onClick={() => setSelectedCall(call)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCall(call);
                      }
                    }}
                  >
                    <td>
                      <strong>{index === 0 ? trigger : `↓ ${trigger}`}</strong>
                      <small>
                        {call.fromStateId
                          ? shortPath(
                              data.states.find(
                                (state) => state.id === call.fromStateId,
                              )?.url || "",
                            )
                          : "Initial route"}
                      </small>
                    </td>
                    <td>
                      <span className="effect-tag">{call.method}</span>
                    </td>
                    <td>
                      <code>{shortPath(call.url)}</code>
                    </td>
                    <td>
                      {call.failed ? (
                        <Status value="failed" />
                      ) : (
                        (call.status ?? "Pending")
                      )}
                    </td>
                    <td className="muted">
                      {call.resourceType}
                      {call.durationMs ? ` · ${call.durationMs} ms` : ""}
                    </td>
                  </tr>
                ));
            })}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <Empty
          icon={Activity}
          title="No API calls observed"
          detail="Fetch and XHR requests appear here as discovery explores routes and interactions."
        />
      )}
      {selectedCall && (
        <ApiCallInspector
          call={selectedCall}
          close={() => setSelectedCall(undefined)}
        />
      )}
    </div>
  );
}
function ApiCallInspector({
  call,
  close,
}: {
  call: ApiCall;
  close: () => void;
}) {
  const [tab, setTab] = useState("Request");
  const tabs = ["Request", "Payload", "Response", "Timing"];
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [close]);
  const headers =
    tab === "Request" ? call.requestHeaders : call.responseHeaders;
  const body = tab === "Payload" ? call.requestBody : call.responseBody;
  const timing = call.timings || {};
  const phases = [
    [
      "DNS lookup",
      timing.domainLookupEnd != null && timing.domainLookupStart != null
        ? timing.domainLookupEnd - timing.domainLookupStart
        : undefined,
    ],
    [
      "Connection",
      timing.connectEnd != null && timing.connectStart != null
        ? timing.connectEnd - timing.connectStart
        : undefined,
    ],
    [
      "TLS setup",
      timing.secureConnectionStart != null && timing.connectEnd != null
        ? timing.connectEnd - timing.secureConnectionStart
        : undefined,
    ],
    [
      "Waiting for server",
      timing.responseStart != null && timing.requestStart != null
        ? timing.responseStart - timing.requestStart
        : undefined,
    ],
    [
      "Download",
      timing.responseEnd != null && timing.responseStart != null
        ? timing.responseEnd - timing.responseStart
        : undefined,
    ],
  ] as const;
  return (
    <>
      <button
        className="inspector-backdrop"
        onClick={close}
        aria-label="Close API call details"
      />
      <aside
        className="inspector api-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="API call details"
      >
        <div className="inspector-heading">
          <span>
            <Activity size={16} /> API call details
          </span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close API call details"
          >
            <X size={18} />
          </button>
        </div>
        <div className="api-inspector-title">
          <div className="api-inspector-method">
            <span className="effect-tag">{call.method}</span>
            <Status
              value={
                call.failed ? "failed" : call.status ? "completed" : "running"
              }
            />
          </div>
          <h2>{call.url}</h2>
          <p>
            {call.resourceType.toUpperCase()} ·{" "}
            {call.durationMs != null
              ? `${call.durationMs} ms total`
              : "Timing unavailable"}
          </p>
        </div>
        <div
          className="api-inspector-tabs"
          role="tablist"
          aria-label="API request details"
        >
          {tabs.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="api-inspector-scroll" role="tabpanel">
          {tab === "Timing" ? (
            <>
              <div className="api-timing-total">
                <span>Total load time</span>
                <strong>
                  {call.durationMs != null
                    ? `${call.durationMs} ms`
                    : "Not available"}
                </strong>
              </div>
              {phases
                .filter(([, value]) => value != null && value >= 0)
                .map(([key, value]) => (
                  <div className="api-timing-row" key={key}>
                    <span>{key}</span>
                    <strong>{value!.toFixed(1)} ms</strong>
                  </div>
                ))}
              {!call.timings && (
                <p className="api-inspector-empty">
                  Detailed timing data is unavailable for this call.
                </p>
              )}
            </>
          ) : tab === "Payload" || tab === "Response" ? (
            body ? (
              <pre className="api-code-block">{body}</pre>
            ) : (
              <p className="api-inspector-empty">
                {tab === "Payload"
                  ? "No request payload was captured."
                  : "No response body was captured."}
              </p>
            )
          ) : (
            <>
              <section className="api-detail-section">
                <h3>Request URL</h3>
                <code>{call.url}</code>
              </section>
              <section className="api-detail-section">
                <h3>Request headers</h3>
                {Object.keys(headers || {}).length ? (
                  <pre className="api-code-block">
                    {JSON.stringify(headers, null, 2)}
                  </pre>
                ) : (
                  <p className="api-inspector-empty">
                    No request headers captured.
                  </p>
                )}
              </section>
            </>
          )}
          {(tab === "Response" || tab === "Payload") && tab === "Response" && (
            <section className="api-detail-section">
              <h3>Response headers</h3>
              {Object.keys(call.responseHeaders || {}).length ? (
                <pre className="api-code-block">
                  {JSON.stringify(call.responseHeaders, null, 2)}
                </pre>
              ) : (
                <p className="api-inspector-empty">
                  No response headers captured.
                </p>
              )}
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
function Artifacts({
  data,
  query,
  download,
  filesPath,
}: {
  data: RunData;
  query: string;
  download: () => void;
  filesPath: string;
}) {
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]),
    [preview, setPreview] = useState(""),
    [content, setContent] = useState("");
  useEffect(() => {
    api<typeof files>(filesPath)
      .then(setFiles)
      .catch(() => {});
  }, [data.run.id, data.run.status, filesPath]);
  const show = async (path: string) => {
    setPreview(path);
    setContent("Loading…");
    try {
      const res = await fetch(`/artifacts/${data.run.id}/${path}`);
      setContent(await res.text());
    } catch {
      setContent("Could not read this file. Export again to regenerate it.");
    }
  };
  return (
    <div className="artifacts-layout">
      <div className="artifact-intro">
        <div className="artifact-art">
          <FileCode2 size={38} />
          <span className="artifact-badge">
            <Check size={16} />
          </span>
        </div>
        <div>
          <h3>Your observations, ready to build on.</h3>
          <p>
            Verified Playwright helpers, structured data, screenshots, and a
            standalone report.
          </p>
          <button className="button primary" onClick={download}>
            <Download size={15} />
            Download all artifacts
          </button>
        </div>
      </div>
      <div className="artifact-files">
        <div className="file-list">
          <h3>
            Exported files <span>{files.length}</span>
          </h3>
          {files
            .filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
            .map((f) => (
              <button
                className={preview === f.path ? "selected" : ""}
                key={f.path}
                onClick={() => show(f.path)}
              >
                {f.path.endsWith(".json") ? (
                  <FileJson size={16} />
                ) : f.path.endsWith(".ts") ? (
                  <FileCode2 size={16} />
                ) : (
                  <FileText size={16} />
                )}
                <span>{f.path}</span>
                <small>
                  {f.size < 1024
                    ? f.size + " B"
                    : Math.round(f.size / 1024) + " KB"}
                </small>
              </button>
            ))}
          {!files.length && (
            <p className="muted">
              Files are generated when the scan pauses or finishes. Use Download
              all artifacts to export now.
            </p>
          )}
        </div>
        <div className="file-preview">
          {preview ? (
            <>
              <div>
                <span>{preview}</span>
                <CopyButton value={content} />
                <a
                  href={`/artifacts/${data.run.id}/${preview}`}
                  download
                  className="icon-button"
                  title="Download file"
                >
                  <Download size={15} />
                </a>
              </div>
              <pre>{content}</pre>
            </>
          ) : (
            <Empty
              icon={FileCode2}
              title="Look inside your discovery"
              detail="Choose a file to preview its contents."
            />
          )}
        </div>
      </div>
      <div className="activity-panel">
        <h3>
          <Activity size={17} />
          Engine activity
        </h3>
        {data.events.slice(0, 15).map((e) => (
          <div className={`activity-row ${e.level}`} key={e.id}>
            <span className="activity-dot" />
            <time>{new Date(e.time).toLocaleTimeString()}</time>
            <span>{e.message}</span>
            {e.worker && <small>Worker {e.worker}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}
function Inspector({
  data,
  selection,
  close,
  select,
}: {
  data: RunData;
  selection: { kind: "state" | "action"; id: string };
  close: () => void;
  select: (s: { kind: "state" | "action"; id: string }) => void;
}) {
  const focusRef = useDialogFocus();
  const closeRef = useRef(close);
  const [fullscreen, setFullscreen] = useState(false);
  const action =
    selection.kind === "action"
      ? data.actions.find((a) => a.id === selection.id)
      : undefined;
  const state = data.states.find(
    (s) => s.id === (action?.fromStateId || selection.id),
  );
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => setTab("overview"), [selection.id]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", listener);
    };
  }, []);
  if (!state) return null;
  const els = data.elements.filter((e) => e.stateId === state.id),
    outgoing = data.actions.filter((a) => a.fromStateId === state.id);
  const target = action
    ? data.elements.find((e) => e.id === action.elementId)
    : undefined;
  return (
    <>
      <button
        className="inspector-backdrop"
        onClick={close}
        aria-label="Dismiss inspector backdrop"
      />
      <aside
        ref={focusRef}
        className={`inspector${fullscreen ? " inspector-fullscreen" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={action ? "Interaction evidence" : "State inspector"}
      >
        <div className="inspector-heading">
          <span>
            {action ? <MousePointer2 size={16} /> : <Layers size={16} />}{" "}
            {action ? "Interaction evidence" : "State inspector"}
          </span>
          <div className="inspector-heading-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setFullscreen((value) => !value)}
              aria-label={
                fullscreen
                  ? "Exit fullscreen inspector"
                  : "Open fullscreen inspector"
              }
              title={fullscreen ? "Exit fullscreen" : "Open fullscreen"}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={close}
              aria-label="Close inspector"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="inspector-title">
          <span className="kind-tag">
            {action ? action.action : stateKind(state)}
          </span>
          <h2>{action ? action.targetName : stateName(state)}</h2>
          <span className="inspector-url">
            {state.url}
            <CopyButton value={state.url} />
          </span>
        </div>
        {action ? (
          <div className="inspector-scroll">
            <Status value={action.decision} />
            <div className="inspector-block">
              <h3>Observed outcome</h3>
              <div className="effect-tags">
                {action.effectFlags.map((e) => (
                  <span className="effect-tag" key={e}>
                    {effectLabel(e)}
                  </span>
                ))}
              </div>
              <p>{action.error || action.policy.reason}</p>
            </div>
            <div className="inspector-block">
              <h3>Before & after</h3>
              <div className="evidence-pair">
                {[
                  data.states.find((s) => s.id === action.fromStateId),
                  data.states.find((s) => s.id === action.toStateId),
                ].map((s, i) => (
                  <button
                    key={i}
                    disabled={!s}
                    onClick={() => s && select({ kind: "state", id: s.id })}
                  >
                    <span>{i ? "After" : "Before"}</span>
                    {s?.screenshotPath ? (
                      <img
                        src={`/artifacts/${s.screenshotPath}`}
                        alt={
                          i ? "After the interaction" : "Before the interaction"
                        }
                      />
                    ) : (
                      <div className="no-evidence">
                        {i && action.decision === "skipped_policy"
                          ? "Not executed"
                          : "No capture"}
                      </div>
                    )}
                    <small>{s ? stateName(s) : "No observed state"}</small>
                  </button>
                ))}
              </div>
            </div>
            {target && (
              <div className="inspector-block">
                <h3>Target locators</h3>
                <LocatorList element={target} />
              </div>
            )}
            <div className="inspector-block">
              <h3>Execution details</h3>
              <dl>
                <dt>Worker</dt>
                <dd>{action.worker}</dd>
                <dt>Elapsed</dt>
                <dd>
                  {action.elapsedMs
                    ? duration(action.elapsedMs)
                    : "Not executed"}
                </dd>
                <dt>Policy</dt>
                <dd>{action.policy.rule}</dd>
                <dt>Business intent</dt>
                <dd>Unknown</dd>
                <dt>Observed confidence</dt>
                <dd>{Math.round(action.confidence * 100)}%</dd>
              </dl>
            </div>
            {action.signals.length > 0 && (
              <div className="inspector-block">
                <h3>Side-effect signals</h3>
                {action.signals.map((s, i) => (
                  <code className="signal" key={i}>
                    {s}
                  </code>
                ))}
              </div>
            )}
            <Replay state={state} />
            <div className="inspector-block">
              <h3>Evidence files</h3>
              {action.evidencePaths.map((p) => (
                <a
                  className="evidence-link"
                  href={`/artifacts/${p}`}
                  target="_blank"
                  rel="noreferrer"
                  key={p}
                >
                  <FileText size={14} />
                  {p.split("/").pop()}
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="inspector-tabs">
              {["overview", "controls", "actions"].map((t) => (
                <button
                  key={t}
                  className={t === tab ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                  {t === "controls"
                    ? ` (${els.length})`
                    : t === "actions"
                      ? ` (${outgoing.length})`
                      : ""}
                </button>
              ))}
            </div>
            <div className="inspector-scroll">
              {tab === "overview" ? (
                <>
                  {state.screenshotPath && (
                    <a
                      className="state-evidence"
                      href={`/artifacts/${state.screenshotPath}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/artifacts/${state.screenshotPath}`}
                        alt={`Screenshot of ${stateName(state)}`}
                      />
                      <span>
                        <Maximize2 size={13} />
                        Open full capture
                      </span>
                    </a>
                  )}
                  <div className="inspector-block">
                    <h3>Visible regions</h3>
                    {state.visibleRegionSummary.length ? (
                      state.visibleRegionSummary.map((r, i) => (
                        <div className="region" key={i}>
                          <Box size={14} />
                          {r}
                        </div>
                      ))
                    ) : (
                      <p>
                        Primary page content, without additional visible
                        overlays.
                      </p>
                    )}
                  </div>
                  <div className="inspector-block">
                    <h3>State fingerprint</h3>
                    <code className="fingerprint">
                      {state.fingerprint}
                      <CopyButton value={state.fingerprint} />
                    </code>
                    <p>{state.fingerprintReason}</p>
                  </div>
                  <Replay state={state} />
                  <div className="inspector-block">
                    <h3>Provenance</h3>
                    <dl>
                      <dt>Discovered</dt>
                      <dd>
                        {new Date(state.discoveredAt).toLocaleTimeString()}
                      </dd>
                      <dt>Worker</dt>
                      <dd>{state.worker}</dd>
                      <dt>Depth</dt>
                      <dd>{state.depth}</dd>
                    </dl>
                    {state.provenanceActionId && (
                      <button
                        className="text-button"
                        onClick={() =>
                          select({
                            kind: "action",
                            id: state.provenanceActionId!,
                          })
                        }
                      >
                        Inspect discovery interaction
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </>
              ) : tab === "controls" ? (
                els.map((e) => (
                  <div className="inspector-block" key={e.id}>
                    <div className="control-title">
                      <span className="role-label">{e.role || e.tag}</span>
                      <h3>{e.accessibleName || "Unnamed control"}</h3>
                    </div>
                    <LocatorList element={e} />
                  </div>
                ))
              ) : (
                outgoing.map((a) => (
                  <button
                    className="inspector-action"
                    key={a.id}
                    onClick={() => select({ kind: "action", id: a.id })}
                  >
                    <MousePointer2 size={15} />
                    <span>
                      <strong>{a.targetName}</strong>
                      <small>
                        {a.effectFlags.length
                          ? a.effectFlags.map(effectLabel).join(", ")
                          : a.policy.rule}
                      </small>
                    </span>
                    <span className={`decision-dot ${a.decision}`} />
                    <ChevronRight size={14} />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
function Replay({ state }: { state: AppState }) {
  return (
    <div className="inspector-block">
      <h3>
        <GitBranch size={14} />
        Verified replay path
      </h3>
      <ol className="replay">
        <li>
          <span>Open seed route</span>
          <code>{shortPath(state.recipe.seed)}</code>
        </li>
        {state.recipe.steps.map((s, i) => (
          <li key={i}>
            <span>
              {s.action}{" "}
              {s.locators.find((l) => l.name)?.name || s.locators[0]?.value}
            </span>
            <code>{shortPath(s.expectedUrl)}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}
function useDialogFocus() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (!root) return;
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    root.addEventListener("keydown", handler);
    return () => {
      root.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return ref;
}
function NewScan({
  projectId,
  projectName,
  projectUrl,
  projectConfig,
  globalDefaults,
  close,
  created,
}: {
  projectId: string;
  projectName: string;
  projectUrl: string;
  projectConfig: ScanConfig;
  globalDefaults?: UserSettings["discovery"];
  close: () => void;
  created: (r: RunSummary) => void;
}) {
  const focusRef = useDialogFocus();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<ScanConfig>(() => ({
    ...projectConfig,
    ...globalDefaults,
    name: `${projectName} discovery`,
    baseUrl: projectUrl,
    seeds: [],
    authStatePath: undefined,
    formValues: [],
  }));
  const [jsonDrafts, setJsonDrafts] = useState(() => ({
    actionAllowlist: JSON.stringify(projectConfig.actionAllowlist, null, 2),
    formSubmitAllowlist: JSON.stringify(
      projectConfig.formSubmitAllowlist,
      null,
      2,
    ),
    formValues: "[]",
    networkWriteAllowlist: JSON.stringify(
      projectConfig.networkWriteAllowlist,
      null,
      2,
    ),
  }));
  const [advancedJson, setAdvancedJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const steps = ["Target", "Exploration", "Safety & evidence", "Advanced"];
  const update = <K extends keyof ScanConfig>(key: K, value: ScanConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));
  const lines = (values: string[]) => values.join("\n");
  const readLines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const updateJson = (key: keyof typeof jsonDrafts, value: string) =>
    setJsonDrafts((current) => ({ ...current, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < steps.length - 1) {
      setStep((current) => current + 1);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const parsedLists = Object.fromEntries(
        Object.entries(jsonDrafts).map(([key, value]) => {
          const parsed: unknown = value.trim() ? JSON.parse(value) : [];
          if (!Array.isArray(parsed))
            throw new Error(`${key} must be a JSON array`);
          return [key, parsed];
        }),
      );
      const extra: unknown = advancedJson.trim()
        ? JSON.parse(advancedJson)
        : {};
      if (!extra || typeof extra !== "object" || Array.isArray(extra))
        throw new Error("Advanced overrides must be a JSON object");
      const result = await api<RunSummary>(
        `/projects/${projectId}/discoveries`,
        {
          config: {
            ...config,
            ...parsedLists,
            ...(extra as Record<string, unknown>),
            baseUrl: projectUrl,
          },
        },
      );
      created(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const numberField = (
    label: string,
    key: keyof ScanConfig,
    value: number,
    min: number,
    max: number,
    suffix = "",
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          update(key, Number(e.target.value) as ScanConfig[typeof key])
        }
      />
      {suffix && <small className="wizard-help">{suffix}</small>}
    </label>
  );
  const toggle = (
    label: string,
    detail: string,
    key: keyof ScanConfig,
    value: boolean,
  ) => (
    <label className="wizard-toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) =>
          update(key, e.target.checked as ScanConfig[typeof key])
        }
      />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <section
        ref={focusRef}
        className="scan-modal discovery-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
      >
        <div className="modal-heading">
          <span className="modal-icon">
            <ScanLine size={24} />
          </span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close discovery setup"
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="scan-title">Configure discovery</h2>
        <p>
          Choose what Unfold should explore, how far it should go, and what
          evidence it should collect.
        </p>
        <div
          className="wizard-progress"
          aria-label={`Step ${step + 1} of ${steps.length}`}
        >
          {steps.map((label, index) => (
            <button
              type="button"
              className={index === step ? "active" : index < step ? "done" : ""}
              onClick={() => {
                if (index <= step) setStep(index);
              }}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <div className="wizard-body">
            {step === 0 && (
              <div className="wizard-section">
                <div className="wizard-section-heading">
                  <h3>What should this discovery visit?</h3>
                  <p>
                    The application origin is set by this project. Add starting
                    routes and any additional origins the application needs.
                  </p>
                </div>
                <label>
                  Discovery name
                  <input
                    autoFocus
                    value={config.name}
                    maxLength={100}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="e.g. Billing workflow review"
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    Role label <span>Optional · for comparing discoveries</span>
                    <input
                      value={config.roleLabel || ""}
                      maxLength={80}
                      onChange={(e) =>
                        update("roleLabel", e.target.value || undefined)
                      }
                      placeholder="e.g. Administrator"
                    />
                    <small className="wizard-help">
                      A label only; discovery does not change account
                      permissions.
                    </small>
                  </label>
                  <label>
                    Locale label <span>Optional · language/region tag</span>
                    <input
                      value={config.localeLabel || ""}
                      maxLength={32}
                      onChange={(e) =>
                        update("localeLabel", e.target.value || undefined)
                      }
                      placeholder="e.g. en-US"
                    />
                    <small className="wizard-help">
                      Record the locale used for this run so compatible
                      discoveries can be compared.
                    </small>
                  </label>
                </div>
                <label>
                  Project application URL
                  <input value={projectUrl} readOnly />
                  <small className="wizard-help">
                    This project’s origin is the discovery anchor. Use starting
                    routes below to begin at a specific page or allowed origin.
                  </small>
                </label>
                <label>
                  Starting routes <span>Optional · one URL per line</span>
                  <textarea
                    value={lines(config.seeds)}
                    onChange={(e) => update("seeds", readLines(e.target.value))}
                    placeholder={`${projectUrl}\n${new URL(projectUrl).origin}/settings`}
                    rows={4}
                  />
                  <small className="wizard-help">
                    Leave empty to begin at the project URL. Every route must
                    use an allowed origin.
                  </small>
                </label>
                <label>
                  Allowed origins <span>Exact origins · one per line</span>
                  <textarea
                    value={lines(config.allowedOrigins)}
                    onChange={(e) =>
                      update("allowedOrigins", readLines(e.target.value))
                    }
                    placeholder="https://api.example.com"
                    rows={3}
                  />
                  <small className="wizard-help">
                    Only add origins that belong to this application and that
                    you are authorized to scan.
                  </small>
                </label>
                <label>
                  Saved browser session path <span>Optional</span>
                  <input
                    value={config.authStatePath || ""}
                    onChange={(e) =>
                      update("authStatePath", e.target.value || undefined)
                    }
                    placeholder=".local/auth-state.json"
                  />
                  <small className="wizard-help">
                    Use a local Playwright storage-state file. Session data
                    stays in your local workspace.
                  </small>
                </label>
              </div>
            )}
            {step === 1 && (
              <div className="wizard-section">
                <div className="wizard-section-heading">
                  <h3>Set the exploration budget</h3>
                  <p>
                    These limits control scan breadth, browser parallelism, and
                    runtime.
                  </p>
                </div>
                <div className="form-row">
                  {numberField(
                    "Browser workers",
                    "concurrency",
                    config.concurrency,
                    1,
                    16,
                    "Parallel browser sessions",
                  )}
                  {numberField(
                    "Maximum depth",
                    "maxDepth",
                    config.maxDepth,
                    0,
                    20,
                    "Actions away from a starting route",
                  )}
                </div>
                <div className="form-row">
                  {numberField(
                    "State limit",
                    "maxStates",
                    config.maxStates,
                    1,
                    10000,
                    "Distinct UI states to save",
                  )}
                  {numberField(
                    "Action limit",
                    "maxActions",
                    config.maxActions,
                    1,
                    50000,
                    "Controls to inspect",
                  )}
                </div>
                <div className="form-row">
                  {numberField(
                    "Time limit",
                    "maxDurationMinutes",
                    config.maxDurationMinutes,
                    1,
                    240,
                    "Minutes",
                  )}
                  {numberField(
                    "Action timeout",
                    "actionTimeoutMs",
                    config.actionTimeoutMs,
                    500,
                    60000,
                    "Milliseconds",
                  )}
                </div>
                <div className="form-row">
                  {numberField(
                    "Page settle time",
                    "settleMs",
                    config.settleMs,
                    50,
                    3000,
                    "Wait after an action · milliseconds",
                  )}
                  {numberField(
                    "Navigation interval",
                    "navigationIntervalMs",
                    config.navigationIntervalMs,
                    0,
                    60000,
                    "Milliseconds between navigations",
                  )}
                </div>
                <div className="form-row">
                  {numberField(
                    "Browser memory cap",
                    "maxBrowserMemoryMB",
                    config.maxBrowserMemoryMB,
                    128,
                    65536,
                    "MB",
                  )}
                  {numberField(
                    "Browser CPU cap",
                    "maxBrowserCpuPercent",
                    config.maxBrowserCpuPercent,
                    50,
                    6400,
                    "Percent across workers",
                  )}
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="wizard-section">
                <div className="wizard-section-heading">
                  <h3>Choose what to run and record</h3>
                  <p>
                    {config.safeMode
                      ? "Safe mode skips uncertain or committing actions. You can narrow discovery behavior below."
                      : "Safe mode is off. Unfamiliar controls may trigger side effects; use a disposable or staging application."}
                  </p>
                </div>
                <div className="wizard-toggle-grid">
                  {toggle(
                    "Safe mode",
                    "Skip controls that may commit changes or have unclear effects.",
                    "safeMode",
                    config.safeMode,
                  )}
                  {toggle(
                    "Dry run",
                    "Inspect pages without activating discovered controls.",
                    "dryRun",
                    config.dryRun,
                  )}
                  {toggle(
                    "Capture screenshots",
                    "Save visual evidence for observed states.",
                    "captureScreenshots",
                    config.captureScreenshots,
                  )}
                  {toggle(
                    "Capture failure traces",
                    "Save Playwright traces when an action fails.",
                    "captureTracesOnFailure",
                    config.captureTracesOnFailure,
                  )}
                </div>
                <h4 className="wizard-subheading">Evidence and replay</h4>
                <div className="form-row">
                  <label>
                    Viewport width
                    <input
                      type="number"
                      min={320}
                      max={2560}
                      value={config.viewport.width}
                      onChange={(e) =>
                        update("viewport", {
                          ...config.viewport,
                          width: Number(e.target.value),
                        })
                      }
                    />
                    <small className="wizard-help">Pixels</small>
                  </label>
                  <label>
                    Viewport height
                    <input
                      type="number"
                      min={400}
                      max={1600}
                      value={config.viewport.height}
                      onChange={(e) =>
                        update("viewport", {
                          ...config.viewport,
                          height: Number(e.target.value),
                        })
                      }
                    />
                    <small className="wizard-help">Pixels</small>
                  </label>
                </div>
                <label>
                  Sensitive-field selectors{" "}
                  <span>One CSS selector per line</span>
                  <textarea
                    value={lines(config.redactSelectors)}
                    onChange={(e) =>
                      update("redactSelectors", readLines(e.target.value))
                    }
                    rows={3}
                    placeholder={"input\ntextarea\n[data-private]"}
                  />
                  <small className="wizard-help">
                    Matched fields are redacted from captured evidence.
                  </small>
                </label>
                <h4 className="wizard-subheading">Route and action rules</h4>
                <div className="form-row">
                  <label>
                    Blocked action keywords <span>One phrase per line</span>
                    <textarea
                      value={lines(config.denyActionKeywords)}
                      onChange={(e) =>
                        update("denyActionKeywords", readLines(e.target.value))
                      }
                      rows={5}
                    />
                  </label>
                  <label>
                    Blocked URL patterns <span>One pattern per line</span>
                    <textarea
                      value={lines(config.denyUrlPatterns)}
                      onChange={(e) =>
                        update("denyUrlPatterns", readLines(e.target.value))
                      }
                      rows={5}
                      placeholder="/admin/delete"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Allowed URL patterns <span>One pattern per line</span>
                    <textarea
                      value={lines(config.allowUrlPatterns)}
                      onChange={(e) =>
                        update("allowUrlPatterns", readLines(e.target.value))
                      }
                      rows={3}
                      placeholder="/settings/.*"
                    />
                  </label>
                  <label>
                    Ignored query parameters <span>One name per line</span>
                    <textarea
                      value={lines(config.ignoreQueryParams)}
                      onChange={(e) =>
                        update("ignoreQueryParams", readLines(e.target.value))
                      }
                      rows={3}
                    />
                  </label>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="wizard-section">
                <div className="wizard-section-heading">
                  <h3>Fine-tune discovery rules</h3>
                  <p>
                    These options are useful for testing known workflows, form
                    states, or APIs. Values are stored with this discovery.
                  </p>
                </div>
                <JsonArrayField
                  label="Action allowlist"
                  value={jsonDrafts.actionAllowlist}
                  onChange={(v) => updateJson("actionAllowlist", v)}
                  placeholder={
                    '[{"route":"/settings","name":"Open preferences"}]'
                  }
                  help="Only listed route and control pairs can be activated when an allowlist is configured."
                />
                <JsonArrayField
                  label="Form-submit allowlist"
                  value={jsonDrafts.formSubmitAllowlist}
                  onChange={(v) => updateJson("formSubmitAllowlist", v)}
                  placeholder={'[{"route":"/search","name":"Search"}]'}
                  help="Explicitly permit safe form submissions by route and submit-control name."
                />
                <JsonArrayField
                  label="Synthetic form values"
                  value={jsonDrafts.formValues}
                  onChange={(v) => updateJson("formValues", v)}
                  placeholder={
                    '[{"route":"/search","label":"Search","value":"sample"}]'
                  }
                  help="Use non-sensitive sample values. Do not put passwords, tokens, or real customer data here."
                />
                <JsonArrayField
                  label="Permitted network writes"
                  value={jsonDrafts.networkWriteAllowlist}
                  onChange={(v) => updateJson("networkWriteAllowlist", v)}
                  placeholder={
                    '[{"url":"https://api.example.com/search","method":"POST"}]'
                  }
                  help="Allow only known safe write requests. Safe mode still applies to UI actions."
                />
                <label>
                  Additional configuration overrides{" "}
                  <span>Optional JSON object</span>
                  <textarea
                    className="wizard-code"
                    value={advancedJson}
                    onChange={(e) => setAdvancedJson(e.target.value)}
                    rows={6}
                    placeholder={
                      '{\n  "captureScreenshots": true,\n  "viewport": { "width": 1440, "height": 960 }\n}'
                    }
                  />
                  <small className="wizard-help">
                    Any valid scanner setting can be added here. Values here
                    override the controls above; project origin stays fixed.
                  </small>
                </label>
                <div className="wizard-review">
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Ready to discover {projectName}</strong>
                    <small>
                      {config.maxStates.toLocaleString()} states ·{" "}
                      {config.maxActions.toLocaleString()} actions · up to{" "}
                      {config.maxDurationMinutes} minutes ·{" "}
                      {config.safeMode ? "safe mode on" : "safe mode off"}
                    </small>
                  </span>
                </div>
              </div>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-footer wizard-footer">
            {step === 0 ? (
              <button className="button" type="button" onClick={close}>
                Cancel
              </button>
            ) : (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setStep((current) => current - 1);
                }}
              >
                <ArrowLeft size={15} />
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button
                className="button primary"
                type="button"
                onClick={() => {
                  setError("");
                  setStep((current) => current + 1);
                }}
              >
                Continue
                <ArrowRight size={15} />
              </button>
            ) : (
              <button className="button primary" disabled={busy} type="submit">
                <ScanLine size={16} />
                {busy ? "Starting discovery…" : "Start discovery"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function JsonArrayField({
  label,
  value,
  onChange,
  placeholder,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  help: string;
}) {
  return (
    <label>
      {label}
      <textarea
        className="wizard-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={placeholder}
      />
      <small className="wizard-help">{help} Enter a JSON array.</small>
    </label>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>,
);
