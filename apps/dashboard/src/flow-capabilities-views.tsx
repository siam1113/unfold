import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Wrench,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  UploadCloud,
  Ban,
  RefreshCw,
  Loader2,
  ListChecks,
  FlaskConical,
  History,
  ClipboardList,
  Link2,
  GitBranch,
  Globe,
  MousePointerClick,
  HelpCircle,
  Sparkles,
  Copy,
  Check,
  Trash2,
  CheckSquare,
  X,
  Save,
  Plus,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { RunData } from "../../../packages/shared/src/index";
import type {
  Capability,
  Flow,
  Risk,
  VerificationRun,
  VerificationStatus,
} from "../../../packages/capability-core/src/types";
import { MineWizard } from "./flow-mine-wizard";
import { VerificationWizard } from "./flow-verification-wizard";
import {
  CypressMark,
  PlaywrightMark,
  ChromeMark,
} from "./flow-automation-framework-views";
import "./flow-capabilities-views.css";

/** A capability row as the server now returns it — its one or two Flow records embedded (apps/server/src/capabilities.ts's `capabilitiesWithFlows`). */
type CapabilityRow = Capability & {
  flows?: { primary: Flow; secondary?: Flow };
};

// REST contract this view is built against (not live yet — see
// hynix_webmcp_extension_plan.md §12). A later wave wires a server to these
// exact routes:
//   GET  /api/projects/:projectId/discoveries/:id/capabilities
//   POST /api/projects/:projectId/discoveries/:id/capabilities/mine
//   GET  /api/projects/:projectId/capabilities/:capId/verification-runs
//   POST /api/projects/:projectId/capabilities/:capId/verify
//   POST /api/projects/:projectId/capabilities/:capId/approve
//   POST /api/projects/:projectId/capabilities/:capId/publish
//   POST /api/projects/:projectId/capabilities/:capId/disable
// Every call degrades to an empty list + muted message on failure, since
// none of these routes exist on the server yet.
const apiRequest = async <T,>(
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
  const value = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((value as { error?: string }).error || "Request failed");
  return value as T;
};

type SubView = "candidates" | "runs" | "registry";

type Props = {
  data: RunData;
  query: string;
  projectId: string;
  discoveryId: string;
};

const riskLabel: Record<Risk, string> = {
  read: "Read-only",
  reversible_write: "Reversible write",
  irreversible_write: "Irreversible write",
};
const riskTone: Record<Risk, string> = {
  read: "is-good",
  reversible_write: "is-warn",
  irreversible_write: "is-bad",
};
const riskIcon: Record<Risk, typeof ShieldCheck> = {
  read: ShieldCheck,
  reversible_write: ShieldAlert,
  irreversible_write: ShieldX,
};
type EvidenceKind = Capability["evidenceKinds"][number];
/** Discover tab filter: "evidenced" is everything that isn't "inferred" (api and/or ui). */
type EvidenceFilter = "all" | "evidenced" | "inferred";
const evidenceKindLabel: Record<EvidenceKind, string> = {
  api: "API evidence",
  ui: "UI evidence",
  inferred: "Inferred — unevidenced",
};
const evidenceKindTone: Record<EvidenceKind, string> = {
  api: "is-good",
  ui: "",
  inferred: "is-warn",
};
const evidenceKindIcon: Record<EvidenceKind, typeof Globe> = {
  api: Globe,
  ui: MousePointerClick,
  inferred: HelpCircle,
};
/** Transitional fallback for a row the server hasn't recomputed `evidenceKinds` for yet. */
const evidenceKindsOf = (capability: Capability): EvidenceKind[] =>
  capability.evidenceKinds?.length
    ? capability.evidenceKinds
    : [capability.evidenceKind ?? "api"];
const statusTone: Record<VerificationStatus, string> = {
  candidate: "",
  testing: "is-warn",
  verified: "is-good",
  published: "is-good",
  inconclusive: "is-warn",
  failed: "is-bad",
  stale: "is-warn",
  disabled: "is-bad",
};
const runStatusTone: Record<VerificationRun["status"], string> = {
  testing: "is-warn",
  verified: "is-good",
  failed: "is-bad",
  inconclusive: "is-warn",
};

const SUB_VIEWS: { id: SubView; name: string; icon: typeof ListChecks }[] = [
  { id: "candidates", name: "Discover", icon: ListChecks },
  { id: "runs", name: "Verify", icon: History },
  { id: "registry", name: "Registry", icon: ClipboardList },
];

