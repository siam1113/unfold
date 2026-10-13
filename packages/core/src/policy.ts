import type {
  PolicyDecision,
  ScanConfig,
  UIElement,
} from "../../shared/src/index.js";
export function allowedUrl(raw: string, c: ScanConfig): boolean {
  try {
    const u = new URL(raw);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      [new URL(c.baseUrl).origin, ...c.allowedOrigins].includes(u.origin) &&
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
  if (element.isSubmit && !submitApproved)
    return result(
      false,
      "form-submit",
      "Form submission requires an exact route and control allowlist entry",
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
  if (action === "fill" || action === "select")
    return result(
      config.formValues.some((v) => v.route === route && v.label === name),
      "synthetic-value",
      "Only configured synthetic field values may be filled",
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
