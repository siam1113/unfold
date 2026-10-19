// Automation: Framework tab. Runs a FrameworkProject's Cypress/Playwright
// suite in a real subprocess and records the outcome as a TestRun. Every
// spawn below uses node:child_process spawn with shell:false and a binary +
// argv array — never exec, never a shell string — so nothing here is ever
// vulnerable to shell/command injection regardless of what's in the
// workspace or stored on the FrameworkProject.
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/storage/src/index.js";
import { artifactRoot } from "../../../packages/storage/src/index.js";
import type {
  FrameworkProject,
  PackageOperation,
  TestCaseResult,
  TestRun,
} from "../../../packages/shared/src/index.js";

interface CaptureResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawns `cmd` with `args` (always a plain argv array — never a shell string), capturing stdout/stderr and enforcing a timeout. */
function spawnAndCapture(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CaptureResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr += `\n${error.message}`;
      resolvePromise({ exitCode: null, stdout, stderr, timedOut });
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Dependency-install invocation for the project's chosen package manager. */
function installCommand(
  packageManager: FrameworkProject["packageManager"],
): [string, string[]] {
  switch (packageManager) {
    case "yarn":
      return ["yarn", ["install"]];
    case "pnpm":
      return ["pnpm", ["install"]];
    default:
      return ["npm", ["install", "--no-audit", "--no-fund"]];
  }
}

/**
 * The real test-runner invocation for the project's framework + package
 * manager. npm has no local-bin shim on PATH, so it goes through `npx`;
 * yarn resolves a local bin directly (`yarn <bin>`); pnpm needs `exec` to
 * do the same (`pnpm <bin>` alone does not reliably resolve a local bin).
 */
function testCommand(
  packageManager: FrameworkProject["packageManager"],
  framework: FrameworkProject["framework"],
): [string, string[]] {
  const args =
    framework === "playwright"
      ? ["playwright", "test", "--reporter=json"]
      : ["cypress", "run", "--reporter", "json"];
  switch (packageManager) {
    case "yarn":
      return ["yarn", args];
    case "pnpm":
      return ["pnpm", ["exec", ...args]];
    default:
      return ["npx", args];
  }
}

/**
 * Validates an npm package name per npm's own naming rules (lowercase,
 * optional @scope/, dots/dashes/underscores — never a leading dash, never
 * whitespace). Even though every spawn below uses an argv array
 * (shell:false, so no shell injection is possible), a crafted "package
 * name" like "--registry=https://evil" would otherwise be parsed as a
 * flag by npm/yarn/pnpm's own CLI argument parser once it lands in argv —
 * this blocks that class of argument-injection regardless of spawn safety.
 */
function isValidPackageName(name: string): boolean {
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
}

/** Same argument-injection concern as isValidPackageName, for the version/tag/range half of a package spec. */
function isValidVersionSpec(version: string): boolean {
  return (
    version.length > 0 &&
    version.length <= 100 &&
    !version.startsWith("-") &&
    !/\s/.test(version)
  );
}

/** Dependency add/remove invocation for the project's chosen package manager. `spec` is already validated (name, or name@version). */
function addPackageCommand(
  packageManager: FrameworkProject["packageManager"],
  spec: string,
  dev: boolean,
): [string, string[]] {
  switch (packageManager) {
    case "yarn":
      return ["yarn", ["add", ...(dev ? ["--dev"] : []), spec]];
    case "pnpm":
      return ["pnpm", ["add", ...(dev ? ["--save-dev"] : []), spec]];
    default:
      return ["npm", ["install", dev ? "--save-dev" : "--save", spec]];
  }
}
function removePackageCommand(
  packageManager: FrameworkProject["packageManager"],
  name: string,
): [string, string[]] {
  switch (packageManager) {
    case "yarn":
      return ["yarn", ["remove", name]];
    case "pnpm":
      return ["pnpm", ["remove", name]];
    default:
      return ["npm", ["uninstall", name]];
  }
}

/**
 * Adds a dependency to the FrameworkProject in the background (same
 * fire-and-forget shape as runFrameworkTests — installs can take anywhere
 * from a couple seconds to a minute) and returns immediately with the
 * initial (running) PackageOperation for the wizard to poll.
 */
export function addPackage(
  store: Store,
  frameworkProject: FrameworkProject,
  ownerId: string,
  input: { name: string; version?: string; dev?: boolean },
): PackageOperation {
  if (!isValidPackageName(input.name))
    throw new Error(`"${input.name}" is not a valid package name.`);
  if (input.version !== undefined && !isValidVersionSpec(input.version))
    throw new Error(`"${input.version}" is not a valid version/tag.`);
  const spec = input.version ? `${input.name}@${input.version}` : input.name;
  const [bin, args] = addPackageCommand(
    frameworkProject.packageManager,
    spec,
    Boolean(input.dev),
  );
  const op: PackageOperation = {
    id: randomUUID(),
    frameworkProjectId: frameworkProject.id,
    projectId: frameworkProject.projectId,
    ownerId,
    action: "add",
    packageName: input.name,
    version: input.version,
    dev: input.dev,
    status: "running",
    command: [bin, ...args].join(" "),
    startedAt: new Date().toISOString(),
  };
  store.createPackageOperation(op);
  void runPackageOperation(store, op, frameworkProject.workspacePath, bin, args);
  return op;
}

/** Removes a dependency from the FrameworkProject in the background — same shape as addPackage. */
export function removePackage(
  store: Store,
  frameworkProject: FrameworkProject,
  ownerId: string,
  name: string,
): PackageOperation {
  if (!isValidPackageName(name))
    throw new Error(`"${name}" is not a valid package name.`);
  const [bin, args] = removePackageCommand(
    frameworkProject.packageManager,
    name,
  );
  const op: PackageOperation = {
    id: randomUUID(),
    frameworkProjectId: frameworkProject.id,
    projectId: frameworkProject.projectId,
    ownerId,
    action: "remove",
    packageName: name,
    status: "running",
    command: [bin, ...args].join(" "),
    startedAt: new Date().toISOString(),
  };
  store.createPackageOperation(op);
  void runPackageOperation(store, op, frameworkProject.workspacePath, bin, args);
  return op;
}

async function runPackageOperation(
  store: Store,
  op: PackageOperation,
  cwd: string,
  bin: string,
  args: string[],
): Promise<void> {
  try {
    const result = await spawnAndCapture(bin, args, {
      cwd,
      timeoutMs: 120_000,
    });
    // Keep only the tail — enough to show the wizard what happened without
    // persisting unbounded install-log output.
    const output = (result.stdout + "\n" + result.stderr).slice(-4000);
    if (result.timedOut || result.exitCode !== 0) {
      store.updatePackageOperation(
        op.id,
        {
          status: "error",
          finishedAt: new Date().toISOString(),
          error: result.timedOut
            ? "Timed out."
            : `${bin} exited with code ${result.exitCode}.`,
          output,
        },
        op.ownerId,
      );
      return;
    }
    store.updatePackageOperation(
      op.id,
      { status: "done", finishedAt: new Date().toISOString(), output },
      op.ownerId,
    );
  } catch (error) {
    try {
      store.updatePackageOperation(
        op.id,
        {
          status: "error",
          finishedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : "Package operation failed unexpectedly.",
        },
        op.ownerId,
      );
    } catch {
      // The FrameworkProject (or operation) may have been deleted mid-flight.
    }
  }
}

/** Best-effort mapper from Playwright's `--reporter=json` output into TestCaseResult[]. Tolerant of any shape — a field it can't find is just omitted. */
function mapPlaywrightCases(parsed: any): TestCaseResult[] {
  const cases: TestCaseResult[] = [];
  const visitSuite = (suite: any) => {
    for (const spec of suite?.specs ?? []) {
      const name = spec?.title ?? "unknown test";
      const tests = spec?.tests ?? [];
      for (const test of tests) {
        const results = test?.results ?? [];
        const last = results[results.length - 1];
        const outcome = test?.status ?? last?.status;
        const status: TestCaseResult["status"] =
          outcome === "expected" || outcome === "passed"
            ? "passed"
            : outcome === "skipped"
              ? "skipped"
              : "failed";
        cases.push({
          name,
          status,
          durationMs: typeof last?.duration === "number" ? last.duration : undefined,
          error: last?.error?.message ?? last?.errors?.[0]?.message,
        });
      }
    }
    for (const nested of suite?.suites ?? []) visitSuite(nested);
  };
  for (const suite of parsed?.suites ?? []) visitSuite(suite);
  return cases;
}

/** Best-effort mapper from Cypress's `--reporter json` output into TestCaseResult[]. Tolerant of any shape. */
function mapCypressCases(parsed: any): TestCaseResult[] {
  const tests = parsed?.tests ?? parsed?.results?.flatMap((r: any) => r?.tests ?? []) ?? [];
  return tests.map((test: any) => {
    const state = test?.state ?? test?.status;
    const status: TestCaseResult["status"] =
      state === "passed" ? "passed" : state === "pending" || state === "skipped" ? "skipped" : "failed";
    const title = Array.isArray(test?.title) ? test.title.join(" > ") : test?.title ?? test?.fullTitle ?? "unknown test";
    return {
      name: title,
      status,
      durationMs: typeof test?.duration === "number" ? test.duration : undefined,
      error: test?.err?.message ?? test?.displayError,
    };
  });
}

/**
 * Tries `JSON.parse(stdout)` first (the common case when the reporter is
 * the only thing printed). Falls back to slicing from the first `{` to the
 * last `}` and parsing that — yarn/pnpm wrap the reporter's pretty-printed,
 * multi-line JSON with their own banner/trailer lines ("yarn run v1.22.x"
 * … "Done in 1.6s."), which the pure single-line fallback below can't
 * recover since the reporter JSON itself spans many lines. Finally falls
 * back to each line from the end parsing as its own object (covers a
 * reporter that prints single-line JSON rather than pretty-printed).
 * Returns undefined if nothing parses.
 */
function parseReporterOutput(stdout: string): any {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // fall through
  }
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stdout.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through
    }
  }
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Starts the FrameworkProject's test suite in a real sandboxed subprocess
 * and returns immediately with the initial (running, no cases yet) TestRun
 * — installing deps and running the suite can take anywhere from seconds to
 * a few minutes, so this no longer blocks the HTTP request for the whole
 * duration; the dashboard polls GET .../runs/:runId instead. Execution
 * continues in the background and persists the terminal state (or an
 * `status: "error"` TestRun on any unexpected failure) once it finishes.
 */
