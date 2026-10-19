/// <reference types="chrome" />

// Runs in the default ("ISOLATED") content-script world — the only one of
// the two WebMCP content scripts with chrome.* access. Its only job is to
// bridge tool data from the background worker (background.ts, which owns
// the server fetch) into content-main.ts, the MAIN-world script that
// actually calls `document.modelContext` — a MAIN-world script runs in the
// page's own JS context and has NO chrome.* access at all, so this bridge
// is load-bearing, not an arbitrary design choice. The two communicate via
// `window.postMessage` (both scripts share the same DOM/window object,
// just different JS global scopes — this is the only channel between
// them).
//
// Handshake: post the tool catalog immediately on this script's own load,
// AND again whenever content-main.ts signals it's ready — covers whichever
// of the two scripts happens to finish loading first, without needing a
// strict load-order guarantee between two independently-registered
// content scripts.
const RESPONSE_TYPE = "unfold-webmcp-tools";
const READY_TYPE = "unfold-webmcp-main-ready";

interface GetToolsResponse {
  tools?: unknown[];
  error?: string;
}

async function fetchAndPost(): Promise<void> {
  const response = await new Promise<GetToolsResponse>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "GET_TOOLS", origin: location.origin },
      (result: GetToolsResponse | undefined) => {
        resolve(
          result ?? {
            error: "No response from the extension's background worker.",
          },
        );
      },
    );
  });
  window.postMessage(
    { source: "unfold-extension", type: RESPONSE_TYPE, ...response },
    location.origin,
  );
}

void fetchAndPost();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (
    event.data?.source === "unfold-extension" &&
    event.data?.type === READY_TYPE
  )
    void fetchAndPost();
});
