import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import {
  Workflow,
  Plus,
  Play,
  Pencil,
  Trash2,
  X,
  ArrowLeft,
  Save,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Circle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Navigation,
  MousePointerClick,
  TextCursorInput,
  Hourglass,
  CheckSquare,
  Globe,
} from "lucide-react";
import type {
  AutomationWorkflow,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowRun,
} from "../../../packages/shared/src/index";
import "./flow-automation-workflow-views.css";

// Workflow tab of the Automation page (apps/dashboard/src/flow-automation-views.tsx).
// Server contract (apps/server/src/automation-workflows.ts, wired onto
// apps/server/src/index.ts):
//   GET    /api/projects/:id/automation/workflows                -> AutomationWorkflow[]
//   POST   /api/projects/:id/automation/workflows                { name, description?, steps, outcome } -> AutomationWorkflow
//   GET    /api/projects/:id/automation/workflows/:workflowId    -> AutomationWorkflow
//   PUT    /api/projects/:id/automation/workflows/:workflowId    Partial<AutomationWorkflow> -> AutomationWorkflow
//   DELETE /api/projects/:id/automation/workflows/:workflowId
//   POST   /api/projects/:id/automation/workflows/:workflowId/run        -> WorkflowRun
//   GET    /api/projects/:id/automation/workflows/:workflowId/runs/:runId -> WorkflowRun
// Types: AutomationWorkflow, WorkflowStep, WorkflowRun in packages/shared/src/index.ts.

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

// ---- Step helpers -----------------------------------------------------

const STEP_TYPE_OPTIONS: { value: WorkflowStep["type"]; label: string }[] = [
  { value: "navigate", label: "Navigate" },
  { value: "click", label: "Click" },
  { value: "fill", label: "Fill" },
  { value: "waitFor", label: "Wait for" },
  { value: "assertText", label: "Assert text" },
  { value: "apiCall", label: "API call" },
];
const STEP_LABELS: Record<WorkflowStep["type"], string> = {
  navigate: "Navigate",
  click: "Click",
  fill: "Fill",
  waitFor: "Wait for",
  assertText: "Assert text",
  apiCall: "API call",
};
const STEP_ICONS: Record<WorkflowStep["type"], typeof Navigation> = {
  navigate: Navigation,
  click: MousePointerClick,
  fill: TextCursorInput,
  waitFor: Hourglass,
  assertText: CheckSquare,
  apiCall: Globe,
};

function defaultStepForType(type: WorkflowStep["type"]): WorkflowStep {
  switch (type) {
    case "navigate":
      return { type, url: "" };
    case "click":
      return { type, selector: "" };
    case "fill":
      return { type, selector: "", value: "" };
    case "waitFor":
      return { type, ms: 1000 };
    case "assertText":
      return { type, selector: "", expected: "" };
    case "apiCall":
      return { type, method: "GET", url: "" };
  }
}

function stepSummary(step: WorkflowStep): string {
  switch (step.type) {
    case "navigate":
      return step.url ? `to ${step.url}` : "(no URL set)";
    case "click":
      return step.selector ? step.selector : "(no selector)";
    case "fill":
      return step.selector
        ? `${step.selector} = "${step.value}"`
        : "(no selector)";
    case "waitFor":
      return step.selector
        ? `for ${step.selector}`
        : step.ms
          ? `${step.ms}ms`
          : "(unset)";
    case "assertText":
      return step.selector
        ? `${step.selector} == "${step.expected}"`
        : "(no selector)";
    case "apiCall":
      return step.url ? `${step.method} ${step.url}` : "(no URL set)";
  }
}

// ---- Draft (builder) state ---------------------------------------------

type Draft = {
  id?: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  outcomeDescription: string;
  assertion?: WorkflowStep;
};

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    steps: [defaultStepForType("navigate")],
    outcomeDescription: "",
    assertion: undefined,
  };
}

function draftFromWorkflow(workflow: AutomationWorkflow): Draft {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || "",
    steps: workflow.steps.length
      ? workflow.steps
      : [defaultStepForType("navigate")],
    outcomeDescription: workflow.outcome.description,
    assertion: workflow.outcome.assertion,
  };
}

