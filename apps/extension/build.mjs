import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
// Resolved against this file's own location, not `process.cwd()` — this
// script is also invoked as `node apps/extension/build.mjs` from the repo
// root (package.json's `extension:watch`/`extension:build`), where the CWD
// is NOT `apps/extension/`. `outdir` already got this right; `entryPoints`
// didn't, and silently resolved against the wrong base the moment it was
// run from anywhere else.
const srcdir = new URL("./src/", import.meta.url).pathname;
const outdir = new URL("./dist/", import.meta.url).pathname;
mkdirSync(outdir, { recursive: true });

const buildOptions = {
  entryPoints: {
    background: `${srcdir}background.ts`,
    "content-isolated": `${srcdir}content-isolated.ts`,
    "content-main": `${srcdir}content-main.ts`,
    options: `${srcdir}options.ts`,
  },
  outdir,
  bundle: true,
  // Plain classic (non-module) bundles for every entry — the MV3 service
  // worker, the two dynamically-registered content scripts, and the options
  // page all work this way with zero ambiguity about ESM support in each
  // context, unlike mixing `"type":"module"` in the manifest for only some
  // of them.
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
};

cpSync(new URL("./manifest.json", import.meta.url), `${outdir}manifest.json`);
cpSync(new URL("./src/options.html", import.meta.url), `${outdir}options.html`);

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("Watching apps/extension for changes…");
} else {
  await build(buildOptions);
}
