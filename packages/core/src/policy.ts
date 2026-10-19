import type {
  PolicyDecision,
  ScanConfig,
  UIElement,
} from "../../shared/src/index.js";
export function allowedUrl(raw: string, c: ScanConfig): boolean {
  try {
    const u = new URL(raw);
    // An empty allowedOrigins is "no restriction configured", not "same
    // origin only" — plenty of real apps render using scripts/styles/fonts
    // from third-party CDNs (e.g. Angular's zone.js), and blocking those by
    // default breaks the target app's own bootstrap rather than scoping the
    // crawl. Origin scoping only kicks in once a project explicitly lists
    // origins to restrict to.
    const inScope =
      c.allowedOrigins.length === 0 ||
      [new URL(c.baseUrl).origin, ...c.allowedOrigins].includes(u.origin);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      inScope &&
      !c.denyUrlPatterns.some((p) => u.href.includes(p)) &&
      (!c.allowUrlPatterns.length ||
        c.allowUrlPatterns.some((p) => u.href.includes(p)))
    );
  } catch {
    return false;
  }
}
export function riskyUrl(raw: string, c: ScanConfig): boolean {
  try {
    return c.denyActionKeywords.some((k) =>
      decodeURIComponent(new URL(raw).pathname + new URL(raw).search)
        .toLowerCase()
        .includes(k.toLowerCase()),
    );
  } catch {
    return true;
  }
}
export function decide(
  element: UIElement,
  url: string,
  config: ScanConfig,
  action = "click",
): PolicyDecision {
  const result = (
    allowed: boolean,
    rule: string,
    reason: string,
  ): PolicyDecision => ({ allowed, rule, reason, intent: "unknown" });
  const route = new URL(url).pathname;
  const name = element.accessibleName;
  if (element.disabled) return result(false, "disabled", "Control is disabled");
  if (element.href && !allowedUrl(element.href, config))
    return result(
      false,
      "origin",
      "Destination is outside the configured URL scope",
    );
  const approved = config.actionAllowlist.some(
    (a) => a.route === route && a.name === name,
  );
  const submitApproved = config.formSubmitAllowlist.some(
    (a) => a.route === route && a.name === name,
  );
  // Submitting a form is where real side effects live (emails sent, records
  // created, real writes on the live target), so it stays gated behind an
  // exact allowlist entry — UNLESS the project has explicitly turned
  // safeMode off, the same single toggle users already use to say "this run
  // may cause real writes." safeMode is Unfold's own crawl-time policy knob,
  // distinct from `dryRun` (inventory-only) and `approved`/`submitApproved`
  // (explicit per-control opt-in) above.
  if (element.isSubmit && !submitApproved && config.safeMode)
    return result(
      false,
      "form-submit",
      "Form submission requires an exact route and control allowlist entry (or disabling safeMode)",
    );
  if (
    config.denyActionKeywords.some((k) =>
      (name + " " + (element.href || ""))
        .toLowerCase()
        .includes(k.toLowerCase()),
    ) &&
    !approved &&
    !submitApproved
  )
    return result(
      false,
      "high-risk",
      "Control matches a blocked action keyword",
    );
  if (config.dryRun)
    return result(
      false,
      "dry-run",
      "Dry run: action inventoried without activation",
    );
  // Typing into a field is non-destructive on its own (nothing is sent
  // anywhere until some later submit action, which has its own gate above) —
  // always allowed, using the project's own configured value for this exact
  // route+label when one exists, or an obviously-synthetic auto-generated
  // one otherwise (packages/shared/src/index.ts's synthesizeFormValue,
  // applied in packages/worker/src/index.ts's act()).
  if (action === "fill" || action === "select")
    return config.formValues.some((v) => v.route === route && v.label === name)
      ? result(true, "synthetic-value", "Configured synthetic field value")
      : result(
          true,
          "auto-synthetic-value",
          "Auto-synthesized field value (no explicit override configured)",
        );
  if (approved || submitApproved)
    return result(
      true,
      "explicit-allowlist",
      "Exact route and control explicitly allowed",
    );
  if (element.href)
    return result(true, "navigation", "Allowed internal navigation");
  if (action === "hover")
    return result(true, "hover", "Non-committing hover probe");
  if (
    ["tab", "menuitem"].includes(element.role) ||
    element.expanded !== undefined ||
    element.hasPopup ||
    element.controls ||
    element.tag === "summary"
  )
    return result(
      true,
      "ui-container",
      "Semantic UI disclosure or selection control",
    );
  if (!config.safeMode)
    return result(
      true,
      "configured-exploration",
      "Unknown control permitted by configured exploration mode",
    );
  return result(
    false,
    "unknown-intent",
    "No safe interaction semantics; add an exact action allowlist entry to explore",
  );
}