// ---- Canvas nodes (ReactFlow) -------------------------------------------
// Two node types share one canvas: "step" renders an existing step (click to
// select — the selected step's full editor opens as a floating inspector
// docked to the canvas, so configuring a step's logic happens right where
// it sits on the canvas rather than in a disconnected part of the page) and
// "add" is a standing "add step" affordance chained after the last step, so
// a step can be appended directly from the canvas without reaching for the
// steps list.

type StepNodeData = { step: WorkflowStep; index: number; selected: boolean };

const StepNode = memo(function StepNode({ data }: NodeProps<StepNodeData>) {
  const Icon = STEP_ICONS[data.step.type];
  return (
    <div className={`faw-step-node${data.selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <span className="faw-step-node-index">{data.index + 1}</span>
      <Icon size={13} />
      <div className="faw-step-node-body">
        <strong>{STEP_LABELS[data.step.type]}</strong>
        <small>{stepSummary(data.step)}</small>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

type AddNodeData = { onAdd: () => void };

const AddStepNode = memo(function AddStepNode({
  data,
}: NodeProps<AddNodeData>) {
  return (
    <div className="faw-add-step-node-wrap">
      <Handle type="target" position={Position.Top} />
      <button type="button" className="faw-add-step-node" onClick={data.onAdd}>
        <Plus size={15} />
        Add step
      </button>
    </div>
  );
});

const stepNodeTypes = { step: StepNode, add: AddStepNode };

// ---- Main component -----------------------------------------------------

export function AutomationWorkflowViews({
  projectId,
}: {
  projectId: string;
}) {
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"list" | "builder">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const [activeRunWorkflow, setActiveRunWorkflow] =
    useState<AutomationWorkflow | null>(null);

  const basePath = `/projects/${projectId}/automation/workflows`;

  const load = useCallback(() => {
    setLoading(true);
    apiRequest<AutomationWorkflow[]>(basePath)
      .then((list) => {
        setWorkflows(list);
        setUnavailable(false);
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, [basePath]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll the active run every ~1.5s until it reaches a terminal status.
  useEffect(() => {
    if (!activeRun) return;
    if (
      activeRun.status === "passed" ||
      activeRun.status === "failed" ||
      activeRun.status === "error"
    )
      return;
    const timer = setTimeout(() => {
      apiRequest<WorkflowRun>(
        `${basePath}/${activeRun.workflowId}/runs/${activeRun.id}`,
      )
        .then(setActiveRun)
        .catch((e) => setNotice((e as Error).message));
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeRun, basePath]);

  const openNew = () => {
    setDraft(emptyDraft());
    setSelectedStep(0);
    setMode("builder");
  };
  const openEdit = (workflow: AutomationWorkflow) => {
    setDraft(draftFromWorkflow(workflow));
    setSelectedStep(workflow.steps.length ? 0 : null);
    setMode("builder");
  };
  const cancelBuilder = () => {
    setMode("list");
    setSelectedStep(null);
  };

  const saveDraft = async () => {
    if (!draft.name.trim()) {
      setNotice("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        steps: draft.steps,
        outcome: {
          description: draft.outcomeDescription.trim(),
          assertion: draft.assertion,
        },
      };
      const saved = draft.id
        ? await apiRequest<AutomationWorkflow>(
            `${basePath}/${draft.id}`,
            payload,
            "PUT",
          )
        : await apiRequest<AutomationWorkflow>(basePath, payload, "POST");
      setWorkflows((prev) => {
        const exists = prev.some((w) => w.id === saved.id);
        return exists
          ? prev.map((w) => (w.id === saved.id ? saved : w))
          : [saved, ...prev];
      });
      setNotice(`"${saved.name}" saved.`);
      setMode("list");
      setSelectedStep(null);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkflow = async (workflow: AutomationWorkflow) => {
    if (
      !window.confirm(
        `Delete workflow "${workflow.name}"? This cannot be undone.`,
      )
    )
      return;
    setActionBusy(`delete:${workflow.id}`);
    try {
      await apiRequest(`${basePath}/${workflow.id}`, {}, "DELETE");
      setWorkflows((prev) => prev.filter((w) => w.id !== workflow.id));
      setNotice(`"${workflow.name}" deleted.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const runWorkflow = async (workflow: AutomationWorkflow) => {
    setActionBusy(`run:${workflow.id}`);
    try {
      const run = await apiRequest<WorkflowRun>(
        `${basePath}/${workflow.id}/run`,
        {},
      );
      setActiveRunWorkflow(workflow);
      setActiveRun(run);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const updateStepAt = (index: number, step: WorkflowStep) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? step : s)),
    }));
  };
  const addStep = useCallback(() => {
    setDraft((prev) => {
      setSelectedStep(prev.steps.length);
      return { ...prev, steps: [...prev.steps, defaultStepForType("navigate")] };
    });
  }, []);
  const deleteStepAt = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
    setSelectedStep(null);
  };
  const moveStep = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    setDraft((prev) => {
      if (target < 0 || target >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...prev, steps };
    });
    setSelectedStep(target);
  };
  const toggleAssertion = (enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      assertion: enabled
        ? prev.assertion ?? defaultStepForType("assertText")
        : undefined,
    }));
  };

  return (
    <div className="faw-root">
      {notice && (
        <div className="faw-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {mode === "list" ? (
        <WorkflowListView
          workflows={workflows}
          loading={loading}
          unavailable={unavailable}
          actionBusy={actionBusy}
          onNew={openNew}
          onEdit={openEdit}
          onDelete={deleteWorkflow}
          onRun={runWorkflow}
        />
      ) : (
        <WorkflowBuilder
          draft={draft}
          setDraft={setDraft}
          selectedStep={selectedStep}
          onSelectStep={setSelectedStep}
          saving={saving}
          onCancel={cancelBuilder}
          onSave={saveDraft}
          onAddStep={addStep}
          onUpdateStep={updateStepAt}
          onDeleteStep={deleteStepAt}
          onMoveStep={moveStep}
          onToggleAssertion={toggleAssertion}
        />
      )}
      {activeRun &&
        createPortal(
          <RunPanel
            run={activeRun}
            workflow={activeRunWorkflow}
            onClose={() => {
              setActiveRun(null);
              setActiveRunWorkflow(null);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

// ---- List view -----------------------------------------------------------

function WorkflowListView({
  workflows,
  loading,
  unavailable,
  actionBusy,
  onNew,
  onEdit,
  onDelete,
  onRun,
}: {
  workflows: AutomationWorkflow[];
  loading: boolean;
  unavailable: boolean;
  actionBusy: string | null;
  onNew: () => void;
  onEdit: (workflow: AutomationWorkflow) => void;
  onDelete: (workflow: AutomationWorkflow) => void;
  onRun: (workflow: AutomationWorkflow) => void;
}) {
  return (
    <div className="faw-list-view">
      <div className="faw-list-header">
        <h2>
          Workflows <span>{workflows.length}</span>
        </h2>
        <button type="button" className="faw-new-button" onClick={onNew}>
          <Plus size={14} /> New workflow
        </button>
      </div>
      {loading ? (
        <p className="faw-muted">Loading workflows…</p>
      ) : !workflows.length ? (
        <div className="faw-empty">
          <Workflow size={22} />
          <strong>No workflows yet</strong>
          <span>
            {unavailable
              ? "Workflows aren't available yet."
              : "Create a workflow to replay a sequence of steps against this project and check the outcome."}
          </span>
          <button type="button" className="faw-new-button" onClick={onNew}>
            <Plus size={14} /> New workflow
          </button>
        </div>
      ) : (
        <div className="faw-card-grid">
          {workflows.map((workflow) => (
            <div className="faw-card" key={workflow.id}>
              <div className="faw-card-head">
                <strong>{workflow.name}</strong>
                <span className="faw-card-steps">
                  {workflow.steps.length} step
                  {workflow.steps.length === 1 ? "" : "s"}
                </span>
              </div>
              {workflow.description && (
                <p className="faw-card-description">{workflow.description}</p>
              )}
              <p className="faw-card-outcome">
                {workflow.outcome.description || "No outcome described."}
              </p>
              <div className="faw-card-actions">
                <button
                  type="button"
                  onClick={() => onRun(workflow)}
                  disabled={actionBusy === `run:${workflow.id}`}
                >
                  {actionBusy === `run:${workflow.id}` ? (
                    <Loader2 size={13} className="faw-spin" />
                  ) : (
                    <Play size={13} />
                  )}
                  Run
                </button>
                <button type="button" onClick={() => onEdit(workflow)}>
                  <Pencil size={13} /> Edit
                </button>
                <button
                  type="button"
                  className="is-destructive"
                  onClick={() => onDelete(workflow)}
                  disabled={actionBusy === `delete:${workflow.id}`}
                >
                  {actionBusy === `delete:${workflow.id}` ? (
                    <Loader2 size={13} className="faw-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Builder ---------------------------------------------------------
//
// Steps/canvas are the primary surface here — name, description, and the
// outcome are secondary and tucked behind the "Details" disclosure so the
// title bar stays a single compact line. The workflow can be laid out two
// interchangeable ways, both editing the same `draft.steps` array: the
// collapsible list on the left (fast add/reorder/delete), or the canvas on
// the right (click a step to open its logic inline via a floating
// inspector docked to the canvas, or use the chained "Add step" node).

function WorkflowBuilder({
  draft,
  setDraft,
  selectedStep,
  onSelectStep,
  saving,
  onCancel,
  onSave,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onMoveStep,
  onToggleAssertion,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  selectedStep: number | null;
  onSelectStep: (index: number | null) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onAddStep: () => void;
  onUpdateStep: (index: number, step: WorkflowStep) => void;
  onDeleteStep: (index: number) => void;
  onMoveStep: (index: number, dir: -1 | 1) => void;
  onToggleAssertion: (enabled: boolean) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [stepsListOpen, setStepsListOpen] = useState(true);

  const flowNodes = useMemo<Node[]>(
    () => [
      ...draft.steps.map((step, index) => ({
        id: `step-${index}`,
        type: "step",
        position: { x: 0, y: index * 118 },
        data: { step, index, selected: selectedStep === index },
        draggable: false,
      })),
      {
        id: "add-step",
        type: "add",
        position: { x: 0, y: draft.steps.length * 118 },
        data: { onAdd: onAddStep },
        draggable: false,
        selectable: false,
      },
    ],
    [draft.steps, selectedStep, onAddStep],
  );
  const flowEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = draft.steps.slice(1).map((_, i) => ({
      id: `e-${i}-${i + 1}`,
      source: `step-${i}`,
      target: `step-${i + 1}`,
      type: "smoothstep",
    }));
    if (draft.steps.length)
      edges.push({
        id: "e-add",
        source: `step-${draft.steps.length - 1}`,
        target: "add-step",
        type: "smoothstep",
      });
    return edges;
  }, [draft.steps.length]);

  return (
    <div className="faw-builder">
      <div className="faw-builder-header">
        <button type="button" className="faw-back-button" onClick={onCancel}>
          <ArrowLeft size={14} /> Back
        </button>
        <input
          className="faw-builder-title-input"
          value={draft.name}
          maxLength={120}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder="Untitled workflow"
          aria-label="Workflow name"
        />
        <button
          type="button"
          className={`faw-details-toggle${detailsOpen ? " is-open" : ""}`}
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Details
        </button>
        <button
          type="button"
          className="faw-save-button"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={13} className="faw-spin" />
          ) : (
            <Save size={13} />
          )}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {detailsOpen && (
        <section className="faw-details-panel">
          <label>
            Description
            <textarea
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="What does this workflow cover?"
            />
          </label>
          <label>
            Outcome — what does success look like?
            <textarea
              value={draft.outcomeDescription}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  outcomeDescription: e.target.value,
                }))
              }
              placeholder="e.g. Order confirmation page shows the new order number"
            />
          </label>
          <label className="faw-assertion-toggle">
            <input
              type="checkbox"
              checked={Boolean(draft.assertion)}
              onChange={(e) => onToggleAssertion(e.target.checked)}
            />
            Add an assertion step
          </label>
          {draft.assertion && (
            <StepEditorForm
              step={draft.assertion}
              onChange={(step) =>
                setDraft((prev) => ({ ...prev, assertion: step }))
              }
            />
          )}
        </section>
      )}
      <div className="faw-workspace">
        <StepsListPanel
          steps={draft.steps}
          selectedStep={selectedStep}
          open={stepsListOpen}
          onToggleOpen={() => setStepsListOpen((v) => !v)}
          onSelectStep={onSelectStep}
          onMoveStep={onMoveStep}
          onDeleteStep={onDeleteStep}
          onAddStep={onAddStep}
        />
        <div className="faw-canvas-panel">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={stepNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
            minZoom={0.3}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
            panOnScroll
            onNodeClick={(_, node) => {
              if (node.id === "add-step") return;
              onSelectStep(Number(node.id.slice("step-".length)));
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {selectedStep !== null && draft.steps[selectedStep] && (
            <div className="faw-canvas-inspector">
              <div className="faw-step-editor-head">
                <strong>Step {selectedStep + 1}</strong>
                <div className="faw-step-editor-actions">
                  <button
                    type="button"
                    title="Move up"
                    disabled={selectedStep === 0}
                    onClick={() => onMoveStep(selectedStep, -1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={selectedStep === draft.steps.length - 1}
                    onClick={() => onMoveStep(selectedStep, 1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="is-destructive"
                    title="Delete step"
                    onClick={() => onDeleteStep(selectedStep)}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    type="button"
                    title="Close"
                    onClick={() => onSelectStep(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <StepEditorForm
                step={draft.steps[selectedStep]}
                onChange={(step) => onUpdateStep(selectedStep, step)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Steps list panel (collapsible) --------------------------------------

function StepsListPanel({
  steps,
  selectedStep,
  open,
  onToggleOpen,
  onSelectStep,
  onMoveStep,
  onDeleteStep,
  onAddStep,
}: {
  steps: WorkflowStep[];
  selectedStep: number | null;
  open: boolean;
  onToggleOpen: () => void;
  onSelectStep: (index: number) => void;
  onMoveStep: (index: number, dir: -1 | 1) => void;
  onDeleteStep: (index: number) => void;
  onAddStep: () => void;
}) {
  return (
    <div className={`faw-steps-list-panel${open ? "" : " is-collapsed"}`}>
      <div className="faw-steps-list-head">
        <button
          type="button"
          className="faw-steps-list-toggle"
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-label={open ? "Collapse steps list" : "Expand steps list"}
          title={open ? "Collapse steps list" : "Steps"}
        >
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          {open && (
            <span>
              Steps <small>{steps.length}</small>
            </span>
          )}
        </button>
        {open && (
          <button
            type="button"
            className="faw-steps-list-add"
            title="Add step"
            aria-label="Add step"
            onClick={onAddStep}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {open && (
        <ol className="faw-steps-list">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[step.type];
            return (
              <li
                key={index}
                className={index === selectedStep ? "is-selected" : ""}
              >
                <button
                  type="button"
                  className="faw-steps-list-row"
                  onClick={() => onSelectStep(index)}
                >
                  <Icon size={13} />
                  <span className="faw-steps-list-row-body">
                    <strong>{STEP_LABELS[step.type]}</strong>
                    <small>{stepSummary(step)}</small>
                  </span>
                </button>
                <div className="faw-steps-list-row-actions">
                  <button
                    type="button"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => onMoveStep(index, -1)}
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={index === steps.length - 1}
                    onClick={() => onMoveStep(index, 1)}
                  >
                    <ChevronDown size={11} />
                  </button>
                  <button
                    type="button"
                    className="is-destructive"
                    title="Delete"
                    onClick={() => onDeleteStep(index)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </li>
            );
          })}
          {!steps.length && (
            <li className="faw-steps-list-empty">No steps yet.</li>
          )}
        </ol>
      )}
    </div>
  );
}

// ---- Step editor form ----------------------------------------------------

function StepEditorForm({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
}) {
  const patch = (partial: Record<string, unknown>) => {
    onChange({ ...step, ...partial } as WorkflowStep);
  };
  const handleTypeChange = (type: WorkflowStep["type"]) => {
    const next = defaultStepForType(type);
    onChange(
      step.description ? { ...next, description: step.description } : next,
    );
  };
  return (
    <div className="faw-step-form">
      <label>
        Type
        <select
          value={step.type}
          onChange={(e) =>
            handleTypeChange(e.target.value as WorkflowStep["type"])
          }
        >
          {STEP_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {(step.type === "navigate" || step.type === "apiCall") && (
        <label>
          URL
          <input
            value={step.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://…"
          />
        </label>
      )}
      {(step.type === "click" ||
        step.type === "fill" ||
        step.type === "waitFor" ||
        step.type === "assertText") && (
        <label>
          Selector{step.type === "waitFor" ? " (optional)" : ""}
          <input
            value={step.selector || ""}
            onChange={(e) => patch({ selector: e.target.value })}
            placeholder="CSS selector"
          />
        </label>
      )}
      {step.type === "fill" && (
        <label>
          Value
          <input
            value={step.value}
            onChange={(e) => patch({ value: e.target.value })}
          />
        </label>
      )}
      {step.type === "waitFor" && (
        <label>
          Milliseconds (optional)
          <input
            type="number"
            min={0}
            max={60000}
            value={step.ms ?? ""}
            onChange={(e) =>
              patch({ ms: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </label>
      )}
      {step.type === "assertText" && (
        <label>
          Expected text
          <input
            value={step.expected}
            onChange={(e) => patch({ expected: e.target.value })}
          />
        </label>
      )}
      {step.type === "apiCall" && (
        <>
          <label>
            Method
            <select
              value={step.method}
              onChange={(e) => patch({ method: e.target.value })}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected status (optional)
            <input
              type="number"
              value={step.expectedStatus ?? ""}
              onChange={(e) =>
                patch({
                  expectedStatus: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
          </label>
        </>
      )}
      <label>
        Description (optional)
        <textarea
          value={step.description || ""}
          onChange={(e) => patch({ description: e.target.value || undefined })}
          placeholder="Notes for this step"
        />
      </label>
    </div>
  );
}

// ---- Run panel -------------------------------------------------------

const STEP_STATUS_ICON: Record<WorkflowStepResult["status"], typeof Circle> = {
  pending: Circle,
  running: Loader2,
  passed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
};
const STEP_STATUS_TONE: Record<WorkflowStepResult["status"], string> = {
  pending: "",
  running: "is-active",
  passed: "is-good",
  failed: "is-bad",
  skipped: "",
};
const RUN_STATUS_LABEL: Record<WorkflowRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  error: "Error",
};
const RUN_STATUS_TONE: Record<WorkflowRun["status"], string> = {
  queued: "",
  running: "is-active",
  passed: "is-good",
  failed: "is-bad",
  error: "is-bad",
};

function RunPanel({
  run,
  workflow,
  onClose,
}: {
  run: WorkflowRun;
  workflow: AutomationWorkflow | null;
  onClose: () => void;
}) {
  const finished =
    run.status === "passed" || run.status === "failed" || run.status === "error";
  return (
    <div className="faw-run-overlay" role="dialog" aria-modal="true">
      <div className="faw-run-panel">
        <div className="faw-run-head">
          <div className="faw-run-head-title">
            <strong>{workflow?.name || "Workflow run"}</strong>
            <span className={`faw-pill ${RUN_STATUS_TONE[run.status]}`}>
              {run.status === "running" && (
                <Loader2 size={11} className="faw-spin" />
              )}
              {RUN_STATUS_LABEL[run.status]}
            </span>
          </div>
          <button
            type="button"
            className="faw-run-close"
            onClick={onClose}
            aria-label="Close run panel"
          >
            <X size={15} />
          </button>
        </div>
        {finished && run.outcomeMet !== undefined && (
          <div
            className={`faw-outcome-banner ${
              run.outcomeMet ? "is-good" : "is-bad"
            }`}
          >
            {run.outcomeMet ? (
              <CheckCircle2 size={15} />
            ) : (
              <XCircle size={15} />
            )}
            {run.outcomeMet ? "Outcome met" : "Outcome not met"}
          </div>
        )}
        {run.error && <div className="faw-run-error">{run.error}</div>}
        <ol className="faw-run-steps">
          {run.stepResults.map((result) => {
            const Icon = STEP_STATUS_ICON[result.status];
            const step = workflow?.steps[result.stepIndex];
            return (
              <li
                key={result.stepIndex}
                className={`faw-run-step ${STEP_STATUS_TONE[result.status]}`}
              >
                <div className="faw-run-step-head">
                  <Icon
                    size={14}
                    className={
                      result.status === "running" ? "faw-spin" : undefined
                    }
                  />
                  <strong>
                    Step {result.stepIndex + 1}
                    {step ? ` — ${STEP_LABELS[step.type]}` : ""}
                  </strong>
                  <span className="faw-run-step-status">{result.status}</span>
                </div>
                {step && (
                  <p className="faw-run-step-summary">{stepSummary(step)}</p>
                )}
                {result.error && (
                  <p className="faw-run-step-error">{result.error}</p>
                )}
                {result.evidenceId && (
                  <img
                    className="faw-run-step-evidence"
                    src={`/artifacts/${result.evidenceId}`}
                    alt={`Evidence for step ${result.stepIndex + 1}`}
                  />
                )}
              </li>
            );
          })}
          {!run.stepResults.length && (
            <p className="faw-muted">No step results yet.</p>
          )}
        </ol>
      </div>
    </div>
  );
}
