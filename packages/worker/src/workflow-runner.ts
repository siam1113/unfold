// Automation: Workflow tab. See apps/server/src/automation-workflows.ts for
// the route-facing logic that persists a WorkflowRun; this module owns only
// the actual browser execution of a workflow's steps. Mirrors the launch
// pattern in apps/server/src/browse-session.ts ("launch" mode: fresh
// headless browser + fresh context) and reuses `stabilize` from ./observe
// for selector-less `waitFor` steps. Deliberately does not use the
// discovery-specific LocatorCandidate/resolveTarget machinery in
// ./observe.ts — workflow steps already carry one explicit selector chosen
// by the workflow author, so there is nothing to score or disambiguate.
import { chromium, type Page, type BrowserContext } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { artifactRoot } from "../../storage/src/index.js";
import type {
  AutomationWorkflow,
  Project,
  WorkflowStep,
  WorkflowStepResult,
} from "../../shared/src/index.js";
import { stabilize, trackPageRequests } from "./observe.js";

/** Resolves a step's URL against the project's base URL; absolute URLs pass through unchanged. */
function resolveUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

/** Executes one step's action against the live page/context. Throws on failure; callers decide what that means for the run. */
export async function executeStep(
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  step: WorkflowStep,
): Promise<void> {
  switch (step.type) {
    case "navigate":
      await page.goto(resolveUrl(step.url, baseUrl));
      return;
    case "click":
      await page.locator(step.selector).click();
      return;
    case "fill":
      await page.locator(step.selector).fill(step.value);
      return;
    case "waitFor":
      if (step.text)
        await page.getByText(step.text).waitFor({ timeout: step.ms ?? 10000 });
      else if (step.selector)
        await page
          .locator(step.selector)
          .waitFor({ timeout: step.ms ?? 10000 });
      else await stabilize(page, step.ms ?? 1000);
      return;
    case "assertText": {
      const text = await page.locator(step.selector).innerText();
      if (!text.includes(step.expected))
        throw new Error(
          `Expected text to include ${JSON.stringify(step.expected)}, got ${JSON.stringify(text)}`,
        );
      return;
    }
    case "apiCall": {
      const response = await context.request.fetch(
        resolveUrl(step.url, baseUrl),
        { method: step.method },
      );
      if (
        step.expectedStatus !== undefined &&
        response.status() !== step.expectedStatus
      )
        throw new Error(
          `Expected status ${step.expectedStatus}, got ${response.status()}`,
        );
      return;
    }
  }
}

/**
 * Runs a discovery run's setupSteps sequentially against an already-open
 * page/context (packages/core/src/index.ts's Coordinator.start() owns
 * opening/closing that context and exporting its storageState() afterward —
 * this function only executes the steps). Throws on the first failing step;
 * the caller decides what that means for the run.
 */
export async function runSetupSteps(
  context: BrowserContext,
  page: Page,
  baseUrl: string,
  steps: WorkflowStep[],
  onEvent?: (message: string) => void,
): Promise<void> {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    onEvent?.(
      `Setup step ${index + 1}/${steps.length}: ${step.type}${
        step.description ? ` — ${step.description}` : ""
      }`,
    );
    try {
      await executeStep(page, context, baseUrl, step);
    } catch (error) {
      throw new Error(
        `Setup step ${index + 1}/${steps.length} (${step.type}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Best-effort screenshot capture after a step succeeds; never fails the step. */
async function captureStepEvidence(
  page: Page,
  runId: string,
  stepIndex: number,
): Promise<string | undefined> {
  try {
    const buf = await page.screenshot();
    const relativePath = `automation-workflows/${runId}/step-${stepIndex}.png`;
    const absolutePath = resolve(artifactRoot(), relativePath);
    await mkdir(resolve(artifactRoot(), "automation-workflows", runId), {
      recursive: true,
    });
    await writeFile(absolutePath, buf);
    return relativePath;
  } catch {
    return undefined;
  }
}

export async function runWorkflowSteps(
  project: Project,
  workflow: AutomationWorkflow,
  runId: string,
  /**
   * Called after every step status transition (running -> passed/failed, or
   * the batch of skips after a failure) with a snapshot of the current
   * stepResults, so the caller can persist live progress instead of only
   * the terminal result — the run record already exists in the DB by the
   * time this is first called, so the dashboard can poll it mid-flight.
   */
  onProgress?: (stepResults: WorkflowStepResult[]) => void,
): Promise<{
  stepResults: WorkflowStepResult[];
  outcomeMet: boolean;
  error?: string;
}> {
  const stepResults: WorkflowStepResult[] = workflow.steps.map(
    (_, stepIndex) => ({ stepIndex, status: "pending" as const }),
  );
  const reportProgress = () =>
    onProgress?.(stepResults.map((result) => ({ ...result })));

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      trackPageRequests(page);

      for (let index = 0; index < workflow.steps.length; index++) {
        const step = workflow.steps[index];
        const result = stepResults[index];
        result.status = "running";
        result.startedAt = new Date().toISOString();
        reportProgress();
        try {
          await executeStep(page, context, project.baseUrl, step);
          result.status = "passed";
          result.finishedAt = new Date().toISOString();
          result.evidenceId = await captureStepEvidence(page, runId, index);
          reportProgress();
        } catch (error) {
          result.status = "failed";
          result.finishedAt = new Date().toISOString();
          result.error = error instanceof Error ? error.message : "Step failed";
          for (let skip = index + 1; skip < stepResults.length; skip++)
            stepResults[skip].status = "skipped";
          reportProgress();
          return { stepResults, outcomeMet: false };
        }
      }

      if (!workflow.outcome.assertion) return { stepResults, outcomeMet: true };

      try {
        await executeStep(
          page,
          context,
          project.baseUrl,
          workflow.outcome.assertion,
        );
        return { stepResults, outcomeMet: true };
      } catch {
        return { stepResults, outcomeMet: false };
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      stepResults,
      outcomeMet: false,
      error:
        error instanceof Error
          ? error.message
          : "Workflow run failed unexpectedly",
    };
  }
}
