// A minimal, dependency-free `document.modelContext` shim for browsers
// without Chrome's native WebMCP implementation (it only exists today
// behind Chrome 149's Origin Trial or chrome://flags/#enable-webmcp-testing
// — see https://developer.chrome.com/docs/ai/webmcp). Implements just the
// surface `registerCapabilities` (./index.ts) and a Chrome extension
// content script (apps/extension, when it exists) actually need:
// registerTool/getTools/executeTool/addEventListener("toolchange", ...).
//
// Shipped as a plain hand-written JS string, NOT a TypeScript function
// handed to `page.evaluate` for Playwright to serialize via
// `fn.toString()`. That approach was tried first and failed empirically:
// `tsx`'s esbuild transpilation wraps compiled functions in a `__name(fn,
// "name")` call to preserve `.name` through minification: harmless inside
// Node, but `fn.toString()` only captures the function's own source, not
// that wrapper — so the string Playwright ships to the browser references
// a `__name` helper that only exists in the Node-side compiled module,
// throwing `ReferenceError: __name is not defined` the moment it runs
// in-page. A plain string literal never passes through that transform, so
// it has no such reference to dangle. This is also the shape a future
// Chrome extension content script will want anyway (eval or inline
// `<script>` injection, not a function reference).
//
// No-ops if `document.modelContext` already exists, so evaluating this
// unconditionally before the native-API feature-detect in `index.ts` is
// always safe: native Chrome 149 wins, everything else gets this instead.
export const WEBMCP_POLYFILL_SOURCE = `(function () {
  if ("modelContext" in document) return;
  var tools = new Map();
  var events = new EventTarget();
  function registerTool(tool, options) {
    options = options || {};
    tools.set(tool.name, tool);
    events.dispatchEvent(new Event("toolchange"));
    if (options.signal) {
      options.signal.addEventListener("abort", function () {
        tools.delete(tool.name);
        events.dispatchEvent(new Event("toolchange"));
      });
    }
    return Promise.resolve();
  }
  function getTools() {
    return Promise.resolve(
      Array.from(tools.values()).map(function (tool) {
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        };
      })
    );
  }
  function executeTool(tool, input, options) {
    input = input || {};
    options = options || {};
    var name = typeof tool === "string" ? tool : tool && tool.name;
    var registered = tools.get(name);
    if (!registered) {
      return Promise.reject(new Error("Unknown WebMCP tool: " + name));
    }
    return Promise.resolve(registered.execute(input, { signal: options.signal }));
  }
  document.modelContext = {
    registerTool: registerTool,
    getTools: getTools,
    executeTool: executeTool,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
})();`;
