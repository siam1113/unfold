// Automation: Workflow tab. Route logic for the Workflow half of the
// Automation feature, factored out the same way apps/server/src/capabilities.ts
// is: plain exported functions taking a Store and already-ownership-checked
// ids/Project, no Express. apps/server/src/index.ts wires these onto HTTP
// routes and owns the `store.project(id, ownerId)` ownership check before
// calling in here.
import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/storage/src/index.js";
import { runWorkflowSteps } from "../../../packages/worker/src/workflow-runner.js";
import type {
  AutomationWorkflow,
  Project,
  WorkflowRun,
  WorkflowStep,
} from "../../../packages/shared/src/index.js";

export function listWorkflows(
  store: Store,
  projectId: string,
  ownerId: string,
): AutomationWorkflow[] {
  return store.automationWorkflows(projectId, ownerId);
}

export function createWorkflow(
  store: Store,
  projectId: string,
  ownerId: string,
  input: {
    name: string;
    description?: string;
    steps: WorkflowStep[];
    outcome: { description: string; assertion?: WorkflowStep };
  },
): AutomationWorkflow {
  const now = new Date().toISOString();
  const workflow: AutomationWorkflow = {
    id: randomUUID(),
    projectId,
    ownerId,
    name: input.name,
    description: input.description,
    steps: input.steps,
    outcome: input.outcome,
    createdAt: now,
    updatedAt: now,
  };
  return store.createAutomationWorkflow(workflow);
}

export function getWorkflow(
  store: Store,
  id: string,
  ownerId: string,
): AutomationWorkflow {
  const workflow = store.automationWorkflow(id, ownerId);
  if (!workflow) throw new Error("Workflow not found");
  return workflow;
}

export function updateWorkflow(
  store: Store,
  id: string,
  ownerId: string,
  patch: Partial<
    Pick<AutomationWorkflow, "name" | "description" | "steps" | "outcome">
  >,
): AutomationWorkflow {
  return store.updateAutomationWorkflow(
    id,
    { ...patch, updatedAt: new Date().toISOString() },
    ownerId,
  );
}

export function deleteWorkflow(
  store: Store,
  id: string,
  ownerId: string,
): void {
  store.deleteAutomationWorkflow(id, ownerId);
}

/**
 * Starts a workflow run in a real browser and returns immediately with the
 * initial (all-pending) run record — execution continues in the background,
 * persisting live per-step progress as it goes (via runWorkflowSteps'
 * onProgress callback) and the terminal status/outcome once it finishes.
 * The dashboard polls GET .../runs/:runId to watch it progress rather than
 * blocking the POST on the whole run, which could take as long as the
 * workflow's slowest step.
 *
 * Only throws for programmer errors (workflow not found) that the route
 * layer should map to an HTTP error — execution failures during the run
 * itself are captured in the persisted WorkflowRun's `status`/`error`
 * fields instead, since a workflow failing is an expected, recordable
 * outcome, not an exceptional one.
 */
export function runWorkflow(
  store: Store,
  project: Project,
  workflowId: string,
  ownerId: string,
): WorkflowRun {
  const workflow = store.automationWorkflow(workflowId, ownerId);
  if (!workflow) throw new Error("Workflow not found");

  const run: WorkflowRun = {
    id: randomUUID(),
    workflowId,
    projectId: project.id,
    ownerId,
    status: "running",
    startedAt: new Date().toISOString(),
    stepResults: workflow.steps.map((_, stepIndex) => ({
      stepIndex,
      status: "pending" as const,
    })),
  };
  store.createWorkflowRun(run);

  void runWorkflowSteps(project, workflow, run.id, (stepResults) => {
    try {
      store.updateWorkflowRun(run.id, { stepResults }, ownerId);
    } catch {
      // The run (or its workflow) may have been deleted mid-flight; drop
      // the update rather than crash a detached background task.
    }
  })
    .then((result) => {
      store.updateWorkflowRun(
        run.id,
        {
          status: result.error
            ? "error"
            : result.outcomeMet
              ? "passed"
              : "failed",
          finishedAt: new Date().toISOString(),
          stepResults: result.stepResults,
          outcomeMet: result.outcomeMet,
          error: result.error,
        },
        ownerId,
      );
    })
    .catch((error) => {
      try {
        store.updateWorkflowRun(
          run.id,
          {
            status: "error",
            finishedAt: new Date().toISOString(),
            error:
              error instanceof Error
                ? error.message
                : "Workflow run crashed unexpectedly.",
          },
          ownerId,
        );
      } catch {
        // Run already gone — nothing to persist.
      }
    });

  return run;
}

export function getWorkflowRun(
  store: Store,
  id: string,
  ownerId: string,
): WorkflowRun {
  const run = store.workflowRun(id, ownerId);
  if (!run) throw new Error("Workflow run not found");
  return run;
}

export function listWorkflowRuns(
  store: Store,
  workflowId: string,
  ownerId: string,
): WorkflowRun[] {
  return store.workflowRuns(workflowId, ownerId);
}
