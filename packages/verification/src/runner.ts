import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, Page, Response as PlaywrightResponse } from "playwright";
import { chromium } from "playwright";
import { artifactRoot, type Store } from "../../storage/src/index.js";
import type {
  Capability,
  Flow,
  VerificationRun,
  CorrelationLevel,
} from "../../capability-core/src/types.js";
import {
  classifyCorrelation,
  canVerifyMutation,
  pathnameOf,
} from "../../capability-core/src/correlation.js";
import type { ApiCall } from "../../shared/src/index.js";
import {
  replayCapability,
  type ReplayResult,
  type RequiredFlowResolution,
} from "../../capability-runtime/src/replay.js";
import { registerCapabilities } from "../../adapters/webmcp/src/index.js";
import { WEBMCP_POLYFILL_SOURCE } from "../../adapters/webmcp/src/polyfill.js";

// Implements hynix_webmcp_extension_plan.md §9 (stages A-F, the
// candidate -> testing -> verified|failed|inconclusive state machine). This
// is the first thing in the repo that ever *computes* "verified" — until
// now it was only ever hand-set by tests/fixtures.

const REPEATABILITY_GATE = 3;
const NAVIGATION_TIMEOUT_MS = 10_000;
const PRECONDITION_FETCH_TIMEOUT_MS = 3_000;

/** One of the fixed stages a run passes through, in order — the UI (the verification wizard) renders exactly this list, filling in whichever ones the run actually reaches. */
export type VerificationStageId =
  | "preconditions"
  | "attempt-1"
  | "attempt-2"
  | "attempt-3"
  | "adapter-contract";

/**
 * Live progress emitted during `VerificationRunner.run`, for a caller (the
 * SSE route in apps/server/src/index.ts) to relay to a UI in real time —
 * mirrors the shape `capabilities/mine`'s SSE pipeline already uses
 * (`{type:"stage"|"status"|...}`) so the dashboard's verification wizard can
 * reuse the same stream-reading idiom as `flow-mine-wizard.tsx`. Purely
 * additive: `run()` behaves identically with no `onEvent` passed.
 */
export type VerificationEvent =
  | {
      type: "stage";
      stage: VerificationStageId;
      status: "active" | "done" | "error";
    }
  | { type: "log"; stage: VerificationStageId; message: string }
  | { type: "screenshot"; stage: VerificationStageId; path: string }
  | { type: "result"; run: VerificationRun };

/**
 * Best-effort screenshot of the live page during one stage of a run — never
 * throws, matching `packages/worker/src/workflow-runner.ts`'s
 * `captureStepEvidence`. Nested under the flow's own discovery run id so the
 * existing `/artifacts` ownership check (apps/server/src/index.ts, which
 * treats the first path segment as a Run id) covers it with no changes.
 */
async function captureVerificationScreenshot(
  page: Page,
  runId: string,
  verificationRunId: string,
  stage: VerificationStageId,
): Promise<string | undefined> {
  try {
    const buf = await page.screenshot();
    const relativePath = `${runId}/evidence/verification/${verificationRunId}/${stage}.png`;
    await mkdir(
      resolve(
        artifactRoot(),
        runId,
        "evidence",
        "verification",
        verificationRunId,
      ),
      { recursive: true },
    );
    await writeFile(resolve(artifactRoot(), relativePath), buf);
    return relativePath;
  } catch {
    return undefined;
  }
}

/**
 * Distinguishes transport success (2xx) from business success (well-formed,
 * error-free body) per stage D. Deliberately conservative: we don't have a
 * per-capability outcome-oracle spec to work from, so "an array" or "an
 * object without an `error` field" is as far as this can safely generalize.
 */
function businessSuccess(
  status: number,
  results: unknown,
  isNavigationOnly = false,
): boolean {
  if (status < 200 || status >= 300) return false;
  // A navigation-proven flow (Flow.expectedNavigation, mined by
  // mineUIOutcomeCapabilities) has no JSON body to inspect — its final step
  // is a document response, not an XHR/fetch one — so a 2xx status is the
  // whole of its business-success claim. Don't fall through to the
  // `results === undefined` rejection below, which exists to catch a
  // malformed *API* response body and would otherwise reject every
  // navigation-only capability outright.
  if (isNavigationOnly) return true;
  if (results === undefined) return false; // body wasn't valid JSON
  if (Array.isArray(results)) return true;
  if (typeof results === "object" && results !== null)
    return !("error" in (results as Record<string, unknown>));
  return false;
}

