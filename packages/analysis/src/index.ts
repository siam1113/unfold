import { createHash } from "node:crypto";
import type {
  AppState,
  LocatorCandidate,
  ScanConfig,
} from "../../shared/src/index.js";
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
export function redact(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(
      /((?:password|token|secret|authorization|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/gi,
      "$1[redacted]",
    )
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]");
}
export function normalizeUrl(raw: string, config: ScanConfig): string {
  const u = new URL(raw);
  u.username = "";
  u.password = "";
  for (const key of [...u.searchParams.keys()]) {
    if (config.ignoreQueryParams.includes(key)) u.searchParams.delete(key);
    else if (/token|secret|password|auth|key|session|code/i.test(key))
      u.searchParams.set(key, "[redacted]");
  }
  u.searchParams.sort();
  return u.toString();
}
export function stableText(text: string): string {
  return redact(text)
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?\b/g, "[date]")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "[time]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}
export function fingerprint(url: string, tokens: string[], mainText: string) {
  return hash([url, [...tokens].sort(), stableText(mainText)]);
}
export function equivalent(a: AppState, b: AppState): boolean {
  if (a.fingerprint === b.fingerprint) return true;
  // Similarity is deliberately conservative: never merge different control/region inventories.
  if (
    a.url !== b.url ||
    a.structureTokens.join("|") !== b.structureTokens.join("|")
  )
    return false;
  const x = new Set(stableText(a.mainText).split(" ")),
    y = new Set(stableText(b.mainText).split(" "));
  const intersection = [...x].filter((t) => y.has(t)).length;
  return intersection / Math.max(1, new Set([...x, ...y]).size) > 0.985;
}
export function expression(
  c: Pick<LocatorCandidate, "kind" | "value" | "name" | "scope">,
  receiver = "page",
): string {
  const root = c.scope
    ? `${receiver}.locator(${JSON.stringify(c.scope)})`
    : receiver;
  if (c.kind === "role")
    return `${root}.getByRole(${JSON.stringify(c.value)}, { name: ${JSON.stringify(c.name || "")}, exact: true })`;
  const method = {
    label: "getByLabel",
    testId: "getByTestId",
    placeholder: "getByPlaceholder",
    text: "getByText",
    css: "locator",
  }[c.kind];
  return `${root}.${method}(${JSON.stringify(c.value)}${["label", "placeholder", "text"].includes(c.kind) ? ", { exact: true }" : ""})`;
}
export function classify(
  before: AppState,
  after: AppState,
  events: string[],
): string[] {
  const flags = new Set(
    events.filter((e) =>
      [
        "open_new_tab",
        "download",
        "external_navigation",
        "submit_form",
      ].includes(e),
    ),
  );
  if (before.url !== after.url && !flags.has("open_new_tab"))
    flags.add("navigate_same_tab");
  const additions = after.visibleRegionSummary.filter(
    (r) => !before.visibleRegionSummary.includes(r),
  );
  for (const r of before.url === after.url ? additions : []) {
    if (r.startsWith("drawer:")) flags.add("open_drawer");
    else if (r.startsWith("dialog:")) flags.add("open_modal");
    else if (r.startsWith("menu:")) flags.add("open_menu");
    else if (r.startsWith("form:")) flags.add("reveal_form");
    else if (r.startsWith("tooltip:")) flags.add("show_tooltip");
  }
  const novel = after.structureTokens.filter(
    (t) => !before.structureTokens.includes(t),
  );
  if (
    before.url === after.url &&
    novel.some((t) => t.includes("selected=true"))
  )
    flags.add("switch_tab");
  if (
    before.url === after.url &&
    novel.some((t) => t.includes("expanded=true"))
  )
    flags.add("expand_region");
  if (before.fingerprint !== after.fingerprint) flags.add("change_content");
  if (!flags.size) flags.add("no_observed_change");
  return [...flags];
}
