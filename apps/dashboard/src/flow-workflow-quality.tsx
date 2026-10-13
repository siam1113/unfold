import React, { useMemo, useState } from "react";
import type {
  ActionEdge,
  AppState,
  RunData,
  UIElement,
} from "../../../packages/shared/src/index";
import "./flow-workflow-quality.css";

export type WorkflowQualityMode =
  | "forms"
  | "ui-states"
  | "accessibility"
  | "automation"
  | "evidence"
  | "scenarios"
  | "field-api"
  | "recovery"
  | "similarity"
  | "control-impact"
  | "search-filter";

export type WorkflowQualityLensProps = {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: { kind: "state" | "action"; id: string }) => void;
  initialMode?: WorkflowQualityMode;
};

const modes: { id: WorkflowQualityMode; label: string; description: string }[] =
  [
    {
      id: "forms",
      label: "Forms",
      description:
        "Observed fields, submit controls, and action outcomes. Input values are never displayed.",
    },
    {
      id: "ui-states",
      label: "UI state patterns",
      description:
        "Captured selected, expanded, disabled, popup, and control relationship states.",
    },
    {
      id: "accessibility",
      label: "UI & accessibility",
      description:
        "Captured roles, accessible names, states, and controls. Missing capture is not proof of missing behavior.",
    },
    {
      id: "automation",
      label: "Automation readiness",
      description:
        "Recorded locator quality, uniqueness, and restore verification signals.",
    },
    {
      id: "evidence",
      label: "Evidence & freshness",
      description:
        "Captured screenshots, elements, action evidence, crawl limits, and age of observations.",
    },
    {
      id: "scenarios",
      label: "Scenarios & task clusters",
      description:
        "Replay candidates from observed recipes and inferred clusters from queued work.",
    },
    {
      id: "field-api",
      label: "Field to API",
      description:
        "Observed relationships between controls, actions, and API calls. Request and response values are omitted.",
    },
    {
      id: "recovery",
      label: "Recovery",
      description:
        "Recorded failures, retries, and restore-locator verification evidence.",
    },
    {
      id: "similarity",
      label: "Route similarity",
      description:
        "Inferred similarity from overlap in captured structure tokens.",
    },
    {
      id: "control-impact",
      label: "Shared control impact",
      description:
        "Compare observed outcomes after using similarly named controls on different routes.",
    },
    {
      id: "search-filter",
      label: "Search & filters",
      description:
        "Trace captured search/filter controls to observed state changes without showing entered values.",
    },
  ];

const routeOf = (state?: AppState) =>
  state?.routeKey || (state ? pathOf(state.url) : "Unknown route");
