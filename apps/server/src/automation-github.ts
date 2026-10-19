// Automation: Framework tab. Connects a FrameworkProject's workspace to a
// GitHub repo and syncs it, via simple-git (never a raw shell string — git
// invocations are driven by simple-git's execFile-based argv API, same
// no-shell-injection guarantee the rest of this feature's child_process
// usage relies on, see apps/server/src/automation-execution.ts).
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { simpleGit } from "simple-git";
import type { Store } from "../../../packages/storage/src/index.js";
import type { FrameworkProject } from "../../../packages/shared/src/index.js";

const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/;

/** Strips any embedded `x-access-token:<token>@` credential out of an error message before it's thrown/logged, so a PAT never leaks into logs or API responses. */
function redactToken(message: string): string {
  return message.replace(/https:\/\/x-access-token:[^@]+@/g, "https://");
}

function authenticatedUrl(repoUrl: string, token: string): string {
  return repoUrl.replace("https://", `https://x-access-token:${token}@`);
}

async function hasGitDir(workspacePath: string): Promise<boolean> {
  try {
    const info = await stat(resolve(workspacePath, ".git"));
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Connects (or reconnects) a FrameworkProject's workspace to a GitHub repo. */
export async function connectGithub(
  store: Store,
  frameworkProject: FrameworkProject,
  ownerId: string,
  input: { repoUrl: string; token: string; defaultBranch?: string },
): Promise<FrameworkProject> {
  if (!GITHUB_REPO_URL.test(input.repoUrl))
    throw new Error(
      "repoUrl must look like https://github.com/<owner>/<repo> — other protocols (git://, file://, ssh) are not supported.",
    );

  store.setFrameworkGithubToken(frameworkProject.id, input.token);
  const url = authenticatedUrl(input.repoUrl, input.token);
  const git = simpleGit(frameworkProject.workspacePath);

  try {
    if (await hasGitDir(frameworkProject.workspacePath)) {
      // Reconnecting an already-git-initialized workspace: just point
      // `origin` at the (possibly new) repo/token.
      const remotes = await git.getRemotes();
      if (remotes.some((remote) => remote.name === "origin"))
        await git.remote(["set-url", "origin", url]);
      else await git.addRemote("origin", url);
    } else {
      // First connection: init in place and keep whatever boilerplate/
      // scratch files already exist as the initial local state, rather
      // than discarding them for a fresh clone — the user may have
      // already started editing the generated scaffold.
      await git.init();
      await git.addRemote("origin", url);
    }
  } catch (error) {
    throw new Error(
      redactToken(error instanceof Error ? error.message : "Failed to connect GitHub repo."),
    );
  }

  return store.updateFrameworkProject(
    frameworkProject.id,
    {
      github: {
        repoUrl: input.repoUrl,
        defaultBranch: input.defaultBranch || "main",
        connectedAt: new Date().toISOString(),
      },
    },
    ownerId,
  );
}

/** Pulls or pushes a FrameworkProject's workspace against its connected GitHub repo. */
export async function syncGithub(
  store: Store,
  frameworkProject: FrameworkProject,
  ownerId: string,
  input: { direction: "pull" | "push"; message?: string },
): Promise<void> {
  if (!frameworkProject.github) throw new Error("Connect a GitHub repo first.");
  const token = store.frameworkGithubToken(frameworkProject.id);
  if (!token) throw new Error("Connect a GitHub repo first.");

  const url = authenticatedUrl(frameworkProject.github.repoUrl, token);
  const git = simpleGit(frameworkProject.workspacePath);
  const branch = frameworkProject.github.defaultBranch;

  try {
    // Set the authenticated URL on `origin` immediately before the
    // operation rather than passing it inline to pull/push — simple-git's
    // pull/push accept only a remote *name*, not an arbitrary URL, so the
    // remote has to carry the credential for the duration of the call.
    // The token is re-read from the DB on every sync (never cached here),
    // and this rewrite happens right before use so it sits in .git/config
    // no longer than the operation itself requires.
    await git.remote(["set-url", "origin", url]);
    if (input.direction === "pull") {
      await git.pull("origin", branch);
    } else {
      await git.add(".");
      await git.commit(input.message || "Update from Unfold");
      await git.push("origin", branch);
    }
  } catch (error) {
    throw new Error(
      redactToken(error instanceof Error ? error.message : "GitHub sync failed."),
    );
  }
}
