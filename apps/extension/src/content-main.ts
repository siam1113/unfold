// Runs in the page's own ("MAIN") JS world — required so the tools it
// registers live on the page's REAL `document.modelContext`, visible to
// any other script on the page (another AI agent, Chrome's own future
// native integrations, etc.), not just to this extension. A MAIN-world
// content script has NO chrome.* API access at all (that's the trade-off
// for running in the page's real context) — content-isolated.ts is the
// only thing feeding this script tool data, over `window.postMessage`.
//
// Deliberately does NOT import packages/adapters/webmcp/src/polyfill.ts's
// `WEBMCP_POLYFILL_SOURCE` and `eval()` it — that string exists specifically
// to survive `Function.prototype.toString()`-serialization across
// Playwright's Node-to-browser bridge (see that file's doc comment); this
// script is normal bundled code already running natively in the browser,
// so the equivalent ~30 lines are written below as plain functions
// instead — no eval() call, which may or may not even be permitted under a
// page's own CSP from a MAIN-world context, so it's simpler and safer to
// just not need it here. Keep this in sync with that file's
// registerTool/getTools/executeTool/addEventListener contract if either
// one changes.
import {
  replayInBrowser,
  isFlowSupported,
  type ReplayFlow,
  type RequiredFlowEntry,
} from "./replay.js";

interface PolyfillTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  execute: (
    input: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => unknown;
}

function installPolyfillIfNeeded(): void {
  if ("modelContext" in document) return;
  const tools = new Map<string, PolyfillTool>();
  const events = new EventTarget();
  const registerTool = (
    tool: PolyfillTool,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> => {
    tools.set(tool.name, tool);
    events.dispatchEvent(new Event("toolchange"));
    options.signal?.addEventListener("abort", () => {
      tools.delete(tool.name);
      events.dispatchEvent(new Event("toolchange"));
    });
    return Promise.resolve();
  };
  const getTools = () =>
    Promise.resolve(
      [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    );
  const executeTool = (
    tool: string | { name: string },
    input: Record<string, unknown> = {},
    options: { signal?: AbortSignal } = {},
  ) => {
    const name = typeof tool === "string" ? tool : tool?.name;
    const registered = tools.get(name);
    if (!registered)
      return Promise.reject(new Error(`Unknown WebMCP tool: ${name}`));
    return Promise.resolve(
      registered.execute(input, { signal: options.signal }),
    );
  };
  (document as unknown as { modelContext: unknown }).modelContext = {
    registerTool,
    getTools,
    executeTool,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
}

interface ToolCatalogItem {
  projectId: string;
  projectName: string;
  capability: {
    name: string;
    description: string;
    risk: "read" | "reversible_write" | "irreversible_write";
    inputSchema: Record<string, unknown>;
  };
  flow: ReplayFlow;
  /** Resolved prerequisites for this tool, embedded by GET /api/extension/tools — see replay.ts's RequiredFlowEntry doc comment. */
  requiredCapabilities?: RequiredFlowEntry[];
}

/** A brief, unmissable on-page notice before a non-read tool actually acts — this runs directly in the user's own authenticated session, exactly as if they'd clicked it themselves, so execution should never be silent. */
function showConsequentialToast(toolName: string): void {
  try {
    const el = document.createElement("div");
    el.textContent = `Unfold is running "${toolName}" on this page.`;
    el.setAttribute(
      "style",
      "position:fixed;top:16px;right:16px;z-index:2147483647;background:#1f2937;color:#fff;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;",
    );
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  } catch {
    // A cosmetic toast failing to render must never block real execution.
  }
}

function registerCatalog(items: ToolCatalogItem[]): void {
  const modelContext = (
    document as unknown as {
      modelContext: { registerTool: (tool: PolyfillTool) => Promise<void> };
    }
  ).modelContext;
  for (const item of items) {
    if (!isFlowSupported(item.flow)) continue; // role/label-only steps — see replay.ts's doc comment
    const toolName = item.capability.name
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .slice(0, 128);
    try {
      void modelContext.registerTool({
        name: toolName,
        description: item.capability.description,
        inputSchema: item.capability.inputSchema,
        annotations: {
          readOnlyHint: item.capability.risk === "read",
          consequentialHint: item.capability.risk !== "read",
        },
        execute: async (input: Record<string, unknown>) => {
          if (item.capability.risk !== "read") showConsequentialToast(toolName);
          return replayInBrowser(item.flow, input, item.requiredCapabilities);
        },
      });
    } catch (error) {
      console.warn(
        `[Unfold WebMCP] Could not register tool "${toolName}":`,
        error,
      );
    }
  }
}

const RESPONSE_TYPE = "unfold-webmcp-tools";
const READY_TYPE = "unfold-webmcp-main-ready";

installPolyfillIfNeeded();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (
    event.data?.source !== "unfold-extension" ||
    event.data?.type !== RESPONSE_TYPE
  )
    return;
  if (event.data.error) {
    console.warn("[Unfold WebMCP]", event.data.error);
    return;
  }
  registerCatalog((event.data.tools ?? []) as ToolCatalogItem[]);
});

window.postMessage(
  { source: "unfold-extension", type: READY_TYPE },
  location.origin,
);