function pathOf(raw?: string) {
  if (!raw) return "Unknown route";
  try {
    return new URL(raw).pathname || "/";
  } catch {
    return raw;
  }
}
const stateLabel = (state?: AppState) => {
  if (!state) return "Unknown screen";
  const special = state.visibleRegionSummary.find((item) =>
    /^(dialog|drawer|menu|tab|details):/.test(item),
  );
  if (special)
    return special.split(":").slice(1).join(":") || special.split(":")[0];
  const path = pathOf(state.url);
  return path === "/"
    ? "Overview"
    : path.split("/").filter(Boolean).pop() || state.title || "Observed screen";
};
const short = (value: string, max = 56) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
const ageLabel = (raw?: string) => {
  if (!raw) return "Timestamp not recorded";
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "Timestamp unavailable";
  const elapsed = Math.max(0, Date.now() - time);
  if (elapsed < 60_000) return "Observed less than a minute ago";
  if (elapsed < 3_600_000)
    return `Observed ${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000)
    return `Observed ${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `Observed ${Math.floor(elapsed / 86_400_000)} days ago`;
};
const scoreLabel = (score?: number) => {
  if (score === undefined || !Number.isFinite(score)) return "Not recorded";
  return `${Math.round((score <= 1 ? score * 100 : score) * 10) / 10}%`;
};
const endpoint = (raw: string) => {
  try {
    return new URL(raw).pathname || "/";
  } catch {
    return raw.split("?")[0];
  }
};
const isField = (element: UIElement) =>
  Boolean(element.inputType) ||
  /^(input|textarea|select)$/.test(element.tag.toLowerCase());
const isControl = (element: UIElement) =>
  Boolean(
    element.role ||
    element.href ||
    element.inputType ||
    element.isSubmit ||
    /^(button|input|textarea|select|a)$/.test(element.tag.toLowerCase()),
  );
const isSearchControl = (element: UIElement) =>
  /search|filter|query|find/i.test(
    `${element.accessibleName} ${element.role} ${element.inputType} ${element.tag}`,
  ) ||
  element.role.toLowerCase() === "searchbox" ||
  element.inputType === "search";
const fieldIdentity = (element: UIElement) =>
  [
    element.accessibleName.trim().toLocaleLowerCase(),
    element.role.trim().toLocaleLowerCase(),
    (element.inputType || element.tag).toLocaleLowerCase(),
  ].join("\u0000");
const nativeValidityLabel = (element?: UIElement) => {
  const evidence = element?.validationEvidence;
  if (!evidence) return "Native validity not recorded";
  if (!evidence.willValidate) return "Native validation not applicable";
  return evidence.valid ? "Native valid" : "Native invalid";
};
const stateEvidenceScore = (
  state: AppState,
  elementCount: number,
  componentCount: number,
  browserActionCount: number,
) => {
  const evidence = [
    Boolean(state.screenshotPath),
    elementCount > 0,
    componentCount > 0,
    state.recipe.steps.length > 0,
    browserActionCount > 0,
  ];
  return {
    score: Math.round((evidence.filter(Boolean).length / evidence.length) * 100),
    evidence,
  };
};
const historySignalsFor = (action: ActionEdge) =>
  action.signals
    .filter((signal) => /(?:^|:)history:(pushState|replaceState|back|forward|go|popstate)(?::(-?\d+))?$/.test(signal))
    .map((signal) => signal.match(/history:(pushState|replaceState|back|forward|go|popstate)(?::(-?\d+))?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => `Page History API: ${match[1]}${match[2] ? ` (${match[2]})` : ""}`);
const matchingControlForTransition = (
  source: UIElement | undefined,
  destinationStateId: string,
  elements: UIElement[],
) => {
  if (!source) return undefined;
  const candidates = elements.filter((candidate) => {
    if (candidate.stateId !== destinationStateId) return false;
    if (source.structuralSignature)
      return candidate.structuralSignature === source.structuralSignature;
    return Boolean(
      source.role.trim() &&
        source.accessibleName.trim() &&
        candidate.role === source.role &&
        candidate.accessibleName === source.accessibleName,
    );
  });
  return candidates.length === 1 ? candidates[0] : undefined;
};
const controlStateChanges = (
  before: UIElement | undefined,
  after: UIElement | undefined,
) => {
  const fields: [string, string | boolean | undefined, string | boolean | undefined][] = [
    ["expanded", before?.expanded, after?.expanded],
    ["selected", before?.selected, after?.selected],
    ["has popup", before?.hasPopup, after?.hasPopup],
    ["disabled", before?.disabled, after?.disabled],
  ];
  return fields.map(([label, oldValue, newValue]) => {
    if (!before || !after || oldValue === undefined || newValue === undefined)
      return label + ": unknown";
    const oldText = String(oldValue);
    const newText = String(newValue);
    return oldText === newText
      ? label + ": " + newText + " (unchanged)"
      : label + ": " + oldText + " → " + newText;
  });
};
const regionCueCounts = (state: AppState | undefined) => {
  const counts = new Map<string, number>();
  for (const region of state?.visibleRegionSummary || []) {
    const kind = region.split(":", 1)[0].toLowerCase();
    if (["dialog", "drawer", "menu", "tab", "details"].includes(kind))
      counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return counts;
};
const regionCueChanges = (
  before: AppState | undefined,
  after: AppState | undefined,
) => {
  if (!before || !after)
    return ["Unknown: source or destination snapshot is missing"];
  const oldCounts = regionCueCounts(before);
  const newCounts = regionCueCounts(after);
  const kinds = new Set([...oldCounts.keys(), ...newCounts.keys()]);
  if (!kinds.size)
    return ["Unknown: no dialog, menu, or related region cue captured"];
  const changes: string[] = [];
  for (const kind of kinds) {
    const oldCount = oldCounts.get(kind) || 0;
    const newCount = newCounts.get(kind) || 0;
    if (oldCount === newCount) continue;
    if (!oldCount && newCount)
      changes.push(kind + " appeared in captured snapshot");
    else if (oldCount && !newCount)
      changes.push(kind + " closed or was no longer listed in captured snapshot");
    else changes.push(kind + " cue count: " + oldCount + " → " + newCount);
  }
  return changes.length ? changes : ["No captured region cue change"];
};
const textMatch = (values: (string | undefined)[], query: string) =>
  !query ||
  values.some((value) => value?.toLowerCase().includes(query.toLowerCase()));

function Selectable({
  kind,
  id,
  onSelect,
  className = "",
  children,
}: {
  kind: "state" | "action";
  id: string;
  onSelect: WorkflowQualityLensProps["onSelect"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`wql-select ${className}`}
      onClick={() => onSelect({ kind, id })}
    >
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
  help,
}: {
  label: string;
  value: React.ReactNode;
  help?: string;
}) {
  return (
    <div className="wql-metric">
      <strong>{value}</strong>
      <span>{label}</span>
      {help && <small>{help}</small>}
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="wql-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="wql-row">{children}</div>;
}

export function WorkflowQualityLens({
  data,
  states,
  actions,
  onSelect,
  initialMode = "forms",
}: WorkflowQualityLensProps) {
  const [mode, setMode] = useState<WorkflowQualityMode>(initialMode);
  const [query, setQuery] = useState("");
  const [expandedScenarioIds, setExpandedScenarioIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeMode = modes.find((item) => item.id === mode)!;
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const actionById = useMemo(
    () => new Map(data.actions.map((action) => [action.id, action])),
    [data.actions],
  );
  const elements = useMemo(
    () =>
      data.elements.filter((element) =>
        states.some((state) => state.id === element.stateId),
      ),
    [data.elements, states],
  );
  const normalizedQuery = query.trim();

  const content = (() => {
    if (mode === "forms") {
      const fields = elements.filter(isField);
      const submits = elements.filter((element) => element.isSubmit);
      const fills = actions.filter(
        (action) => action.action === "fill" || action.action === "select",
      );
      const submitActions = actions.filter((action) => {
        const element = data.elements.find(
          (candidate) => candidate.id === action.elementId,
        );
        return element?.isSubmit;
      });
      const submitFailed = submitActions.filter(
        (action) => action.decision === "failed",
      ).length;
      const submitSkipped = submitActions.filter(
        (action) => action.decision === "skipped_policy",
      ).length;
      const validationCaptured = fields.filter(
        (field) => field.validationEvidence !== undefined,
      );
      const invalidFields = validationCaptured.filter(
        (field) =>
          field.validationEvidence?.ariaInvalid ||
          field.validationEvidence?.cssInvalid ||
          (field.validationEvidence?.willValidate &&
            !field.validationEvidence.valid),
      );
      const ariaInvalidFields = validationCaptured.filter(
        (field) => field.validationEvidence?.ariaInvalid,
      );
      const requiredFields = validationCaptured.filter(
        (field) => field.validationEvidence?.required,
      );
      const formNoValidateSubmits = submits.filter(
        (element) => element.formNoValidate,
      ).length;
      const linkedSubmitCalls = data.apiCalls.filter(
        (call) =>
          call.actionId &&
          submitActions.some((action) => action.id === call.actionId),
      ).length;
      const validityTransitions = actions.flatMap((action) => {
        if (!action.toStateId) return [];
        const sourceFields = fields.filter(
          (field) => field.stateId === action.fromStateId && field.validationEvidence,
        );
        const destinationFields = fields.filter((field) => field.stateId === action.toStateId);
        return sourceFields.flatMap((sourceField) => {
          if (!sourceField.accessibleName.trim()) return [];
          const destinationField = destinationFields.find(
            (field) => fieldIdentity(field) === fieldIdentity(sourceField) && field.validationEvidence,
          );
          return destinationField ? [{ action, sourceField, destinationField }] : [];
        });
      });
      const browserFormActions = actions.filter((action) => {
        const evidence = action.browserEvidence;
        return evidence && (
          evidence.before.formCount > 0 || evidence.after.formCount > 0 ||
          evidence.before.fieldCount > 0 || evidence.after.fieldCount > 0
        );
      });
      const byForm = new Map<string, UIElement[]>();
      for (const field of fields) {
        const key = field.formId || `unassociated:${field.stateId}`;
        byForm.set(key, [...(byForm.get(key) || []), field]);
      }
      const matchingFields = fields.filter((field) =>
        textMatch(
          [
            field.accessibleName,
            field.role,
            field.inputType,
            stateLabel(stateById.get(field.stateId)),
            routeOf(stateById.get(field.stateId)),
          ],
          normalizedQuery,
        ),
      );
      return (
        <>
          <div className="wql-metrics">
            <Metric
              label="Captured fields"
              value={fields.length}
              help="Field values are excluded"
            />
            <Metric label="Observed fill/select actions" value={fills.length} />
            <Metric label="Submit controls captured" value={submits.length} />
            <Metric
              label="Submit actions observed"
              value={submitActions.length}
            />
            <Metric label="Failed submit attempts" value={submitFailed} />
            <Metric label="Policy-skipped submits" value={submitSkipped} />
            <Metric
              label="Validation fields captured"
              value={`${validationCaptured.length}/${fields.length}`}
            />
            <Metric
              label="Invalid at captured snapshot"
              value={invalidFields.length}
            />
            <Metric label="ARIA invalid" value={ariaInvalidFields.length} />
            <Metric
              label="Required fields captured"
              value={requiredFields.length}
            />
            <Metric
              label="Validity transitions recorded"
              value={validityTransitions.length}
              help="Matched across source and destination snapshots"
            />
            <Metric
              label="Submit controls bypassing native validation"
              value={formNoValidateSubmits}
            />
            <Metric
              label="API calls linked to submits"
              value={linkedSubmitCalls}
            />
          </div>
          <div className="wql-note">
            Validation evidence stores boolean DOM validity flags only; it never
            records field values or validation message text. These are
            point-in-time field snapshots, not proof of successful or failed
            form submission. “Not recorded” means no validity snapshot was
            available, not that the field has no validation.
          </div>
          {browserFormActions.length > 0 && (
            <div className="wql-card">
              <h3>Browser-observed form snapshots</h3>
              <p className="wql-note">These aggregate before/after counts are captured directly around each action, including forms or fields the control inventory did not successfully identify. Constraint reasons are native browser validity flags; custom business rules remain unobservable. No value or message text is stored.</p>
              {browserFormActions.slice(0, 100).map((action) => {
                const evidence = action.browserEvidence!;
                const reasons = Object.entries(evidence.after.invalidReasons).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}: ${count}`);
                return <Selectable key={action.id} kind="action" id={action.id} onSelect={onSelect} className="wql-row-button">
                  <span className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}>{action.decision.replaceAll("_", " ")}</span>
                  <span className="wql-main"><strong>{action.action} · {action.targetName || "unnamed control"}</strong><small>{evidence.before.formCount} → {evidence.after.formCount} forms · {evidence.before.fieldCount} → {evidence.after.fieldCount} visible fields · {evidence.before.invalidFieldCount} → {evidence.after.invalidFieldCount} invalid</small><small>After action validity reasons: {reasons.join(" · ") || "none recorded"}</small></span>
                </Selectable>;
              })}
            </div>
          )}
          {matchingFields.length ? (
            <div className="wql-card">
              <h3>Field inventory</h3>
              {matchingFields.map((field) => {
                const fieldActions = actions.filter(
                  (action) => action.elementId === field.id,
                );
                const state = stateById.get(field.stateId);
                const validation = field.validationEvidence;
                const validationLabel = !validation
                  ? "Validation state not recorded"
                  : validation.ariaInvalid ||
                      validation.cssInvalid ||
                      (validation.willValidate && !validation.valid)
                    ? "Invalid at capture"
                    : validation.willValidate
                      ? "Valid at capture"
                      : "Native validation not applicable";
                return (
                  <Selectable
                    key={field.id}
                    kind="state"
                    id={field.stateId}
                    onSelect={onSelect}
                    className="wql-row-button"
                  >
                    <span className="wql-kind">
                      {field.inputType || field.tag}
                    </span>
                    <span className="wql-main">
                      <strong>
                        {field.accessibleName || "Field name not captured"}
                      </strong>
                      <small>
                        {stateLabel(state)} · {routeOf(state)} ·{" "}
                        {fieldActions.length} observed action(s)
                      </small>
                    </span>
                    <span className="wql-chip">
                      {validationLabel} ·{" "}
                      {field.formId
                        ? "Form-linked"
                        : "Form association not captured"}
                    </span>
                    {validation && (
                      <small className="wql-validation-flags">
                        {[
                          `required=${validation.required}`,
                          `aria-invalid=${validation.ariaInvalid}`,
                          `:invalid=${validation.cssInvalid}`,
                          `willValidate=${validation.willValidate}`,
                          `valid=${validation.valid}`,
                          ...Object.entries(validation)
                            .filter(
                              ([key, value]) =>
                                ![
                                  "required",
                                  "ariaInvalid",
                                  "cssInvalid",
                                  "willValidate",
                                  "valid",
                                ].includes(key) && value,
                            )
                            .map(([key]) => key),
                        ].join(" · ")}
                      </small>
                    )}
                  </Selectable>
                );
              })}
            </div>
          ) : (
            <Empty
              title={
                fields.length
                  ? "No fields match this search"
                  : "No form fields captured"
              }
              detail="The current run has no matching captured input, textarea, or select controls."
            />
          )}
          {byForm.size > 0 && (
            <div className="wql-card">
              <h3>Observed form interaction flow</h3>
              {[...byForm].map(([formId, group]) => {
                const members = elements.filter((element) =>
                  formId.startsWith("unassociated:")
                    ? group.some((field) => field.id === element.id)
                    : element.formId === formId,
                );
                const memberIds = new Set(members.map((element) => element.id));
                const formActions = actions.filter((action) =>
                  memberIds.has(action.elementId),
                );
                return (
                  <div className="wql-form-flow" key={formId}>
                    <Row>
                      <span className="wql-main">
                        <strong>
                          {formId.startsWith("unassociated:")
                            ? "Fields without a captured form association"
                            : "Captured form group"}
                        </strong>
                        <small>
                          {routeOf(stateById.get(group[0]?.stateId))} ·{" "}
                          {members.filter((element) => element.isSubmit).length}{" "}
                          submit control(s) ·{" "}
                          {
                            members.filter(
                              (element) =>
                                element.isSubmit && element.formNoValidate,
                            ).length
                          }{" "}
                          bypass native validation
                        </small>
                      </span>
                      <span>
                        {group.length} fields · {formActions.length} action(s)
                      </span>
                    </Row>
                    {formActions.length ? (
                      formActions.map((action) => {
                        const field = members.find(
                          (element) => element.id === action.elementId,
                        );
                        const destination = action.toStateId
                          ? stateById.get(action.toStateId)
                          : undefined;
                        const apiCount = data.apiCalls.filter(
                          (call) => call.actionId === action.id,
                        ).length;
                        return (
                          <Selectable
                            key={action.id}
                            kind="action"
                            id={action.id}
                            onSelect={onSelect}
                            className="wql-row-button wql-form-action"
                          >
                            <span
                              className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}
                            >
                              {action.decision.replaceAll("_", " ")}
                            </span>
                            <span className="wql-main">
                              <strong>
                                {field?.isSubmit ? "Submit" : action.action} ·{" "}
                                {field?.accessibleName ||
                                  action.targetName ||
                                  "Field/control name not captured"}
                              </strong>
                              <small>
                                {routeOf(stateById.get(action.fromStateId))} →{" "}
                                {destination
                                  ? stateLabel(destination)
                                  : "No resulting screen recorded"}{" "}
                                · {apiCount} linked API call(s)
                              </small>
                            </span>
                          </Selectable>
                        );
                      })
                    ) : (
                      <p className="wql-empty-inline">
                        No action record is associated with these captured
                        fields; this does not establish whether the form is
                        usable.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="wql-card">
            <h3>Native validity transitions</h3>
            <div className="wql-note">
              Compares boolean native validity snapshots for a field matched by captured accessible name, role, and field type across an observed action. Failed submissions, subsequent corrections, and retries are shown only where action and state records link them. Custom or business validation remains unknown. Values and validation messages are never displayed.
            </div>
            {validityTransitions.length ? validityTransitions
              .filter(({ action, sourceField }) => textMatch([sourceField.accessibleName, action.targetName, routeOf(stateById.get(action.fromStateId))], normalizedQuery))
              .slice(0, 100)
              .map(({ action, sourceField, destinationField }) => {
                const submit = data.elements.some((element) => element.id === action.elementId && element.isSubmit);
                const task = data.tasks.find((item) => item.stateId === action.fromStateId && item.elementId === action.elementId);
                return (
                  <Selectable key={`${action.id}:${sourceField.id}`} kind="action" id={action.id} onSelect={onSelect} className="wql-row-button wql-validity-transition">
                    <span className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}>{submit ? "Submit" : action.action}</span>
                    <span className="wql-main">
                      <strong>{sourceField.accessibleName || "Field name not captured"} · {nativeValidityLabel(sourceField)} → {nativeValidityLabel(destinationField)}</strong>
                      <small>{routeOf(stateById.get(action.fromStateId))} → {stateLabel(stateById.get(destinationField.stateId))} · {action.decision.replaceAll("_", " ")}{submit && action.decision === "failed" ? " · failed submission observed" : ""}{task && task.attempts > 1 ? ` · ${task.attempts} task attempts recorded` : ""}</small>
                    </span>
                    <span className="wql-chip">{sourceField.validationEvidence?.willValidate && destinationField.validationEvidence?.willValidate ? "Native validity" : "Applicability differs"}</span>
                  </Selectable>
                );
              }) : <p className="wql-empty-inline">No matched source and destination validity snapshots were recorded across an action. This does not mean validation is absent.</p>}
          </div>
        </>
      );
    }

    if (mode === "accessibility") {
      const controls = elements.filter(isControl);
      const named = controls.filter(
        (element) => element.accessibleName.trim().length > 0,
      );
      const roleRecorded = controls.filter(
        (element) => element.role.trim().length > 0,
      );
      const stateRecorded = controls.filter(
        (element) =>
          element.disabled ||
          element.expanded !== undefined ||
          element.selected !== undefined ||
          element.hasPopup !== undefined ||
          element.controls !== undefined,
      );
      const accessibleNameGroups = new Map<
        string,
        { stateId: string; name: string; elements: UIElement[] }
      >();
      for (const element of named) {
        const name = element.accessibleName.trim().replace(/\s+/g, " ");
        const key = `${element.stateId}\u0000${name.toLocaleLowerCase()}`;
        const group = accessibleNameGroups.get(key) || {
          stateId: element.stateId,
          name,
          elements: [],
        };
        group.elements.push(element);
        accessibleNameGroups.set(key, group);
      }
      const repeatedNames = [...accessibleNameGroups.values()].filter(
        (group) => group.elements.length > 1,
      );
      const ambiguousNames = repeatedNames.filter((group) => {
        const signatures = new Set(
          group.elements.map(
            (element) =>
              `${element.role.trim().toLowerCase()}|${element.tag.toLowerCase()}|${element.inputType || ""}`,
          ),
        );
        return signatures.size > 1;
      });
      const rows = controls.filter((element) =>
        textMatch(
          [
            element.accessibleName,
            element.role,
            element.tag,
            element.inputType,
            routeOf(stateById.get(element.stateId)),
          ],
          normalizedQuery,
        ),
      );
      return (
        <>
          <div className="wql-metrics">
            <Metric label="Controls captured" value={controls.length} />
            <Metric
              label="Accessible name captured"
              value={`${named.length}/${controls.length}`}
            />
            <Metric
              label="Role captured"
              value={`${roleRecorded.length}/${controls.length}`}
            />
            <Metric
              label="State/relationship signals"
              value={stateRecorded.length}
            />
            <Metric label="Repeated names on one screen" value={repeatedNames.length} />
            <Metric label="Potentially ambiguous names" value={ambiguousNames.length} />
          </div>
          <div className="wql-note">
            These counts describe captured semantics. “Name not captured” or
            “role not captured” flags an evidence gap for review; it does not
            establish that a control is inaccessible.
          </div>
          {repeatedNames.length > 0 && (
            <div className="wql-card">
              <h3>Repeated accessible names on the same screen</h3>
              <div className="wql-note">
                This is an inferred review signal from captured names. Repeated
                names can be intentional; differing captured roles or control
                types make a group more likely to need review.
              </div>
              {repeatedNames
                .filter((group) =>
                  textMatch(
                    [
                      group.name,
                      routeOf(stateById.get(group.stateId)),
                      stateLabel(stateById.get(group.stateId)),
                    ],
                    normalizedQuery,
                  ),
                )
                .map((group) => {
                  const signatures = new Set(
                    group.elements.map(
                      (element) =>
                        `${element.role.trim().toLowerCase()}|${element.tag.toLowerCase()}|${element.inputType || ""}`,
                    ),
                  );
                  return (
                    <Selectable
                      key={`${group.stateId}:${group.name}`}
                      kind="state"
                      id={group.stateId}
                      onSelect={onSelect}
                      className="wql-row-button"
                    >
                      <span className="wql-kind">
                        {signatures.size > 1
                          ? "Potentially ambiguous"
                          : "Repeated name"}
                      </span>
                      <span className="wql-main">
                        <strong>{group.name}</strong>
                        <small>
                          {stateLabel(stateById.get(group.stateId))} · {routeOf(stateById.get(group.stateId))} · {group.elements.length} controls
                        </small>
                      </span>
                      <span className="wql-chip">
                        {[...new Set(group.elements.map((element) => element.role || element.tag))].join(" / ")}
                      </span>
                    </Selectable>
                  );
                })}
            </div>
          )}
          {rows.length ? (
            <div className="wql-card">
              <h3>Control semantics inventory</h3>
              {rows.map((element) => (
                <Selectable
                  key={element.id}
                  kind="state"
                  id={element.stateId}
                  onSelect={onSelect}
                  className="wql-row-button"
                >
                  <span className="wql-kind">
                    {element.role || "Role not captured"}
                  </span>
                  <span className="wql-main">
                    <strong>
                      {element.accessibleName || "Accessible name not captured"}
                    </strong>
                    <small>
                      {element.tag}
                      {element.inputType
                        ? ` · ${element.inputType}`
                        : ""} · {routeOf(stateById.get(element.stateId))}
                    </small>
                  </span>
                  <span className="wql-chip">
                    {element.disabled
                      ? "Disabled observed"
                      : "Enabled state not recorded"}
                  </span>
                </Selectable>
              ))}
            </div>
          ) : (
            <Empty
              title={
                controls.length
                  ? "No controls match this search"
                  : "No controls captured"
              }
              detail="No matching controls are available in the current run data."
            />
          )}
        </>
      );
    }

    if (mode === "ui-states") {
      const controls = elements.filter(isControl);
      const stateSignals = controls.filter(
        (element) =>
          element.disabled ||
          element.expanded !== undefined ||
          element.selected !== undefined ||
          element.hasPopup !== undefined ||
          element.controls !== undefined,
      );
      const expanded = controls.filter(
        (element) => element.expanded !== undefined,
      );
      const selected = controls.filter(
        (element) => element.selected !== undefined,
      );
      const disabled = controls.filter((element) => element.disabled);
      const popup = controls.filter(
        (element) => element.hasPopup !== undefined,
      );
      const stateTransitions = actions.filter(
        (action) =>
          action.toStateId &&
          stateById.has(action.fromStateId) &&
          stateById.has(action.toStateId),
      );
      const comparableTransitions = stateTransitions.filter((action) => {
        const source = elements.find(
          (element) => element.id === action.elementId,
        );
        return Boolean(
          source &&
            action.toStateId &&
            matchingControlForTransition(source, action.toStateId, elements),
        );
      });
      const rows = stateSignals.filter((element) =>
        textMatch(
          [
            element.accessibleName,
            element.role,
            element.tag,
            stateLabel(stateById.get(element.stateId)),
            routeOf(stateById.get(element.stateId)),
          ],
          normalizedQuery,
        ),
      );
      return (
        <>
          <div className="wql-metrics">
            <Metric
              label="Controls with state evidence"
              value={`${stateSignals.length}/${controls.length}`}
            />
            <Metric label="Expanded state captured" value={expanded.length} />
            <Metric label="Selected state captured" value={selected.length} />
            <Metric label="Disabled captured" value={disabled.length} />
            <Metric label="Popup semantics captured" value={popup.length} />
            <Metric
              label="Observed state transitions"
              value={stateTransitions.length}
            />
            <Metric
              label="Comparable control snapshots"
              value={comparableTransitions.length}
            />
          </div>
          <div className="wql-note">
            State changes are compared only when the same control can be
            matched between the action's captured source and destination
            snapshots. Action type alone is not used to infer an open, close,
            selected, or expanded state.
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Observed control state patterns</h3>
              {rows.map((element) => (
                <Selectable
                  key={element.id}
                  kind="state"
                  id={element.stateId}
                  onSelect={onSelect}
                  className="wql-row-button"
                >
                  <span className="wql-kind">
                    {element.role || element.tag}
                  </span>
                  <span className="wql-main">
                    <strong>
                      {element.accessibleName || "Control name not captured"}
                    </strong>
                    <small>
                      {routeOf(stateById.get(element.stateId))} ·{" "}
                      {[
                        element.disabled ? "disabled" : "enabled not recorded",
                        element.expanded !== undefined
                          ? `expanded=${element.expanded}`
                          : undefined,
                        element.selected !== undefined
                          ? `selected=${element.selected}`
                          : undefined,
                        element.hasPopup !== undefined
                          ? `popup=${element.hasPopup}`
                          : undefined,
                        element.controls
                          ? "controls relationship recorded"
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="wql-chip">
                    {element.controls
                      ? "Controls target recorded"
                      : "No target captured"}
                  </span>
                </Selectable>
              ))}
            </div>
          ) : (
            <Empty
              title={
                stateSignals.length
                  ? "No state patterns match"
                  : "No explicit UI state captured"
              }
              detail="The current records do not contain explicit selected, expanded, popup, or relationship values for matching controls."
            />
          )}
          <div className="wql-note">
            Captured state values describe snapshots. “Comparable control
            snapshots” only pairs controls with a matching structural signature
            or role/name across an observed transition; the data does not record
            continuous DOM lifecycle events between captures.
          </div>
          {stateTransitions.length ? (
            <div className="wql-card">
              <h3>Observed UI state transitions</h3>
              {stateTransitions
                .filter((action) =>
                  textMatch(
                    [
                      action.targetName,
                      action.action,
                      routeOf(stateById.get(action.fromStateId)),
                      routeOf(
                        action.toStateId
                          ? stateById.get(action.toStateId)
                          : undefined,
                      ),
                    ],
                    normalizedQuery,
                  ),
                )
                .map((action) => {
                  const sourceState = stateById.get(action.fromStateId);
                  const destination = action.toStateId
                    ? stateById.get(action.toStateId)
                    : undefined;
                  const sourceControl = elements.find(
                    (element) => element.id === action.elementId,
                  );
                  const destinationControl = destination
                    ? matchingControlForTransition(
                        sourceControl,
                        destination.id,
                        elements,
                      )
                    : undefined;
                  return (
                    <Selectable
                      key={action.id}
                      kind="action"
                      id={action.id}
                      onSelect={onSelect}
                      className="wql-row-button wql-state-transition"
                    >
                      <span
                        className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}
                      >
                        {action.decision.replaceAll("_", " ")}
                      </span>
                      <span className="wql-main">
                        <strong>
                          {sourceControl?.accessibleName ||
                            action.targetName ||
                            action.action}
                        </strong>
                        <small>
                          {routeOf(sourceState)} →{" "}
                          {destination
                            ? `${routeOf(destination)} · ${stateLabel(destination)}`
                            : "Destination state not captured"}
                        </small>
                        <small className="wql-transition-delta">
                          Control state:{" "}
                          {controlStateChanges(
                            sourceControl,
                            destinationControl,
                          ).join(" · ")}
                        </small>
                        <small className="wql-transition-delta">
                          Dialog/menu cues:{" "}
                          {regionCueChanges(sourceState, destination).join(" · ")}
                        </small>
                      </span>
                    </Selectable>
                  );
                })}
            </div>
          ) : null}
        </>
      );
    }

    if (mode === "automation") {
      const controlElements = elements.filter(isControl);
      const locatorCount = controlElements.reduce(
        (count, element) => count + element.locatorCandidates.length,
        0,
      );
      const uniqueCount = controlElements.filter((element) =>
        element.locatorCandidates.some(
          (candidate) => candidate.uniqueAtDiscovery,
        ),
      ).length;
      const verifiedCount = controlElements.filter((element) =>
        element.locatorCandidates.some(
          (candidate) => candidate.verifiedAfterRestore,
        ),
      ).length;
      const scores = controlElements
        .flatMap((element) =>
          element.locatorCandidates.map((candidate) => candidate.score),
        )
        .filter(Number.isFinite);
      const avgScore = scores.length
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : undefined;
      const actionConfidence = actions
        .map((action) => action.confidence)
        .filter(Number.isFinite);
      const avgConfidence = actionConfidence.length
        ? actionConfidence.reduce((sum, value) => sum + value, 0) /
          actionConfidence.length
        : undefined;
      const relevantStateIds = new Set(states.map((state) => state.id));
      const componentConfidence = data.components
        .filter((component) => relevantStateIds.has(component.stateId))
        .map((component) => component.confidence)
        .filter(Number.isFinite);
      const meanComponentConfidence = componentConfidence.length
        ? componentConfidence.reduce((sum, value) => sum + value, 0) /
          componentConfidence.length
        : undefined;
      const actionsWithEvidence = actions.filter(
        (action) => action.evidencePaths.length > 0,
      ).length;
      const linkedApiCalls = data.apiCalls.filter(
        (call) =>
          call.actionId &&
          actions.some((action) => action.id === call.actionId),
      ).length;
      const rows = controlElements.filter((element) =>
        textMatch(
          [
            element.accessibleName,
            element.role,
            element.tag,
            routeOf(stateById.get(element.stateId)),
          ],
          normalizedQuery,
        ),
      );
      return (
        <>
          <div className="wql-metrics">
            <Metric
              label="Controls inventoried"
              value={controlElements.length}
            />
            <Metric label="Locator candidates recorded" value={locatorCount} />
            <Metric
              label="Unique at discovery"
              value={`${uniqueCount}/${controlElements.length}`}
            />
            <Metric
              label="Verified after restore"
              value={`${verifiedCount}/${controlElements.length}`}
            />
            <Metric label="Mean locator score" value={scoreLabel(avgScore)} />
            <Metric
              label="Mean action confidence"
              value={scoreLabel(avgConfidence)}
            />
            <Metric
              label="Mean component confidence"
              value={scoreLabel(meanComponentConfidence)}
            />
            <Metric
              label="Actions with evidence paths"
              value={`${actionsWithEvidence}/${actions.length}`}
            />
            <Metric label="Action-linked API calls" value={linkedApiCalls} />
          </div>
          <div className="wql-note">
            Readiness signals reflect stored locator evidence and confidence
            scores. Missing candidates or verification mean “not recorded,” not
            that automation is impossible.
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Control locator inventory</h3>
              {rows.map((element) => {
                const candidates = element.locatorCandidates;
                const unique = candidates.filter(
                  (candidate) => candidate.uniqueAtDiscovery,
                ).length;
                const verified = candidates.filter(
                  (candidate) => candidate.verifiedAfterRestore,
                ).length;
                const bestScore = candidates.length
                  ? Math.max(...candidates.map((candidate) => candidate.score))
                  : undefined;
                return (
                  <Selectable
                    key={element.id}
                    kind="state"
                    id={element.stateId}
                    onSelect={onSelect}
                    className="wql-row-button"
                  >
                    <span className="wql-kind">
                      {element.accessibleName || element.role || element.tag}
                    </span>
                    <span className="wql-main">
                      <strong>
                        {routeOf(stateById.get(element.stateId))} ·{" "}
                        {candidates.length} candidate(s)
                      </strong>
                      <small>
                        {unique} unique at discovery · {verified} verified after
                        restore
                      </small>
                      <small className="wql-locator-kinds">
                        {candidates.length
                          ? candidates
                              .map(
                                (candidate) =>
                                  `${candidate.kind} ${scoreLabel(candidate.score)} · ${candidate.uniqueAtDiscovery ? "unique" : "not unique"} · ${candidate.verifiedAfterRestore ? "restore verified" : "not restore verified"} · ${candidate.failures.length} recorded failure(s)`,
                              )
                              .join("; ")
                          : "No locator candidates recorded"}
                      </small>
                    </span>
                    <span className="wql-chip">
                      Best score {scoreLabel(bestScore)}
                    </span>
                  </Selectable>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No controls match this search"
              detail="Locator readiness is only summarized for captured controls."
            />
          )}
          {actions.filter((action) =>
            textMatch(
              [
                action.targetName,
                action.action,
                action.error,
                routeOf(stateById.get(action.fromStateId)),
              ],
              normalizedQuery,
            ),
          ).length > 0 && (
            <div className="wql-card">
              <h3>Action evidence lineage</h3>
              {actions
                .filter((action) =>
                  textMatch(
                    [
                      action.targetName,
                      action.action,
                      action.error,
                      routeOf(stateById.get(action.fromStateId)),
                    ],
                    normalizedQuery,
                  ),
                )
                .slice(0, 40)
                .map((action) => {
                  const source = stateById.get(action.fromStateId);
                  const destination = action.toStateId
                    ? stateById.get(action.toStateId)
                    : undefined;
                  const directCalls = data.apiCalls.filter(
                    (call) => call.actionId === action.id,
                  ).length;
                  return (
                    <Selectable
                      key={action.id}
                      kind="action"
                      id={action.id}
                      onSelect={onSelect}
                      className="wql-row-button"
                    >
                      <span
                        className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}
                      >
                        {action.decision.replaceAll("_", " ")}
                      </span>
                      <span className="wql-main">
                        <strong>{action.targetName || action.action}</strong>
                        <small>
                          {routeOf(source)} →{" "}
                          {destination
                            ? stateLabel(destination)
                            : "No destination state recorded"}{" "}
                          · source screenshot{" "}
                          {source?.screenshotPath ? "captured" : "not recorded"}{" "}
                          · destination screenshot{" "}
                          {destination?.screenshotPath
                            ? "captured"
                            : "not recorded"}
                        </small>
                      </span>
                      <span className="wql-chip">
                        Confidence {scoreLabel(action.confidence)} ·{" "}
                        {action.evidencePaths.length} files · {directCalls} API
                        calls
                      </span>
                    </Selectable>
                  );
                })}
            </div>
          )}
        </>
      );
    }

    if (mode === "evidence") {
      const stateEvidence = states.map((state) => ({
        state,
        elementCount: elements.filter((element) => element.stateId === state.id)
          .length,
        actionCount: actions.filter(
          (action) => action.fromStateId === state.id,
        ),
        browserActionCount: actions.filter((action) => action.fromStateId === state.id && action.browserEvidence).length,
        hasScreenshot: Boolean(state.screenshotPath),
        componentCount: data.components.filter((component) => component.stateId === state.id).length,
      }));
      const confidenceEvidence = stateEvidence.map((item) => ({
        ...item,
        completeness: stateEvidenceScore(item.state, item.elementCount, item.componentCount, item.browserActionCount),
      }));
      const screenshotStates = stateEvidence.filter(
        (item) => item.hasScreenshot,
      ).length;
      const statesWithElements = stateEvidence.filter(
        (item) => item.elementCount > 0,
      ).length;
      const actionsWithEvidence = actions.filter(
        (action) => action.evidencePaths.length > 0,
      ).length;
      const rows = stateEvidence.filter(({ state }) =>
        textMatch(
          [state.routeKey, stateLabel(state), pathOf(state.url)],
          normalizedQuery,
        ),
      );
      const discoveryAge = ageLabel(
        data.run.finishedAt || data.run.startedAt || data.run.createdAt,
      );
      const cap = data.run.config.maxStates;
      return (
        <>
          <div className="wql-metrics">
            <Metric label="Observed screens" value={states.length} />
            <Metric
              label="Screenshots captured"
              value={`${screenshotStates}/${states.length}`}
            />
            <Metric
              label="Screens with elements"
              value={`${statesWithElements}/${states.length}`}
            />
            <Metric
              label="Actions with evidence paths"
              value={`${actionsWithEvidence}/${actions.length}`}
            />
            <Metric label="Run state cap" value={cap} />
            <Metric label="Latest run observation" value={discoveryAge} />
          </div>
          <div className="wql-note">
            Evidence completeness reports only artifacts present in this run. An
            artifact gap does not mean the corresponding screen, interaction, or
            behavior is absent.
          </div>
          <div className="wql-card">
            <h3>Heuristic state confidence</h3>
            <div className="wql-note">
              A simple evidence-completeness score, not a model probability or a
              claim that the state is correct. Each state gets one point for
              each recorded artifact type: screenshot, controls, components,
              replay recipe, and browser action snapshots. Multiple actions do
              not add extra points. This score is a completeness checklist, not
              a calibrated confidence estimate.
            </div>
            {confidenceEvidence.filter(({ state }) => textMatch([state.routeKey, stateLabel(state), pathOf(state.url)], normalizedQuery)).map(({ state, completeness, elementCount, componentCount, browserActionCount }) => (
              <Selectable key={`confidence:${state.id}`} kind="state" id={state.id} onSelect={onSelect} className="wql-row-button wql-confidence-row">
                <span className="wql-kind">{completeness.score}% evidence</span>
                <span className="wql-main">
                  <strong>{stateLabel(state)}</strong>
                  <small>{routeOf(state)} · screenshot {completeness.evidence[0] ? "recorded" : "not recorded"} · {elementCount} controls · {componentCount} components · {state.recipe.steps.length} replay step(s) · {browserActionCount} browser evidence action(s)</small>
                </span>
                <span className="wql-chip">{completeness.evidence.filter(Boolean).length}/5 evidence types</span>
              </Selectable>
            ))}
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Per-screen evidence</h3>
              {rows.map(
                ({ state, elementCount, actionCount, hasScreenshot }) => (
                  <Selectable
                    key={state.id}
                    kind="state"
                    id={state.id}
                    onSelect={onSelect}
                    className="wql-row-button"
                  >
                    <span className="wql-kind">{routeOf(state)}</span>
                    <span className="wql-main">
                      <strong>{stateLabel(state)}</strong>
                      <small>
                        {ageLabel(state.discoveredAt)} · {elementCount} captured
                        element(s) · {actionCount.length} outgoing action(s)
                      </small>
                    </span>
                    <span className="wql-chip">
                      Screenshot {hasScreenshot ? "captured" : "not recorded"}
                    </span>
                  </Selectable>
                ),
              )}
            </div>
          ) : (
            <Empty
              title="No screens match this search"
              detail="Adjust the search to inspect evidence records."
            />
          )}
          {data.run.stopReason && (
            <div className="wql-note">
              <strong>Recorded stop reason:</strong> {data.run.stopReason}
            </div>
          )}
        </>
      );
    }

    if (mode === "scenarios") {
      const candidates = states
        .filter((state) => state.recipe.steps.length > 0)
        .filter((state) =>
          textMatch(
            [state.routeKey, stateLabel(state), pathOf(state.url)],
            normalizedQuery,
          ),
        );
      const done = data.tasks.filter((task) => task.status === "done").length;
      const pending = data.tasks.filter(
        (task) => task.status === "pending" || task.status === "leased",
      ).length;
      const failed = data.tasks.filter(
        (task) => task.status === "failed",
      ).length;
      const taskGroups = new Map<string, typeof data.tasks>();
      for (const task of data.tasks) {
        const action = actionById.get(task.id);
        const evidence = action?.browserEvidence;
        const before = evidence?.before;
        const after = evidence?.after;
        const traits = [
          before?.passwordControlCount || after?.passwordControlCount || before?.signInControlCount || after?.signInControlCount ? "auth surface" : undefined,
          before?.formCount || after?.formCount ? "form interaction" : undefined,
          before?.searchControlCount || after?.searchControlCount ? "search interaction" : undefined,
          before?.filterControlCount || after?.filterControlCount ? "filter interaction" : undefined,
          evidence?.events.some((event) => event.kind === "redirect" || event.kind === "navigation_start") ? "navigation transition" : undefined,
        ].filter(Boolean);
        const activity = traits.length ? traits.join(" + ") : action?.action || "activity not classified";
        const key = `${task.kind} · ${pathOf(task.url)} · ${activity}`;
        taskGroups.set(key, [...(taskGroups.get(key) || []), task]);
      }
      const groups = [...taskGroups]
        .filter(([key]) => textMatch([key], normalizedQuery))
        .sort((a, b) => b[1].length - a[1].length);
      return (
        <>
          <div className="wql-metrics">
            <Metric
              label="Replay candidates"
              value={candidates.length}
              help="Observed paths with a recorded restore recipe"
            />
            <Metric label="Tasks done" value={done} />
            <Metric label="Tasks pending or leased" value={pending} />
            <Metric label="Tasks failed" value={failed} />
          </div>
          <div className="wql-note">
            Each scenario is a candidate assembled from an observed restore
            recipe. Evidence completeness is shown step by step; these are not
            runnable tests. Task clusters are inferred from task kind and route,
            and are not user-intent labels.
          </div>
          {candidates.length ? (
            <div className="wql-card">
              <h3>Candidate scenarios from observed paths</h3>
              {candidates.map((state) => {
                const steps = state.recipe.steps;
                const verified = steps.reduce(
                  (sum, step) =>
                    sum +
                    step.locators.filter(
                      (locator) => locator.verifiedAfterRestore,
                    ).length,
                  0,
                );
                const locatorCount = steps.reduce(
                  (sum, step) => sum + step.locators.length,
                  0,
                );
                const isExpanded = expandedScenarioIds.has(state.id);
                const completeStepCount = steps.filter((step) => {
                  const matchingElements = data.elements.filter(
                    (element) => element.structuralSignature === step.elementSignature,
                  );
                  const matchingAction = actions.some(
                    (action) =>
                      action.action === step.action &&
                      matchingElements.some((element) => element.id === action.elementId),
                  );
                  return Boolean(
                    step.locators.length &&
                      step.locators.some((locator) => locator.uniqueAtDiscovery) &&
                      step.expectedFingerprint &&
                      matchingAction,
                  );
                }).length;
                return (
                  <article className="wql-scenario" key={state.id}>
                    <div className="wql-scenario-heading">
                      <button
                        type="button"
                        className="wql-row-button wql-scenario-select"
                        onClick={() => onSelect({ kind: "state", id: state.id })}
                      >
                        <span className="wql-kind">{routeOf(state)}</span>
                        <span className="wql-main">
                          <strong>{stateLabel(state)}</strong>
                          <small>
                            {steps.length} observed recipe step(s) · {completeStepCount}/{steps.length} with core evidence · {verified}/{locatorCount} locators restore-verified
                          </small>
                        </span>
                        <span className="wql-chip">Candidate scenario</span>
                      </button>
                      <button
                        type="button"
                        className="wql-scenario-toggle"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedScenarioIds((current) => {
                            const next = new Set(current);
                            if (next.has(state.id)) next.delete(state.id);
                            else next.add(state.id);
                            return next;
                          })
                        }
                      >
                        {isExpanded ? "Hide step evidence" : "Show step evidence"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="wql-scenario-steps">
                        {steps.map((step, index) => {
                          const matchingElements = data.elements.filter(
                            (element) => element.structuralSignature === step.elementSignature,
                          );
                          const observedAction = actions.find(
                            (action) =>
                              action.action === step.action &&
                              matchingElements.some((element) => element.id === action.elementId),
                          );
                          const uniqueLocatorCount = step.locators.filter(
                            (locator) => locator.uniqueAtDiscovery,
                          ).length;
                          const restoredLocatorCount = step.locators.filter(
                            (locator) => locator.verifiedAfterRestore,
                          ).length;
                          const expectedStateCaptured = Boolean(
                            step.expectedFingerprint || step.expectedUrl,
                          );
                          const checks = [
                            ["Locator evidence", step.locators.length > 0, `${step.locators.length} captured`],
                            ["Unique locator", uniqueLocatorCount > 0, `${uniqueLocatorCount} unique at discovery`],
                            ["Restore verification", restoredLocatorCount > 0, `${restoredLocatorCount} verified after restore`],
                            ["Matching observed action", Boolean(observedAction), observedAction ? "Observed" : "Not linked"],
                            ["Expected result evidence", expectedStateCaptured, expectedStateCaptured ? "Fingerprint or route recorded" : "Not recorded"],
                          ] as const;
                          return (
                            <div className="wql-scenario-step" key={`${state.id}:${index}`}>
                              <span className="wql-scenario-step-number">{index + 1}</span>
                              <div className="wql-main">
                                <strong>{step.action} · {matchingElements[0]?.accessibleName || matchingElements[0]?.role || "Control name not captured"}</strong>
                                <small>{step.expectedUrl ? pathOf(step.expectedUrl) : "Expected route not recorded"}</small>
                                <ul className="wql-evidence-checks">
                                  {checks.map(([label, present, detail]) => (
                                    <li className={present ? "is-present" : "is-missing"} key={label}>
                                      <span aria-hidden="true">{present ? "✓" : "·"}</span> {label}: {detail}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <span className="wql-chip">Evidence {checks.filter(([, present]) => present).length}/5</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No replay candidates captured"
              detail="No selected screen has a restore recipe with steps."
            />
          )}
          {groups.length ? (
            <div className="wql-card">
              <h3>Inferred task clusters</h3>
              {groups.map(([group, tasks]) => (
                <Row key={group}>
                  <span className="wql-main">
                    <strong>{group}</strong>
                    <small>Inferred from task kind, observed URL path, and value-free browser structure when available</small>
                  </span>
                  <span>
                    {tasks.length} tasks ·{" "}
                    {tasks.filter((task) => task.status === "failed").length}{" "}
                    failed
                  </span>
                </Row>
              ))}
            </div>
          ) : data.tasks.length > 0 ? (
            <Empty
              title="No task clusters match"
              detail="Adjust the search to see inferred task groups."
            />
          ) : (
            <Empty
              title="No task records captured"
              detail="The run data has no recorded task leases."
            />
          )}
        </>
      );
    }

    if (mode === "field-api") {
      const rows = data.apiCalls.filter((call) => {
        const action = call.actionId
          ? actionById.get(call.actionId)
          : undefined;
        const element = action
          ? data.elements.find((item) => item.id === action.elementId)
          : undefined;
        const state = call.fromStateId
          ? stateById.get(call.fromStateId)
          : action
            ? stateById.get(action.fromStateId)
            : undefined;
        return textMatch(
          [
            call.method,
            endpoint(call.url),
            action?.targetName,
            element?.accessibleName,
            state?.routeKey,
            action?.action,
          ],
          normalizedQuery,
        );
      });
      return (
        <>
          <div className="wql-metrics">
            <Metric label="API calls observed" value={data.apiCalls.length} />
            <Metric
              label="Calls linked to observed actions"
              value={`${data.apiCalls.filter((call) => Boolean(call.actionId && actionById.has(call.actionId))).length}/${data.apiCalls.length}`}
            />
            <Metric label="Calls in current search" value={rows.length} />
          </div>
          <div className="wql-note">
            Request/response bodies, headers, query strings, and entered field
            values are intentionally omitted. A call linked to an action is an
            observed association, not proof that the field value caused that
            request.
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Observed field/action/API associations</h3>
              {rows.map((call) => {
                const action = call.actionId
                  ? actionById.get(call.actionId)
                  : undefined;
                const element = action
                  ? data.elements.find((item) => item.id === action.elementId)
                  : undefined;
                const state = call.fromStateId
                  ? stateById.get(call.fromStateId)
                  : action
                    ? stateById.get(action.fromStateId)
                    : undefined;
                const association = action
                  ? `${element?.accessibleName || "Control name not captured"} → ${action.targetName || action.action}`
                  : "No action association recorded";
                const body = (
                  <>
                    <span className="wql-kind">
                      {call.method.toUpperCase()}
                    </span>
                    <span className="wql-main">
                      <strong>{endpoint(call.url)}</strong>
                      <small>
                        {association} · {routeOf(state)} ·{" "}
                        {call.status === undefined
                          ? "status not captured"
                          : `status ${call.status}`}
                      </small>
                    </span>
                    <span className="wql-chip">
                      {call.durationMs === undefined
                        ? "Duration not captured"
                        : `${Math.round(call.durationMs)} ms`}
                    </span>
                  </>
                );
                return action ? (
                  <Selectable
                    key={call.id}
                    kind="action"
                    id={action.id}
                    onSelect={onSelect}
                    className="wql-row-button"
                  >
                    {body}
                  </Selectable>
                ) : (
                  <Row key={call.id}>{body}</Row>
                );
              })}
            </div>
          ) : (
            <Empty
              title={
                data.apiCalls.length
                  ? "No API calls match this search"
                  : "No API calls captured"
              }
              detail="API relationships can only be shown when calls were recorded in this run."
            />
          )}
        </>
      );
    }

    if (mode === "recovery") {
      const failedActions = actions.filter(
        (action) => action.decision === "failed",
      );
      const failedSubmitValidationSnapshots = failedActions.filter((action) => {
        const submitControl = data.elements.find(
          (element) => element.id === action.elementId && element.isSubmit,
        );
        if (!submitControl?.formId) return false;
        return data.elements.some(
          (field) =>
            field.stateId === action.fromStateId &&
            field.formId === submitControl.formId &&
            field.validationEvidence &&
            (field.validationEvidence.ariaInvalid ||
              field.validationEvidence.cssInvalid ||
              (field.validationEvidence.willValidate &&
                !field.validationEvidence.valid)),
        );
      }).length;
      const failedTasks = data.tasks.filter((task) => task.status === "failed");
      const retries = data.tasks.filter((task) => task.attempts > 1);
      const failedApiCalls = data.apiCalls.filter(
        (call) =>
          call.failed || (call.status !== undefined && call.status >= 400),
      );
      const rows = failedActions.filter((action) =>
        textMatch(
          [
            action.error,
            action.errorCode,
            action.targetName,
            stateById.get(action.fromStateId)?.routeKey,
          ],
          normalizedQuery,
        ),
      );
      const recoveryFor = (failed: ActionEdge) => {
        const sourceState = stateById.get(failed.fromStateId);
        const sourceControl = data.elements.find((element) => element.id === failed.elementId);
        if (!sourceState || !sourceControl) return [] as { action: ActionEdge; kind: string; basis: string }[];
        const signature = fieldIdentity(sourceControl);
        const hasUsefulSignature = Boolean(sourceControl.accessibleName.trim() || sourceControl.role.trim());
        if (!hasUsefulSignature) return [] as { action: ActionEdge; kind: string; basis: string }[];
        const later = actions.filter((candidate) => {
          if (new Date(candidate.createdAt).getTime() <= new Date(failed.createdAt).getTime()) return false;
          const candidateState = stateById.get(candidate.fromStateId);
          if (!candidateState) return false;
          return sourceState.fingerprint
            ? candidateState.fingerprint === sourceState.fingerprint
            : candidateState.routeKey === sourceState.routeKey;
        }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const linked: { action: ActionEdge; kind: string; basis: string }[] = [];
        for (const candidate of later) {
          const control = data.elements.find((element) => element.id === candidate.elementId);
          if (!control) continue;
          const sameSnapshot = Boolean(sourceState.fingerprint) && stateById.get(candidate.fromStateId)?.fingerprint === sourceState.fingerprint;
          const basis = sameSnapshot ? "same captured state fingerprint" : "same route only; weaker match";
          if (candidate.action === failed.action && fieldIdentity(control) === signature) {
            linked.push({ action: candidate, kind: candidate.decision === "executed" ? "Possible successful retry" : "Possible retry" , basis });
          } else if (sourceControl.isSubmit && sourceControl.formId &&
            ["fill", "select"].includes(candidate.action) && control.formId === sourceControl.formId) {
            linked.push({ action: candidate, kind: "Possible form correction", basis: `${basis} · same captured form association` });
          } else if (sourceControl.isSubmit && control.isSubmit && control.formId === sourceControl.formId && candidate.decision === "executed") {
            linked.push({ action: candidate, kind: "Later submit action executed", basis });
          }
          if (linked.length >= 4) break;
        }
        return linked;
      };
      const failedTaskRows = failedTasks.filter((task) =>
        textMatch([task.key, task.url, task.stateId], normalizedQuery),
      );
      return (
        <>
          <div className="wql-metrics">
            <Metric label="Failed actions" value={failedActions.length} />
            <Metric label="Failed tasks" value={failedTasks.length} />
            <Metric
              label="Tasks with repeated attempts"
              value={retries.length}
            />
            <Metric
              label="Action evidence paths"
              value={
                failedActions.filter(
                  (action) => action.evidencePaths.length > 0,
                ).length
              }
            />
            <Metric label="Failed API calls" value={failedApiCalls.length} />
            <Metric
              label="Failed tasks retried"
              value={retries.filter((task) => task.status === "failed").length}
            />
            <Metric
              label="Failed submits with invalid source snapshot"
              value={failedSubmitValidationSnapshots}
            />
          </div>
          <div className="wql-note">
            Retry and restore signals are limited to stored task attempts,
            action errors, evidence paths, and locator verification. No recovery
            success is inferred without a recorded successful outcome.
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Failed action records</h3>
              {rows.map((action) => {
                const state = stateById.get(action.fromStateId);
                const restore = states.find(
                  (candidate) => candidate.recipe.id === action.restoreRecipeId,
                );
                const locatorCount =
                  restore?.recipe.steps.reduce(
                    (sum, step) => sum + step.locators.length,
                    0,
                  ) || 0;
                const verified =
                  restore?.recipe.steps.reduce(
                    (sum, step) =>
                      sum +
                      step.locators.filter(
                        (locator) => locator.verifiedAfterRestore,
                      ).length,
                    0,
                  ) || 0;
                const relatedTaskAttempts = data.tasks
                  .filter(
                    (task) =>
                      task.stateId === action.fromStateId &&
                      task.elementId === action.elementId,
                  )
                  .map((task) => task.attempts);
                const attempts = relatedTaskAttempts.length
                  ? Math.max(...relatedTaskAttempts)
                  : undefined;
                const submitControl = data.elements.find(
                  (element) =>
                    element.id === action.elementId && element.isSubmit,
                );
                const formFields = submitControl?.formId
                  ? data.elements.filter(
                      (field) =>
                        field.stateId === action.fromStateId &&
                        field.formId === submitControl.formId &&
                        isField(field),
                    )
                  : [];
                const formValidationCaptured = formFields.filter(
                  (field) => field.validationEvidence !== undefined,
                ).length;
                const formInvalidCaptured = formFields.filter(
                  (field) =>
                    field.validationEvidence &&
                    (field.validationEvidence.ariaInvalid ||
                      field.validationEvidence.cssInvalid ||
                      (field.validationEvidence.willValidate &&
                        !field.validationEvidence.valid)),
                ).length;
                const recoveryLinks = recoveryFor(action);
                const historyBreadcrumbs = [
                  ...historySignalsFor(action),
                  ...recoveryLinks.flatMap(({ action: linked }) => historySignalsFor(linked)),
                ];
                return (
                  <React.Fragment key={action.id}>
                  <Selectable
                    kind="action"
                    id={action.id}
                    onSelect={onSelect}
                    className="wql-row-button"
                  >
                    <span className="wql-kind is-error">Failed</span>
                    <span className="wql-main">
                      <strong>{action.targetName || action.action}</strong>
                      <small>
                        {action.error ||
                          action.errorCode ||
                          "Error detail not recorded"}{" "}
                        · {routeOf(state)}
                      </small>
                    </span>
                    <span className="wql-chip">
                      {action.evidencePaths.length} evidence · restore{" "}
                      {verified}/{locatorCount} ·{" "}
                      {attempts === undefined
                        ? "retry count not linked"
                        : `${attempts} task attempt(s)`}
                    </span>
                    {submitControl && (
                      <small className="wql-validation-flags">
                        {formFields.length
                          ? `${formInvalidCaptured} invalid boolean field flag(s) in source snapshot · ${formValidationCaptured}/${formFields.length} field validity records captured`
                          : "Form field validation snapshot not available"}
                      </small>
                    )}
                    {historyBreadcrumbs.length > 0 && (
                      <small className="wql-recovery-history">
                        Observed page History API cue(s): {[...new Set(historyBreadcrumbs)].join(" · ")}. These signals do not identify browser toolbar use.
                      </small>
                    )}
                  </Selectable>
                  {recoveryLinks.map(({ action: linked, kind, basis }) => (
                    <Selectable key={`${action.id}:${linked.id}`} kind="action" id={linked.id} onSelect={onSelect} className="wql-row-button wql-recovery-link">
                      <span className={`wql-kind ${linked.decision === "failed" ? "is-error" : ""}`}>{kind}</span>
                      <span className="wql-main">
                        <strong>{linked.targetName || linked.action}</strong>
                        <small>{routeOf(stateById.get(linked.fromStateId))} → {linked.toStateId ? stateLabel(stateById.get(linked.toStateId)) : "Destination unknown"} · {linked.decision.replaceAll("_", " ")} · inferred relation: {basis}</small>
                      </span>
                      <span className="wql-chip">{linked.evidencePaths.length} evidence item(s)</span>
                    </Selectable>
                  ))}
                  </React.Fragment>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No failed actions match"
              detail={
                failedActions.length
                  ? "Adjust the search to inspect failure records."
                  : "No failed action outcome was recorded in the selected run."
              }
            />
          )}
          {failedTaskRows.length ? (
            <div className="wql-card">
              <h3>Failed task records</h3>
              {failedTaskRows.map((task) => (
                <Row key={task.id}>
                  <span className="wql-kind is-error">{task.kind}</span>
                  <span className="wql-main">
                    <strong>{pathOf(task.url)}</strong>
                    <small>
                      {task.key} · {task.attempts} attempt(s) ·{" "}
                      {task.stateId
                        ? stateLabel(stateById.get(task.stateId))
                        : "State association not recorded"}
                    </small>
                  </span>
                  <span className="wql-chip">{task.status}</span>
                </Row>
              ))}
            </div>
          ) : null}
          {failedApiCalls.length > 0 && (
            <div className="wql-card">
              <h3>API failures recorded</h3>
              {failedApiCalls
                .filter((call) =>
                  textMatch(
                    [call.method, endpoint(call.url), call.actionId],
                    normalizedQuery,
                  ),
                )
                .slice(0, 30)
                .map((call) => {
                  const action = call.actionId
                    ? actionById.get(call.actionId)
                    : undefined;
                  const label = `${call.method.toUpperCase()} ${endpoint(call.url)}`;
                  const detail = `${call.status === undefined ? "Status not recorded" : `Status ${call.status}`} · ${call.failed ? "request failed" : "error status"}`;
                  return action ? (
                    <Selectable
                      key={call.id}
                      kind="action"
                      id={action.id}
                      onSelect={onSelect}
                      className="wql-row-button"
                    >
                      <span className="wql-kind is-error">API error</span>
                      <span className="wql-main">
                        <strong>{label}</strong>
                        <small>
                          {detail} · linked action:{" "}
                          {action.targetName || action.action}
                        </small>
                      </span>
                    </Selectable>
                  ) : (
                    <Row key={call.id}>
                      <span className="wql-kind is-error">API error</span>
                      <span className="wql-main">
                        <strong>{label}</strong>
                        <small>
                          {detail} · action association not captured
                        </small>
                      </span>
                    </Row>
                  );
                })}
            </div>
          )}
        </>
      );
    }

    if (mode === "control-impact") {
      const groups = new Map<
        string,
        { element: UIElement; stateIds: Set<string>; actions: ActionEdge[] }
      >();
      for (const element of elements) {
        const name = element.accessibleName.trim();
        if (!name) continue;
        const key = `${element.role.toLowerCase()}\u0000${name.toLowerCase()}`;
        const group = groups.get(key) || {
          element,
          stateIds: new Set<string>(),
          actions: [],
        };
        group.stateIds.add(element.stateId);
        group.actions.push(
          ...actions.filter((action) => action.elementId === element.id),
        );
        groups.set(key, group);
      }
      const rows = [...groups.values()]
        .filter((group) => group.stateIds.size > 1)
        .filter((group) =>
          textMatch(
            [
              group.element.accessibleName,
              group.element.role,
              ...[...group.stateIds].map((id) => routeOf(stateById.get(id))),
            ],
            normalizedQuery,
          ),
        )
        .sort((a, b) => b.stateIds.size - a.stateIds.size);
      return (
        <>
          <div className="wql-note">
            Controls are grouped by captured role and accessible name. Outcomes
            show what discovery recorded after each use; shared names do not
            prove the controls have the same implementation.
          </div>
          {rows.length ? (
            <div className="wql-card">
              <h3>Shared controls and observed effects</h3>
              {rows.map((group) => (
                <article
                  className="wql-impact-group"
                  key={`${group.element.role}:${group.element.accessibleName}`}
                >
                  <header>
                    <span className="wql-kind">
                      {group.element.role || "Role not captured"}
                    </span>
                    <strong>{group.element.accessibleName}</strong>
                    <span className="wql-chip">
                      {group.stateIds.size} screens
                    </span>
                  </header>
                  <div className="wql-impact-routes">
                    {[...group.stateIds].map((id) => (
                      <span key={id}>{routeOf(stateById.get(id))}</span>
                    ))}
                  </div>
                  {group.actions.length ? (
                    group.actions.map((action) => (
                      <Selectable
                        key={action.id}
                        kind="action"
                        id={action.id}
                        onSelect={onSelect}
                        className="wql-row-button"
                      >
                        <span
                          className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}
                        >
                          {action.decision.replaceAll("_", " ")}
                        </span>
                        <span className="wql-main">
                          <strong>
                            {action.action} ·{" "}
                            {action.targetName || group.element.accessibleName}
                          </strong>
                          <small>
                            {routeOf(stateById.get(action.fromStateId))} →{" "}
                            {action.toStateId
                              ? stateLabel(stateById.get(action.toStateId))
                              : "No resulting screen recorded"}
                          </small>
                        </span>
                      </Selectable>
                    ))
                  ) : (
                    <p className="wql-empty-inline">
                      No action was recorded for these matching controls.
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="No shared controls found"
              detail="The current run needs similarly named controls observed on more than one screen."
            />
          )}
        </>
      );
    }

    if (mode === "search-filter") {
      const candidates = elements
        .filter(isSearchControl)
        .filter((element) =>
          textMatch(
            [
              element.accessibleName,
              element.role,
              element.inputType,
              element.tag,
              routeOf(stateById.get(element.stateId)),
            ],
            normalizedQuery,
          ),
        );
      const candidateIds = new Set(candidates.map((element) => element.id));
      const rows = actions.filter(
        (action) =>
          candidateIds.has(action.elementId) &&
          (action.action === "fill" ||
            action.action === "select" ||
            action.action === "click"),
      );
      const candidateActionCount = new Set(
        rows.map((action) => action.elementId),
      ).size;
      const browserSearchActions = actions.filter((action) => {
        const evidence = action.browserEvidence;
        return evidence && (
          evidence.before.searchControlCount + evidence.after.searchControlCount +
          evidence.before.filterControlCount + evidence.after.filterControlCount > 0
        );
      });
      return (
        <>
          <div className="wql-metrics">
            <Metric
              label="Search/filter control candidates"
              value={candidates.length}
            />
            <Metric
              label="Candidates with an observed action"
              value={`${candidateActionCount}/${candidates.length}`}
            />
            <Metric label="Recorded candidate actions" value={rows.length} />
            <Metric label="Actions with browser search/filter evidence" value={browserSearchActions.length} />
          </div>
          <div className="wql-note">
            Candidates are identified from captured control names and types
            (never text snippets or entered values). Result-shape notes are
            inferred from structure tokens, observed route/state changes, and
            linked API status/counts. They do not show entered terms, field
            values, request bodies, or response bodies. Browser evidence also
            records control and result-candidate counts around each action,
            without storing search text. A missing cue is
            unknown, not proof that results exist or that no request occurred.
          </div>
          {candidates.length ? (
            <div className="wql-card">
              <h3>Search/filter candidates and observed behavior</h3>
              {candidates.map((element) => {
                const candidateActions = rows.filter(
                  (action) => action.elementId === element.id,
                );
                return (
                  <article className="wql-search-candidate" key={element.id}>
                    <Selectable
                      kind="state"
                      id={element.stateId}
                      onSelect={onSelect}
                      className="wql-row-button"
                    >
                      <span className="wql-kind">
                        {element.role || element.inputType || element.tag}
                      </span>
                      <span className="wql-main">
                        <strong>
                          {element.accessibleName ||
                            "Search/filter name not captured"}
                        </strong>
                        <small>
                          {routeOf(stateById.get(element.stateId))} ·{" "}
                          {candidateActions.length} observed action(s)
                        </small>
                      </span>
                      <span className="wql-chip">Candidate</span>
                    </Selectable>
                    {candidateActions.length ? (
                      candidateActions.map((action) => {
                        const source = stateById.get(action.fromStateId);
                        const destination = action.toStateId
                          ? stateById.get(action.toStateId)
                          : undefined;
                        const calls = data.apiCalls.filter(
                          (call) => call.actionId === action.id,
                        );
                        const sourceTokens = source?.structureTokens;
                        const destinationTokens = destination?.structureTokens;
                        const hasStructureEvidence = Boolean(
                          sourceTokens?.length && destinationTokens?.length,
                        );
                        const sourceTokenSet = new Set(sourceTokens || []);
                        const destinationTokenSet = new Set(
                          destinationTokens || [],
                        );
                        const sharedTokenCount = [...sourceTokenSet].filter(
                          (token) => destinationTokenSet.has(token),
                        ).length;
                        const tokenUnionCount = new Set([
                          ...sourceTokenSet,
                          ...destinationTokenSet,
                        ]).size;
                        const structureChanged =
                          hasStructureEvidence &&
                          ([...sourceTokenSet].some(
                            (token) => !destinationTokenSet.has(token),
                          ) ||
                            [...destinationTokenSet].some(
                              (token) => !sourceTokenSet.has(token),
                            ));
                        const noResultCue = (tokens: string[] | undefined) =>
                          tokens?.some((token) =>
                            /\b(no results?|no matches|no items|no records|nothing found|empty state|0 results)\b/i.test(
                              token,
                            ),
                          ) || false;
                        const sourceNoResult = noResultCue(sourceTokens);
                        const destinationNoResult =
                          noResultCue(destinationTokens);
                        const resultShapeSummary = !hasStructureEvidence
                          ? "Unknown: before/after structure evidence is missing"
                          : destinationNoResult && !sourceNoResult
                            ? "Possible no-result cue appeared in captured structure"
                            : sourceNoResult && !destinationNoResult
                              ? "Possible no-result cue was no longer captured after the action"
                              : destinationNoResult
                                ? "Possible no-result cue remains in captured structure"
                                : structureChanged
                                  ? "Captured structure changed; a result-shape change is inferred"
                                  : "No structure change detected; result contents are unknown";
                        const browserEvidence = action.browserEvidence;
                        const browserSummary = browserEvidence
                          ? `Browser counts · search controls ${browserEvidence.before.searchControlCount}→${browserEvidence.after.searchControlCount} · filters ${browserEvidence.before.filterControlCount}→${browserEvidence.after.filterControlCount} · result candidates ${browserEvidence.before.resultItemCount}→${browserEvidence.after.resultItemCount} · empty cues ${browserEvidence.before.emptyCueCount}→${browserEvidence.after.emptyCueCount}`
                          : "Browser-level result counts not captured for this older action";
                        const routeStateSummary =
                          !source || !destination
                            ? "Unknown: before or after state not captured"
                            : source.id === destination.id
                              ? "Same observed state · " + routeOf(source)
                              : routeOf(source) === routeOf(destination)
                                ? "State changed within " + routeOf(source)
                                : "Route changed: " +
                                  routeOf(source) +
                                  " → " +
                                  routeOf(destination);
                        const apiStatusCounts = {
                          success: calls.filter(
                            (call) =>
                              call.status !== undefined &&
                              call.status >= 200 &&
                              call.status < 300 &&
                              !call.failed,
                          ).length,
                          error: calls.filter(
                            (call) =>
                              call.failed ||
                              (call.status !== undefined && call.status >= 400),
                          ).length,
                          other: calls.filter(
                            (call) =>
                              !call.failed &&
                              call.status !== undefined &&
                              (call.status < 200 || call.status >= 300) &&
                              call.status < 400,
                          ).length,
                          unknown: calls.filter(
                            (call) => call.status === undefined,
                          ).length,
                        };
                        const apiSummary = calls.length
                          ? calls.length +
                            " linked API call(s) · " +
                            apiStatusCounts.success +
                            " 2xx · " +
                            apiStatusCounts.error +
                            " failed/error · " +
                            apiStatusCounts.other +
                            " other status · " +
                            apiStatusCounts.unknown +
                            " status unknown"
                          : "No action-linked API call captured";
                        return (
                          <Selectable
                            key={action.id}
                            kind="action"
                            id={action.id}
                            onSelect={onSelect}
                            className="wql-row-button wql-search-action"
                          >
                            <span
                              className={`wql-kind ${action.decision === "failed" ? "is-error" : ""}`}
                            >
                              {action.action} ·{" "}
                              {action.decision.replaceAll("_", " ")}
                            </span>
                            <span className="wql-main">
                              <strong>
                                {action.targetName ||
                                  "Search/filter interaction"}
                              </strong>
                              <small>
                                {routeOf(stateById.get(action.fromStateId))} →{" "}
                                {destination
                                  ? stateLabel(destination)
                                  : "No resulting screen recorded"}{" "}
                                · {calls.length} action-linked API call(s)
                              </small>
                              <small className="wql-search-evidence">
                                Inferred result shape: {resultShapeSummary}
                                {hasStructureEvidence
                                  ? " · " +
                                    sharedTokenCount +
                                    "/" +
                                    tokenUnionCount +
                                    " shared structure tokens"
                                  : ""}
                              </small>
                              <small className="wql-search-evidence">{browserSummary}</small>
                              <small className="wql-search-evidence">
                                Observed navigation: {routeStateSummary}
                              </small>
                              <small className="wql-search-evidence">
                                Linked API status/count: {apiSummary}
                              </small>
                            </span>
                            {calls.length > 0 && (
                              <span className="wql-chip">
                                {calls
                                  .map(
                                    (call) =>
                                      `${call.method.toUpperCase()} ${endpoint(call.url)}`,
                                  )
                                  .join("; ")}
                              </span>
                            )}
                          </Selectable>
                        );
                      })
                    ) : (
                      <p className="wql-empty-inline">
                        No action was recorded for this candidate control; it
                        may still have behavior that was not captured.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No search/filter candidates found"
              detail="No captured control names, roles, or input types identify a search/filter candidate."
            />
          )}
          {browserSearchActions.length > 0 && (
            <div className="wql-card">
              <h3>Browser-observed search and filter changes</h3>
              <p className="wql-note">Result candidates count visible list rows, list items, articles, and table rows in the main region. Empty cues use conventional accessibility/test selectors. These are structural counts, not proof of the meaning of a result set.</p>
              {browserSearchActions.slice(0, 100).map((action) => {
                const evidence = action.browserEvidence!;
                return <Selectable key={action.id} kind="action" id={action.id} onSelect={onSelect} className="wql-row-button">
                  <span className="wql-kind">{action.decision.replaceAll("_", " ")}</span>
                  <span className="wql-main"><strong>{action.action} · {action.targetName || "search/filter control"}</strong><small>Result candidates {evidence.before.resultItemCount} → {evidence.after.resultItemCount} · empty cues {evidence.before.emptyCueCount} → {evidence.after.emptyCueCount} · status regions {evidence.before.statusCount} → {evidence.after.statusCount}</small></span>
                </Selectable>;
              })}
            </div>
          )}
        </>
      );
    }

    // Similarity is an inference. Captured component family/kind signals add
    // evidence where available; they do not establish shared implementation.
    const tokensByRoute = new Map<string, { structure: Set<string>; components: Set<string> }>();
    for (const state of states) {
      const features = tokensByRoute.get(routeOf(state)) || {
        structure: new Set<string>(),
        components: new Set<string>(),
      };
      state.structureTokens.forEach((token) => features.structure.add(token));
      for (const component of data.components.filter((item) => item.stateId === state.id)) {
        features.components.add(`kind:${component.kind}`);
        if (component.familyId) features.components.add(`family:${component.familyId}`);
      }
      tokensByRoute.set(routeOf(state), features);
    }
    const routes = [...tokensByRoute.entries()];
    const pairs: { a: string; b: string; score: number; overlap: number; componentOverlap: number; structureOverlap: number }[] =
      [];
    for (let i = 0; i < routes.length; i++)
      for (let j = i + 1; j < routes.length; j++) {
        const [a, left] = routes[i];
        const [b, right] = routes[j];
        const allLeft = new Set([...left.structure, ...left.components]);
        const allRight = new Set([...right.structure, ...right.components]);
        const overlap = [...allLeft].filter((token) => allRight.has(token)).length;
        const componentOverlap = [...left.components].filter((token) => right.components.has(token)).length;
        const structureOverlap = [...left.structure].filter((token) => right.structure.has(token)).length;
        const union = new Set([...allLeft, ...allRight]).size;
        pairs.push({ a, b, overlap, componentOverlap, structureOverlap, score: union ? overlap / union : 0 });
      }
    const matches = pairs
      .filter((pair) => textMatch([pair.a, pair.b], normalizedQuery))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
    return (
      <>
        <div className="wql-metrics">
          <Metric label="Routes compared" value={routes.length} />
          <Metric label="Route pairs" value={pairs.length} />
          <Metric
            label="Pairs with shared tokens"
            value={pairs.filter((pair) => pair.overlap > 0).length}
          />
          <Metric
            label="Routes with component signals"
            value={[...tokensByRoute.values()].filter((features) => features.components.size > 0).length}
            help="Captured component kinds or family IDs"
          />
        </div>
        <div className="wql-note">
          Similarity is inferred from overlap in captured structure tokens and,
          where available, component kinds and family IDs. It indicates
          observed structural overlap only, not equivalent behavior or shared
          implementation. Routes without component signals use structure
          tokens only.
        </div>
        {matches.length ? (
          <div className="wql-card">
            <h3>Inferred route similarity</h3>
            {matches.map((pair) => (
              <Row key={`${pair.a}\u0000${pair.b}`}>
                <span className="wql-main">
                  <strong>
                    {pair.a} ↔ {pair.b}
                  </strong>
                    <small>{pair.structureOverlap} shared structure token(s) · {pair.componentOverlap} shared component signal(s)</small>
                </span>
                <span className="wql-similarity">
                  <b>{Math.round(pair.score * 100)}%</b>
                  <i>
                    <span
                      style={{ width: `${Math.round(pair.score * 100)}%` }}
                    />
                  </i>
                </span>
              </Row>
            ))}
          </div>
        ) : (
          <Empty
            title={
              pairs.length
                ? "No route pairs match"
                : "Not enough routes to compare"
            }
            detail={
              pairs.length
                ? "Adjust the search to see matching pairs."
                : "Route similarity needs at least two observed routes."
            }
          />
        )}
      </>
    );
  })();

  return (
    <section
      className="workflow-quality-lens"
      aria-label="Workflow and data quality lenses"
    >
      <header className="wql-header">
        <div>
          <span className="wql-eyebrow">Workflow quality</span>
          <h2>{activeMode.label}</h2>
          <p>{activeMode.description}</p>
        </div>
        <label className="wql-search">
          <span className="sr-only">Search current quality view</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this view"
            type="search"
          />
          <span aria-hidden="true">⌕</span>
        </label>
      </header>
      <div
        className="wql-mode-tabs"
        role="tablist"
        aria-label="Workflow quality views"
      >
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            aria-controls="wql-panel"
            id={`wql-tab-${item.id}`}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="wql-panel"
        role="tabpanel"
        id="wql-panel"
        aria-labelledby={`wql-tab-${mode}`}
      >
        {content}
      </div>
    </section>
  );
}
