// AI Browse (hynix_webmcp_extension_plan.md): a live session either
// connected via Playwright's connectOverCDP to the user's OWN local Chrome,
// or launched fresh as a throwaway isolated browser the server owns
// outright — not a worker-launched/managed browser either way
// (packages/core's Coordinator launches its own headless chromium for
// discovery; this is a deliberately separate, simpler manager, since
// Coordinator is tied to headless multi-worker crawling and a
// Run/TaskLease domain model that doesn't fit a single live page driven
// turn-by-turn by an LLM). apps/server/src/index.ts wires this onto HTTP
// routes; it owns ownership checks the same way apps/server/src/capabilities.ts
// does for capability routes.
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/storage/src/index.js";
import type {
  BrowseSession,
  BrowseEvent,
} from "../../../packages/shared/src/index.js";

export class BrowseSessionConflictError extends Error {}

export type OpenBrowseSessionOptions =
  | { mode: "connect"; cdpEndpoint: string }
  | { mode: "launch" };

export interface BrowseSessionHandle {
  id: string;
  projectId: string;
  ownerId: string;
  mode: "connect" | "launch";
  browser: Browser;
  page: Page;
  nextSequence: number;
  subscribers: Set<(event: BrowseEvent) => void>;
}

// In-memory liveness map, mirroring packages/core/src/index.ts's
// `activeRuns` pattern — the live Browser/Page handle can't be persisted;
// the Store (browse_events) is the only durable source of truth for the
// session's transcript.
const live = new Map<string, BrowseSessionHandle>();

export function getLiveSession(
  sessionId: string,
): BrowseSessionHandle | undefined {
  return live.get(sessionId);
}

/** Appends an event to both the session's live subscriber fan-out and the durable Store transcript. */
export function recordEvent(
  store: Store,
  session: BrowseSessionHandle,
  kind: BrowseEvent["kind"],
  payload: Record<string, unknown>,
): BrowseEvent {
  const event: BrowseEvent = {
    id: randomUUID(),
    sessionId: session.id,
    sequence: session.nextSequence++,
    time: new Date().toISOString(),
    kind,
    payload,
  };
  store.appendBrowseEvent(event);
  for (const subscriber of session.subscribers) subscriber(event);
  return event;
}

/** Subscribes to a live session's event fan-out (for the SSE events route). Returns an unsubscribe function; a no-op if the session isn't live. */
export function subscribeBrowseSession(
  sessionId: string,
  subscriber: (event: BrowseEvent) => void,
): () => void {
  const session = live.get(sessionId);
  if (!session) return () => {};
  session.subscribers.add(subscriber);
  return () => session.subscribers.delete(subscriber);
}

export async function openBrowseSession(
  store: Store,
  projectId: string,
  ownerId: string,
  options: OpenBrowseSessionOptions,
  baseUrl?: string,
): Promise<BrowseSession> {
  // One active session per project at a time (mirrors Coordinator's
  // "already running" guard) — two sessions sharing one CDP connection's
  // default context would silently cross-talk (one agent clicking around
  // while another watches a different tab).
  if ([...live.values()].some((session) => session.projectId === projectId))
    throw new BrowseSessionConflictError(
      "A browse session is already active for this project",
    );

  const id = randomUUID();
  store.createBrowseSession({
    id,
    projectId,
    ownerId,
    mode: options.mode,
    cdpEndpoint: options.mode === "connect" ? options.cdpEndpoint : undefined,
    status: "connecting",
    createdAt: new Date().toISOString(),
  });

  let browser: Browser;
  try {
    browser =
      options.mode === "connect"
        ? await chromium.connectOverCDP(options.cdpEndpoint)
        : await chromium.launch({ headless: true });
  } catch (error) {
    return store.updateBrowseSession(
      id,
      {
        status: "failed",
        lastError:
          error instanceof Error
            ? options.mode === "connect"
              ? `Could not connect to ${options.cdpEndpoint}: ${error.message}. Is Chrome running with --remote-debugging-port?`
              : `Could not launch an isolated browser: ${error.message}`
            : "Could not start the browse session.",
      },
      ownerId,
    );
  }

  // "connect" mode: use the user's own existing default context — their
  // real cookies and session — never browser.newContext(), which would be a
  // fresh, cookie-less context and defeat the entire point of browsing as
  // the user. "launch" mode: there is no pre-existing context at all (a
  // freshly launched browser starts with zero), so always create one.
  const context =
    options.mode === "connect"
      ? (browser.contexts()[0] ?? (await browser.newContext()))
      : await browser.newContext();
  // Open exactly one new tab dedicated to this session; in "connect" mode
  // never touch a tab the user already had open.
  const page = await context.newPage();

  const handle: BrowseSessionHandle = {
    id,
    projectId,
    ownerId,
    mode: options.mode,
    browser,
    page,
    nextSequence: 0,
    subscribers: new Set(),
  };
  live.set(id, handle);

  // Registered before navigating so the initial page load's own
  // console/network activity shows up as evidence too, instead of only
  // whatever happens after.
  page.on("console", (message) => {
    recordEvent(store, handle, "console", {
      level: message.type(),
      text: message.text(),
    });
  });
  page.on("request", (request) => {
    recordEvent(store, handle, "network_request", {
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    recordEvent(store, handle, "network_response", {
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
    });
  });
  page.once("close", () => {
    void closeBrowseSession(store, id, ownerId).catch(() => {});
  });

  // Land on the project's own app by default rather than leaving the fresh
  // tab blank — the whole point of a browse session is driving THIS
  // project's app, so start there instead of making the user navigate
  // there by hand every time. Recorded as a "status" event (not swallowed)
  // so the dashboard can actually show what happened instead of leaving
  // the user staring at a blank tab with no explanation.
  if (baseUrl) {
    recordEvent(store, handle, "status", {
      message: `Opening ${baseUrl}…`,
    });
    try {
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      recordEvent(store, handle, "status", {
        message: `Loaded ${page.url()}`,
      });
    } catch (error) {
      // Best-effort — an unreachable baseUrl shouldn't block the session
      // from opening; the agent/user can still navigate manually. But say
      // so, rather than leaving a blank tab with zero explanation.
      recordEvent(store, handle, "status", {
        message: `Could not open ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return store.updateBrowseSession(id, { status: "live" }, ownerId);
}

export async function closeBrowseSession(
  store: Store,
  sessionId: string,
  ownerId: string,
): Promise<void> {
  const handle = live.get(sessionId);
  live.delete(sessionId);
  if (handle) {
    if (handle.mode === "launch") {
      // The server owns this browser outright (nothing else is keeping it
      // running), so closing it fully is correct and necessary — leaving it
      // open would leak a whole browser process per session.
      await handle.browser.close().catch(() => {});
    } else {
      // "connect" mode: close ONLY the one page this session opened. Never
      // call browser.close()/context.close() — for a CDP-attached browser
      // that risks affecting the user's other, pre-existing tabs. Dropping
      // this handle lets the CDP connection itself be garbage-collected
      // without sending any close/disconnect command to the real browser.
      await handle.page.close().catch(() => {});
    }
  }
  const session = store.browseSession(sessionId, ownerId);
  if (session && session.status !== "closed")
    store.updateBrowseSession(
      sessionId,
      { status: "closed", closedAt: new Date().toISOString() },
      ownerId,
    );
}

export async function screenshotBrowseSession(
  sessionId: string,
): Promise<Buffer> {
  const handle = live.get(sessionId);
  if (!handle) throw new Error("Browse session is not live");
  return handle.page.screenshot({ type: "png" });
}