/**
 * Generates 3 distinct safe synthetic values for the capability's one
 * string input property (stage E's repeatability gate). Prefers quoted
 * example values that already appear in the capability's own description
 * (evidence-derived naming, e.g. mined descriptions that mention real
 * observed option text) and falls back to generic, obviously-synthetic
 * strings otherwise so a capability with no such hints still gets 3
 * distinct, safe attempts.
 */
/**
 * `count` defaults to the repeatability gate (3), but stage F's adapter
 * probe asks for one more — it must NOT reuse one of the 3 values already
 * spent in stage C/D. A non-idempotent write capability (e.g. "create item
 * named X") can legitimately behave differently the second time it's asked
 * to do the exact same thing (a 409 on a duplicate, a no-op, …), and that
 * self-collision used to get misreported as `adapter_contract_mismatch` —
 * a false "the WebMCP tool doesn't work" when the real story was "this
 * input was already consumed."
 */
function syntheticInputs(
  capability: Capability,
  count: number = REPEATABILITY_GATE,
): Record<string, unknown>[] {
  const schema = capability.inputSchema as {
    properties?: Record<string, { type?: string } | undefined>;
  };
  const stringKey = Object.entries(schema.properties ?? {}).find(
    ([, propertySchema]) => propertySchema?.type === "string",
  )?.[0];
  if (!stringKey) return Array.from({ length: count }, () => ({}));

  const quoted = Array.from(
    capability.description.matchAll(/"([^"]{2,40})"/g),
  ).map((m) => m[1]);
  const fallback = [
    "probe-one",
    "probe-two",
    "zzz-no-match-probe",
    "probe-four",
  ];
  const values: string[] = [];
  for (const candidate of [...new Set(quoted), ...fallback]) {
    if (values.length >= count) break;
    if (!values.includes(candidate)) values.push(candidate);
  }
  return values.slice(0, count).map((value) => ({ [stringKey]: value }));
}

async function checkReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PRECONDITION_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Stage B: preconditions are advisory until a fixture/tenant provisioning
 * system exists. A precondition that names a URL gets a real reachability
 * check (recorded, never blocking); anything else is recorded as-is. */
