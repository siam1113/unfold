import { describe, it, expect } from "vitest";
import {
  mineReadOnlyCapabilities,
  mineWriteCapabilities,
  mineUIOutcomeCapabilities,
} from "../packages/capability-core/src/miner.js";
import { ConfigSchema } from "../packages/shared/src/index.js";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  RunData,
  UIElement,
} from "../packages/shared/src/index.js";

const config = ConfigSchema.parse({ baseUrl: "http://127.0.0.1:4174" });
const runId = "run-1";

const box = { x: 0, y: 0, width: 10, height: 10 };
const recipe = { id: "r1", seed: "http://127.0.0.1:4174/projects", steps: [] };

const projectsState: AppState = {
  id: "state-projects",
  runId,
  url: "http://127.0.0.1:4174/projects",
  routeKey: "/projects",
  fingerprint: "fp-projects",
  fingerprintVersion: 1,
  fingerprintReason: "structure",
  structureTokens: [],
  title: "Projects",
  visibleRegionSummary: [],
  interactiveElementIds: ["search-input", "apply-filters", "delete-button"],
  discoveredAt: new Date().toISOString(),
  depth: 1,
  worker: 0,
  recipe,
  mainText: "Projects",
};

const searchInput: UIElement = {
  id: "search-input",
  stateId: projectsState.id,
  role: "textbox",
  accessibleName: "Project name",
  tag: "input",
  textSnippet: "",
  structuralSignature: "input#search",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  inputType: "text",
  box,
};

const applyFiltersElement: UIElement = {
  id: "apply-filters-el",
  stateId: projectsState.id,
  role: "button",
  accessibleName: "Apply filters",
  tag: "button",
  textSnippet: "Apply filters",
  structuralSignature: "button#apply-filters",
  locatorCandidates: [],
  disabled: false,
  isSubmit: true,
  box,
};

const deleteElement: UIElement = {
  id: "delete-el",
  stateId: projectsState.id,
  role: "button",
  accessibleName: "Delete project",
  tag: "button",
  textSnippet: "Delete project",
  structuralSignature: "button#delete",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  box,
};

const basePolicy = {
  allowed: true,
  reason: "allowed",
  rule: "default",
  intent: "unknown" as const,
};

const applyFiltersAction: ActionEdge = {
  id: "action-apply-filters",
  runId,
  fromStateId: projectsState.id,
  toStateId: projectsState.id,
  elementId: applyFiltersElement.id,
  targetName: "Apply filters",
  action: "click",
  effectFlags: [],
  decision: "executed",
  restoreRecipeId: recipe.id,
  evidencePaths: [],
  policy: basePolicy,
  worker: 0,
  depth: 1,
  createdAt: new Date().toISOString(),
  confidence: 1,
  intent: "unknown",
  signals: [],
  beforeUrl: projectsState.url,
  afterUrl: projectsState.url,
};

const deleteAction: ActionEdge = {
  ...applyFiltersAction,
  id: "action-delete",
  elementId: deleteElement.id,
  targetName: "Delete project",
};

const searchApiCall: ApiCall = {
  id: "call-1",
  runId,
  taskId: "task-search",
  actionId: applyFiltersAction.id,
  sequence: 0,
  method: "GET",
  url: "http://127.0.0.1:4174/api/projects?query=Mobile",
  resourceType: "fetch",
  status: 200,
  failed: false,
};

const deleteApiCall: ApiCall = {
  id: "call-2",
  runId,
  taskId: "task-delete",
  actionId: deleteAction.id,
  sequence: 0,
  method: "POST",
  url: "http://127.0.0.1:4174/api/delete",
  resourceType: "fetch",
  status: 200,
  failed: false,
};