export function runFrameworkTests(
  store: Store,
  frameworkProject: FrameworkProject,
  ownerId: string,
): TestRun {
  const now = new Date().toISOString();
  const [testBin, testArgs] = testCommand(
    frameworkProject.packageManager,
    frameworkProject.framework,
  );
  const command = [testBin, ...testArgs].join(" ");
  const run: TestRun = {
    id: randomUUID(),
    frameworkProjectId: frameworkProject.id,
    projectId: frameworkProject.projectId,
    ownerId,
    status: "running",
    command,
    startedAt: now,
    cases: [],
  };
  store.createTestRun(run);

  void execute().catch((error) => {
    try {
      store.updateTestRun(
        run.id,
        {
          status: "error",
          finishedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : "Test run failed unexpectedly.",
        },
        ownerId,
      );
    } catch {
      // The FrameworkProject (or run) may have been deleted mid-flight —
      // nothing left to persist this to.
    }
  });

  return run;

  async function execute(): Promise<void> {
    const workspacePath = frameworkProject.workspacePath;
    const nodeModulesPresent = await exists(
      resolve(workspacePath, "node_modules"),
    );
    if (!nodeModulesPresent) {
      const [installBin, installArgs] = installCommand(
        frameworkProject.packageManager,
      );
      const install = await spawnAndCapture(installBin, installArgs, {
        cwd: workspacePath,
        timeoutMs: 180_000,
      });
      if (install.timedOut || install.exitCode !== 0) {
        store.updateTestRun(
          run.id,
          {
            status: "error",
            finishedAt: new Date().toISOString(),
            error:
              `${installBin} install failed: ` +
              install.stderr.slice(0, 2000),
          },
          ownerId,
        );
        return;
      }
    }

    const result = await spawnAndCapture(testBin, testArgs, {
      cwd: workspacePath,
      timeoutMs: 300_000,
      env: { ...process.env, CI: "1" },
    });

    const logDir = resolve(
      artifactRoot(),
      "automation-framework",
      frameworkProject.id,
      "runs",
    );
    await mkdir(logDir, { recursive: true });
    const logAbsolutePath = resolve(logDir, run.id + ".log");
    await writeFile(
      logAbsolutePath,
      result.stdout + "\n" + result.stderr,
      "utf8",
    );
    // Relative to artifactRoot() — mirrors how other artifacts (e.g.
    // packages/worker/src/workflow-runner.ts's step screenshots) store a
    // root-relative path rather than an absolute filesystem path.
    const logPath = `automation-framework/${frameworkProject.id}/runs/${run.id}.log`;

    const parsed = parseReporterOutput(result.stdout);
    let cases: TestCaseResult[] = [];
    if (parsed) {
      cases =
        frameworkProject.framework === "playwright"
          ? mapPlaywrightCases(parsed)
          : mapCypressCases(parsed);
    }

    const exitCode = result.timedOut ? null : result.exitCode;
    const status: TestRun["status"] = exitCode === 0 ? "passed" : "failed";
    const resultsSummary =
      cases.length > 0
        ? {
            total: cases.length,
            passed: cases.filter((c) => c.status === "passed").length,
            failed: cases.filter((c) => c.status === "failed").length,
            skipped: cases.filter((c) => c.status === "skipped").length,
          }
        : undefined;

    store.updateTestRun(
      run.id,
      {
        status,
        finishedAt: new Date().toISOString(),
        exitCode: exitCode ?? undefined,
        cases,
        resultsSummary,
        logPath,
        command,
        error: result.timedOut ? "Test run timed out." : undefined,
      },
      ownerId,
    );
  }
}