async function describePreconditions(capability: Capability): Promise<string> {
  if (capability.preconditions.length === 0)
    return "No preconditions declared.";
  const notes = await Promise.all(
    capability.preconditions.map(async (precondition) => {
      if (!/^https?:\/\//.test(precondition))
        return `advisory: ${precondition}`;
      const reachable = await checkReachable(precondition);
      return reachable
        ? `confirmed reachable: ${precondition}`
        : `unreachable (advisory only, not blocking): ${precondition}`;
    }),
  );
  return notes.join(" | ");
}

type AttemptOutcome =
  | { kind: "pass"; evidenceId: string }
  | { kind: "fail"; category: string; evidenceId?: string }
  | { kind: "inconclusive"; category: string };

const LEVEL_RANK: Record<CorrelationLevel, number> = {
  direct: 3,
  strong: 2,
  weak: 1,
  none: 0,
};

/** The strongest level among several — used when more than one observed call matches `expectedRequest`'s method+pathname (plan §8 point 6: don't force one-to-one attribution, but a gating decision still needs one answer, so take the best-supported one rather than the first). */
function bestLevel(levels: CorrelationLevel[]): CorrelationLevel {
  return levels.reduce(
    (best, level) => (LEVEL_RANK[level] > LEVEL_RANK[best] ? level : best),
    "none" as CorrelationLevel,
  );
}

/**
 * Runs one replay attempt while independently observing every network
 * response the page sees during it, and classifies how strongly those
 * observations correlate with the dispatched action (plan §8) — rather than
 * simply trusting that whichever response `replayCapability`'s own
 * `expectedRequest` wait caught is attributable to this attempt. The runner
 * has no `ActionEdge`/`RunData` to draw on (it replays live against a page;
 * it isn't analyzing a stored discovery run), so it builds the minimal
 * `CorrelatableAction` the classifier actually needs — `{id, createdAt}` —
 * and tags every call observed during this attempt's capture window with
 * that same id as `taskId` (faithful to the real worker's semantics: taskId
 * identifies one capture window, which here is exactly "this one attempt").
 * No call is ever given a matching `actionId`, since live replay has no
 * out-of-band instrumentation telling it which response the click *actually*
 * caused — only timing and repetition patterns are available, so the best
 * this can ever classify a call as is "strong", never "direct".
 */
async function replayWithCorrelation(
  page: Page,
  capability: Capability,
  flow: Flow,
  input: Record<string, unknown>,
  navigationTimeoutMs: number,
  expectTimeoutMs: number,
  resolveRequiredFlow?: (
    capabilityId: string,
  ) => Promise<RequiredFlowResolution | undefined>,
): Promise<{ result: ReplayResult; correlationLevel: CorrelationLevel }> {
  const attemptId = randomUUID();
  const observed: ApiCall[] = [];
  let sequence = 0;
  const onResponse = (response: PlaywrightResponse) => {
    observed.push({
      id: randomUUID(),
      runId: flow.runId,
      taskId: attemptId,
      sequence: sequence++,
      method: response.request().method(),
      url: response.url(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      failed: response.status() >= 400,
      observedAt: new Date().toISOString(),
    });
  };
  page.on("response", onResponse);
  // Stamped from inside replayCapability, right before it fires the step
  // that actually triggers the proof-of-success call — not here, before any
  // of the flow's setup steps run (see replayCapability's `onBeforeFinalAction`
  // doc comment for why that distinction matters to the correlation window
  // below).
  let actionCreatedAt = new Date().toISOString();
  let result: ReplayResult;
  try {
    result = await replayCapability(
      page,
      capability,
      flow,
      input,
      () => {
        actionCreatedAt = new Date().toISOString();
      },
      navigationTimeoutMs,
      expectTimeoutMs,
      resolveRequiredFlow,
    );
  } finally {
    page.off("response", onResponse);
  }

  if (!flow.expectedRequest) {
    // Navigation-proven flow (Flow.expectedNavigation): there's no ApiCall
    // evidence to classify via classifyCorrelation at all — that's the whole
    // reason this flow was mined via mineUIOutcomeCapabilities instead of
    // the API-correlation miners. The closest honest proxy a live replay can
    // offer is "did the page actually land on the expected destination
    // route" — never "direct" (that requires the crawler's own fingerprint
    // machinery, which a live page here doesn't have), so "strong" if it
    // landed, "none" if it didn't.
    const landed = flow.expectedNavigation
      ? new URL(page.url()).pathname === flow.expectedNavigation.urlPattern
      : false;
    return { result, correlationLevel: landed ? "strong" : "none" };
  }

  const matchingLevels = classifyCorrelation(
    { id: attemptId, createdAt: actionCreatedAt },
    observed,
  )
    .filter(
      ({ call }) =>
        call.method === flow.expectedRequest!.method &&
        pathnameOf(call.url) === flow.expectedRequest!.urlPattern,
    )
    .map(({ level }) => level);

  return { result, correlationLevel: bestLevel(matchingLevels) };
}

/** Classifies an error thrown by `replayCapability` *after* navigation to
 * `flow.startUrl` already succeeded — so this only ever sees step/oracle
 * failures (locator problems, missing expected network response), never
 * environment-unavailable, which is handled separately around our own
 * `page.goto`. */
function classifyReplayError(error: unknown): { category: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/waitForResponse|Timeout.*exceeded.*waiting for event/i.test(message))
    return { category: "no_matching_network_response" };
  if (/locator|selector|resolveTarget|strict mode|No element/i.test(message))
    return { category: "locator_unreachable" };
  return { category: "replay_error" };
}

function isEnvironmentUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_EMPTY_RESPONSE|net::ERR_|ECONNREFUSED|ENOTFOUND|ERR_SOCKET|ERR_ADDRESS_UNREACHABLE/i.test(
    message,
  );
}