const run: RunData = {
  run: {
    id: runId,
    name: "test run",
    status: "completed",
    config,
    createdAt: new Date().toISOString(),
    elapsedMs: 0,
    stats: {
      states: 1,
      routes: 1,
      actions: 2,
      executed: 2,
      blocked: 0,
      failed: 0,
      components: 0,
      elements: 3,
      verified: 0,
      pending: 0,
      active: 0,
    },
  },
  states: [projectsState],
  elements: [searchInput, applyFiltersElement, deleteElement],
  components: [],
  actions: [applyFiltersAction, deleteAction],
  apiCalls: [searchApiCall, deleteApiCall],
  tasks: [],
  events: [],
};

describe("mineReadOnlyCapabilities", () => {
  it("derives exactly one read-only candidate from a GET-correlated fill+submit flow", () => {
    const candidates = mineReadOnlyCapabilities(run, "project-1");
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.capability.risk).toBe("read");
    expect(candidate.capability.status).toBe("candidate");
    expect(candidate.capability.name).toBe("Click Apply Filters");
    expect(candidate.capability.inputSchema).toMatchObject({
      type: "object",
      properties: { project_name: { type: "string" } },
      required: ["project_name"],
    });
    expect(candidate.flow.startUrl).toBe(projectsState.url);
  });

  it("never mines a candidate from a write (POST) flow like /api/delete", () => {
    const candidates = mineReadOnlyCapabilities(run, "project-1");
    expect(candidates.some((c) => c.capability.name.includes("delete"))).toBe(
      false,
    );
  });

  it("defaults preconditions to empty when the run used no captured session or setup steps", () => {
    const [candidate] = mineReadOnlyCapabilities(run, "project-1");
    expect(candidate.capability.preconditions).toEqual([]);
  });

  it("defaults an authenticated-session precondition when the run used a captured login (authStatePath)", () => {
    const authedRun: RunData = {
      ...run,
      run: {
        ...run.run,
        config: { ...config, authStatePath: "/tmp/auth-state.json" },
      },
    };
    const [candidate] = mineReadOnlyCapabilities(authedRun, "project-1");
    expect(candidate.capability.preconditions).toEqual([
      "Requires an authenticated session (this capability's evidence run used a captured login or setup steps to establish one)",
    ]);
  });

  it("defaults an authenticated-session precondition when the run used setup steps", () => {
    const setupStepsRun: RunData = {
      ...run,
      run: {
        ...run.run,
        config: {
          ...config,
          setupSteps: [{ type: "click" as const, selector: "#login" }],
        },
      },
    };
    const [candidate] = mineReadOnlyCapabilities(setupStepsRun, "project-1");
    expect(candidate.capability.preconditions).toHaveLength(1);
  });
});

const newProjectNameInput: UIElement = {
  id: "new-project-name-input",
  stateId: projectsState.id,
  role: "textbox",
  accessibleName: "New project name",
  tag: "input",
  textSnippet: "",
  structuralSignature: "input#new-project-name",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  inputType: "text",
  box,
};

const createProjectElement: UIElement = {
  id: "create-project-el",
  stateId: projectsState.id,
  role: "button",
  accessibleName: "Create project",
  tag: "button",
  textSnippet: "Create project",
  structuralSignature: "button#create-project",
  locatorCandidates: [],
  disabled: false,
  isSubmit: true,
  box,
};

const createProjectAction: ActionEdge = {
  ...applyFiltersAction,
  id: "action-create-project",
  elementId: createProjectElement.id,
  targetName: "Create project",
};

const createProjectApiCall: ApiCall = {
  id: "call-3",
  runId,
  taskId: "task-create-project",
  actionId: createProjectAction.id,
  sequence: 0,
  method: "POST",
  url: "http://127.0.0.1:4174/api/projects",
  resourceType: "fetch",
  status: 201,
  failed: false,
};

// Deliberately excludes the GET-only `task-search`/`applyFiltersAction` and
// the pre-existing write `task-delete`/`deleteAction` fixtures above (both
// also trigger from `projectsState`, which has a fillable input) so the
// "exactly one candidate" assertion below isn't confounded by an unrelated
// second mutation task also qualifying.
const writeRun: RunData = {
  ...run,
  elements: [searchInput, newProjectNameInput, createProjectElement],
  actions: [createProjectAction],
  apiCalls: [createProjectApiCall],
};

