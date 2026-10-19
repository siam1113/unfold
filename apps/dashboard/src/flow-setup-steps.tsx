import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { WorkflowStep } from "../../../packages/shared/src/index";
import "./flow-setup-steps.css";

// Setup steps run once, sequentially, before any discovery worker starts
// probing (packages/core/src/index.ts's Coordinator.start()) — for sites
// where a storage-state session alone isn't enough to get past the first
// route (a consent banner, a workspace picker, a multi-field login).
// Reuses WorkflowStep (packages/shared/src/index.ts) — the same step
// vocabulary the Automation tab's named workflows already use — but ships
// its own compact list editor rather than reusing that tab's ReactFlow
// canvas (flow-automation-workflow-views.tsx), which is built for a
// dedicated full-page editor, not a form embedded in a wizard step.
const STEP_TYPE_OPTIONS: { value: WorkflowStep["type"]; label: string }[] = [
  { value: "click", label: "Click" },
  { value: "fill", label: "Fill / Type" },
  { value: "waitFor", label: "Wait for" },
  { value: "navigate", label: "Navigate" },
];

function defaultStep(type: WorkflowStep["type"]): WorkflowStep {
  switch (type) {
    case "click":
      return { type, selector: "" };
    case "fill":
      return { type, selector: "", value: "" };
    case "waitFor":
      return { type, text: "" };
    case "navigate":
      return { type, url: "" };
    case "assertText":
      return { type, selector: "", expected: "" };
    case "apiCall":
      return { type, method: "GET", url: "" };
  }
}

function stepLabel(type: WorkflowStep["type"]): string {
  return STEP_TYPE_OPTIONS.find((o) => o.value === type)?.label || type;
}

function stepSummary(step: WorkflowStep): string {
  switch (step.type) {
    case "click":
      return step.selector || "(no selector)";
    case "fill":
      return step.selector
        ? `${step.selector} = "${step.value}"`
        : "(no selector)";
    case "waitFor":
      return step.text
        ? `text "${step.text}"`
        : step.selector
          ? step.selector
          : step.ms
            ? `${step.ms}ms`
            : "(unset)";
    case "navigate":
      return step.url || "(no URL)";
    case "assertText":
      return step.selector
        ? `${step.selector} == "${step.expected}"`
        : "(no selector)";
    case "apiCall":
      return step.url ? `${step.method} ${step.url}` : "(no URL)";
  }
}

export function SetupStepsEditor({
  steps: rawSteps,
  onChange,
}: {
  steps: WorkflowStep[] | undefined;
  onChange: (steps: WorkflowStep[]) => void;
}) {
  // Defensive: a project created before setupSteps existed in ConfigSchema,
  // or a stale cached API response, can hand this undefined.
  const steps = rawSteps ?? [];
  const [expanded, setExpanded] = useState<number | null>(
    steps.length ? null : 0,
  );

  const update = (index: number, step: WorkflowStep) =>
    onChange(steps.map((s, i) => (i === index ? step : s)));
  const remove = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
    setExpanded(null);
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setExpanded(target);
  };
  const add = () => {
    onChange([...steps, defaultStep("click")]);
    setExpanded(steps.length);
  };

  return (
    <div className="setup-steps-editor">
      {!steps.length && (
        <p className="wizard-help">
          No setup steps yet. Add one if this app needs more than a login
          session before discovery can proceed — e.g. dismissing a consent
          banner, picking a workspace, or a multi-field login.
        </p>
      )}
      {steps.map((step, index) => (
        <div className="setup-step-card" key={index}>
          <div className="setup-step-card-head">
            <button
              type="button"
              className="setup-step-card-toggle"
              onClick={() => setExpanded(expanded === index ? null : index)}
            >
              <span className="setup-step-index">{index + 1}</span>
              <strong>{stepLabel(step.type)}</strong>
              <span className="setup-step-summary">{stepSummary(step)}</span>
            </button>
            <span className="setup-step-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Move down"
                disabled={index === steps.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove step"
                onClick={() => remove(index)}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
          {expanded === index && (
            <div className="setup-step-form">
              <label>
                Step type
                <select
                  value={step.type}
                  onChange={(e) =>
                    update(
                      index,
                      defaultStep(e.target.value as WorkflowStep["type"]),
                    )
                  }
                >
                  {STEP_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {step.type === "navigate" && (
                <label>
                  URL
                  <input
                    value={step.url}
                    onChange={(e) =>
                      update(index, { ...step, url: e.target.value })
                    }
                    placeholder="/login"
                  />
                </label>
              )}
              {(step.type === "click" || step.type === "fill") && (
                <label>
                  Selector
                  <input
                    value={step.selector}
                    onChange={(e) =>
                      update(index, { ...step, selector: e.target.value })
                    }
                    placeholder="#username, button[type=submit], text=Accept"
                  />
                </label>
              )}
              {step.type === "fill" && (
                <label>
                  Value
                  <input
                    value={step.value}
                    onChange={(e) =>
                      update(index, { ...step, value: e.target.value })
                    }
                    placeholder="demo"
                  />
                </label>
              )}
              {step.type === "waitFor" && (
                <>
                  <label>
                    Wait for text <span>Optional</span>
                    <input
                      value={step.text || ""}
                      onChange={(e) =>
                        update(index, {
                          ...step,
                          text: e.target.value || undefined,
                        })
                      }
                      placeholder="Signed in as"
                    />
                  </label>
                  <label>
                    Or selector <span>Optional</span>
                    <input
                      value={step.selector || ""}
                      onChange={(e) =>
                        update(index, {
                          ...step,
                          selector: e.target.value || undefined,
                        })
                      }
                      placeholder=".dashboard-ready"
                    />
                  </label>
                  <label>
                    Timeout (ms) <span>Optional</span>
                    <input
                      type="number"
                      value={step.ms ?? ""}
                      onChange={(e) =>
                        update(index, {
                          ...step,
                          ms: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      placeholder="10000"
                    />
                  </label>
                </>
              )}
              <label>
                Description <span>Optional</span>
                <input
                  value={step.description || ""}
                  onChange={(e) =>
                    update(index, {
                      ...step,
                      description: e.target.value || undefined,
                    })
                  }
                  placeholder="e.g. Dismiss cookie banner"
                />
              </label>
            </div>
          )}
        </div>
      ))}
      <button type="button" className="button" onClick={add}>
        <Plus size={14} />
        Add step
      </button>
    </div>
  );
}
