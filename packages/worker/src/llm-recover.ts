import type { Page } from "playwright";
import { decide } from "../../core/src/policy.js";
import type { RestoreRecipe, ScanConfig } from "../../shared/src/index.js";
import { resolveTarget, performAction, settle } from "./observe.js";
import type { Observation } from "../../shared/src/index.js";

/**
 * Last-resort recovery when reload-to-the-recorded-URL still doesn't land
 * on the target: ask an LLM which element to click next, picking only from
 * elements the normal policy gate (decide()) would already allow — the
 * model chooses a direction, it never gets a say in what's safe to do.
 * Returns the observation once the URL matches, or undefined if recovery
 * isn't possible (no API key configured, no approved candidates, model
 * declined, or attempts ran out).
 */
export async function llmRecover(
  page: Page,
  runId: string,
  config: ScanConfig,
  recipe: RestoreRecipe,
  depth: number,
  worker: number,
  targetUrl: string,
  maxAttempts = 2,
): Promise<Observation | undefined> {
  if (!process.env.OPENAI_API_KEY) return undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const obs = await settle(
      page,
      runId,
      { ...config, captureScreenshots: false },
      recipe,
      depth,
      worker,
    );
    if (obs.state.url === targetUrl) return obs;
    const candidates = obs.elements
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => decide(e, obs.state.url, config, "click").allowed);
    if (!candidates.length) return undefined;
    const choice = await askModel(
      obs.state.url,
      targetUrl,
      candidates.map(({ e }, i) => ({
        i,
        role: e.role,
        name: e.accessibleName,
        href: e.href,
      })),
    ).catch(() => undefined);
    if (choice === undefined) return undefined;
    const picked = candidates.find(({ index }) => index === choice);
    if (!picked) return undefined;
    try {
      const locator = await resolveTarget(page, picked.e.locatorCandidates);
      await performAction(locator, "click");
    } catch {
      return undefined;
    }
  }
  const final = await settle(
    page,
    runId,
    { ...config, captureScreenshots: false },
    recipe,
    depth,
    worker,
  );
  return final.state.url === targetUrl ? final : undefined;
}

async function askModel(
  fromUrl: string,
  targetUrl: string,
  options: { i: number; role: string; name: string; href?: string }[],
): Promise<number | undefined> {
  const endpoint = `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'You help a web crawler get from its current page back to a previously-seen page. Given the current URL, the target URL, and a list of already-approved clickable elements, reply with strict JSON only: {"index": N} naming the element most likely to navigate toward the target, or {"index": null} if none of them would help. Never explain, never add text outside the JSON.',
        },
        {
          role: "user",
          content: JSON.stringify({ fromUrl, targetUrl, options }),
        },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return undefined;
  const result = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = result.choices?.[0]?.message?.content;
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as { index: number | null };
    return typeof parsed.index === "number" ? parsed.index : undefined;
  } catch {
    return undefined;
  }
}
