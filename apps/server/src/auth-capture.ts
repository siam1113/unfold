// Login session capture: a human logs into the target app in a fresh,
// isolated, visible browser window, and the resulting Playwright
// storageState() is saved to disk so it can be set as a discovery run's
// ScanConfig.authStatePath (packages/worker/src/index.ts already wires that
// path straight into browser.newContext({ storageState })).
//
// Deliberately separate from apps/server/src/browse-session.ts (same
// reasoning that file gives for being separate from Coordinator): AI
// Browse's "connect" mode attaches to the user's whole real Chrome profile
// and would export every cookie in it, not just the target app's — wrong
// for a credential-bearing file headed into artifacts/. Its "launch" mode is
// headless, driven only through chat + screenshot polling — typing a
// password into an LLM chat box is also wrong. This module instead mirrors
// apps/cli/src/index.ts's `auth` command: a throwaway isolated context in a
// real, visible browser window the user drives directly with their own
// mouse/keyboard, never through our UI.
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  artifactRoot,
  type Store,
} from "../../../packages/storage/src/index.js";
import type { AuthCapture } from "../../../packages/shared/src/index.js";

export class AuthCaptureConflictError extends Error {}

interface AuthCaptureHandle {
  id: string;
  projectId: string;
  ownerId: string;
  browser: Browser;
  page: Page;
}

// In-memory liveness map, mirroring browse-session.ts's `live` pattern — the
// live Browser/Page handle can't be persisted across a process restart; the
// Store is the only durable record, and closeStaleAuthCaptures() reconciles
// it at startup.
const live = new Map<string, AuthCaptureHandle>();

export async function openAuthCapture(
  store: Store,
  projectId: string,
  ownerId: string,
  baseUrl: string,
): Promise<AuthCapture> {
  // One active capture per project at a time — two open windows against the
  // same project would just confuse whoever's clicking "I'm logged in".
  if ([...live.values()].some((handle) => handle.projectId === projectId))
    throw new AuthCaptureConflictError(
      "A login capture is already open for this project",
    );

  const id = randomUUID();
  store.createAuthCapture({
    id,
    projectId,
    ownerId,
    baseUrl,
    status: "open",
    createdAt: new Date().toISOString(),
  });

  let browser: Browser;
  let page: Page;
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
    });
    // A fresh, isolated context — never the user's real browser profile.
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (error) {
    return store.updateAuthCapture(
      id,
      {
        status: "failed",
        lastError:
          error instanceof Error
            ? `Could not open a browser window: ${error.message}`
            : "Could not open a browser window.",
      },
      ownerId,
    );
  }

  live.set(id, { id, projectId, ownerId, browser, page });
  page.once("close", () => {
    live.delete(id);
  });

  return store.updateAuthCapture(id, { status: "open" }, ownerId);
}

export async function captureAuthState(
  store: Store,
  id: string,
  ownerId: string,
): Promise<AuthCapture> {
  const handle = live.get(id);
  if (!handle) throw new Error("This login capture is no longer open");
  const capture = store.authCapture(id, ownerId);
  if (!capture) throw new Error("Auth capture not found");

  const state = await handle.page.context().storageState();
  const path = resolve(
    artifactRoot(),
    "projects",
    handle.projectId,
    `auth-state-${Date.now()}.json`,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(state));
  await chmod(path, 0o600);

  const domains = new Set<string>();
  for (const cookie of state.cookies)
    domains.add(cookie.domain.replace(/^\./, ""));
  for (const origin of state.origins)
    try {
      domains.add(new URL(origin.origin).hostname);
    } catch {
      // Ignore an unparseable origin rather than failing the whole capture.
    }

  live.delete(id);
  await handle.browser.close().catch(() => {});

  return store.updateAuthCapture(
    id,
    {
      status: "captured",
      path,
      cookieCount: state.cookies.length,
      domains: [...domains].sort(),
      capturedAt: new Date().toISOString(),
    },
    ownerId,
  );
}

export async function cancelAuthCapture(
  store: Store,
  id: string,
  ownerId: string,
): Promise<AuthCapture> {
  const handle = live.get(id);
  live.delete(id);
  if (handle) await handle.browser.close().catch(() => {});
  return store.updateAuthCapture(id, { status: "cancelled" }, ownerId);
}

export async function forgetAuthCapture(
  store: Store,
  id: string,
  ownerId: string,
): Promise<void> {
  const capture = store.authCapture(id, ownerId);
  if (capture?.path) await rm(capture.path, { force: true }).catch(() => {});
  const handle = live.get(id);
  live.delete(id);
  if (handle) await handle.browser.close().catch(() => {});
  store.deleteAuthCapture(id, ownerId);
}