async function installWebMcpShim(page: Page): Promise<void> {
  // Most real browsers don't implement document.modelContext yet (Chrome's
  // native version is still behind an Origin Trial/flag — see
  // packages/adapters/webmcp/src/polyfill.ts's doc comment). Install the
  // same shared polyfill `registerCapabilities` itself now installs, so
  // stage F exercises the adapter contract exactly as it would against a
  // real `document.modelContext`, native or not — no second, drifting
  // implementation of the same shim to keep in sync.
  await page.evaluate(WEBMCP_POLYFILL_SOURCE);
}

export class VerificationRunner {
  constructor(
    public store: Store,
    private launchBrowser: (headless: boolean) => Promise<Browser> = (
      headless,
    ) => chromium.launch({ headless }),
  ) {}

  /**
   * The discovery run's saved login session (`ScanConfig.authStatePath`,
   * the same file `packages/worker/src/index.ts` hands to its own
   * `browser.newContext()`), so a capability mined from an authenticated
   * crawl is replayed authenticated too — otherwise every attempt below
   * hits the app as a logged-out visitor and fails for reasons that have
   * nothing to do with whether the flow itself is correct.
   * `store.run` (unlike `store.data`/`store.summary`) returns the
   * unredacted config; `store.data().run.config.authStatePath` would only
   * ever be the redacted `"[local session]"` placeholder. Advisory, not
   * fatal: a lookup failure (ownerId mismatch, run missing) just means
   * verification falls back to an unauthenticated context, same as before
   * this existed.
   */
  private resolveAuthStatePath(
    flow: Flow,
    ownerId?: string,
  ): string | undefined {
    try {
      const path = this.store.run(flow.runId, ownerId).config.authStatePath;
      return path && existsSync(path) ? path : undefined;
    } catch {
      return undefined;
    }
  }

  async run(
    capabilityId: string,
    options: {
      flowId?: string;
      headless?: boolean;
      ownerId?: string;
      onEvent?: (event: VerificationEvent) => void;
      // Three independent knobs, all surfaced in the verification wizard's
      // UI (apps/dashboard/src/flow-verification-wizard.tsx) — a slow real
      // app can need more time for one of these without needing more time
      // for the others. Each defaults to the old hardcoded behavior when
      // omitted, so an existing caller (bulk re-verify) is unaffected.
      /** page.goto / cross-document waitForURL. */
      navigationTimeoutMs?: number;
      /** The final step's proof-of-success waitForResponse. */
      expectTimeoutMs?: number;
      /** click/fill/select/hover actionability waits (page.setDefaultTimeout) — left at Playwright's own 30s default when omitted. */
      actionTimeoutMs?: number;
    } = {},
  ): Promise<VerificationRun> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const emit = options.onEvent ?? (() => {});
    const navigationTimeoutMs =
      options.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
    const expectTimeoutMs = options.expectTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
    const actionTimeoutMs = options.actionTimeoutMs;
    const finish = (run: VerificationRun): VerificationRun => {
      const saved = this.store.saveVerificationRun(run);
      emit({ type: "result", run: saved });
      return saved;
    };

    // --- Stage A: contract/static checks -----------------------------
    const capability = this.store.capability(capabilityId);
    if (!capability)
      return finish({
        id,
        capabilityId,
        flowId: "",
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        passCount: 0,
        failureCategories: ["missing_capability"],
        evidenceIds: [],
        notes: `No capability found for id ${capabilityId}.`,
      });

    // A capability may have a secondary flow (an LLM-authored merge of an
    // API-evidenced and a UI-evidenced candidate for the same real action —
    // apps/server/src/mining-session.ts); `options.flowId` lets the caller
    // pick which one to verify, defaulting to the primary as today.
    const targetFlowId = options.flowId ?? capability.flowId;
    const flow = this.store.flow(targetFlowId);
    if (!flow) {
      this.store.saveCapability({ ...capability, status: "failed" });
      return finish({
        id,
        capabilityId,
        flowId: targetFlowId,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        passCount: 0,
        failureCategories: ["missing_flow"],
        evidenceIds: [],
        notes: `Flow ${targetFlowId} referenced by capability ${capabilityId} was not found.`,
      });
    }

    if (
      typeof capability.inputSchema !== "object" ||
      capability.inputSchema === null ||
      flow.steps.length === 0
    ) {
      this.store.saveCapability({ ...capability, status: "failed" });
      return finish({
        id,
        capabilityId,
        flowId: flow.id,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        passCount: 0,
        failureCategories: ["contract_invalid"],
        evidenceIds: [],
        notes:
          "Capability input schema or flow steps failed static contract checks.",
      });
    }