describe("mineWriteCapabilities", () => {
  it("never mines a candidate from a GET-only task — that's the read miner's job", () => {
    const candidates = mineWriteCapabilities(run, "project-1");
    expect(
      candidates.some((c) =>
        c.capability.dependencies.includes(
          applyFiltersElement.structuralSignature,
        ),
      ),
    ).toBe(false);
  });

  it("derives exactly one candidate/reversible_write capability from a POST task with a fillable input", () => {
    const candidates = mineWriteCapabilities(writeRun, "project-1");
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.capability.status).toBe("candidate");
    expect(candidate.capability.risk).toBe("reversible_write");
    expect(candidate.capability.dependencies).toContain(
      createProjectElement.structuralSignature,
    );
    expect(candidate.flow.expectedRequest).toEqual({
      method: "POST",
      urlPattern: "/api/projects",
    });
  });

  it("produces a flow with a sensible composite kind", () => {
    const [candidate] = mineWriteCapabilities(writeRun, "project-1");
    expect(candidate.flow.kind).toBe("composite");
  });

  it("fills every fillable field in the triggering state, not just the first one", () => {
    // writeRun's projectsState has two fillable inputs (searchInput "Project
    // name" and newProjectNameInput "New project name") — the old
    // `fillable[0]`-only logic would discard the second one entirely.
    const [candidate] = mineWriteCapabilities(writeRun, "project-1");
    const fillSteps = candidate.flow.steps.filter((s) => s.action === "fill");
    expect(fillSteps).toHaveLength(2);
    expect(candidate.capability.inputSchema).toMatchObject({
      properties: {
        project_name: { type: "string" },
        new_project_name: { type: "string" },
      },
      required: expect.arrayContaining(["project_name", "new_project_name"]),
    });
    // Trigger step is last, after every fill step.
    expect(candidate.flow.steps.at(-1)?.action).toBe("click");
  });

  it("rejects a mutation whose only available trigger is uncorrelated (plan §8: weak/none correlation never verifies a write)", () => {
    // Same taskId group, but the POST has no actionId of its own — before
    // wiring in classifyCorrelation, the miner fell back to
    // `sorted[0].actionId` (an unrelated GET's action in the same task
    // window) with no check that the mutation itself actually correlates
    // with that action. Neither actionId nor taskId match, and no
    // `observedAt` is set, so classifyCorrelation has nothing to go on but
    // "none" — this must now be rejected instead of silently mined.
    const unrelatedAction: ActionEdge = {
      ...applyFiltersAction,
      id: "action-unrelated",
      elementId: createProjectElement.id,
      targetName: "Create project",
    };
    const unrelatedGetCall: ApiCall = {
      id: "call-unrelated-get",
      runId,
      taskId: "task-mixed",
      actionId: unrelatedAction.id,
      sequence: 0,
      method: "GET",
      url: "http://127.0.0.1:4174/api/unrelated",
      resourceType: "fetch",
      status: 200,
      failed: false,
    };
    const uncorrelatedMutationCall: ApiCall = {
      id: "call-mutation-no-actionid",
      runId,
      taskId: "task-mixed",
      sequence: 1,
      method: "POST",
      url: "http://127.0.0.1:4174/api/projects",
      resourceType: "fetch",
      status: 201,
      failed: false,
    };
    const mixedRun: RunData = {
      ...run,
      elements: [searchInput, newProjectNameInput, createProjectElement],
      actions: [unrelatedAction],
      apiCalls: [unrelatedGetCall, uncorrelatedMutationCall],
    };
    expect(mineWriteCapabilities(mixedRun, "project-1")).toHaveLength(0);
  });
});

