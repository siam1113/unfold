import type { Page } from "playwright";
import {
  replayCapability,
  type RequiredFlowResolution,
} from "../../../capability-runtime/src/replay.js";
import type {
  Capability,
  CapabilityCandidate,
  Flow,
} from "../../../capability-core/src/types.js";
import { WEBMCP_POLYFILL_SOURCE } from "./polyfill.js";

// Maps our internal Capability shape onto the real WebMCP `ModelContextTool`
// surface (W3C Web Machine Learning CG, draft 14 Oct 2026:
// document.modelContext.registerTool({ name, description, inputSchema,
// annotations, execute })). Kept as a pure function per the plan's "adapters
// are replaceable" principle — isolate WebMCP's API shape behind this one
// mapping so a future spec change (e.g. the Navigator -> Document getter
// move that already happened once) only touches this file.
export interface ModelContextToolShape {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean };
}

const toToolName = (name: string) =>
  name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);

export function toModelContextTool(
  capability: Capability,
): ModelContextToolShape {
  return {
    name: toToolName(capability.name),
    description: capability.description,
    inputSchema: capability.inputSchema,
    annotations: {
      readOnlyHint: capability.risk === "read",
      consequentialHint: capability.risk !== "read",
    },
  };
}

export interface RegisterResult {
  registered: string[];
  unavailable: boolean;
}

export type CapabilityReplay = (
  page: Page,
  capability: Capability,
  flow: Flow,
  input: Record<string, unknown>,
  // Optional 5th param so the default binding below can offer
  // replayCapability's one-level precondition remediation; a caller
  // supplying its own `replay` (e.g. the verification runner's Stage F
  // probe, which already closes over its own Store-backed resolver) is free
  // to ignore it.
  resolveRequiredFlow?: (
    capabilityId: string,
  ) => Promise<RequiredFlowResolution | undefined>,
) => Promise<unknown>;

// `replayCapability`'s own 5th positional param is `onBeforeFinalAction`
// (`() => void`), not `resolveRequiredFlow` — `CapabilityReplay`'s shape
// doesn't line up with `replayCapability`'s positionally, so the default
// binding below needs this adapter rather than `replayCapability` directly.
const defaultReplay: CapabilityReplay = (
  page,
  capability,
  flow,
  input,
  resolveRequiredFlow,
) =>
  replayCapability(
    page,
    capability,
    flow,
    input,
    undefined,
    undefined,
    undefined,
    resolveRequiredFlow,
  );

/**
 * Registers every *published* capability as a live WebMCP tool on `page`.
 * Evaluates `WEBMCP_POLYFILL_SOURCE` (./polyfill.ts) first — a no-op on a
 * browser that already has the native API (Chrome 149+ Origin Trial), and
 * otherwise a minimal `document.modelContext` shim, so this always works
 * regardless of whether the real browser build has shipped WebMCP yet.
 * `{ registered: [], unavailable: true }` is now only a defensive fallback
 * for a page whose CSP/script-injection is blocked outright, not the common
 * case it used to be. `candidate`/`testing`/`verified`/etc. capabilities are
 * never registered — passing the verification runner's gates (`verified`)
 * is necessary but not sufficient; only a capability a reviewer has
 * additionally `published` is ever agent-callable.
 */
export async function registerCapabilities(
  page: Page,
  candidates: CapabilityCandidate[],
  replay: CapabilityReplay = defaultReplay,
): Promise<RegisterResult> {
  const published = candidates.filter(
    (c) => c.capability.status === "published",
  );
  await page.evaluate(WEBMCP_POLYFILL_SOURCE);
  const available = await page.evaluate(() => "modelContext" in document);
  if (!available) return { registered: [], unavailable: true };

  const byName = new Map(
    published.map((c) => [toToolName(c.capability.name), c] as const),
  );
  // Resolves one of a capability's `requiredCapabilityIds` against this same
  // call's `published` list — every candidate this page's tools were built
  // from is already in memory here, so no Store/DB access is needed. Keyed
  // by real `capability.id` (requiredCapabilityIds entries are always real
  // ids), not by the sanitized tool name `byName` uses.
  const resolveRequiredFlow = async (
    capabilityId: string,
  ): Promise<RequiredFlowResolution | undefined> => {
    const found = published.find((c) => c.capability.id === capabilityId);
    return found && { capability: found.capability, flow: found.flow };
  };
  await page.exposeFunction(
    "__hynixExecute",
    async (name: string, input: Record<string, unknown>) => {
      const candidate = byName.get(name);
      if (!candidate) throw new Error(`Unknown capability: ${name}`);
      return replay(
        page,
        candidate.capability,
        candidate.flow,
        input,
        resolveRequiredFlow,
      );
    },
  );

  for (const candidate of published) {
    const tool = toModelContextTool(candidate.capability);
    // A plain JS source string with `tool`'s fields inlined via
    // JSON.stringify, evaluated directly — NOT a TS closure handed to
    // `page.evaluate(fn, arg)`. Confirmed empirically (see polyfill.ts's
    // doc comment on WEBMCP_POLYFILL_SOURCE): tsx/esbuild's "keep names"
    // transform wraps ANY named function/arrow assignment — including an
    // object property like `execute: (input) => ...` — in a
    // `__name(fn, "execute")` call that only exists in the Node-side
    // compiled module. `Function.prototype.toString()`-based serialization
    // (what `page.evaluate(fn, arg)` does under the hood) ships just the
    // function's own source text across to the browser, so that reference
    // dangles and throws `ReferenceError: __name is not defined` the
    // instant it runs in-page. A hand-built string never passes through
    // that transform in the first place.
    //
    // Per Chrome's WebMCP imperative-API docs
    // (developer.chrome.com/docs/ai/webmcp/imperative-api), a caller that
    // needs to invoke this tool later obtains the executeTool()-ready
    // handle via getTools() — registerTool()'s own resolved value isn't a
    // usable RegisteredTool handle and callers (e.g. the verification
    // runner's Stage F probe) shouldn't rely on it, so there's nothing to
    // capture here.
    const source = `(function () {
      document.modelContext.registerTool({
        name: ${JSON.stringify(tool.name)},
        description: ${JSON.stringify(tool.description)},
        inputSchema: ${JSON.stringify(tool.inputSchema ?? null)},
        annotations: ${JSON.stringify(tool.annotations)},
        execute: function (input) {
          return window.__hynixExecute(${JSON.stringify(tool.name)}, input);
        },
      });
    })();`;
    await page.evaluate(source);
  }
  return { registered: [...byName.keys()], unavailable: false };
}
