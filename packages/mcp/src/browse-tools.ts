// AI Browse's tool surface: the small set of live-browser-driving tools an
// LLM agent loop calls, each operating directly on a live Playwright `Page`
// (connected via chromium.connectOverCDP in apps/server/src/browse-session.ts
// — this module knows nothing about CDP/sessions, only the `Page` it's
// handed). Deliberately decoupled from apps/server: packages depend on
// packages, never the other way around, so this takes a plain `Page` plus a
// recorder callback rather than importing a BrowseSessionHandle type.
//
// Unlike packages/worker/src/observe.ts's resolveTarget/performAction (built
// for replaying *recorded* locator candidates against discovery-captured
// elements), these tools take raw selectors an LLM improvises live against
// an arbitrary page — there's no locator-candidate machinery to reuse here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { Page } from "playwright";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export type BrowseToolCallRecorder = (
  name: string,
  args: Record<string, unknown>,
  status: "running" | "done" | "failed",
  result?: unknown,
) => void;

export function registerBrowseTools(
  server: McpServer,
  page: Page,
  recordToolCall: BrowseToolCallRecorder,
) {
  const wrap =
    <A extends Record<string, unknown>>(
      name: string,
      run: (args: A) => Promise<unknown>,
    ) =>
    async (args: A) => {
      recordToolCall(name, args, "running");
      try {
        const result = await run(args);
        recordToolCall(name, args, "done", result);
        return text(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordToolCall(name, args, "failed", { error: message });
        return { ...text({ error: message }), isError: true };
      }
    };

  server.registerTool(
    "navigate",
    {
      title: "Navigate",
      description: "Navigate the live browser tab to a URL.",
      inputSchema: { url: z.string().url() },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap("navigate", async ({ url }: { url: string }) => {
      await page.goto(url);
      return { url: page.url() };
    }),
  );

  server.registerTool(
    "click",
    {
      title: "Click",
      description:
        'Click an element on the current page, identified by a CSS selector or Playwright text selector (e.g. "text=Check Out").',
      inputSchema: { selector: z.string() },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap("click", async ({ selector }: { selector: string }) => {
      await page.locator(selector).first().click();
      return { url: page.url() };
    }),
  );

  server.registerTool(
    "fill",
    {
      title: "Fill",
      description:
        "Type a value into an input or textarea identified by a selector.",
      inputSchema: { selector: z.string(), value: z.string() },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(
      "fill",
      async ({ selector, value }: { selector: string; value: string }) => {
        await page.locator(selector).first().fill(value);
        return { url: page.url() };
      },
    ),
  );

  server.registerTool(
    "read_page",
    {
      title: "Read page",
      description:
        "Read the current page's URL, title, visible text, and a short list of interactive elements.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap("read_page", async () => {
      const [title, bodyText, interactive] = await Promise.all([
        page.title(),
        page.locator("body").innerText(),
        page.evaluate(() =>
          [...document.querySelectorAll("button,a,input,select,textarea")]
            .slice(0, 100)
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              text: el.textContent?.trim().slice(0, 80),
              name:
                el.getAttribute("aria-label") ||
                el.getAttribute("name") ||
                undefined,
            })),
        ),
      ]);
      return {
        url: page.url(),
        title,
        text: bodyText.slice(0, 8000),
        interactive,
      };
    }),
  );

  server.registerTool(
    "screenshot",
    {
      title: "Screenshot",
      description: "Capture a screenshot of the current page.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args: Record<string, never>) => {
      recordToolCall("screenshot", args, "running");
      try {
        const buf = await page.screenshot({ type: "png" });
        recordToolCall("screenshot", args, "done");
        return {
          content: [
            {
              type: "image" as const,
              data: buf.toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordToolCall("screenshot", args, "failed", { error: message });
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    },
  );
}

/** Connects an in-process MCP client to a fresh server exposing just this page's browse tools — same InMemoryTransport pattern as packages/mcp/src/server.ts's connectProjectMcpClient. */
export async function connectBrowseMcpClient(
  page: Page,
  recordToolCall: BrowseToolCallRecorder,
) {
  const server = new McpServer({ name: "unfold-browse", version: "1.0.0" });
  registerBrowseTools(server, page, recordToolCall);
  const client = new Client({ name: "unfold-browse-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
