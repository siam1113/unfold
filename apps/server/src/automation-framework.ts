// Automation: Framework tab. Backend scaffolding/filesystem logic for a
// project's FrameworkProject — the Cypress/Playwright workspace on disk that
// apps/server/src/automation-execution.ts runs tests against and
// apps/server/src/automation-github.ts syncs with a remote repo. Mirrors the
// plain-function-over-Store pattern in apps/server/src/capabilities.ts: no
// Express, no route code, no ownership checks (callers already resolved the
// FrameworkProject via store.frameworkProject*/project lookups that checked
// ownerId).
import { mkdir, readdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/storage/src/index.js";
import { artifactRoot } from "../../../packages/storage/src/index.js";
import type { FrameworkProject } from "../../../packages/shared/src/index.js";

/** Directories a workspace walk/traversal should never look inside — build output, VCS internals, and framework run artifacts. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "test-results",
  "playwright-report",
]);
/** Cypress nests its run artifacts two levels deep (cypress/videos, cypress/screenshots) — matched by directory name regardless of depth, same as the other skip entries. */
const SKIP_NESTED_DIRS = new Set(["videos", "screenshots"]);

function writePackageJson(
  workspacePath: string,
  content: Record<string, unknown>,
) {
  return fsWriteFile(
    resolve(workspacePath, "package.json"),
    JSON.stringify(content, null, 2) + "\n",
    "utf8",
  );
}

/** Writes a minimal, runnable Playwright project: config + one trivial passing spec. */
export async function writePlaywrightBoilerplate(
  workspacePath: string,
): Promise<void> {
  await mkdir(resolve(workspacePath, "tests"), { recursive: true });
  await writePackageJson(workspacePath, {
    name: "automation-tests",
    private: true,
    type: "module",
    devDependencies: { "@playwright/test": "^1.64.0" },
  });
  await fsWriteFile(
    resolve(workspacePath, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Set a base URL for the app under test, then use relative paths in page.goto():
  // use: { baseURL: "https://example.com" },
});
`,
    "utf8",
  );
  await fsWriteFile(
    resolve(workspacePath, "tests", "example.spec.ts"),
    `import { test, expect } from "@playwright/test";

test("sanity check", () => {
  expect(1 + 1).toBe(2);
});

// A real test against the app under test looks like this:
// test("home page loads", async ({ page }) => {
//   await page.goto("/");
//   await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
// });
`,
    "utf8",
  );
}

/** Writes a minimal, runnable Cypress project: config + one trivial passing spec. */
export async function writeCypressBoilerplate(
  workspacePath: string,
): Promise<void> {
  await mkdir(resolve(workspacePath, "cypress", "e2e"), { recursive: true });
  await writePackageJson(workspacePath, {
    name: "automation-tests",
    private: true,
    devDependencies: { cypress: "^14.0.0" },
  });
  await fsWriteFile(
    resolve(workspacePath, "cypress.config.js"),
    `const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {},
});
`,
    "utf8",
  );
  await fsWriteFile(
    resolve(workspacePath, "cypress", "e2e", "example.cy.js"),
    `describe("sanity check", () => {
  it("passes", () => {
    expect(1 + 1).to.equal(2);
  });

  // A real test against the app under test looks like this:
  // it("loads the home page", () => {
  //   cy.visit("/");
  //   cy.get("h1").should("be.visible");
  // });
});
`,
    "utf8",
  );
}

/**
 * Get-or-create: there is exactly one FrameworkProject per project
 * (framework_projects has a UNIQUE(project_id) column — see
 * packages/storage/src/index.ts), so a second call with different `input`
 * is a no-op that just returns the existing project untouched.
 */
export async function getOrCreateFrameworkProject(
  store: Store,
  projectId: string,
  ownerId: string,
  input: { framework: "cypress" | "playwright"; origin: "boilerplate" | "scratch" },
): Promise<FrameworkProject> {
  const existing = store.frameworkProject(projectId, ownerId);
  if (existing) return existing;

  const id = randomUUID();
  const workspacePath = resolve(artifactRoot(), "automation-framework", id);
  await mkdir(workspacePath, { recursive: true });

  if (input.origin === "boilerplate") {
    if (input.framework === "playwright")
      await writePlaywrightBoilerplate(workspacePath);
    else await writeCypressBoilerplate(workspacePath);
  } else {
    await writePackageJson(workspacePath, {
      name: "automation-tests",
      private: true,
      type: "module",
    });
  }

  const now = new Date().toISOString();
  return store.createFrameworkProject({
    id,
    projectId,
    ownerId,
    framework: input.framework,
    origin: input.origin,
    workspacePath,
    packageManager: "npm",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Resolves `subpath` against `workspacePath` and throws if it would escape
 * the workspace (path traversal guard shared by listFiles/readFile/writeFile).
 */
function resolveInWorkspace(workspacePath: string, subpath: string): string {
  const resolved = resolve(workspacePath, subpath || ".");
  if (resolved !== workspacePath && !resolved.startsWith(workspacePath + sep))
    throw new Error("Path escapes the framework project workspace.");
  return resolved;
}

async function walk(
  root: string,
  dir: string,
  skipNested: boolean,
): Promise<{ path: string; isDir: boolean }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: { path: string; isDir: boolean }[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (SKIP_DIRS.has(entry.name) || (skipNested && SKIP_NESTED_DIRS.has(entry.name)))
    )
      continue;
    const absolute = resolve(dir, entry.name);
    const relative = posix.relative(
      root.split(sep).join(posix.sep),
      absolute.split(sep).join(posix.sep),
    );
    const isDir = entry.isDirectory();
    out.push({ path: relative, isDir });
    if (isDir)
      out.push(...(await walk(root, absolute, skipNested || entry.name === "cypress")));
  }
  return out;
}

/** Recursively lists `workspacePath` (or a subdirectory of it), as POSIX-style relative paths. Skips VCS/dependency/run-artifact directories. */
export async function listFiles(
  frameworkProject: FrameworkProject,
  subpath?: string,
): Promise<{ path: string; isDir: boolean }[]> {
  const root = frameworkProject.workspacePath;
  const start = resolveInWorkspace(root, subpath || ".");
  return walk(root, start, false);
}

/** Reads a file inside the workspace. Throws if `path` escapes the workspace. */
export async function readFile(
  frameworkProject: FrameworkProject,
  path: string,
): Promise<string> {
  const resolved = resolveInWorkspace(frameworkProject.workspacePath, path);
  return fsReadFile(resolved, "utf8");
}

/** Writes a file inside the workspace, creating intermediate directories as needed. Throws if `path` escapes the workspace. */
export async function writeFile(
  frameworkProject: FrameworkProject,
  path: string,
  content: string,
): Promise<void> {
  const resolved = resolveInWorkspace(frameworkProject.workspacePath, path);
  await mkdir(dirname(resolved), { recursive: true });
  await fsWriteFile(resolved, content, "utf8");
}

export interface PackageEntry {
  name: string;
  version: string;
  dev: boolean;
}

/**
 * The FrameworkProject's installed/declared dependencies, read straight from
 * its package.json (not from node_modules — this reflects what Save/the
 * install wizard has declared, whether or not `npm install` has run yet).
 * `dependencies` and `devDependencies` are merged into one list, tagged by
 * `dev`; a package listed in both (unusual, but package.json allows it)
 * counts as a dependency, not a devDependency, matching how npm would
 * resolve the conflict.
 */
export async function listPackages(
  frameworkProject: FrameworkProject,
): Promise<PackageEntry[]> {
  let raw: string;
  try {
    raw = await readFile(frameworkProject, "package.json");
  } catch {
    return [];
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const deps: Record<string, string> = parsed?.dependencies || {};
  const devDeps: Record<string, string> = parsed?.devDependencies || {};
  const entries: PackageEntry[] = [];
  for (const [name, version] of Object.entries(devDeps))
    entries.push({ name, version, dev: true });
  for (const [name, version] of Object.entries(deps))
    entries.push({ name, version, dev: false });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