export function Capabilities({ data, query, projectId, discoveryId }: Props) {
  const [subView, setSubView] = useState<SubView>("candidates");
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [capabilitiesUnavailable, setCapabilitiesUnavailable] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [verifyWizard, setVerifyWizard] = useState<{
    capabilityId: string;
    flowId?: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [runs, setRuns] = useState<VerificationRun[]>([]);
  const [runsUnavailable, setRunsUnavailable] = useState(false);
  const [runsCapabilityId, setRunsCapabilityId] = useState<string | null>(null);
  // "approved" has no persisted status of its own (plan §9: the chain is
  // verified -> published, with the approve endpoint just a reviewer
  // confirmation/audit point — see apps/server/src/index.ts's /approve
  // route), so it's tracked client-side and does reset on reload.
  // "published" is NOT the same situation: the server does persist
  // `status: "published"` (apps/server/src/capabilities.ts's
  // publishCapability), so it's derived from the fetched capability list
  // below rather than a separate ephemeral Set — otherwise a reload wipes
  // the Registry tab's published rows even though the server still has them.
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const publishedIds = useMemo(
    () =>
      new Set(
        capabilities.filter((c) => c.status === "published").map((c) => c.id),
      ),
    [capabilities],
  );
  const [registrySelectedIds, setRegistrySelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [candidateSelectedIds, setCandidateSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [registrySelectMode, setRegistrySelectMode] = useState(false);
  const [candidateSelectMode, setCandidateSelectMode] = useState(false);

  const basePath = `/projects/${projectId}/discoveries/${discoveryId}/capabilities`;

  useEffect(() => {
    let alive = true;
    apiRequest<CapabilityRow[]>(basePath)
      .then((list) => {
        if (!alive) return;
        setCapabilities(list);
        setCapabilitiesUnavailable(false);
      })
      .catch(() => {
        if (alive) setCapabilitiesUnavailable(true);
      });
    return () => {
      alive = false;
    };
  }, [basePath, data.run.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return capabilities
      .filter((c) => c.status !== "disabled")
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      )
      .filter((c) => {
        if (evidenceFilter === "all") return true;
        const inferred = evidenceKindsOf(c).includes("inferred");
        return evidenceFilter === "inferred" ? inferred : !inferred;
      });
  }, [capabilities, query, evidenceFilter]);

  const selected = capabilities.find((c) => c.id === selectedId) || null;

  // The server's action endpoints (verify/approve/publish/disable) return a
  // plain Capability, not the list endpoint's flows-embedded shape — merge
  // rather than replace so the row keeps its already-loaded `flows`.
  const applyUpdatedCapability = (updated: Capability) => {
    setCapabilities((prev) =>
      prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
    );
  };

  const approve = async (capability: Capability) => {
    setActionBusy(`approve:${capability.id}`);
    try {
      const updated = await apiRequest<Capability>(
        `/projects/${projectId}/capabilities/${capability.id}/approve`,
        {},
      );
      applyUpdatedCapability(updated);
      setApprovedIds((prev) => new Set(prev).add(capability.id));
      setNotice(`${updated.name} approved.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const publish = async (capability: Capability) => {
    setActionBusy(`publish:${capability.id}`);
    try {
      const updated = await apiRequest<Capability>(
        `/projects/${projectId}/capabilities/${capability.id}/publish`,
        {},
      );
      applyUpdatedCapability(updated);
      setNotice(`${updated.name} published.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const disable = async (capability: Capability) => {
    setActionBusy(`disable:${capability.id}`);
    try {
      const updated = await apiRequest<Capability>(
        `/projects/${projectId}/capabilities/${capability.id}/disable`,
        {},
      );
      applyUpdatedCapability(updated);
      setApprovedIds((prev) => {
        const next = new Set(prev);
        next.delete(capability.id);
        return next;
      });
      setNotice(`${updated.name} disabled.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const setRequired = async (capability: Capability, ids: string[]) => {
    setActionBusy(`required:${capability.id}`);
    try {
      const updated = await apiRequest<Capability>(
        `/projects/${projectId}/capabilities/${capability.id}/required-capabilities`,
        { requiredCapabilityIds: ids },
        "PUT",
      );
      applyUpdatedCapability(updated);
      setNotice(`${updated.name}'s requirements saved.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const forgetCapability = (id: string) => {
    setCapabilities((prev) => prev.filter((c) => c.id !== id));
    setRegistrySelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setCandidateSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setApprovedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const deleteOne = async (capability: Capability) => {
    setActionBusy(`delete:${capability.id}`);
    try {
      await apiRequest(
        `/projects/${projectId}/capabilities/${capability.id}`,
        {},
        "DELETE",
      );
      forgetCapability(capability.id);
      setNotice(`${capability.name} deleted.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const bulkDelete = async (targets: Capability[]) => {
    if (!targets.length) return;
    setActionBusy("bulk:delete");
    try {
      const results = await Promise.allSettled(
        targets.map((c) =>
          apiRequest(
            `/projects/${projectId}/capabilities/${c.id}`,
            {},
            "DELETE",
          ),
        ),
      );
      results.forEach((result, i) => {
        if (result.status === "fulfilled") forgetCapability(targets[i].id);
      });
      const failed = results.filter((r) => r.status === "rejected").length;
      setNotice(
        failed
          ? `Deleted ${results.length - failed} of ${results.length} capabilities (${failed} failed).`
          : `Deleted ${results.length} capabilit${results.length === 1 ? "y" : "ies"}.`,
      );
    } finally {
      setActionBusy(null);
    }
  };

  const bulkRefresh = async (targets: Capability[]) => {
    if (!targets.length) return;
    setActionBusy("bulk:refresh");
    try {
      const results = await Promise.allSettled(
        targets.map((c) =>
          apiRequest<Capability>(
            `/projects/${projectId}/capabilities/${c.id}/verify`,
            {},
          ),
        ),
      );
      results.forEach((result) => {
        if (result.status === "fulfilled") applyUpdatedCapability(result.value);
      });
      const failed = results.filter((r) => r.status === "rejected").length;
      setNotice(
        failed
          ? `Re-verification started for ${results.length - failed} of ${results.length} capabilities (${failed} failed).`
          : `Re-verification started for ${results.length} capabilit${results.length === 1 ? "y" : "ies"}.`,
      );
    } finally {
      setActionBusy(null);
    }
  };

  const loadRunsFor = (capabilityId: string) => {
    setRunsCapabilityId(capabilityId);
    let alive = true;
    apiRequest<VerificationRun[]>(
      `/projects/${projectId}/capabilities/${capabilityId}/verification-runs`,
    )
      .then((list) => {
        if (!alive) return;
        setRuns(list);
        setRunsUnavailable(false);
      })
      .catch(() => {
        if (alive) {
          setRuns([]);
          setRunsUnavailable(true);
        }
      });
    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    if (subView !== "runs") return;
    const capabilityId = selectedId || runsCapabilityId;
    if (!capabilityId) return;
    return loadRunsFor(capabilityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, selectedId, projectId]);

  const registryRows = useMemo(
    () =>
      capabilities.filter(
        (c) =>
          c.status === "verified" ||
          c.status === "disabled" ||
          approvedIds.has(c.id) ||
          publishedIds.has(c.id),
      ),
    [capabilities, approvedIds, publishedIds],
  );

  return (
    <div className="flow-cap-view">
      <div
        className="flow-cap-subnav"
        role="tablist"
        aria-label="Capability views"
      >
        {SUB_VIEWS.map((view) => (
          <button
            key={view.id}
            role="tab"
            aria-selected={subView === view.id}
            className={subView === view.id ? "active" : ""}
            onClick={() => setSubView(view.id)}
          >
            <view.icon size={13} />
            {view.name}
          </button>
        ))}
      </div>
      {notice && (
        <div className="flow-cap-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {subView === "candidates" && (
        <CandidatesView
          capabilities={filtered}
          allCapabilities={capabilities}
          unavailable={capabilitiesUnavailable}
          evidenceFilter={evidenceFilter}
          onEvidenceFilterChange={setEvidenceFilter}
          onOpenWizard={() => setShowWizard(true)}
          selected={selected}
          onSelect={setSelectedId}
          actionBusy={actionBusy}
          onVerify={(capability, flowId) =>
            setVerifyWizard({ capabilityId: capability.id, flowId })
          }
          onDelete={deleteOne}
          onSetRequired={setRequired}
          selectMode={candidateSelectMode}
          onToggleSelectMode={() => {
            setCandidateSelectMode((prev) => !prev);
            setCandidateSelectedIds(new Set());
          }}
          selectedIds={candidateSelectedIds}
          onToggleSelect={(id) =>
            setCandidateSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={() =>
            setCandidateSelectedIds((prev) =>
              filtered.every((c) => prev.has(c.id))
                ? new Set()
                : new Set(filtered.map((c) => c.id)),
            )
          }
          onBulkDelete={() =>
            bulkDelete(filtered.filter((c) => candidateSelectedIds.has(c.id)))
          }
          onBulkRefresh={() =>
            bulkRefresh(filtered.filter((c) => candidateSelectedIds.has(c.id)))
          }
        />
      )}
      {showWizard &&
        createPortal(
          <MineWizard
            projectId={projectId}
            discoveryId={discoveryId}
            close={() => setShowWizard(false)}
            onMined={(list) => {
              const typed = list as CapabilityRow[];
              setCapabilities(typed);
              setCapabilitiesUnavailable(false);
              setNotice(
                `Mining found ${typed.length} capabilit${typed.length === 1 ? "y" : "ies"}.`,
              );
            }}
          />,
          document.body,
        )}
      {verifyWizard &&
        createPortal(
          <VerificationWizard
            projectId={projectId}
            capabilities={capabilities}
            initialCapabilityId={verifyWizard.capabilityId}
            initialFlowId={verifyWizard.flowId}
            close={() => setVerifyWizard(null)}
            onFinished={(updatedCapability) => {
              if (!updatedCapability) return;
              applyUpdatedCapability(updatedCapability);
              if (
                runsCapabilityId === updatedCapability.id ||
                selectedId === updatedCapability.id
              )
                loadRunsFor(updatedCapability.id);
            }}
          />,
          document.body,
        )}
      {subView === "runs" && (
        <RunsView
          capabilities={capabilities}
          selectedCapabilityId={selectedId || runsCapabilityId}
          onSelectCapability={loadRunsFor}
          runs={runs}
          unavailable={runsUnavailable}
        />
      )}
      {subView === "registry" && (
        <RegistryView
          capabilities={registryRows}
          approvedIds={approvedIds}
          publishedIds={publishedIds}
          actionBusy={actionBusy}
          selectMode={registrySelectMode}
          onToggleSelectMode={() => {
            setRegistrySelectMode((prev) => !prev);
            setRegistrySelectedIds(new Set());
          }}
          selectedIds={registrySelectedIds}
          onToggleSelect={(id) =>
            setRegistrySelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={() =>
            setRegistrySelectedIds((prev) =>
              registryRows.every((c) => prev.has(c.id))
                ? new Set()
                : new Set(registryRows.map((c) => c.id)),
            )
          }
          onApprove={approve}
          onPublish={publish}
          onDisable={disable}
          onDelete={deleteOne}
          onBulkDelete={() =>
            bulkDelete(
              registryRows.filter((c) => registrySelectedIds.has(c.id)),
            )
          }
          onBulkRefresh={() =>
            bulkRefresh(
              registryRows.filter((c) => registrySelectedIds.has(c.id)),
            )
          }
        />
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: Risk }) {
  const Icon = riskIcon[risk];
  return (
    <span className={`flow-cap-pill ${riskTone[risk]}`}>
      <Icon size={11} />
      {riskLabel[risk]}
    </span>
  );
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={`flow-cap-pill ${statusTone[status]}`}>{status}</span>
  );
}

function EvidenceKindBadge({ capability }: { capability: Capability }) {
  return (
    <>
      {evidenceKindsOf(capability).map((kind) => {
        const Icon = evidenceKindIcon[kind];
        return (
          <span
            className={`flow-cap-pill ${evidenceKindTone[kind]}`}
            key={kind}
          >
            <Icon size={11} />
            {evidenceKindLabel[kind]}
          </span>
        );
      })}
    </>
  );
}

/** Same pattern as apps/dashboard/src/main.tsx's CopyButton (not exported from there, so kept local here too). */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      title="Copy to clipboard"
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

type FlowSide = "primary" | "secondary";

type FlowStepType = Flow["steps"][number];
type LocatorType = FlowStepType["locators"][number];

/** Same "pick the best evidence" rule the default click → selector view already used. */
const bestLocator = (step: FlowStepType): LocatorType | undefined =>
  step.locators.find((l) => l.uniqueAtDiscovery) ?? step.locators[0];

/**
 * The bare selector a non-framework reader expects by default — e.g.
 * `testid=submit-button` — as opposed to `locator.expression`, which is
 * already full Playwright locator *code* (`page.getByTestId("submit-button")`,
 * built by packages/analysis/src/index.ts's `expression()`). Showing that
 * code unconditionally was the bug: every reader got Playwright-flavored
 * syntax whether or not they use Playwright. The framework icons below are
 * what now reveal `expression` (and its Cypress/Chrome equivalents).
 */
function selectorLabel(locator: LocatorType): string {
  switch (locator.kind) {
    case "role":
      return `role=${locator.value}${locator.name ? ` "${locator.name}"` : ""}`;
    case "testId":
      return `testid=${locator.value}`;
    case "label":
      return `label="${locator.value}"`;
    case "placeholder":
      return `placeholder="${locator.value}"`;
    case "text":
      return `text="${locator.value}"`;
    case "css":
    default:
      return locator.value;
  }
}

type CodeFramework = "default" | "playwright" | "cypress" | "chrome";

const FRAMEWORK_CODE_LABEL: Record<
  Exclude<CodeFramework, "default">,
  string
> = {
  playwright: "Playwright",
  cypress: "Cypress",
  chrome: "Chrome DevTools Recorder",
};

/** `step.inputField` is a property name off the capability's own inputSchema (see onSetRequired/Input schema section above), so `input.<field>` reads as "the caller-supplied value for this field" in every generated snippet below. Bracket-notates when the field isn't a plain identifier (a pre-existing capability mined before mining-tools.ts started slugifying LLM-supplied field names could still have one with spaces/punctuation) — dot notation would otherwise emit invalid code. */
const inputRef = (step: FlowStepType) => {
  const field = step.inputField ?? "value";
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field)
    ? `input.${field}`
    : `input[${JSON.stringify(field)}]`;
};

function toPlaywrightCode(flow: Flow): string {
  return flow.steps
    .map((step) => {
      const locator = bestLocator(step);
      const target = locator
        ? locator.expression
        : `page.locator(/* ${step.elementSignature} */)`;
      switch (step.action) {
        case "fill":
          return `${target}.fill(${inputRef(step)});`;
        case "select":
          return `${target}.selectOption(${inputRef(step)});`;
        case "hover":
          return `${target}.hover();`;
        case "click":
        default:
          return `${target}.click();`;
      }
    })
    .join("\n");
}

function cypressTarget(locator: LocatorType): string {
  switch (locator.kind) {
    case "testId":
      return `cy.get('[data-testid="${locator.value}"]')`;
    case "label":
      return `cy.findByLabelText(${JSON.stringify(locator.value)})`;
    case "placeholder":
      return `cy.get('[placeholder="${locator.value}"]')`;
    case "text":
      return `cy.contains(${JSON.stringify(locator.value)})`;
    case "role":
      return `cy.findByRole(${JSON.stringify(locator.value)}${
        locator.name ? `, { name: ${JSON.stringify(locator.name)} }` : ""
      })`;
    case "css":
    default:
      return `cy.get(${JSON.stringify(locator.value)})`;
  }
}

function toCypressCode(flow: Flow): string {
  return flow.steps
    .map((step) => {
      const locator = bestLocator(step);
      const target = locator
        ? cypressTarget(locator)
        : `cy.get(/* ${step.elementSignature} */)`;
      switch (step.action) {
        case "fill":
          return `${target}.type(${inputRef(step)});`;
        case "select":
          return `${target}.select(${inputRef(step)});`;
        case "hover":
          return `${target}.trigger("mouseover");`;
        case "click":
        default:
          return `${target}.click();`;
      }
    })
    .join("\n");
}

/** Chrome's own Recorder selector syntax: `aria/<name>` for accessibility-tree matches, `text/<value>` for text matches, otherwise a plain CSS selector — see Chrome DevTools' "Selector" tab. */
function chromeSelector(locator: LocatorType): string {
  switch (locator.kind) {
    case "role":
      return locator.name
        ? `aria/${locator.name}[role="${locator.value}"]`
        : `aria/${locator.value}`;
    case "label":
      return `aria/${locator.value}`;
    case "testId":
      return `[data-testid="${locator.value}"]`;
    case "placeholder":
      return `[placeholder="${locator.value}"]`;
    case "text":
      return `text/${locator.value}`;
    case "css":
    default:
      return locator.value;
  }
}

/** Chrome DevTools Recorder's import/export JSON shape — pasteable straight into the Recorder panel. Not a precise replay (no viewport/timeout metadata), just a recognizable translation of this flow's steps. */
function toChromeRecorderJson(flow: Flow, title: string): string {
  const steps = flow.steps.map((step) => {
    const locator = bestLocator(step);
    const selectors = [
      [locator ? chromeSelector(locator) : `/* ${step.elementSignature} */`],
    ];
    if (step.action === "hover") return { type: "hover", selectors };
    if (step.action === "fill" || step.action === "select")
      return { type: "change", selectors, value: `{{${inputRef(step)}}}` };
    return { type: "click", selectors };
  });
  return JSON.stringify({ title, steps }, null, 2);
}

function generateFlowCode(
  framework: CodeFramework,
  flow: Flow,
  title: string,
): string {
  switch (framework) {
    case "playwright":
      return toPlaywrightCode(flow);
    case "cypress":
      return toCypressCode(flow);
    case "chrome":
      return toChromeRecorderJson(flow, title);
    case "default":
    default:
      return "";
  }
}

/** Preconditions are free-text (no action/selector to translate — see Capability.preconditions), so a framework icon here just restates each one as that framework's comment syntax rather than runnable code. */
function preconditionStub(preconditions: string[]): string {
  return preconditions.map((p) => `// precondition: ${p}`).join("\n");
}

const FRAMEWORK_CODE_ICON: Record<
  Exclude<CodeFramework, "default">,
  typeof PlaywrightMark
> = {
  playwright: PlaywrightMark,
  cypress: CypressMark,
  chrome: ChromeMark,
};

/** Shared "click → selector" / Playwright / Cypress / Chrome switcher used by both the Flow and Preconditions sections below. */
function CodeFrameworkToggle({
  value,
  onChange,
}: {
  value: CodeFramework;
  onChange: (framework: CodeFramework) => void;
}) {
  return (
    <div className="flow-cap-code-toggle" role="tablist" aria-label="Code view">
      <button
        type="button"
        role="tab"
        aria-selected={value === "default"}
        className={value === "default" ? "active" : ""}
        onClick={() => onChange("default")}
        title="Selector view"
      >
        Selector
      </button>
      {(
        Object.keys(FRAMEWORK_CODE_ICON) as Exclude<CodeFramework, "default">[]
      ).map((framework) => {
        const Icon = FRAMEWORK_CODE_ICON[framework];
        return (
          <button
            key={framework}
            type="button"
            role="tab"
            aria-selected={value === framework}
            className={value === framework ? "active" : ""}
            onClick={() => onChange(framework)}
            title={FRAMEWORK_CODE_LABEL[framework]}
            aria-label={FRAMEWORK_CODE_LABEL[framework]}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

function CandidatesView({
  capabilities,
  allCapabilities,
  unavailable,
  evidenceFilter,
  onEvidenceFilterChange,
  onOpenWizard,
  selected,
  onSelect,
  actionBusy,
  onVerify,
  onDelete,
  onSetRequired,
  selectMode,
  onToggleSelectMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkDelete,
  onBulkRefresh,
}: {
  capabilities: CapabilityRow[];
  /** Full, unfiltered project capability list — the "Requires" picker below shouldn't shrink along with the search box's query filter. */
  allCapabilities: CapabilityRow[];
  unavailable: boolean;
  evidenceFilter: EvidenceFilter;
  onEvidenceFilterChange: (value: EvidenceFilter) => void;
  onOpenWizard: () => void;
  selected: CapabilityRow | null;
  onSelect: (id: string) => void;
  actionBusy: string | null;
  onVerify: (capability: Capability, flowId?: string) => void;
  onDelete: (capability: Capability) => void;
  onSetRequired: (capability: Capability, ids: string[]) => Promise<void>;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkDelete: () => void;
  onBulkRefresh: () => void;
}) {
  const [flowSide, setFlowSide] = useState<FlowSide>("primary");
  const [flowCodeView, setFlowCodeView] = useState<CodeFramework>("default");
  const [preconditionsCodeView, setPreconditionsCodeView] =
    useState<CodeFramework>("default");
  useEffect(() => {
    setFlowSide("primary");
    setFlowCodeView("default");
    setPreconditionsCodeView("default");
  }, [selected?.id]);
  // Switching API/UI flow tabs changes which steps are on screen, so any
  // native-code view open for the old flow no longer matches — drop back to
  // the plain selector view rather than silently showing stale code.
  useEffect(() => {
    setFlowCodeView("default");
  }, [flowSide]);

  // Editable, ORDER-sensitive draft of "Requires" — reset from the selected
  // capability's own persisted value whenever the selection changes (or a
  // save lands), so switching to a different capability, or closing/
  // reopening the modal, never leaves a stale, unsaved selection showing.
  const [requiredDraft, setRequiredDraft] = useState<string[]>([]);
  useEffect(() => {
    setRequiredDraft(selected?.requiredCapabilityIds ?? []);
  }, [selected?.id, selected?.requiredCapabilityIds]);
  const [requiresModalOpen, setRequiresModalOpen] = useState(false);
  // `?? []` guards a capability object served without this field at all —
  // e.g. a server process still running pre-this-feature compiled code, or
  // any other shape drift — rather than assuming every Capability the
  // client ever sees was parsed through the current zod schema's default.
  const selectedRequiredIds = selected?.requiredCapabilityIds ?? [];
  const requiredDirty =
    selected &&
    (requiredDraft.length !== selectedRequiredIds.length ||
      requiredDraft.some((id, i) => id !== selectedRequiredIds[i]));

  const hasSecondaryFlow = Boolean(selected?.flows?.secondary);
  const activeFlow =
    hasSecondaryFlow && flowSide === "secondary"
      ? selected!.flows!.secondary!
      : selected?.flows?.primary;
  const activeFlowId = hasSecondaryFlow
    ? flowSide === "secondary"
      ? selected!.secondaryFlowId
      : selected!.flowId
    : undefined;
  const flowCode = useMemo(
    () =>
      activeFlow && selected
        ? generateFlowCode(flowCodeView, activeFlow, selected.name)
        : "",
    [activeFlow, flowCodeView, selected],
  );

  const allSelected =
    capabilities.length > 0 && capabilities.every((c) => selectedIds.has(c.id));
  const selectedCount = capabilities.filter((c) =>
    selectedIds.has(c.id),
  ).length;

  return (
    <div className="flow-cap-layout">
      <div className="flow-cap-list-pane">
        <div className="flow-cap-list-head">
          {selectMode && (
            <label className="flow-cap-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                disabled={!capabilities.length}
                aria-label="Select all candidates"
              />
            </label>
          )}
          <h3>
            Discover <span>{capabilities.length}</span>
          </h3>
          <select
            className="flow-cap-evidence-filter"
            value={evidenceFilter}
            onChange={(e) =>
              onEvidenceFilterChange(e.target.value as EvidenceFilter)
            }
            aria-label="Filter by evidence"
          >
            <option value="all">All evidence</option>
            <option value="evidenced">Evidenced only</option>
            <option value="inferred">Inferred only</option>
          </select>
          <button
            className="flow-cap-select-toggle"
            onClick={onToggleSelectMode}
          >
            {selectMode ? <X size={13} /> : <CheckSquare size={13} />}
            {selectMode ? "Cancel" : "Select"}
          </button>
          <button className="flow-cap-mine-button" onClick={onOpenWizard}>
            <Sparkles size={13} />
            Mine
          </button>
        </div>
        {selectMode && selectedCount > 0 && (
          <div className="flow-cap-bulk-toolbar">
            <span>{selectedCount} selected</span>
            <button
              onClick={onBulkRefresh}
              disabled={
                actionBusy === "bulk:refresh" || actionBusy === "bulk:delete"
              }
            >
              {actionBusy === "bulk:refresh" ? (
                <Loader2 size={12} className="flow-cap-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Re-verify
            </button>
            <button
              onClick={onBulkDelete}
              disabled={
                actionBusy === "bulk:refresh" || actionBusy === "bulk:delete"
              }
              className="is-destructive"
            >
              {actionBusy === "bulk:delete" ? (
                <Loader2 size={12} className="flow-cap-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Delete
            </button>
          </div>
        )}
        <div className="flow-cap-list">
          {capabilities.map((capability) => (
            <div
              key={capability.id}
              className={
                selected?.id === capability.id
                  ? "flow-cap-row-wrap selected"
                  : "flow-cap-row-wrap"
              }
            >
              {selectMode && (
                <input
                  type="checkbox"
                  className="flow-cap-row-checkbox"
                  checked={selectedIds.has(capability.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => onToggleSelect(capability.id)}
                  aria-label={`Select ${capability.name}`}
                />
              )}
              <button
                className={
                  selected?.id === capability.id
                    ? "flow-cap-row selected"
                    : "flow-cap-row"
                }
                onClick={() => onSelect(capability.id)}
              >
                <div className="flow-cap-row-main">
                  <strong>{capability.name}</strong>
                  <small>{capability.description}</small>
                </div>
                <div className="flow-cap-row-badges">
                  <RiskBadge risk={capability.risk} />
                  <StatusBadge status={capability.status} />
                  <EvidenceKindBadge capability={capability} />
                </div>
                <div className="flow-cap-chips">
                  {capability.evidenceRunIds.slice(0, 3).map((runId) => (
                    <span className="flow-cap-chip" key={runId} title={runId}>
                      <Link2 size={9} />
                      {runId.slice(0, 8)}
                    </span>
                  ))}
                  {capability.dependencies.slice(0, 3).map((dep) => (
                    <span className="flow-cap-chip" key={dep} title={dep}>
                      <GitBranch size={9} />
                      {dep}
                    </span>
                  ))}
                  {(capability.requiredCapabilityIds?.length ?? 0) > 0 && (
                    <span
                      className="flow-cap-chip"
                      title={`Requires ${capability.requiredCapabilityIds.length} other capabilit${capability.requiredCapabilityIds.length === 1 ? "y" : "ies"} to already be satisfied`}
                    >
                      <CheckSquare size={9} />
                      requires {capability.requiredCapabilityIds.length}
                    </span>
                  )}
                </div>
              </button>
            </div>
          ))}
          {!capabilities.length && !unavailable && (
            <p className="muted">
              No capability candidates yet. Mine this discovery run's graph to
              propose some.
            </p>
          )}
          {!capabilities.length && unavailable && (
            <p className="muted">Capabilities aren't available yet.</p>
          )}
        </div>
      </div>
      <div className="flow-cap-detail-pane">
        {selected ? (
          <>
            <div className="flow-cap-detail-head">
              <span>{selected.name}</span>
              <small>v{selected.version}</small>
            </div>
            <p className="flow-cap-detail-description">
              {selected.description}
            </p>
            <div className="flow-cap-detail-badges">
              <RiskBadge risk={selected.risk} />
              <StatusBadge status={selected.status} />
              <EvidenceKindBadge capability={selected} />
            </div>
            {hasSecondaryFlow && (
              <div className="flow-cap-flow-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={flowSide === "primary"}
                  className={flowSide === "primary" ? "active" : ""}
                  onClick={() => setFlowSide("primary")}
                >
                  {evidenceKindLabel[selected.evidenceKinds[0]]}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={flowSide === "secondary"}
                  className={flowSide === "secondary" ? "active" : ""}
                  onClick={() => setFlowSide("secondary")}
                >
                  {evidenceKindLabel[selected.evidenceKinds[1]]}
                </button>
              </div>
            )}
            {activeFlow && (
              <section>
                <div className="flow-cap-section-head">
                  <h4>Flow</h4>
                  <CodeFrameworkToggle
                    value={flowCodeView}
                    onChange={setFlowCodeView}
                  />
                </div>
                {flowCodeView === "default" ? (
                  <ol className="flow-cap-flow-steps">
                    {activeFlow.steps.map((step, i) => {
                      const locator = bestLocator(step);
                      return (
                        <li key={i}>
                          <code>{step.action}</code>
                          {step.inputField
                            ? ` (${step.inputField}) `
                            : " "}→{" "}
                          {locator ? (
                            <span className="flow-cap-step-ref">
                              <code
                                title={`Element signature: ${step.elementSignature}`}
                              >
                                {selectorLabel(locator)}
                              </code>
                              <CopyButton value={selectorLabel(locator)} />
                            </span>
                          ) : (
                            <code title="No locator evidence captured for this step — raw structural signature shown instead.">
                              {step.elementSignature}
                            </code>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="flow-cap-flow-code-wrap">
                    <pre className="flow-cap-flow-code">
                      <code>{flowCode}</code>
                    </pre>
                    <CopyButton value={flowCode} />
                  </div>
                )}
                <p className="flow-cap-flow-proof">
                  {activeFlow.expectedRequest
                    ? `Proof: ${activeFlow.expectedRequest.method} ${activeFlow.expectedRequest.urlPattern}`
                    : activeFlow.expectedNavigation
                      ? `Proof: navigates to ${activeFlow.expectedNavigation.urlPattern}`
                      : "No proof declared."}
                </p>
              </section>
            )}
            <section>
              <h4>Input schema</h4>
              <pre>{JSON.stringify(selected.inputSchema, null, 2)}</pre>
            </section>
            <section>
              <div className="flow-cap-section-head">
                <h4>Preconditions</h4>
                <div className="flow-cap-section-head-actions">
                  {selected.preconditions.length > 0 && (
                    <CodeFrameworkToggle
                      value={preconditionsCodeView}
                      onChange={setPreconditionsCodeView}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-button flow-cap-requires-edit-button"
                    onClick={() => setRequiresModalOpen(true)}
                    aria-label="Edit required capabilities"
                    title="Edit required capabilities"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              {selected.preconditions.length ? (
                preconditionsCodeView === "default" ? (
                  <ul>
                    {selected.preconditions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <pre className="flow-cap-flow-code">
                    <code>{preconditionStub(selected.preconditions)}</code>
                  </pre>
                )
              ) : selectedRequiredIds.length === 0 ? (
                <p className="muted">None declared.</p>
              ) : null}
              {selectedRequiredIds.length > 0 && (
                <>
                  <p className="muted flow-cap-requires-hint">
                    Also requires these capabilities to already be satisfied, in
                    order — attempted automatically if this one's first step
                    can't resolve.
                  </p>
                  <ol className="flow-cap-requires-ordered-list flow-cap-requires-ordered-list-readonly">
                    {selectedRequiredIds.map((id, i) => {
                      const c = allCapabilities.find((cap) => cap.id === id);
                      return (
                        <li key={id}>
                          <span className="flow-cap-requires-order">
                            {i + 1}
                          </span>
                          <span className="flow-cap-requires-name">
                            {c ? c.name : id}
                            {c && <StatusBadge status={c.status} />}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </section>
            <section>
              <h4>Expected outcomes</h4>
              {selected.expectedOutcomes.length ? (
                <ul>
                  {selected.expectedOutcomes.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None declared.</p>
              )}
            </section>
            <section>
              <h4>Required permissions</h4>
              {selected.requiredPermissions.length ? (
                <div className="flow-cap-chips">
                  {selected.requiredPermissions.map((p) => (
                    <span className="flow-cap-chip" key={p}>
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">None declared.</p>
              )}
            </section>
            <div className="flow-cap-detail-actions">
              <button
                className="flow-cap-verify-button"
                onClick={() => onVerify(selected, activeFlowId)}
                disabled={selected.status === "testing"}
              >
                <FlaskConical size={14} />
                {selected.status === "testing" ? "Verifying…" : "Verify"}
              </button>
              <button
                className="flow-cap-delete-button"
                onClick={() => onDelete(selected)}
                disabled={actionBusy === `delete:${selected.id}`}
              >
                {actionBusy === `delete:${selected.id}` ? (
                  <Loader2 size={14} className="flow-cap-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
            </div>
          </>
        ) : (
          <div className="flow-cap-empty">
            <Wrench size={20} />
            <strong>Select a candidate</strong>
            <span>
              Choose a capability from the list to inspect its contract and run
              verification.
            </span>
          </div>
        )}
      </div>
      {requiresModalOpen &&
        selected &&
        createPortal(
          <RequiresEditorModal
            capability={selected}
            allCapabilities={allCapabilities}
            draft={requiredDraft}
            onChangeDraft={setRequiredDraft}
            onClose={() => {
              setRequiresModalOpen(false);
              setRequiredDraft(selected.requiredCapabilityIds ?? []);
            }}
            onSave={() =>
              onSetRequired(selected, requiredDraft).then(() =>
                setRequiresModalOpen(false),
              )
            }
            saving={actionBusy === `required:${selected.id}`}
            dirty={Boolean(requiredDirty)}
          />,
          document.body,
        )}
    </div>
  );
}

function RequiresEditorModal({
  capability,
  allCapabilities,
  draft,
  onChangeDraft,
  onClose,
  onSave,
  saving,
  dirty,
}: {
  capability: CapabilityRow;
  allCapabilities: CapabilityRow[];
  draft: string[];
  onChangeDraft: (ids: string[]) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const byId = new Map(allCapabilities.map((c) => [c.id, c]));
  const available = allCapabilities.filter(
    (c) => c.id !== capability.id && !draft.includes(c.id),
  );

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    onChangeDraft(next);
  };

  return (
    <div
      className="flow-cap-requires-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="flow-cap-requires-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Required capabilities for ${capability.name}`}
      >
        <div className="flow-cap-requires-modal-head">
          <h3>Requires</h3>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="muted flow-cap-requires-hint">
          Other capabilities that should already be satisfied before{" "}
          <strong>{capability.name}</strong> runs. Attempted automatically, in
          this order, if its first step can't resolve.
        </p>

        <div className="flow-cap-requires-modal-section">
          <h5>Required, in order</h5>
          {draft.length === 0 ? (
            <p className="muted">No preconditions yet — add one below.</p>
          ) : (
            <ol className="flow-cap-requires-ordered-list">
              {draft.map((id, i) => {
                const c = byId.get(id);
                return (
                  <li key={id}>
                    <span className="flow-cap-requires-order">{i + 1}</span>
                    <span className="flow-cap-requires-name">
                      {c ? c.name : id}
                      {c && <StatusBadge status={c.status} />}
                    </span>
                    <span className="flow-cap-requires-row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => move(i, -1)}
                        disabled={saving || i === 0}
                        aria-label="Move up"
                        title="Move up"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => move(i, 1)}
                        disabled={saving || i === draft.length - 1}
                        aria-label="Move down"
                        title="Move down"
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() =>
                          onChangeDraft(draft.filter((x) => x !== id))
                        }
                        disabled={saving}
                        aria-label="Remove"
                        title="Remove"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flow-cap-requires-modal-section">
          <h5>Add a capability</h5>
          {available.length === 0 ? (
            <p className="muted">
              {allCapabilities.length <= 1
                ? "No other capabilities in this project yet."
                : "All other capabilities are already required."}
            </p>
          ) : (
            <ul className="flow-cap-requires-add-list">
              {available.map((c) => (
                <li key={c.id}>
                  <span className="flow-cap-requires-name">
                    {c.name}
                    <StatusBadge status={c.status} />
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onChangeDraft([...draft, c.id])}
                    disabled={saving}
                    aria-label={`Add ${c.name}`}
                    title="Add"
                  >
                    <Plus size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flow-cap-requires-modal-actions">
          <button
            type="button"
            className="flow-cap-requires-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flow-cap-requires-save"
            onClick={onSave}
            disabled={saving || !dirty}
          >
            {saving ? (
              <Loader2 size={13} className="flow-cap-spin" />
            ) : (
              <Save size={13} />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RunsView({
  capabilities,
  selectedCapabilityId,
  onSelectCapability,
  runs,
  unavailable,
}: {
  capabilities: Capability[];
  selectedCapabilityId: string | null;
  onSelectCapability: (id: string) => void;
  runs: VerificationRun[];
  unavailable: boolean;
}) {
  const capability = capabilities.find((c) => c.id === selectedCapabilityId);
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runs],
  );
  return (
    <div className="flow-cap-runs">
      <label className="flow-cap-picker">
        Capability
        <select
          value={selectedCapabilityId || ""}
          onChange={(e) => onSelectCapability(e.target.value)}
        >
          <option value="">Choose a capability</option>
          {capabilities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {!selectedCapabilityId && (
        <div className="flow-cap-empty">
          <History size={20} />
          <strong>No capability selected</strong>
          <span>
            Pick a capability above, or select one from Discover first.
          </span>
        </div>
      )}
      {selectedCapabilityId && !sorted.length && (
        <p className="muted">
          {unavailable
            ? "Capabilities aren't available yet."
            : `No verification runs recorded yet for ${capability?.name || "this capability"}.`}
        </p>
      )}
      {sorted.length > 0 && (
        <ol className="flow-cap-run-list">
          {sorted.map((run) => (
            <li key={run.id} className="flow-cap-run-row">
              <span className={`flow-cap-pill ${runStatusTone[run.status]}`}>
                {run.status}
              </span>
              <div className="flow-cap-run-main">
                <strong>
                  {run.passCount} pass{run.passCount === 1 ? "" : "es"}
                </strong>
                <small>
                  {new Date(run.startedAt).toLocaleString()}
                  {run.finishedAt
                    ? ` → ${new Date(run.finishedAt).toLocaleTimeString()}`
                    : " · in progress"}
                </small>
              </div>
              <div className="flow-cap-chips">
                {run.failureCategories.map((category) => (
                  <span className="flow-cap-chip is-bad" key={category}>
                    {category}
                  </span>
                ))}
                {!run.failureCategories.length && (
                  <span className="flow-cap-chip is-good">no failures</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RegistryView({
  capabilities,
  approvedIds,
  publishedIds,
  actionBusy,
  selectMode,
  onToggleSelectMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onApprove,
  onPublish,
  onDisable,
  onDelete,
  onBulkDelete,
  onBulkRefresh,
}: {
  capabilities: Capability[];
  approvedIds: Set<string>;
  publishedIds: Set<string>;
  actionBusy: string | null;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onApprove: (capability: Capability) => void;
  onPublish: (capability: Capability) => void;
  onDisable: (capability: Capability) => void;
  onDelete: (capability: Capability) => void;
  onBulkDelete: () => void;
  onBulkRefresh: () => void;
}) {
  const allSelected =
    capabilities.length > 0 && capabilities.every((c) => selectedIds.has(c.id));
  const selectedCount = capabilities.filter((c) =>
    selectedIds.has(c.id),
  ).length;
  return (
    <div className="flow-cap-registry">
      <div className="flow-cap-registry-head">
        <button className="flow-cap-select-toggle" onClick={onToggleSelectMode}>
          {selectMode ? <X size={13} /> : <CheckSquare size={13} />}
          {selectMode ? "Cancel" : "Select"}
        </button>
      </div>
      {selectMode && selectedCount > 0 && (
        <div className="flow-cap-registry-toolbar">
          <span>{selectedCount} selected</span>
          <button
            onClick={onBulkRefresh}
            disabled={
              actionBusy === "bulk:refresh" || actionBusy === "bulk:delete"
            }
          >
            {actionBusy === "bulk:refresh" ? (
              <Loader2 size={13} className="flow-cap-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Re-verify selected
          </button>
          <button
            onClick={onBulkDelete}
            disabled={
              actionBusy === "bulk:refresh" || actionBusy === "bulk:delete"
            }
            className="is-destructive"
          >
            {actionBusy === "bulk:delete" ? (
              <Loader2 size={13} className="flow-cap-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            Delete selected
          </button>
        </div>
      )}
      {capabilities.length ? (
        <table className="flow-cap-registry-table">
          <thead>
            <tr>
              {selectMode && (
                <th className="flow-cap-checkbox-cell">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                    aria-label="Select all capabilities"
                  />
                </th>
              )}
              <th>Capability</th>
              <th>Version</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Evidence</th>
              <th>Registry state</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {capabilities.map((capability) => {
              const disabled = capability.status === "disabled";
              const approved = approvedIds.has(capability.id);
              const published = publishedIds.has(capability.id);
              const busy = actionBusy?.endsWith(`:${capability.id}`);
              return (
                <tr
                  key={capability.id}
                  className={
                    selectedIds.has(capability.id) ? "is-selected" : ""
                  }
                >
                  {selectMode && (
                    <td className="flow-cap-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(capability.id)}
                        onChange={() => onToggleSelect(capability.id)}
                        aria-label={`Select ${capability.name}`}
                      />
                    </td>
                  )}
                  <td>
                    <strong>{capability.name}</strong>
                    <small>{capability.description}</small>
                  </td>
                  <td>{capability.version}</td>
                  <td>
                    <StatusBadge status={capability.status} />
                  </td>
                  <td>
                    <RiskBadge risk={capability.risk} />
                  </td>
                  <td>
                    <EvidenceKindBadge capability={capability} />
                  </td>
                  <td>
                    <span
                      className={`flow-cap-pill ${
                        disabled
                          ? "is-bad"
                          : published
                            ? "is-good"
                            : approved
                              ? "is-warn"
                              : ""
                      }`}
                    >
                      {disabled
                        ? "disabled"
                        : published
                          ? "published"
                          : approved
                            ? "approved"
                            : "unapproved"}
                    </span>
                  </td>
                  <td className="flow-cap-registry-actions">
                    <button
                      onClick={() => onApprove(capability)}
                      disabled={
                        disabled ||
                        approved ||
                        actionBusy === `approve:${capability.id}`
                      }
                      title="Approve"
                    >
                      <CheckCircle2 size={13} />
                    </button>
                    <button
                      onClick={() => onPublish(capability)}
                      disabled={
                        disabled ||
                        !approved ||
                        published ||
                        actionBusy === `publish:${capability.id}`
                      }
                      title="Publish"
                    >
                      <UploadCloud size={13} />
                    </button>
                    <button
                      onClick={() => onDisable(capability)}
                      disabled={
                        disabled || actionBusy === `disable:${capability.id}`
                      }
                      title="Disable"
                      className="is-destructive"
                    >
                      <Ban size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(capability)}
                      disabled={actionBusy === `delete:${capability.id}`}
                      title="Delete"
                      className="is-destructive"
                    >
                      <Trash2 size={13} />
                    </button>
                    {busy && <RefreshCw size={12} className="flow-cap-spin" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="flow-cap-empty">
          <ClipboardList size={20} />
          <strong>Nothing in the registry yet</strong>
          <span>
            Verified capabilities appear here once a candidate passes
            verification.
          </span>
        </div>
      )}
    </div>
  );
}
