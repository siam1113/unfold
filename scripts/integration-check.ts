import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/src/index.js";
import { Coordinator } from "../packages/core/src/index.js";
import type {
  ActionEdge,
  AppState,
  TaskLease,
} from "../packages/shared/src/index.js";
const dir = mkdtempSync(join(tmpdir(), "unfold-integration-"));
let store = new Store(join(dir, "run.sqlite"));
const run = store.createRun({
  name: "Resume validation",
  baseUrl: "http://127.0.0.1:4174",
  maxDepth: 2,
  maxActions: 160,
  maxStates: 80,
  concurrency: 4,
  settleMs: 80,
  navigationIntervalMs: 10,
  captureScreenshots: false,
});
try {
  const coordinator = new Coordinator(store);
  const execution = coordinator.start(run.id);
  while (
    store.summary(run.id).stats.states === 0 &&
    store.run(run.id).status === "running"
  )
    await new Promise((r) => setTimeout(r, 50));
  coordinator.pause(run.id);
  await execution;
  assert.equal(store.run(run.id).status, "paused");
  const before = new Set(
    store.all<AppState>("states", run.id).map((s) => s.id),
  );
  assert(before.size > 0);
  store.close();
  store = new Store(join(dir, "run.sqlite"));
  const pending = store
    .all<TaskLease>("tasks", run.id)
    .find((t) => t.status === "pending");
  assert(pending);
  store.saveTask({ ...pending, status: "leased", leaseUntil: Date.now() - 1 });
  store.updateRun(run.id, { status: "running", ownerPid: 999999 });
  await new Coordinator(store).start(run.id);
  const data = store.data(run.id);
  assert.equal(data.run.status, "completed");
  assert([...before].every((id) => data.states.some((s) => s.id === id)));
  assert.equal(
    data.states.length,
    new Set(data.states.map((s) => s.fingerprint)).size,
  );
  assert.equal(data.actions.filter((a) => a.decision === "failed").length, 0);
  assert.equal(data.tasks.filter((t) => t.status === "leased").length, 0);
  for (const name of ["Delete project", "Save changes"])
    assert(
      data.actions.some(
        (a) => a.targetName === name && a.decision === "skipped_policy",
      ),
    );
  const metrics = await (
    await fetch("http://127.0.0.1:4174/api/metrics")
  ).json();
  assert.equal(metrics.mutations, 0);
  // A real small-budget run must stop without losing the frontier, then resume under an extended budget.
  const limited = store.createRun({
    ...run.config,
    name: "Budget validation",
    maxActions: 1,
  });
  await new Coordinator(store).start(limited.id);
  assert.equal(store.run(limited.id).status, "limited");
  assert.equal(
    store
      .all<TaskLease>("tasks", limited.id)
      .filter((t) => t.kind === "action")
      .reduce((n, t) => n + t.attempts, 0),
    1,
  );
  assert(store.summary(limited.id).stats.pending > 0);
  const capped = store.createRun({
    ...run.config,
    name: "State budget validation",
    maxStates: 2,
  });
  await new Coordinator(store).start(capped.id);
  assert.equal(store.run(capped.id).status, "limited");
  assert(store.summary(capped.id).stats.states <= 2);
  assert(store.summary(capped.id).stats.pending > 0);
  const formRun = store.createRun({
    ...run.config,
    name: "Synthetic form validation",
    baseUrl: "http://127.0.0.1:4174/projects",
    allowUrlPatterns: ["http://127.0.0.1:4174/projects"],
    maxDepth: 3,
    maxActions: 100,
    formValues: [
      {
        route: "/projects",
        label: "Project name",
        value: "Synthetic validation value 4e84",
      },
    ],
    formSubmitAllowlist: [{ route: "/projects", name: "Apply filters" }],
  });
  await new Coordinator(store).start(formRun.id);
  const formData = store.data(formRun.id);
  assert(
    formData.actions.some(
      (a) =>
        a.action === "fill" &&
        a.decision === "executed" &&
        a.fromStateId !== a.toStateId,
    ),
  );
  const submissions = formData.actions.filter((a) =>
    a.effectFlags.includes("submit_form"),
  );
  assert(submissions.length > 0);
  for (const action of submissions)
    assert(
      formData.elements.some(
        (e) =>
          e.stateId === action.fromStateId &&
          e.accessibleName === "Project name" &&
          e.valueState === "configured",
      ),
    );
  assert(!JSON.stringify(formData).includes("Synthetic validation value 4e84"));
  console.log(
    JSON.stringify(
      {
        stateBudget: "passed",
        syntheticFormStates: "passed",
        pauseResume: "passed",
        expiredLeaseRecovery: "passed",
        durableStatesPreserved: before.size,
        finalStates: data.states.length,
        unsafeMutations: metrics.mutations,
        actionBudget: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