const homeState: AppState = {
  id: "state-home",
  runId,
  url: "http://127.0.0.1:4174/home",
  routeKey: "/home",
  fingerprint: "fp-home",
  fingerprintVersion: 1,
  fingerprintReason: "structure",
  structureTokens: [],
  title: "Home",
  visibleRegionSummary: [],
  interactiveElementIds: ["checkout-button"],
  discoveredAt: new Date().toISOString(),
  depth: 1,
  worker: 0,
  recipe,
  mainText: "Home",
};

const checkoutState: AppState = {
  ...homeState,
  id: "state-checkout-page",
  url: "http://127.0.0.1:4174/checkout",
  routeKey: "/checkout",
  fingerprint: "fp-checkout",
  title: "Checkout",
  mainText: "Checkout",
};

const checkoutButtonElement: UIElement = {
  id: "checkout-button",
  stateId: homeState.id,
  role: "button",
  accessibleName: "Check Out",
  tag: "button",
  textSnippet: "Check Out",
  structuralSignature: "button#checkout",
  locatorCandidates: [],
  disabled: false,
  isSubmit: true,
  box,
};

const promoCodeInput: UIElement = {
  id: "promo-code-input",
  stateId: homeState.id,
  role: "textbox",
  accessibleName: "Promo code",
  tag: "input",
  textSnippet: "",
  structuralSignature: "input#promo-code",
  locatorCandidates: [],
  disabled: false,
  isSubmit: false,
  inputType: "text",
  box,
};

// This full-page-navigation click (no XHR/fetch involved at all) is exactly
// the "create order" shape that mineReadOnlyCapabilities/mineWriteCapabilities
// mine zero candidates from — classifyUIOutcome's fingerprint-change check is
// the only thing that recognizes it happened.
const checkoutAction: ActionEdge = {
  ...applyFiltersAction,
  id: "action-checkout",
  fromStateId: homeState.id,
  toStateId: checkoutState.id,
  elementId: checkoutButtonElement.id,
  targetName: "Check Out",
  beforeUrl: homeState.url,
  afterUrl: checkoutState.url,
};

const noInputRun: RunData = {
  ...run,
  states: [homeState, checkoutState],
  elements: [checkoutButtonElement],
  actions: [checkoutAction],
  apiCalls: [],
};

