import type { Page, Locator } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import {
  hash,
  fingerprint,
  normalizeUrl,
  stableText,
  expression,
  redact,
} from "../../analysis/src/index.js";
import type {
  LocatorCandidate,
  Observation,
  ScanConfig,
  RestoreRecipe,
  UIElement,
  Component,
} from "../../shared/src/index.js";
import { artifactRoot } from "../../storage/src/index.js";
export function locator(page: Page, c: LocatorCandidate): Locator {
  const root = c.scope ? page.locator(c.scope) : page;
  switch (c.kind) {
    case "role":
      return root.getByRole(c.value as Parameters<Page["getByRole"]>[0], {
        name: c.name,
        exact: true,
      });
    case "label":
      return root.getByLabel(c.value, { exact: true });
    case "testId":
      return root.getByTestId(c.value);
    case "placeholder":
      return root.getByPlaceholder(c.value, { exact: true });
    case "text":
      return root.getByText(c.value, { exact: true });
    default:
      return root.locator(c.value);
  }
}
export async function verify(
  page: Page,
  candidates: LocatorCandidate[],
  restored = false,
): Promise<LocatorCandidate[]> {
  return Promise.all(
    candidates.map(async (c) => {
      try {
        const l = locator(page, c);
        const count = await l.count();
        const valid = count === 1 && (await l.isVisible());
        return {
          ...c,
          uniqueAtDiscovery: restored ? c.uniqueAtDiscovery : valid,
          verifiedAfterRestore: restored ? valid : c.verifiedAfterRestore,
          score: valid ? c.score : Math.min(15, c.score),
          reasons: [
            ...new Set([
              ...c.reasons,
              valid
                ? "Resolves to one visible element"
                : `Resolves to ${count} elements or is hidden`,
            ]),
          ],
          failures: valid
            ? c.failures
            : [
                ...c.failures,
                restored
                  ? "Did not resolve after restoration"
                  : "Ambiguous or hidden at discovery",
              ],
        };
      } catch {
        return {
          ...c,
          score: 0,
          uniqueAtDiscovery: restored ? c.uniqueAtDiscovery : false,
          verifiedAfterRestore: restored ? false : c.verifiedAfterRestore,
          failures: [...c.failures, "Invalid selector"],
        };
      }
    }),
  );
}
export async function resolveTarget(
  page: Page,
  candidates: LocatorCandidate[],
): Promise<Locator> {
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    const l = locator(page, c);
    try {
      if (
        (await l.count()) === 1 &&
        (await l.isVisible()) &&
        (await l.isEnabled())
      )
        return l;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("LOCATOR_UNREACHABLE: no unique visible enabled candidate");
}
export async function stabilize(page: Page, ms: number) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 3000 })
    .catch(() => {});
  await page
    .evaluate(async (delay) => {
      await new Promise<void>((resolve) => {
        let quiet: ReturnType<typeof setTimeout>;
        const done = () => {
          clearTimeout(quiet);
          clearTimeout(cap);
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(done, delay);
        });
        const cap = setTimeout(done, Math.max(1000, delay * 4));
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        quiet = setTimeout(done, delay);
      });
    }, ms)
    .catch(() => {});
}
export async function observe(
  page: Page,
  runId: string,
  config: ScanConfig,
  recipe: RestoreRecipe,
  depth: number,
  worker: number,
  provenanceActionId?: string,
  browserTabId?: string,
  browserTabParentId?: string,
): Promise<Observation> {
  const raw = await page.evaluate(
    (syntheticValues) => {
      const modal = document.querySelector("dialog:modal");
      const visible = (e: Element) => {
        if (e.closest("[data-private],[data-sensitive]")) return false;
        const closed = e.closest("details:not([open])");
        if (
          closed &&
          e !== closed &&
          !closed.querySelector("summary")?.contains(e)
        )
          return false;
        if (modal && !modal.contains(e) && !e.contains(modal)) return false;
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        if (
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= innerHeight &&
          r.right <= innerWidth
        ) {
          const top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          if (
            top &&
            top !== e &&
            !e.contains(top) &&
            top.closest("dialog,[role=dialog],[data-drawer],[role=menu]")
          )
            return false;
        }
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          !e.closest('[aria-hidden="true"],[inert]')
        );
      };
      const text = (e: Element | null) =>
        e
          ? (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180)
          : "";
      const name = (e: Element) =>
        e.getAttribute("aria-label") ||
        (e.getAttribute("aria-labelledby") || "")
          .split(" ")
          .map((id) => text(document.getElementById(id)))
          .filter(Boolean)
          .join(" ") ||
        (e instanceof HTMLInputElement ||
        e instanceof HTMLTextAreaElement ||
        e instanceof HTMLSelectElement
          ? Array.from(e.labels || [])
              .map(text)
              .join(" ")
          : "") ||
        e.getAttribute("alt") ||
        e.getAttribute("title") ||
        text(e);
      const css = (e: Element): string => {
        if (e.getAttribute("data-testid"))
          return `[data-testid=${JSON.stringify(e.getAttribute("data-testid"))}]`;
        if (e.id && !/[0-9]{4,}|[a-f0-9]{8,}|:r/.test(e.id))
          return "#" + CSS.escape(e.id);
        let p = e.tagName.toLowerCase();
        const siblings = e.parentElement
          ? Array.from(e.parentElement.children).filter(
              (s) => s.tagName === e.tagName,
            )
          : [];
        if (siblings.length > 1)
          p += `:nth-of-type(${siblings.indexOf(e) + 1})`;
        return e.parentElement && e.parentElement.tagName !== "BODY"
          ? css(e.parentElement) + " > " + p
          : p;
      };
      const semantic =
        'header,nav,main,form,dialog,table,[role="dialog"],[role="navigation"],[role="toolbar"],[role="menu"],article,[data-component],[data-drawer]';
      const containers = Array.from(document.querySelectorAll(semantic)).filter(
        visible,
      );
      // Repeated siblings need matching structure, meaningful content and a visible layout boundary.
      const shape = (e: Element, depth = 0): string =>
        `${e.tagName.toLowerCase()}:${e.getAttribute("role") || ""}${
          depth < 3
            ? "[" +
              Array.from(e.children)
                .map((child) => shape(child, depth + 1))
                .join(",") +
              "]"
            : ""
        }`;
      const repeated = new Map<Element, { family: string; count: number }>();
      for (const parent of Array.from(
        document.querySelectorAll("main,section,ul,ol,div,tbody"),
      )) {
        const groups = new Map<string, Element[]>();
        for (const child of Array.from(parent.children)) {
          if (
            !child.matches("div,li,tr,article,section") ||
            !visible(child) ||
            child.children.length < 2
          )
            continue;
          if (!child.querySelector("h2,h3,h4,a,button,input,td,[role=button]"))
            continue;
          const box = child.getBoundingClientRect();
          if (box.width < 80 || box.height < 24) continue;
          const key = shape(child);
          groups.set(key, [...(groups.get(key) || []), child]);
        }
        for (const [family, members] of groups)
          if (members.length >= 3) {
            for (const member of members) {
              repeated.set(member, { family, count: members.length });
              if (!containers.includes(member)) containers.push(member);
            }
          }
      }
      const containerFor = (element: Element | null) => {
        for (let e = element; e; e = e.parentElement)
          if (containers.includes(e)) return e;
        return null;
      };
      const regions = Array.from(
        document.querySelectorAll(
          'dialog,[role="dialog"],[data-drawer],[role="menu"],[role="tooltip"],form,[role="tab"][aria-selected="true"],details[open]',
        ),
      )
        .filter(visible)
        .map(
          (e) =>
            `${e.hasAttribute("data-drawer") ? "drawer" : e.matches('dialog,[role="dialog"]') ? "dialog" : e.getAttribute("role") || e.tagName.toLowerCase()}:${name(e).slice(0, 90)}`,
        );
      const els = Array.from(
        document.querySelectorAll(
          'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"],[role="menuitem"],[role="combobox"],[aria-haspopup],[data-tooltip],[tabindex="0"]',
        ),
      )
        .filter(visible)
        .map((e) => {
          const tag = e.tagName.toLowerCase();
          const inputType = e.getAttribute("type") || "";
          const role =
            e.getAttribute("role") ||
            {
              a: "link",
              button: "button",
              select: "combobox",
              textarea: "textbox",
              summary: "button",
            }[tag] ||
            (tag === "input"
              ? ["button", "submit", "reset"].includes(inputType)
                ? "button"
                : inputType === "checkbox"
                  ? "checkbox"
                  : inputType === "radio"
                    ? "radio"
                    : "textbox"
              : "");
          const parent = containerFor(e),
            box = e.getBoundingClientRect();
          const isFormControl =
            e instanceof HTMLInputElement ||
            e instanceof HTMLTextAreaElement ||
            e instanceof HTMLSelectElement ||
            e instanceof HTMLButtonElement;
          const form = isFormControl ? e.form : null;
          const formIndex = form
            ? Array.from(document.forms).indexOf(form)
            : -1;
          const formId = form
            ? form.id || `observed-form-${formIndex + 1}`
            : undefined;
          const validationControl =
            e instanceof HTMLInputElement ||
            e instanceof HTMLTextAreaElement ||
            e instanceof HTMLSelectElement
              ? e
              : undefined;
          const validity = validationControl?.validity;
          return {
            tag,
            role,
            name: name(e),
            text: text(e),
            css: css(e),
            testId: e.getAttribute("data-testid"),
            placeholder: e.getAttribute("placeholder"),
            label:
              e instanceof HTMLInputElement ||
              e instanceof HTMLTextAreaElement ||
              e instanceof HTMLSelectElement
                ? Array.from(e.labels || [])
                    .map(text)
                    .join(" ")
                : "",
            href: e instanceof HTMLAnchorElement ? e.href : undefined,
            inputType,
            valueState:
              syntheticValues.some((v) => v.label === name(e)) &&
              (e instanceof HTMLInputElement ||
                e instanceof HTMLTextAreaElement ||
                e instanceof HTMLSelectElement)
                ? syntheticValues.some(
                    (v) => v.label === name(e) && v.value === e.value,
                  )
                  ? ("configured" as const)
                  : ("pending" as const)
                : undefined,
            expanded:
              e.getAttribute("aria-expanded") ??
              (tag === "summary"
                ? String(e.parentElement?.hasAttribute("open"))
                : undefined),
            selected: e.getAttribute("aria-selected") ?? undefined,
            hasPopup:
              e.getAttribute("aria-haspopup") ??
              (e.hasAttribute("data-tooltip") ? "tooltip" : undefined),
            controls: e.getAttribute("aria-controls") ?? undefined,
            disabled: e.matches(':disabled,[aria-disabled="true"]'),
            isSubmit:
              (e instanceof HTMLButtonElement &&
                e.type === "submit" &&
                !!e.form) ||
              (e instanceof HTMLInputElement &&
                e.type === "submit" &&
                !!e.form),
            formId,
            formNoValidate:
              e instanceof HTMLButtonElement || e instanceof HTMLInputElement
                ? e.formNoValidate
                : undefined,
            validationEvidence: validity
              ? {
                  required: validationControl?.required ?? false,
                  ariaInvalid: e.getAttribute("aria-invalid") === "true",
                  cssInvalid: e.matches(":invalid"),
                  willValidate: validationControl?.willValidate ?? false,
                  valid: validity.valid,
                  valueMissing: validity.valueMissing,
                  typeMismatch: validity.typeMismatch,
                  patternMismatch: validity.patternMismatch,
                  tooLong: validity.tooLong,
                  tooShort: validity.tooShort,
                  rangeUnderflow: validity.rangeUnderflow,
                  rangeOverflow: validity.rangeOverflow,
                  stepMismatch: validity.stepMismatch,
                  badInput: validity.badInput,
                  customError: validity.customError,
                }
              : undefined,
            container: parent ? containers.indexOf(parent) : -1,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
          };
        });
      const components = containers.map((e) => ({
        name:
          e.getAttribute("aria-label") ||
          text(e.querySelector("h1,h2,h3,legend,caption")) ||
          e.getAttribute("data-component") ||
          e.tagName.toLowerCase(),
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute("role"),
        css: css(e),
        box: (() => {
          const box = e.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        })(),
        parent: containers.indexOf(containerFor(e.parentElement) as Element),
        repeated: repeated.get(e),
      }));
      const main = (document.querySelector("main") || document.body).cloneNode(
        true,
      ) as HTMLElement;
      main
        .querySelectorAll(
          'input,textarea,script,style,[data-private],[data-sensitive],[aria-hidden="true"],time',
        )
        .forEach((e) => e.remove());
      return {
        title: document.title,
        regions,
        els,
        components,
        mainText: main.textContent || "",
        links: Array.from(document.querySelectorAll("a[href]:not([download])"))
          .filter(visible)
          .map((e) => (e as HTMLAnchorElement).href),
      };
    },
    config.formValues.filter((v) => v.route === new URL(page.url()).pathname),
  );
  const url = normalizeUrl(page.url(), config);
  const tokens = [
    ...raw.regions,
    ...raw.els.map(
      (e) =>
        `${e.role}:${stableText(e.name)}:expanded=${e.expanded}:selected=${e.selected}:disabled=${e.disabled}:submit=${e.isSubmit}:formNoValidate=${e.formNoValidate ?? "unknown"}${e.valueState ? `:value=${e.valueState}` : ""}${e.validationEvidence ? `:required=${e.validationEvidence.required}:ariaInvalid=${e.validationEvidence.ariaInvalid}:cssInvalid=${e.validationEvidence.cssInvalid}:willValidate=${e.validationEvidence.willValidate}:valid=${e.validationEvidence.valid}:validity=${[e.validationEvidence.valueMissing, e.validationEvidence.typeMismatch, e.validationEvidence.patternMismatch, e.validationEvidence.tooLong, e.validationEvidence.tooShort, e.validationEvidence.rangeUnderflow, e.validationEvidence.rangeOverflow, e.validationEvidence.stepMismatch, e.validationEvidence.badInput, e.validationEvidence.customError].map((flag) => Number(flag)).join("")}` : ""}`,
    ),
  ].sort();
  const fp = fingerprint(url, tokens, raw.mainText);
  const stateId = hash([runId, fp]);
  const candidates = (e: (typeof raw.els)[number]): LocatorCandidate[] => {
    const list: LocatorCandidate[] = [];
    const add = (
      kind: LocatorCandidate["kind"],
      value: string,
      score: number,
      name?: string,
      scope?: string,
    ) => {
      const c: LocatorCandidate = {
        kind,
        value,
        name,
        scope,
        score,
        uniqueAtDiscovery: false,
        verifiedAfterRestore: false,
        reasons: [
          kind === "css"
            ? "Structural CSS fallback"
            : "Semantic or stable attribute",
        ],
        failures: [],
        expression: "",
      };
      c.expression = expression(c);
      list.push(c);
    };
    if (e.role && e.name) add("role", e.role, 96, e.name);
    if (e.label) add("label", e.label, 95);
    if (e.testId) add("testId", e.testId, 93);
    if (e.placeholder) add("placeholder", e.placeholder, 85);
    if (e.container >= 0 && e.role && e.name)
      add("role", e.role, 88, e.name, raw.components[e.container].css);
    add("css", e.css, e.css.includes("nth-") ? 35 : 70);
    return list;
  };
  const elements: UIElement[] = await Promise.all(
    raw.els.map(async (e, index) => ({
      id: hash([stateId, index, e.css]),
      stateId,
      role: e.role,
      accessibleName: redact(e.name),
      tag: e.tag,
      textSnippet: redact(e.text),
      structuralSignature: hash([e.role, e.name, e.css]),
      containerId:
        e.container >= 0
          ? hash([stateId, "component", e.container])
          : undefined,
      locatorCandidates: await verify(page, candidates(e)),
      href: e.href ? normalizeUrl(e.href, config) : undefined,
      inputType: e.inputType,
      valueState: e.valueState,
      expanded: e.expanded,
      selected: e.selected,
      hasPopup: e.hasPopup,
      controls: e.controls,
      disabled: e.disabled,
      isSubmit: e.isSubmit,
      formId: e.formId,
      formNoValidate: e.formNoValidate,
      validationEvidence: e.validationEvidence,
      box: e.box,
    })),
  );
  const components: Component[] = await Promise.all(
    raw.components.map(async (c, index) => {
      const id = hash([stateId, "component", index]);
      const kind: Component["kind"] =
        c.role === "dialog" || c.tag === "dialog"
          ? "dialog"
          : c.role === "navigation" || c.tag === "nav"
            ? "navigation"
            : c.role === "toolbar"
              ? "toolbar"
              : c.tag === "article" || (c.repeated && c.tag !== "tr")
                ? "card"
                : ["header", "form", "table"].includes(c.tag)
                  ? (c.tag as Component["kind"])
                  : "custom";
      const candidate: LocatorCandidate = {
        kind: "css",
        value: c.css,
        expression: expression({ kind: "css", value: c.css }),
        uniqueAtDiscovery: false,
        verifiedAfterRestore: false,
        score: c.css.includes("nth-") ? 40 : 80,
        reasons: ["Semantic container root"],
        failures: [],
      };
      return {
        id,
        stateId,
        name: redact(c.name),
        familyId: c.repeated
          ? hash(["repeated", c.repeated.family])
          : undefined,
        kind,
        rootLocator: (await verify(page, [candidate]))[0],
        box: c.box,
        elementIds: elements
          .filter((e) => e.containerId === id)
          .map((e) => e.id),
        childComponentIds: raw.components.flatMap((child, j) =>
          child.parent === index ? [hash([stateId, "component", j])] : [],
        ),
        classificationEvidence: [
          ...(c.repeated
            ? [
                `Repeated DOM shape across ${c.repeated.count} visible siblings`,
                "Matching hierarchy, content and layout boundary",
              ]
            : [`Semantic ${c.tag} element`]),
          ...(c.role ? [`ARIA role: ${c.role}`] : []),
        ],
        confidence: c.repeated ? 0.82 : c.tag === "main" ? 0.8 : 0.94,
      };
    }),
  );
  let screenshotPath: string | undefined;
  if (config.captureScreenshots) {
    screenshotPath = `${runId}/evidence/screenshots/${stateId}.png`;
    const path = resolve(artifactRoot(), screenshotPath);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({
      path,
      fullPage: false,
      animations: "disabled",
      mask: config.redactSelectors.map((s) => page.locator(s)),
      maskColor: "#a2adbd",
    });
  }
  const u = new URL(url);
  return {
    state: {
      id: stateId,
      runId,
      url,
      routeKey: u.origin + u.pathname,
      fingerprint: fp,
      fingerprintVersion: 1,
      fingerprintReason:
        "Normalized URL, visible regions, control semantics and stable main content; conservative similarity fallback",
      structureTokens: tokens,
      title: redact(raw.title),
      visibleRegionSummary: raw.regions.map(redact),
      interactiveElementIds: elements.map((e) => e.id),
      screenshotPath,
      discoveredAt: new Date().toISOString(),
      depth,
      worker,
      browserTabId,
      browserTabParentId,
      recipe,
      mainText: stableText(raw.mainText),
      provenanceActionId,
    },
    elements,
    components,
    links: raw.links
      .filter((l) => /^https?:/.test(l))
      .map((l) => normalizeUrl(l, config)),
    observedAt: new Date().toISOString(),
  };
}
