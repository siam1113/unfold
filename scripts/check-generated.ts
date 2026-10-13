import { Store } from "../packages/storage/src/index.js";
import { execFileSync } from "node:child_process";
const store = new Store();
const id = process.argv[2] || store.list()[0]?.id;
if (!id) throw new Error("Run a discovery first");
try {
  execFileSync(
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      `artifacts/${id}/generated/tsconfig.json`,
    ],
    { stdio: "inherit" },
  );
  console.log(`Generated TypeScript passes: ${id}`);
} finally {
  store.close();
}