describe("mineUIOutcomeCapabilities", () => {
  it("mines a trigger-only candidate from a plain click that navigates to a new, fingerprint-distinct state", () => {
    const candidates = mineUIOutcomeCapabilities(noInputRun, "project-1");
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.capability.name).toBe("Click Check Out");
    expect(candidate.capability.risk).toBe("reversible_write");
    expect(candidate.capability.status).toBe("candidate");
    expect(candidate.capability.evidenceKind).toBe("ui");
    expect(candidate.flow.steps).toHaveLength(1);
    expect(candidate.flow.expectedRequest).toBeUndefined();
    expect(candidate.flow.expectedNavigation).toEqual({
      urlPattern: "/checkout",
    });
  });

  it("mines a fill+trigger candidate when the triggering state has a fillable input", () => {
    const inputRun: RunData = {
      ...noInputRun,
      elements: [checkoutButtonElement, promoCodeInput],
    };
    const candidates = mineUIOutcomeCapabilities(inputRun, "project-1");
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.flow.steps).toHaveLength(2);
    expect(candidate.flow.steps[0].action).toBe("fill");
    expect(candidate.capability.inputSchema).toMatchObject({
      type: "object",
      properties: { promo_code: { type: "string" } },
      required: ["promo_code"],
    });
  });

  it("mines independently of, and never collides with, mineWriteCapabilities on the same trigger action", () => {
    const checkoutApiCall: ApiCall = {
      id: "call-checkout",
      runId,
      taskId: checkoutAction.id,
      actionId: checkoutAction.id,
      sequence: 0,
      method: "POST",
      url: "http://127.0.0.1:4174/api/checkout",
      resourceType: "fetch",
      status: 201,
      failed: false,
    };
    const dualEvidenceRun: RunData = {
      ...noInputRun,
      elements: [checkoutButtonElement, promoCodeInput],
      apiCalls: [checkoutApiCall],
    };
    const apiCandidates = mineWriteCapabilities(dualEvidenceRun, "project-1");
    const uiCandidates = mineUIOutcomeCapabilities(
      dualEvidenceRun,
      "project-1",
    );
    expect(apiCandidates).toHaveLength(1);
    expect(uiCandidates).toHaveLength(1);
    // Names collide now that naming is human-readable rather than
    // miner-prefixed (see apps/server/src/capabilities.ts's dedupe key,
    // which is why this is safe) — evidenceKind is what still tells them apart.
    expect(apiCandidates[0].capability.name).toBe("Click Check Out");
    expect(uiCandidates[0].capability.name).toBe("Click Check Out");
    expect(apiCandidates[0].capability.evidenceKind).toBe("api");
    expect(uiCandidates[0].capability.evidenceKind).toBe("ui");
  });

  it("auto-links requiredCapabilityIds when one candidate's startUrl unambiguously matches another's navigation destination", () => {
    // ui_check_out: home (/home) -> checkout (/checkout), already in
    // noInputRun. Add a second leg from the SAME checkout state onward, so
    // its own startUrl ("/checkout") exactly matches ui_check_out's
    // expectedNavigation.urlPattern — the one case linkRequiredCapabilities
    // should auto-link.
    const confirmationState: AppState = {
      ...homeState,
      id: "state-confirmation",
      url: "http://127.0.0.1:4174/confirmation",
      routeKey: "/confirmation",
      fingerprint: "fp-confirmation",
      title: "Confirmation",
      mainText: "Confirmation",
    };
    const confirmButtonElement: UIElement = {
      id: "confirm-button",
      stateId: checkoutState.id,
      role: "button",
      accessibleName: "Confirm order",
      tag: "button",
      textSnippet: "Confirm order",
      structuralSignature: "button#confirm",
      locatorCandidates: [],
      disabled: false,
      isSubmit: true,
      box,
    };
    const confirmAction: ActionEdge = {
      ...applyFiltersAction,
      id: "action-confirm",
      fromStateId: checkoutState.id,
      toStateId: confirmationState.id,
      elementId: confirmButtonElement.id,
      targetName: "Confirm order",
      beforeUrl: checkoutState.url,
      afterUrl: confirmationState.url,
    };
    const twoLegRun: RunData = {
      ...noInputRun,
      states: [homeState, checkoutState, confirmationState],
      elements: [checkoutButtonElement, confirmButtonElement],
      actions: [checkoutAction, confirmAction],
    };
    const candidates = mineUIOutcomeCapabilities(twoLegRun, "project-1");
    expect(candidates).toHaveLength(2);
    const checkOut = candidates.find(
      (c) => c.capability.name === "Click Check Out",
    )!;
    const confirmOrder = candidates.find(
      (c) => c.capability.name === "Click Confirm Order",
    )!;
    expect(checkOut.capability.requiredCapabilityIds).toEqual([]);
    expect(confirmOrder.capability.requiredCapabilityIds).toEqual([
      checkOut.capability.id,
    ]);
  });

  it("leaves requiredCapabilityIds empty when a candidate's startUrl matches 2+ other candidates' destinations (ambiguous)", () => {
    // Two DIFFERENT triggers both land on checkoutState — from checkout's
    // own perspective as a startUrl, "which one got me here" is ambiguous,
    // so linkRequiredCapabilities must not guess.
    const otherHomeState: AppState = {
      ...homeState,
      id: "state-other-home",
      url: "http://127.0.0.1:4174/other-home",
      routeKey: "/other-home",
      fingerprint: "fp-other-home",
      title: "Other home",
      mainText: "Other home",
    };
    const otherButtonElement: UIElement = {
      id: "other-checkout-button",
      stateId: otherHomeState.id,
      role: "button",
      accessibleName: "Go to checkout",
      tag: "button",
      textSnippet: "Go to checkout",
      structuralSignature: "button#other-checkout",
      locatorCandidates: [],
      disabled: false,
      isSubmit: true,
      box,
    };
    const otherCheckoutAction: ActionEdge = {
      ...applyFiltersAction,
      id: "action-other-checkout",
      fromStateId: otherHomeState.id,
      toStateId: checkoutState.id,
      elementId: otherButtonElement.id,
      targetName: "Go to checkout",
      beforeUrl: otherHomeState.url,
      afterUrl: checkoutState.url,
    };
    const confirmButtonElement: UIElement = {
      id: "confirm-button",
      stateId: checkoutState.id,
      role: "button",
      accessibleName: "Confirm order",
      tag: "button",
      textSnippet: "Confirm order",
      structuralSignature: "button#confirm",
      locatorCandidates: [],
      disabled: false,
      isSubmit: true,
      box,
    };
    const confirmationState: AppState = {
      ...homeState,
      id: "state-confirmation",
      url: "http://127.0.0.1:4174/confirmation",
      routeKey: "/confirmation",
      fingerprint: "fp-confirmation",
      title: "Confirmation",
      mainText: "Confirmation",
    };
    const confirmAction: ActionEdge = {
      ...applyFiltersAction,
      id: "action-confirm",
      fromStateId: checkoutState.id,
      toStateId: confirmationState.id,
      elementId: confirmButtonElement.id,
      targetName: "Confirm order",
      beforeUrl: checkoutState.url,
      afterUrl: confirmationState.url,
    };
    const ambiguousRun: RunData = {
      ...noInputRun,
      states: [homeState, otherHomeState, checkoutState, confirmationState],
      elements: [
        checkoutButtonElement,
        otherButtonElement,
        confirmButtonElement,
      ],
      actions: [checkoutAction, otherCheckoutAction, confirmAction],
    };
    const candidates = mineUIOutcomeCapabilities(ambiguousRun, "project-1");
    const confirmOrder = candidates.find(
      (c) => c.capability.name === "Click Confirm Order",
    )!;
    expect(confirmOrder.capability.requiredCapabilityIds).toEqual([]);
  });

  it("prepends the triggering state's own real path (recipe.steps) before the trigger — turns 'click X' into 'dismiss the dialog, then click X'", () => {
    // A trigger state reached only by first dismissing a dialog — its own
    // RestoreRecipe already records that one click, same as discovery
    // computed it for state-restoration purposes. The old miner never read
    // this at all, so it only ever mined the bare trigger.
    const dialogDismissSignature = "button#dismiss-dialog";
    const stateReachedViaDialog: AppState = {
      ...homeState,
      id: "state-home-via-dialog",
      recipe: {
        id: "r-dialog",
        seed: homeState.url,
        steps: [
          {
            elementSignature: dialogDismissSignature,
            locators: [],
            action: "click",
            expectedFingerprint: homeState.fingerprint,
            expectedUrl: homeState.url,
          },
        ],
      },
    };
    const checkoutViaDialogElement: UIElement = {
      ...checkoutButtonElement,
      id: "checkout-button-via-dialog",
      stateId: stateReachedViaDialog.id,
    };
    const checkoutViaDialogAction: ActionEdge = {
      ...checkoutAction,
      id: "action-checkout-via-dialog",
      fromStateId: stateReachedViaDialog.id,
      elementId: checkoutViaDialogElement.id,
    };
    const dialogRun: RunData = {
      ...run,
      states: [stateReachedViaDialog, checkoutState],
      elements: [checkoutViaDialogElement],
      actions: [checkoutViaDialogAction],
      apiCalls: [],
    };
    const [candidate] = mineUIOutcomeCapabilities(dialogRun, "project-1");
    expect(candidate.flow.steps).toHaveLength(2);
    expect(candidate.flow.steps[0]).toMatchObject({
      elementSignature: dialogDismissSignature,
      action: "click",
    });
    expect(candidate.flow.steps[1]).toMatchObject({
      elementSignature: checkoutViaDialogElement.structuralSignature,
      action: "click",
    });
    expect(candidate.flow.kind).toBe("composite");
  });
});
