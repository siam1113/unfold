import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Store, artifactRoot } from "../../storage/src/index.js";
import { expression } from "../../analysis/src/index.js";
import type { UIElement } from "../../shared/src/index.js";
const identifier = (value: string) => {
  const clean = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join("");
  return /^[a-zA-Z]/.test(clean) ? clean : "Element" + clean;
};
const safeComment = (s: string) =>
  s.replace(/[\r\n\u2028\u2029]/g, " ").replace(/\*\//g, "* /");
export async function exportRun(store: Store, id: string) {
  const data = store.data(id);
  const dir = resolve(artifactRoot(), id);
  await Promise.all(
    ["generated/pages", "generated/components", "report"].map((p) =>
      mkdir(resolve(dir, p), { recursive: true }),
    ),
  );
  // Remove stale source files when a paused run is exported again.
  const { unlink } = await import("node:fs/promises");
  for (const folder of ["pages", "components"])
    for (const name of await readdir(resolve(dir, "generated", folder)))
      if (name.endsWith(".ts"))
        await unlink(resolve(dir, "generated", folder, name));
  const exports: string[] = [];
  const manifest: { className: string; stateId: string; getters: string[] }[] =
    [];
  const getter = (e: UIElement, index: number) => {
    const candidate = [...e.locatorCandidates]
      .filter((c) => c.verifiedAfterRestore && c.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) return "";
    const key = identifier(e.accessibleName || e.tag) + index;
    return `  // ${safeComment(e.accessibleName)}; verified after restoring state ${safeComment(e.stateId)}\n  get ${key}(): Locator { return ${expression(candidate, "this.page")}; }\n`;
  };
  for (const state of data.states) {
    const name = `${identifier(new URL(state.url).pathname === "/" ? "Home" : new URL(state.url).pathname)}State${state.id.slice(0, 6)}`;
    const els = data.elements.filter((e) => e.stateId === state.id);
    const eligible = els.filter((e) =>
      e.locatorCandidates.some((c) => c.verifiedAfterRestore),
    );
    if (!eligible.length) continue;
    manifest.push({
      className: name,
      stateId: state.id,
      getters: eligible.map(
        (e, i) => identifier(e.accessibleName || e.tag) + i,
      ),
    });
    const replay = state.recipe.steps
      .map((s, i) => {
        const c = [...s.locators]
          .filter((c) => c.verifiedAfterRestore)
          .sort((a, b) => b.score - a.score)[0];
        if (!c) return '    throw new Error("Replay locator is unverified");';
        if (s.action === "fill" || s.action === "select")
          return `    if (values[${JSON.stringify(s.valueKey)}] === undefined) throw new Error("Supply the configured synthetic value");\n    await ${expression(c, "this.page")}.${s.action === "select" ? "selectOption" : "fill"}(values[${JSON.stringify(s.valueKey)}]);`;
        return `    await ${expression(c, "this.page")}.${s.action === "hover" ? "hover" : "click"}();`;
      })
      .join("\n");
    const methods = data.actions
      .filter(
        (a) =>
          a.fromStateId === state.id &&
          a.decision === "executed" &&
          a.action === "click",
      )
      .flatMap((a, i) => {
        const el = eligible.find((e) => e.id === a.elementId);
        if (!el) return [];
        const c = [...el.locatorCandidates]
          .filter((c) => c.verifiedAfterRestore)
          .sort((a, b) => b.score - a.score)[0];
        const check =
          a.effectFlags.includes("navigate_same_tab") && a.afterUrl
            ? ` await this.page.waitForURL(${JSON.stringify(a.afterUrl)});`
            : "";
        return [
          `  // Observed effects: ${safeComment(a.effectFlags.join(", "))}. Restore this state before calling.\n  async activate${identifier(el.accessibleName || "Control")}${i}(): Promise<void> { await ${expression(c, "this.page")}.click();${check} }`,
        ];
      })
      .join("\n");
    const source = `import type { Page, Locator } from 'playwright';\n\n/** Verified controls for ${safeComment(state.url)}. Business assertions require review. */\nexport class ${name} {\n  constructor(private readonly page: Page) {}\n  async restore(values: Record<string, string> = {}): Promise<void> {\n    await this.page.goto(${JSON.stringify(state.recipe.seed)});\n${replay}\n  }\n${eligible.map(getter).join("")}\n${methods}\n}\n`;
    await writeFile(resolve(dir, "generated/pages", `${name}.ts`), source);
    exports.push(`export { ${name} } from './pages/${name}.js';`);
  }
  for (const component of data.components.filter(
    (c) => c.rootLocator.verifiedAfterRestore,
  )) {
    const name = `${identifier(component.name)}Component${component.id.slice(0, 6)}`;
    const els = data.elements.filter((e) =>
      component.elementIds.includes(e.id),
    );
    manifest.push({
      className: name,
      stateId: component.stateId,
      getters: [
        "root",
        ...els.flatMap((e, i) =>
          e.locatorCandidates.some((c) => c.verifiedAfterRestore && c.score > 0)
            ? [identifier(e.accessibleName || e.tag) + i]
            : [],
        ),
      ],
    });
    await writeFile(
      resolve(dir, "generated/components", `${name}.ts`),
      `import type { Page, Locator } from 'playwright';\n\nexport class ${name} {\n  constructor(private readonly page: Page) {}\n  get root(): Locator { return ${expression(component.rootLocator, "this.page")}; }\n${els.map(getter).join("")}\n}\n`,
    );
    exports.push(`export { ${name} } from './components/${name}.js';`);
  }
  await writeFile(
    resolve(dir, "generated/manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    resolve(dir, "generated/index.ts"),
    exports.join("\n") + "\n",
  );
  await writeFile(
    resolve(dir, "generated/README.md"),
    "# Observed automation\n\nInstall playwright and import index.ts. Each state class has a restore() method and only exposes controls verified after replay. Call restore before an action helper. Helpers record observed interactions; they do not assert business correctness. Supply authentication with your own BrowserContext. Synthetic form values are parameters, never embedded.\n",
  );
  await writeFile(
    resolve(dir, "generated/tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["**/*.ts"],
      },
      null,
      2,
    ),
  );
  const files = {
    run: data.run,
    states: data.states,
    elements: data.elements,
    components: data.components,
    actions: data.actions,
    apiCalls: data.apiCalls,
    graph: { nodes: data.states, edges: data.actions },
    events: data.events,
  };
  await Promise.all(
    Object.entries(files).map(([key, value]) =>
      writeFile(resolve(dir, `${key}.json`), JSON.stringify(value, null, 2)),
    ),
  );
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  await writeFile(
    resolve(dir, "report/index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unfold discovery report</title><style>body{font:15px system-ui;background:#eef2f7;color:#263b54;max-width:1100px;margin:50px auto;padding:24px}input{padding:12px;width:80%;border:1px solid #c3ceda;border-radius:8px}article{background:white;padding:20px;margin:12px 0;border-radius:12px}small{color:#5c6d81}img{max-width:100%}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1 id="title"></h1><p id="stats"></p><input id="search" aria-label="Search states" placeholder="Search states, routes, or visible regions"><div id="states"></div><script type="application/json" id="data">${payload}</script><script>const d=JSON.parse(document.getElementById('data').textContent);document.getElementById('title').textContent=d.run.name;document.getElementById('stats').textContent=d.states.length+' states · '+d.run.stats.routes+' routes · '+d.actions.length+' action records';function render(){const q=document.getElementById('search').value.toLowerCase();const root=document.getElementById('states');root.replaceChildren();for(const s of d.states.filter(s=>JSON.stringify(s).toLowerCase().includes(q))){const a=document.createElement('article');const h=document.createElement('h2');h.textContent=s.title;a.append(h);const p=document.createElement('p');p.textContent=s.url+' — '+s.visibleRegionSummary.join(', ');a.append(p);if(s.screenshotPath){const im=document.createElement('img');im.src='../evidence/screenshots/'+s.screenshotPath.split('/').pop();im.alt='Captured state';im.loading='lazy';a.append(im)}const detail=document.createElement('details');const label=document.createElement('summary');label.textContent='Actions and evidence';detail.append(label);const pre=document.createElement('pre');pre.textContent=JSON.stringify(d.actions.filter(e=>e.fromStateId===s.id),null,2);detail.append(pre);a.append(detail);root.append(a)}}document.getElementById('search').oninput=render;render();</script></html>`,
  );
  return dir;
}