    // candidate -> testing
    this.store.saveCapability({ ...capability, status: "testing" });

    emit({ type: "stage", stage: "preconditions", status: "active" });
    const preconditionNotes = await describePreconditions(capability);
    emit({ type: "log", stage: "preconditions", message: preconditionNotes });
    emit({ type: "stage", stage: "preconditions", status: "done" });
    const allInputs = syntheticInputs(capability, REPEATABILITY_GATE + 1);
    const inputs = allInputs.slice(0, REPEATABILITY_GATE);
    const adapterProbeInput = allInputs[REPEATABILITY_GATE];

    const evidenceIds: string[] = [];
    const failureCategories = new Set<string>();
    let passCount = 0;
    let status: "verified" | "failed" | "inconclusive" = "verified";

    // Resolves one of capability.requiredCapabilityIds for replayCapability's
    // one-level precondition remediation (see
    // packages/capability-runtime/src/replay.ts). Scoped to the SAME
    // project defensively — the miner heuristic and the dashboard's edit
    // route already only ever write same-project ids, but this is the
    // trust boundary where a stale/cross-project id would otherwise let one
    // project's verification run replay another project's flow.
    const resolveRequiredFlow = async (
      requiredCapabilityId: string,
    ): Promise<RequiredFlowResolution | undefined> => {
      const required = this.store.capability(requiredCapabilityId);
      if (!required || required.projectId !== capability.projectId)
        return undefined;
      const requiredFlow = this.store.flow(required.flowId);
      if (!requiredFlow) return undefined;
      return { capability: required, flow: requiredFlow };
    };

