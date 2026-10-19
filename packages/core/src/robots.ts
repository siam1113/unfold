import type { ScanConfig } from "../../shared/src/index.js";

const normalize = (value: string) =>
  value
    .replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c))
    .replace(/%[0-9a-f]{2}/gi, (c) => {
      const decoded = String.fromCharCode(parseInt(c.slice(1), 16));
      return /[a-z0-9._~-]/i.test(decoded) ? decoded : c.toUpperCase();
    });
export function parseRobots(text: string) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
    delay: number;
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  let hasDirective = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.split("#")[0].match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(),
      value = match[2];
    if (key === "user-agent") {
      if (!group || hasDirective) {
        group = { agents: [], rules: [], delay: 0 };
        groups.push(group);
        hasDirective = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      if (key === "allow" || key === "disallow") {
        hasDirective = true;
        if (value.startsWith("/"))
          group.rules.push({ allow: key === "allow", path: normalize(value) });
      } else if (key === "crawl-delay") {
        hasDirective = true;
        if (/^\d+(\.\d+)?$/.test(value))
          group.delay = Math.max(group.delay, Number(value) * 1000);
      }
    }
  }
  const specific = groups.filter((g) => g.agents.includes("unfold"));
  const selected = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  const rules = selected.flatMap((g) => g.rules);
  return {
    delayMs: Math.max(0, ...selected.map((g) => g.delay)),
    allows(raw: string) {
      const u = new URL(raw);
      if (u.pathname === "/robots.txt") return true;
      const path = normalize(u.pathname + u.search);
      const matches = rules
        .filter((r) => {
          const end = r.path.endsWith("$");
          const pattern = (end ? r.path.slice(0, -1) : r.path)
            .split("*")
            .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*");
          return new RegExp("^" + pattern + (end ? "$" : "")).test(path);
        })
        .sort(
          (a, b) =>
            Buffer.byteLength(b.path) - Buffer.byteLength(a.path) ||
            Number(b.allow) - Number(a.allow),
        );
      return matches[0]?.allow ?? true;
    },
  };
}

export class RobotsPolicy {
  private policies = new Map<string, ReturnType<typeof parseRobots>>();
  constructor(
    private config: ScanConfig,
    private log: (message: string) => void,
  ) {}
  async load() {
    for (const origin of new Set([
      new URL(this.config.baseUrl).origin,
      ...this.config.allowedOrigins,
    ])) {
      let url = origin + "/robots.txt";
      try {
        let response: Response | undefined;
        for (let redirects = 0; redirects <= 5; redirects++) {
          response = await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.timeout(5000),
            headers: {
              "User-Agent": "Unfold/1.0 (authorized application discovery)",
            },
          });
          if (response.status < 300 || response.status >= 400) break;
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error("missing redirect destination");
          url = new URL(location, url).href;
          if (
            ![origin, ...this.config.allowedOrigins].includes(
              new URL(url).origin,
            )
          )
            throw new Error("redirect outside allowed origins");
          if (redirects === 5) throw new Error("redirect limit");
        }
        if (!response || response.status >= 500 || response.status === 429)
          throw new Error("service unavailable");
        if (response.status >= 400) {
          await response.body?.cancel();
          this.policies.set(origin, parseRobots(""));
          this.log(
            `Robots ${origin}: unavailable (${response.status}), no rules`,
          );
          continue;
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        if (reader)
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              length += result.value.length;
              if (length > 512000)
                throw new Error("robots file exceeds 500 KiB limit");
              chunks.push(result.value);
            }
          } finally {
            await reader.cancel();
          }
        this.policies.set(
          origin,
          parseRobots(Buffer.concat(chunks).toString("utf8")),
        );
        this.log(
          `Robots ${origin}: loaded; crawl delay ${this.delay(origin)} ms`,
        );
      } catch {
        this.policies.set(origin, parseRobots("User-agent: *\nDisallow: /"));
        this.log(
          `Robots ${origin}: unreachable or outside scope; access blocked for this run`,
        );
      }
    }
  }
  allows(url: string) {
    // load() only fetches robots.txt for the base origin plus configured
    // allowedOrigins. allowedUrl() (policy.ts) already allows any origin by
    // default — an app can legitimately load from origins never listed
    // there. Falling back to false here silently re-blocked exactly those
    // requests through a second, separate gate, even though the origin
    // policy itself had already allowed them (e.g. a side nav populated
    // from a different origin than the app's own, never rendering).
    const policy = this.policies.get(new URL(url).origin);
    return policy ? policy.allows(url) : true;
  }
  delay(origin: string) {
    return this.policies.get(origin)?.delayMs || 0;
  }
}
