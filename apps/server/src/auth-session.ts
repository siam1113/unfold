// Headless session refresh: replays a project's recorded/edited login
// recipe (`project.scanConfig.setupSteps` — the same WorkflowStep
// vocabulary and `runSetupSteps` execution engine discovery's own setup
// steps already use, packages/worker/src/workflow-runner.ts) against a
// fresh headless browser, and saves the resulting storageState as the
// project's CANONICAL session file (always the same path, unlike
// apps/server/src/auth-capture.ts's manual flow which timestamps a new
// file per capture — a refresh replaces, it doesn't accumulate).
//
// This is what turns "the captured session expired, verification is stuck
// failing for auth reasons until someone re-runs discovery" into a one-click
// (or fully automatable) action: see packages/verification/src/runner.ts's
// resolveAuthStatePath, which now prefers this project-level path over
// whatever a specific past discovery run's own config froze in at crawl
// time.
//
// Secrets (any `secret: true` fill step's real value — see
// WorkflowStepSchema's `fill` variant and `executeStep`'s doc comment) are
// supplied fresh by the caller for each refresh, in memory only: never
// read from or written to the project record, never logged.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  artifactRoot,
  type Store,
} from "../../../packages/storage/src/index.js";
import { runSetupSteps } from "../../../packages/worker/src/workflow-runner.js";

export class NoLoginRecipeError extends Error {}
export class MissingSecretError extends Error {}

export interface RefreshSessionResult {
  cookieCount: number;
  domains: string[];
}

export async function refreshProjectAuthSession(
  store: Store,
  projectId: string,
  ownerId: string,
  secrets: Record<number, string> = {},
  onEvent?: (message: string) => void,
): Promise<RefreshSessionResult> {
  const project = store.project(projectId, ownerId);
  const steps = project.scanConfig.setupSteps;
  if (!steps.length)
    throw new NoLoginRecipeError(
      "This project has no login recipe yet — capture a login session first, then save it as the project's recipe, before refreshing.",
    );

  const missing = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === "fill" && step.secret)
    .filter(({ index }) => !secrets[index]?.length);
  if (missing.length)
    throw new MissingSecretError(
      `Missing a value for ${missing.length === 1 ? "a secret field" : `${missing.length} secret fields`} in the login recipe (step ${missing
        .map(({ index }) => index + 1)
        .join(
          ", ",
        )}) — supply it fresh each time you refresh, it's never stored.`,
    );

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
  });
  try {
    const existingPath = project.scanConfig.authStatePath;
    const context = await browser.newContext({
      storageState:
        existingPath && existsSync(existingPath) ? existingPath : undefined,
    });
    // Same budget a regular discovery action gets (see
    // packages/core/src/index.ts's Coordinator.start(), which applies this
    // identically to its own setup-steps context) — otherwise a bad
    // selector in the recipe hangs on Playwright's 30s default instead of
    // failing fast with a clear error.
    context.setDefaultTimeout(project.scanConfig.actionTimeoutMs);
    context.setDefaultNavigationTimeout(project.scanConfig.actionTimeoutMs);
    const page = await context.newPage();
    try {
      await runSetupSteps(
        context,
        page,
        project.baseUrl,
        steps,
        onEvent,
        secrets,
      );
      const state = await context.storageState();
      const path = resolve(
        artifactRoot(),
        "projects",
        projectId,
        "auth-state.json",
      );
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(state));
      await chmod(path, 0o600);
      store.updateProjectAuthStatePath(projectId, path, ownerId);

      const domains = new Set<string>();
      for (const cookie of state.cookies)
        domains.add(cookie.domain.replace(/^\./, ""));
      for (const origin of state.origins)
        try {
          domains.add(new URL(origin.origin).hostname);
        } catch {
          // Ignore an unparseable origin rather than failing the whole refresh.
        }
      return {
        cookieCount: state.cookies.length,
        domains: [...domains].sort(),
      };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