    const authStatePath = this.resolveAuthStatePath(flow, options.ownerId);
    const browser = await this.launchBrowser(options.headless ?? true);
    try {
      // --- Stage C+D: step verification + outcome oracle, run 3x ----
      for (const [attemptIndex, input] of inputs.entries()) {
        const stage = `attempt-${attemptIndex + 1}` as VerificationStageId;
        emit({ type: "stage", stage, status: "active" });
        emit({
          type: "log",
          stage,
          message: `Navigating to ${flow.startUrl} with input ${JSON.stringify(input)}`,
        });
        const context = await browser.newContext(
          authStatePath ? { storageState: authStatePath } : undefined,
        );
        const page = await context.newPage();
        if (actionTimeoutMs) page.setDefaultTimeout(actionTimeoutMs);
        try {
          try {
            await page.goto(flow.startUrl, { timeout: navigationTimeoutMs });
          } catch (error) {
            // Stage E: the environment itself is unreachable. One
            // connection failure is enough — do not retry, stop entirely.
            failureCategories.add("environment_unavailable");
            status = "inconclusive";
            emit({
              type: "log",
              stage,
              message: `Could not reach ${flow.startUrl}: ${error instanceof Error ? error.message : String(error)}`,
            });
            const screenshotPath = await captureVerificationScreenshot(
              page,
              flow.runId,
              id,
              stage,
            );
            if (screenshotPath)
              emit({ type: "screenshot", stage, path: screenshotPath });
            emit({ type: "stage", stage, status: "error" });
            break;
          }

          let outcome: AttemptOutcome;
          try {
            const { result, correlationLevel } = await replayWithCorrelation(
              page,
              capability,
              flow,
              input,
              navigationTimeoutMs,
              expectTimeoutMs,
              resolveRequiredFlow,
            );
            const evidence = this.store.saveEvidence({
              id: randomUUID(),
              runId: flow.runId,
              kind: "network",
              observedAt: new Date().toISOString(),
              source: "verification-runner",
              observation: {
                status: result.status,
                resultCount: Array.isArray(result.results)
                  ? result.results.length
                  : undefined,
              },
              correlation: correlationLevel,
              verificationRunId: id,
            });
            evidenceIds.push(evidence.id);
            // Plan §8: "a weak correlation cannot alone satisfy a mutation
            // outcome assertion" — a 2xx/well-formed response is not enough
            // to verify a write if the evidence tying it to this attempt's
            // own action is only "weak"/"none" (e.g. a concurrent unrelated
            // request happened to land in the same window). Read capabilities
            // aren't gated this way; plan §8 reserves the hard requirement
            // for mutations specifically.
            if (
              capability.risk !== "read" &&
              !canVerifyMutation([correlationLevel])
            ) {
              outcome = {
                kind: "fail",
                category: "insufficient_correlation",
                evidenceId: evidence.id,
              };
            } else if (
              businessSuccess(
                result.status,
                result.results,
                Boolean(flow.expectedNavigation),
              )
            ) {
              outcome = { kind: "pass", evidenceId: evidence.id };
            } else if (!flow.expectedRequest && !flow.expectedNavigation) {
              // Inferred capability (packages/mcp/src/mining-tools.ts's
              // propose_capability with no `proof`): replay reached this
              // point without throwing — the real, resolved elements
              // accepted the action — but there was never a recorded network
              // call or navigation to confirm an actual outcome against.
              // Honest signal is "ran without erroring, unconfirmed," not a
              // guessed pass or a misleading "bad response" failure.
              outcome = { kind: "inconclusive", category: "no_outcome_proof" };
            } else {
              outcome = {
                kind: "fail",
                category:
                  result.status < 200 || result.status >= 300
                    ? "non_2xx_response"
                    : "malformed_response",
                evidenceId: evidence.id,
              };
            }
          } catch (error) {
            if (isEnvironmentUnavailable(error)) {
              outcome = {
                kind: "inconclusive",
                category: "environment_unavailable",
              };
            } else {
              outcome = { kind: "fail", ...classifyReplayError(error) };
            }
          }

          const screenshotPath = await captureVerificationScreenshot(
            page,
            flow.runId,
            id,
            stage,
          );
          if (screenshotPath) {
            emit({ type: "screenshot", stage, path: screenshotPath });
            // Attach to the evidence row this attempt already saved (if
            // any) so it survives past this live stream — a later visit to
            // the Verify tab's run history can still retrieve it via
            // `store.evidenceForVerificationRun`.
            if ("evidenceId" in outcome && outcome.evidenceId) {
              const existing = this.store.evidence(outcome.evidenceId);
              if (existing)
                this.store.saveEvidence({
                  ...existing,
                  observation: { ...existing.observation, screenshotPath },
                });
            }
          }
          emit({
            type: "log",
            stage,
            message:
              outcome.kind === "pass"
                ? "Passed — response matched the expected outcome."
                : outcome.kind === "inconclusive"
                  ? `Inconclusive — ${outcome.category}`
                  : `Failed — ${outcome.category}`,
          });
          emit({
            type: "stage",
            stage,
            status: outcome.kind === "pass" ? "done" : "error",
          });

          if (outcome.kind === "pass") {
            passCount++;
          } else if (outcome.kind === "inconclusive") {
            failureCategories.add(outcome.category);
            status = "inconclusive";
            break;
          } else {
            failureCategories.add(outcome.category);
            status = "failed";
            // All 3 attempts must pass for `verified`; one failure already
            // dooms the repeatability gate, so stop rather than burn the
            // remaining (10s-network-wait-bound) attempts.
            break;
          }
        } finally {
          await context.close();
        }
      }

      // --- Stage F: adapter/consumer contract ------------------------
      // Only reached if all 3 direct replay attempts passed.
      if (status === "verified" && passCount === REPEATABILITY_GATE) {
        emit({ type: "stage", stage: "adapter-contract", status: "active" });
        const context = await browser.newContext(
          authStatePath ? { storageState: authStatePath } : undefined,
        );
        const page = await context.newPage();
        if (actionTimeoutMs) page.setDefaultTimeout(actionTimeoutMs);
        try {
          await page.goto(flow.startUrl, { timeout: navigationTimeoutMs });
          await installWebMcpShim(page);
          // registerCapabilities only ever registers "published" capabilities
          // (plan §9 — "verified" means the gates passed, not that a reviewer
          // exposed it yet). This probe copy is never persisted; it only
          // needs to pass the adapter's status gate to prove the contract
          // holds, so it's stamped "published" here, not "verified".
          const publishedCopy: Capability = {
            ...capability,
            status: "published",
          };
          const registration = await registerCapabilities(
            page,
            [{ capability: publishedCopy, flow }],
            // Default `registerCapabilities` param is `replayCapability`
            // called with its own hardcoded 10s defaults — bypassing the
            // very `navigationTimeoutMs`/`expectTimeoutMs` this run was
            // configured with. A slow real app could pass attempts 1-3
            // (which DO get the configured timeouts) and then have this
            // stage time out and get misreported as
            // `adapter_contract_mismatch`, when the adapter wiring itself
            // was never the problem.
            (page, capability, flow, input) =>
              replayCapability(
                page,
                capability,
                flow,
                input,
                undefined,
                navigationTimeoutMs,
                expectTimeoutMs,
                resolveRequiredFlow,
              ),
          );
          const toolName = registration.registered[0];
          if (registration.unavailable || !toolName) {
            status = "failed";
            failureCategories.add("adapter_registration_failed");
            emit({
              type: "log",
              stage: "adapter-contract",
              message: registration.unavailable
                ? "document.modelContext is unavailable on this page (script injection likely blocked by CSP)."
                : "registerCapabilities did not register this capability as a tool.",
            });
          } else {
            // Isolated from the outer try/catch (which used to swallow
            // EVERY failure in this stage — a thrown setup error, a thrown
            // execute() error, and a plain "wrong status code" all landed
            // on the same unexplained `adapter_contract_mismatch` with no
            // way to tell them apart) so a thrown error here is reported
            // with its real message instead of silently reusing whatever
            // the generic catch below says.
            let adapterResult: { status: number; results: unknown } | undefined;
            let navigationLanded: boolean | undefined;
            try {
              adapterResult = (await page.evaluate(
                async ([name, input]) => {
                  // Per Chrome's WebMCP imperative-API docs
                  // (developer.chrome.com/docs/ai/webmcp/imperative-api),
                  // executeTool's first argument is a tool object obtained
                  // from getTools() — NOT whatever registerTool() resolved
                  // with (that value's shape is unspecified) and NOT a bare
                  // name string. The native implementation enforces WebIDL
                  // argument typing and rejects anything else with "The
                  // provided value is not of type 'RegisteredTool'". Every
                  // modelContext shim in this repo (polyfill.ts,
                  // content-main.ts) still accepts either form via
                  // `typeof tool === "string" ? tool : tool.name`, so this
                  // works unchanged against the polyfilled path too.
                  const tools = await (document as any).modelContext.getTools();
                  const match = (tools as any[]).find((t) => t.name === name);
                  if (!match)
                    throw new Error(
                      `getTools() did not return a tool named "${name}"`,
                    );
                  return (document as any).modelContext.executeTool(
                    match,
                    input,
                  );
                },
                [toolName, adapterProbeInput] as const,
              )) as { status: number; results: unknown };
            } catch (execError) {
              const message =
                execError instanceof Error
                  ? execError.message
                  : String(execError);
              // A navigation-proven tool's execute() calls back into Node
              // (window.__hynixExecute -> replayCapability) and that real
              // click/navigation tears down the very JS realm this
              // page.evaluate() is suspended in the instant the browser
              // *commits* the new navigation — which happens well before
              // replayCapability's own Node-side await (waitForOutcome's
              // waitForResponse for the new document) resolves, since a
              // commit and a finished response are different events. So
              // this catch can run while the navigation is still in
              // flight: checking page.url() once here is a real race (it
              // can still read the old pathname), confirmed by tracing
              // actual execution — the catch fired while page.url() was
              // still "/", and the Node-side replayCapability call (and
              // its page.url() read) didn't land on "/activity" until
              // ~1ms later. page.waitForURL polls Playwright's own
              // CDP-level navigation tracking (immune to the destroyed JS
              // realm) until the pathname matches or this gives up, which
              // is what correctly spans that window — a single snapshot
              // read does not. Generous combined timeout since this has to
              // cover the whole remaining click-to-navigate-to-settle
              // window, not just one leg of it. Only treat this specific
              // error this way for a flow that actually expects a
              // navigation; for any other flow shape, or any other error
              // message, this is a real failure same as before.
              if (
                flow.expectedNavigation &&
                /execution context was destroyed/i.test(message)
              ) {
                const { urlPattern } = flow.expectedNavigation;
                navigationLanded = await page
                  .waitForURL((url) => url.pathname === urlPattern, {
                    timeout: navigationTimeoutMs + expectTimeoutMs,
                  })
                  .then(() => true)
                  .catch(() => false);
              } else {
                status = "failed";
                failureCategories.add("adapter_execution_error");
                emit({
                  type: "log",
                  stage: "adapter-contract",
                  message: `executeTool("${toolName}") threw: ${message}`,
                });
              }
            }
            if (adapterResult) {
              const ok = businessSuccess(
                adapterResult.status,
                adapterResult.results,
                Boolean(flow.expectedNavigation),
              );
              emit({
                type: "log",
                stage: "adapter-contract",
                message: `Tool responded with status ${adapterResult.status}, result ${
                  adapterResult.results === undefined
                    ? "undefined (response body wasn't valid JSON)"
                    : Array.isArray(adapterResult.results)
                      ? `an array of ${adapterResult.results.length}`
                      : typeof adapterResult.results
                } — ${ok ? "matches" : "does NOT match"} the expected outcome.`,
              });
              if (!ok) {
                status = "failed";
                failureCategories.add("adapter_contract_mismatch");
              }
            } else if (navigationLanded !== undefined) {
              emit({
                type: "log",
                stage: "adapter-contract",
                message: navigationLanded
                  ? `Tool execution navigated the page to the expected route (${flow.expectedNavigation!.urlPattern}) — matches the expected outcome.`
                  : `Tool execution navigated the page, but not to the expected route (${flow.expectedNavigation!.urlPattern}; landed on ${new URL(page.url()).pathname}) — does NOT match the expected outcome.`,
              });
              if (!navigationLanded) {
                status = "failed";
                failureCategories.add("adapter_contract_mismatch");
              }
            }
          }
          const screenshotPath = await captureVerificationScreenshot(
            page,
            flow.runId,
            id,
            "adapter-contract",
          );
          if (screenshotPath)
            emit({
              type: "screenshot",
              stage: "adapter-contract",
              path: screenshotPath,
            });
        } catch (error) {
          status = "failed";
          failureCategories.add("adapter_setup_error");
          emit({
            type: "log",
            stage: "adapter-contract",
            message: `Setup failed before the tool could be invoked: ${error instanceof Error ? error.message : String(error)}`,
          });
        } finally {
          emit({
            type: "log",
            stage: "adapter-contract",
            message:
              status === "verified"
                ? "Adapter registered the tool and executed it successfully."
                : `Failed — ${[...failureCategories].pop()}`,
          });
          emit({
            type: "stage",
            stage: "adapter-contract",
            status: status === "verified" ? "done" : "error",
          });
          await context.close();
        }
      } else if (status === "verified") {
        // Shouldn't happen (loop only stays "verified" with passCount===3),
        // but guard against publishing on an incomplete gate regardless.
        status = "failed";
        failureCategories.add("repeatability_gate_incomplete");
      }
    } finally {
      await browser.close();
    }

