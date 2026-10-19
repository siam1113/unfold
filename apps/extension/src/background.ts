/// <reference types="chrome" />

// The background service worker owns the only two things that need
// extension-level privilege (not available to a page's own JS): (1) the
// personal access token and server URL, held in chrome.storage.local, and
// the actual fetch to the Unfold server using it — content scripts never
// fetch the API directly, since a fetch made FROM the page's own JS context
// is subject to that page's CORS/CSP, while a fetch made from the
// background worker is not, as long as the extension holds host permission
// for the Unfold server's own origin (requested once, in options.ts, kept
// separate from the per-target-site permissions below); and (2) deciding
// which real-world origins get the content scripts injected into them at
// all — driven entirely by `chrome.permissions` (the user's own per-site
// grants, requested from options.ts), never a blanket `<all_urls>` match in
// the manifest.
//
// `content-main.ts` (the one that actually calls `document.modelContext`)
// cannot hold a `world: "MAIN"` reference to any `chrome.*` API — MAIN-world
// content scripts run in the page's own JS context, which the extension's
// chrome.* namespace is deliberately not exposed to. `content-isolated.ts`
// is the bridge: it DOES have chrome.* access (the default, isolated world)
// and relays tool data to the main-world script via `window.postMessage`
// (see content-isolated.ts's doc comment for the handshake).

interface StoredConfig {
  serverUrl?: string;
  apiToken?: string;
}

const CONTENT_SCRIPT_ID = "unfold-webmcp";

async function getConfig(): Promise<StoredConfig> {
  return chrome.storage.local.get(["serverUrl", "apiToken"]);
}

/**
 * Re-derives which origins should have the WebMCP content scripts injected
 * from the live set of granted `chrome.permissions` origins — never stored
 * separately, so there's exactly one source of truth and no way for it to
 * drift out of sync with what the user actually granted (e.g. after they
 * revoke a site via Chrome's own extension-permissions UI, not just this
 * extension's options page). Deliberately excludes the Unfold server's own
 * origin: that permission exists only so THIS file can fetch the API, never
 * so the content script gets injected into the Unfold dashboard itself.
 */
async function syncRegisteredContentScripts(): Promise<void> {
  const { serverUrl } = await getConfig();
  const granted = await chrome.permissions.getAll();
  const serverOrigin = serverUrl ? safeOrigin(serverUrl) : undefined;
  const matches = (granted.origins ?? []).filter((pattern) => {
    const patternOrigin = safeOrigin(pattern.replace(/\/\*$/, ""));
    return !serverOrigin || patternOrigin !== serverOrigin;
  });

  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [`${CONTENT_SCRIPT_ID}-isolated`, `${CONTENT_SCRIPT_ID}-main`],
  });
  if (existing.length)
    await chrome.scripting.unregisterContentScripts({
      ids: existing.map((script) => script.id),
    });
  if (matches.length === 0) return;

  await chrome.scripting.registerContentScripts([
    {
      id: `${CONTENT_SCRIPT_ID}-isolated`,
      matches,
      js: ["content-isolated.js"],
      runAt: "document_idle",
      world: "ISOLATED",
    },
    {
      id: `${CONTENT_SCRIPT_ID}-main`,
      matches,
      js: ["content-main.js"],
      runAt: "document_idle",
      world: "MAIN",
    },
  ]);
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

chrome.runtime.onInstalled.addListener(
  () => void syncRegisteredContentScripts(),
);
chrome.runtime.onStartup.addListener(() => void syncRegisteredContentScripts());
chrome.permissions.onAdded.addListener(
  () => void syncRegisteredContentScripts(),
);
chrome.permissions.onRemoved.addListener(
  () => void syncRegisteredContentScripts(),
);

type ExtensionMessage = { type: "GET_TOOLS"; origin: string };

async function handleGetTools(
  origin: string,
): Promise<{ tools: unknown[] } | { error: string }> {
  const { serverUrl, apiToken } = await getConfig();
  if (!serverUrl || !apiToken)
    return {
      error:
        "Connect this extension to your Unfold server first (click the extension icon).",
    };
  try {
    const url = `${serverUrl.replace(/\/$/, "")}/api/extension/tools?origin=${encodeURIComponent(origin)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { error: body?.error || `Request failed (${response.status})` };
    }
    return { tools: await response.json() };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not reach the Unfold server.",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message?.type === "GET_TOOLS") {
      void handleGetTools(message.origin).then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    return false;
  },
);
