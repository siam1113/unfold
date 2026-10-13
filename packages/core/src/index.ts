import { RobotsPolicy } from "./robots.js";
import { BrowserResources, resourcePressure } from "./resources.js";
import { ConfigSchema } from "../../shared/src/index.js";
import { chromium } from "playwright";
import { Store } from "../../storage/src/index.js";
import { BrowserWorker, type ProbeResult } from "../../worker/src/index.js";
import { hash, redact } from "../../analysis/src/index.js";
import { allowedUrl, riskyUrl, decide } from "./policy.js";
import type {
  AppState,
  Observation,
  TaskLease,
  ActionEdge,
  UIElement,
  Run,
} from "../../shared/src/index.js";
import { exportRun } from "../../generator/src/index.js";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function alive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
const activeRuns = new Set<string>();
export class Coordinator {
  private active = activeRuns;
  constructor(public store: Store) {}
  pause(id: string) {
    const r = this.store.run(id);
    if (r.status === "running") this.store.updateRun(id, { status: "pausing" });
  }
  async start(id: string): Promise<Run> {
    if (this.active.has(id)) throw new Error("Run is already active");
    let run = this.store.transaction(() => {
      const r = this.store.run(id);
      r.config = ConfigSchema.parse(r.config);
      if (
        ["running", "pausing"].includes(r.status) &&
        r.ownerPid !== process.pid &&
        alive(r.ownerPid) &&
        (r.ownerLeaseUntil || 0) > Date.now()
      )
        throw new Error("Run is active in another coordinator");
      if (r.status === "completed")
        throw new Error("Completed runs cannot be resumed; create another run");
      this.store.recover(id);
      return this.store.updateRun(id, {
        status: "running",
        config: r.config,
        ownerPid: process.pid,
        ownerLeaseUntil: Date.now() + 60000,
        startedAt: r.startedAt || new Date().toISOString(),
        finishedAt: undefined,
        error: undefined,
        stopReason: undefined,
      });
    });
    this.active.add(id);
    const heartbeat = setInterval(
      () => this.store.updateRun(id, { ownerLeaseUntil: Date.now() + 60000 }),
      10000,
    );
    const started = Date.now(),
      baseElapsed = run.elapsedMs;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const c = ConfigSchema.parse(run.config);
    this.store.updateRun(id, { config: c });
    const robots = new RobotsPolicy(c, (message) =>
      this.store.event(id, "info", message),
    );
    const resources = {
      samples: 0,
      peakBrowserRssMB: 0,
      peakBrowserCpuPercent: 0,
      browserCpuMs: 0,
      peakContexts: 0,
      requests: 0,
      responseBytes: 0,
      appErrors: 0,
      ...run.resources,
    };
    const previousBrowserCpuMs = resources.browserCpuMs;
    let resourceTimer: ReturnType<typeof setInterval> | undefined;
    let sampling: Promise<void> | undefined;
    const recentFailures: boolean[] = [];
    let inFlight = 0;
    let attempts = this.store
      .all<TaskLease>("tasks", id)
      .filter((t) => t.kind === "action")
      .reduce((sum, t) => sum + t.attempts, 0);
    let stopReason: string | undefined;
    let adaptive = c.networkWriteAllowlist.length ? 1 : c.concurrency;
    const nextNavigation = new Map<string, number>();
    const throttle = async (origin: string) => {
      const now = Date.now();
      const next = Math.max(now, nextNavigation.get(origin) || 0);
      nextNavigation.set(
        origin,
        next + Math.max(c.navigationIntervalMs, robots.delay(origin)),
      );
      await sleep(next - now);
    };
    try {
      await robots.load();
      for (const url of c.seeds.length ? c.seeds : [c.baseUrl])
        this.queueRoute(id, url, 0);
      this.store.event(
        id,
        "info",
        `Exploration started with ${c.concurrency} isolated browser workers`,
      );
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.UNFOLD_BROWSER_EXECUTABLE,
      });
      const monitor = new BrowserResources(browser);
      const sample = async () => {
        try {
          const value = await monitor.sample();
          resources.samples++;
          resources.peakBrowserRssMB = Math.max(
            resources.peakBrowserRssMB,
            value.browserRssMB,
          );
          resources.peakBrowserCpuPercent = Math.max(
            resources.peakBrowserCpuPercent,
            value.browserCpuPercent,
          );
          resources.browserCpuMs = previousBrowserCpuMs + value.browserCpuMs;
          const pressure = resourcePressure(
            value,
            c.maxBrowserMemoryMB,
            c.maxBrowserCpuPercent,
          );
          if (pressure && adaptive > 1) {
            adaptive = Math.max(1, Math.floor(adaptive / 2));
            this.store.event(
              id,
              "warn",
              `Browser ${pressure} pressure; worker limit reduced to ${adaptive}`,
            );
          }
          if (pressure === "memory")
            stopReason = "Browser memory budget reached";
        } catch {
          this.store.event(id, "warn", "Browser resource sample unavailable");
        }
      };
      await sample();
      resourceTimer = setInterval(() => {
        if (!sampling)
          sampling = sample().finally(() => {
            sampling = undefined;
          });
      }, 1000);
      const worker = new BrowserWorker(
        browser,
        this.store,
        c,
        throttle,
        robots,
        resources,
      );
      const loop = async (index: number) => {
        while (true) {
          const current = this.store.run(id);
          if (current.status !== "running" || stopReason) return;
          if (
            baseElapsed + Date.now() - started >=
            c.maxDurationMinutes * 60000
          ) {
            stopReason = "Duration budget reached";
            return;
          }
          if (this.store.all<AppState>("states", id).length >= c.maxStates) {
            stopReason = "State budget reached";
            return;
          }
          if (attempts >= c.maxActions) {
            stopReason = "Action budget reached";
            return;
          }
          if (index > adaptive) {
            if (inFlight === 0) return;
            await sleep(100);
            continue;
          }
          const task = this.store.lease(
            id,
            index,
            (c.maxDepth + 3) * (c.actionTimeoutMs + 5000),
          );
          if (!task) {
            if (inFlight === 0) return;
            await sleep(75);
            continue;
          }
          inFlight++;
          resources.peakContexts = Math.max(resources.peakContexts, inFlight);
          if (task.kind === "action") attempts++;
          try {
            const result = await worker.probe(task, index);
            recentFailures.push(result.edge?.decision === "failed");
            if (recentFailures.length > 10) recentFailures.shift();
            if (
              recentFailures.length === 10 &&
              recentFailures.filter(Boolean).length >= 3 &&
              adaptive > 1
            ) {
              adaptive = Math.max(1, Math.floor(adaptive / 2));
              recentFailures.length = 0;
              this.store.event(
                id,
                "warn",
                `Rising action failures; worker limit reduced to ${adaptive}`,
                index,
              );
            }
            if (result.edge?.decision === "failed" && task.attempts < 2) {
              task.status = "pending";
              task.priority = -1;
              this.store.saveTask(task);
              this.store.event(
                id,
                "warn",
                `Retrying ${result.edge.targetName}: ${result.edge.errorCode}`,
                index,
              );
            } else this.commit(task, result);
            if (result.signals.some((s) => /^http_(429|5)/.test(s))) {
              adaptive = Math.max(1, Math.floor(adaptive / 2));
              this.store.event(
                id,
                "warn",
                `Target returned rate or server errors; worker limit reduced to ${adaptive}`,
                index,
              );
            }
          } catch (e) {
            const msg = redact(e instanceof Error ? e.message : String(e));
            task.status = task.attempts < 2 ? "pending" : "failed";
            this.store.saveTask(task);
            this.store.event(
              id,
              "error",
              `${task.kind} task failed: ${msg.slice(0, 400)}`,
              index,
            );
            if (msg === "STATE_BUDGET") stopReason = "State budget reached";
          } finally {
            inFlight--;
            this.store.updateRun(id, {
              elapsedMs: baseElapsed + Date.now() - started,
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: c.concurrency }, (_, i) => loop(i + 1)),
      );
      clearInterval(resourceTimer);
      await sampling;
      await sample();
      this.store.updateRun(id, { resources });
      const pending = this.store
        .all<TaskLease>("tasks", id)
        .some((t) => t.status === "pending");
      const failedRoutes = this.store
        .all<TaskLease>("tasks", id)
        .some((t) => t.kind === "route" && t.status === "failed");
      const status =
        this.store.run(id).status === "pausing"
          ? "paused"
          : stopReason
            ? "limited"
            : failedRoutes &&
                this.store.all<AppState>("states", id).length === 0
              ? "failed"
              : pending
                ? "paused"
                : "completed";
      run = this.store.updateRun(id, {
        status,
        stopReason,
        elapsedMs: baseElapsed + Date.now() - started,
        finishedAt: new Date().toISOString(),
        ownerPid: undefined,
        ownerLeaseUntil: undefined,
        ...(status === "failed"
          ? { error: "No seed route could be loaded. See the activity log." }
          : {}),
      });
      this.store.event(id, "info", stopReason || `Exploration ${status}`);
      await exportRun(this.store, id);
      return run;
    } catch (e) {
      const error = redact(e instanceof Error ? e.message : String(e));
      this.store.updateRun(id, {
        status: "failed",
        error,
        ownerPid: undefined,
        ownerLeaseUntil: undefined,
        elapsedMs: baseElapsed + Date.now() - started,
      });
      this.store.event(id, "error", error.slice(0, 600));
      throw e;
    } finally {
      clearInterval(heartbeat);
      clearInterval(resourceTimer);
      await sampling;
      this.store.updateRun(id, { resources });
      await browser?.close();
      this.active.delete(id);
    }
  }
  private queueRoute(id: string, url: string, depth: number) {
    const c = this.store.run(id).config;
    if (depth > c.maxDepth || !allowedUrl(url, c) || riskyUrl(url, c)) return;
    this.store.enqueue({
      id: hash([id, "route", url]),
      runId: id,
      key: `route:${url}`,
      kind: "route",
      url,
      action: "click",
      depth,
      priority: 10,
      status: "pending",
      attempts: 0,
    });
  }
  private expand(obs: Observation, state: AppState) {
    const c = this.store.run(state.runId).config;
    for (const url of obs.links)
      this.queueRoute(state.runId, url, state.depth + 1);
    if (state.depth >= c.maxDepth) return;
    for (const element of obs.elements) {
      const input = ["input", "textarea", "select"].includes(element.tag);
      const value = c.formValues.find(
        (v) =>
          v.route === new URL(state.url).pathname &&
          v.label === element.accessibleName,
      );
      const action = input
        ? element.tag === "select"
          ? "select"
          : "fill"
        : element.hasPopup === "tooltip"
          ? "hover"
          : "click";
      const decision = decide(element, state.url, c, action);
      if (input && !value) {
        decision.allowed = false;
        decision.rule = "no-synthetic-value";
        decision.reason = "No synthetic value configured for this field";
      }
      if (
        element.isSubmit &&
        obs.elements.some(
          (field) =>
            field.formId === element.formId && field.valueState === "pending",
        )
      ) {
        decision.allowed = false;
        decision.rule = "form-values-required";
        decision.reason =
          "Configured synthetic fields must be filled before submission";
      }
      const key = `${state.fingerprint}:${element.structuralSignature}:${action}`;
      const id = hash([state.runId, key]);
      if (!decision.allowed) {
        const edge: ActionEdge = {
          id,
          runId: state.runId,
          fromStateId: state.id,
          elementId: element.id,
          targetName: element.accessibleName || element.tag,
          action,
          effectFlags: [],
          decision: "skipped_policy",
          restoreRecipeId: state.recipe.id,
          evidencePaths: state.screenshotPath ? [state.screenshotPath] : [],
          policy: decision,
          worker: state.worker,
          depth: state.depth + 1,
          createdAt: new Date().toISOString(),
          confidence: 1,
          intent: "unknown",
          signals: [],
          beforeUrl: state.url,
        };
        this.store.put("actions", state.runId, edge);
        continue;
      }
      this.store.enqueue({
        id,
        runId: state.runId,
        key,
        kind: "action",
        url: state.url,
        stateId: state.id,
        elementId: element.id,
        action,
        valueKey: value ? `${value.route}:${value.label}` : undefined,
        depth: state.depth + 1,
        priority: element.href ? 5 : 1,
        status: "pending",
        attempts: 0,
      });
    }
  }
  private commit(task: TaskLease, result: ProbeResult) {
    this.store.transaction(() => {
      let destinationLimited = false;
      let canonicalStateId: string | undefined;
      if (result.observation) {
        try {
          const { state, fresh } = this.store.observation(result.observation);
          canonicalStateId = state.id;
          if (result.edge) result.edge.toStateId = state.id;
          if (fresh) {
            this.expand(result.observation, state);
            this.store.event(
              task.runId,
              "info",
              `Discovered ${new URL(state.url).pathname}${state.visibleRegionSummary.length ? " · " + state.visibleRegionSummary[0] : ""}`,
              task.worker,
            );
          }
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "STATE_BUDGET")
            throw error;
          destinationLimited = true;
          if (result.edge) {
            result.edge.toStateId = undefined;
            result.edge.signals.push(
              "state_budget: destination observation retained in evidence; awaiting resume",
            );
          }
          this.store.event(
            task.runId,
            "warn",
            "State budget reached while committing an in-flight observation; frontier retained",
            task.worker,
          );
        }
      }
      result.apiCalls.forEach((call) => {
        if (result.observation)
          call.toStateId = canonicalStateId || result.edge?.toStateId;
        this.store.put("api_calls", task.runId, call);
      });
      result.verifiedElements?.forEach((e) =>
        this.store.put("elements", task.runId, e),
      );
      result.verifiedComponents?.forEach((c) =>
        this.store.put("components", task.runId, c),
      );
      if (result.edge) this.store.put("actions", task.runId, result.edge);
      task.status = destinationLimited
        ? "pending"
        : result.edge?.decision === "failed"
          ? "failed"
          : "done";
      task.leaseUntil = undefined;
      this.store.saveTask(task);
    });
  }
}