    const finishedAt = new Date().toISOString();
    const run = finish({
      id,
      capabilityId,
      flowId: flow.id,
      status,
      startedAt,
      finishedAt,
      passCount,
      failureCategories: [...failureCategories],
      evidenceIds,
      notes: preconditionNotes,
    });

    // testing -> verified | failed | inconclusive. For a two-flow capability
    // (apps/server/src/mining-session.ts's merge), the capability-level
    // status reads "verified" once ANY flow has ever passed, and must never
    // regress back down just because a DIFFERENT flow's later attempt
    // failed — this run's own VerificationRun above still records its own
    // honest outcome regardless; only the capability-level rollup gets this
    // treatment. A single-flow capability (no secondaryFlowId) behaves
    // exactly as before — `otherFlowId` is undefined, so this is a no-op.
    const otherFlowId =
      targetFlowId === capability.flowId
        ? capability.secondaryFlowId
        : capability.flowId;
    const otherFlowEverVerified =
      status !== "verified" &&
      otherFlowId !== undefined &&
      this.store
        .verificationRuns(capabilityId)
        .some((r) => r.flowId === otherFlowId && r.status === "verified");
    this.store.saveCapability({
      ...capability,
      status: otherFlowEverVerified ? "verified" : status,
    });
    return run;
  }
}
