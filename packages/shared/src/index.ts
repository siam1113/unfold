import { z } from "zod";
const httpUrl = z
  .string()
  .url()
  .refine(
    (v) =>
      ["http:", "https:"].includes(new URL(v).protocol) &&
      !new URL(v).username &&
      !new URL(v).password,
    "Use an HTTP(S) URL without credentials",
  );
// Shared step vocabulary for both the Automation tab's named workflows
// (packages/worker/src/workflow-runner.ts) and ConfigSchema.setupSteps
// below — a sequence of browser actions run once, before any discovery
// worker starts probing, to get past things a storage-state file alone
// can't (consent banners, workspace pickers, multi-field logins).
export const WorkflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string(),
    value: z.string(),
    /**
     * Marks this step's real value as never persisted — recorded (Auto-
     * recorded login steps, apps/server/src/auth-capture.ts) or manually
     * flagged password fields always store `value: ""` here, regardless of
     * what the user actually typed. The real value is supplied fresh,
     * in-memory only, at each headless replay (`executeStep`'s `secrets`
     * param, keyed by this step's index in the array) — never written to
     * disk, the database, or returned to any client.
     */
    secret: z.boolean().optional(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("waitFor"),
    selector: z.string().optional(),
    /** Wait for this text to appear anywhere on the page (page.getByText),
     * as an alternative to a selector — useful when there's no stable
     * selector for a success/arrival state. */
    text: z.string().optional(),
    ms: z.number().int().positive().max(60000).optional(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("assertText"),
    selector: z.string(),
    expected: z.string(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("apiCall"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string(),
    expectedStatus: z.number().int().optional(),
    description: z.string().max(300).optional(),
  }),
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export const ConfigSchema = z
  .object({
    name: z.string().min(1).max(100).default("Application discovery"),
    roleLabel: z.string().trim().max(80).optional(),
    localeLabel: z.string().trim().max(32).optional(),
    baseUrl: httpUrl,
    seeds: z.array(httpUrl).max(100).default([]),
    allowedOrigins: z
      .array(
        httpUrl.refine(
          (v) => new URL(v).origin === v,
          "Use an exact origin without a trailing slash",
        ),
      )
      .default([]),
    authStatePath: z.string().optional(),
    // Runs once, sequentially, before any discovery worker begins probing —
    // see packages/core/src/index.ts's Coordinator.start(). The resulting
    // context's storageState() becomes (or extends) authStatePath, so its
    // effect (cookies, localStorage) reaches every subsequent worker
    // context the same way a manually captured login session does.
    setupSteps: z.array(WorkflowStepSchema).max(20).default([]),
    concurrency: z.number().int().min(1).max(16).default(4),
    maxDepth: z.number().int().min(0).max(20).default(6),
    maxStates: z.number().int().min(1).max(10000).default(250),
    maxActions: z.number().int().min(1).max(50000).default(1500),
    // 360 (6h) accommodates the "thorough" exploration tier's larger
    // action/state budget without the clock being the thing that cuts a
    // run short before its own budget does.
    maxDurationMinutes: z.number().positive().max(360).default(15),
    actionTimeoutMs: z.number().int().min(500).max(60000).default(10000),
    settleMs: z.number().int().min(50).max(3000).default(250),
    navigationIntervalMs: z.number().int().min(0).max(60000).default(100),
    maxBrowserMemoryMB: z.number().min(128).max(65536).default(4096),
    maxBrowserCpuPercent: z.number().min(50).max(6400).default(800),
    safeMode: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    actionAllowlist: z
      .array(z.object({ route: z.string(), name: z.string() }))
      .default([]),
    formSubmitAllowlist: z
      .array(z.object({ route: z.string(), name: z.string() }))
      .default([]),
    formValues: z
      .array(
        z.object({
          route: z.string(),
          label: z.string(),
          value: z.string().max(1000),
        }),
      )
      .default([]),
    // Network writes are allowed by default — the same policy as origins:
    // apps legitimately fetch read-only data (menus, permissions, search
    // results) over POST, and a default-block made that indistinguishable
    // from a real mutation, breaking rendering. Every write request is
    // still surfaced as a run event (see worker/src/index.ts) so a user can
    // see exactly what fired and, if they want, add it here to block it on
    // future runs.
    networkWriteBlocklist: z
      .array(
        z.object({
          url: httpUrl,
          method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
        }),
      )
      .default([]),
    denyActionKeywords: z
      .array(z.string().min(1))
      .default([
        "delete",
        "remove",
        "purchase",
        "pay",
        "transfer",
        "send",
        "publish",
        "invite",
        "save",
        "logout",
        "sign out",
        "unsubscribe",
        "create",
        "update",
        "confirm",
        "checkout",
        "subscribe",
      ]),
    denyUrlPatterns: z.array(z.string().min(1)).default([]),
    allowUrlPatterns: z.array(z.string().min(1)).default([]),
    ignoreQueryParams: z
      .array(z.string())
      .default([
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "gclid",
        "fbclid",
      ]),
    captureScreenshots: z.boolean().default(true),
    captureTracesOnFailure: z.boolean().default(true),
    streamWorkers: z.boolean().default(false),
    viewport: z
      .object({
        width: z.number().int().min(320).max(2560),
        height: z.number().int().min(400).max(1600),
      })
      .default({ width: 1440, height: 960 }),
    redactSelectors: z
      .array(z.string())
      .default(["input", "textarea", "[data-private]", "[data-sensitive]"]),
  })
  .superRefine((c, ctx) => {
    const origins = new Set([new URL(c.baseUrl).origin, ...c.allowedOrigins]);
    for (const raw of [c.baseUrl, ...c.seeds]) {
      const url = new URL(raw);
      if (
        [...url.searchParams].some(
          ([key, value]) =>
            /^(?:code|key)$|token|secret|password|auth|api[_-]?key|session/i.test(
              key,
            ) && value,
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Use a local auth-state file instead of credentials in seed URLs",
          path: ["seeds"],
        });
    }
    for (const seed of c.seeds)
      if (!origins.has(new URL(seed).origin))
        ctx.addIssue({
          code: "custom",
          message: "Seed origin must be explicitly allowed",
          path: ["seeds"],
        });
  });
export type ScanConfig = z.infer<typeof ConfigSchema>;
export const GlobalDiscoverySettingsSchema = z.object({
  safeMode: ConfigSchema.shape.safeMode,
  dryRun: ConfigSchema.shape.dryRun,
  denyActionKeywords: ConfigSchema.shape.denyActionKeywords,
  concurrency: ConfigSchema.shape.concurrency,
  maxDepth: ConfigSchema.shape.maxDepth,
  maxStates: ConfigSchema.shape.maxStates,
  maxActions: ConfigSchema.shape.maxActions,
  maxDurationMinutes: ConfigSchema.shape.maxDurationMinutes,
  actionTimeoutMs: ConfigSchema.shape.actionTimeoutMs,
  settleMs: ConfigSchema.shape.settleMs,
  maxBrowserMemoryMB: ConfigSchema.shape.maxBrowserMemoryMB,
  maxBrowserCpuPercent: ConfigSchema.shape.maxBrowserCpuPercent,
  captureScreenshots: ConfigSchema.shape.captureScreenshots,
  captureTracesOnFailure: ConfigSchema.shape.captureTracesOnFailure,
  viewport: ConfigSchema.shape.viewport,
});
export const UserSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  palette: z.enum(["teal", "blue", "violet", "amber", "rose"]).default("teal"),
  fontFamily: z
    .enum([
      "system",
      "ibm-plex-sans",
      "atkinson-hyperlegible",
      "inter",
      "dm-sans",
      "lato",
      "nunito-sans",
      "source-sans-3",
    ])
    .default("ibm-plex-sans"),
  discovery: GlobalDiscoverySettingsSchema.default(
    GlobalDiscoverySettingsSchema.parse({}),
  ),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export const LocatorSchema = z.object({
  kind: z.enum(["role", "label", "testId", "placeholder", "text", "css"]),
  value: z.string(),
  name: z.string().optional(),
  scope: z.string().optional(),
  expression: z.string(),
  uniqueAtDiscovery: z.boolean(),
  verifiedAfterRestore: z.boolean(),
  score: z.number(),
  reasons: z.array(z.string()),
  failures: z.array(z.string()).default([]),
});
export type LocatorCandidate = z.infer<typeof LocatorSchema>;
export const ElementSchema = z.object({
  id: z.string(),
  stateId: z.string(),
  role: z.string(),
  accessibleName: z.string(),
  tag: z.string(),
  textSnippet: z.string(),
  structuralSignature: z.string(),
  containerId: z.string().optional(),
  locatorCandidates: z.array(LocatorSchema),
  href: z.string().optional(),
  inputType: z.string().optional(),
  valueState: z.enum(["configured", "pending"]).optional(),
  expanded: z.string().optional(),
  selected: z.string().optional(),
  hasPopup: z.string().optional(),
  controls: z.string().optional(),
  disabled: z.boolean(),
  isSubmit: z.boolean(),
  formId: z.string().optional(),
  formNoValidate: z.boolean().optional(),
  validationEvidence: z
    .object({
      required: z.boolean(),
      ariaInvalid: z.boolean(),
      cssInvalid: z.boolean(),
      willValidate: z.boolean(),
      valid: z.boolean(),
      valueMissing: z.boolean(),
      typeMismatch: z.boolean(),
      patternMismatch: z.boolean(),
      tooLong: z.boolean(),
      tooShort: z.boolean(),
      rangeUnderflow: z.boolean(),
      rangeOverflow: z.boolean(),
      stepMismatch: z.boolean(),
      badInput: z.boolean(),
      customError: z.boolean(),
    })
    .optional(),
  box: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});
export type UIElement = z.infer<typeof ElementSchema>;
export const StepSchema = z.object({
  elementSignature: z.string(),
  locators: z.array(LocatorSchema),
  action: z.enum(["click", "hover", "fill", "select"]),
  valueKey: z.string().optional(),
  expectedFingerprint: z.string(),
  expectedUrl: z.string(),
});
export type RecipeStep = z.infer<typeof StepSchema>;
export const RestoreRecipeSchema = z.object({
  id: z.string(),
  seed: z.string(),
  steps: z.array(StepSchema),
});
export type RestoreRecipe = z.infer<typeof RestoreRecipeSchema>;
export const AppStateSchema = z.object({
  id: z.string(),
  runId: z.string(),
  url: z.string(),
  routeKey: z.string(),
  fingerprint: z.string(),
  fingerprintVersion: z.literal(1),
  fingerprintReason: z.string(),
  structureTokens: z.array(z.string()),
  title: z.string(),
  visibleRegionSummary: z.array(z.string()),
  interactiveElementIds: z.array(z.string()),
  screenshotPath: z.string().optional(),
  discoveredAt: z.string(),
  depth: z.number(),
  worker: z.number(),
  /** Logical lineage across restored action tasks; not a browser-process tab handle. */
  browserTabId: z.string().max(32).optional(),
  browserTabParentId: z.string().max(32).optional(),
  recipe: RestoreRecipeSchema,
  mainText: z.string(),
  provenanceActionId: z.string().optional(),
});
export type AppState = z.infer<typeof AppStateSchema>;
export const ComponentSchema = z.object({
  id: z.string(),
  stateId: z.string(),
  name: z.string(),
  kind: z.enum([
    "header",
    "navigation",
    "dialog",
    "form",
    "table",
    "card",
    "toolbar",
    "custom",
  ]),
  rootLocator: LocatorSchema,
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      viewportWidth: z.number().optional(),
      viewportHeight: z.number().optional(),
    })
    .optional(),
  elementIds: z.array(z.string()),
  childComponentIds: z.array(z.string()),
  familyId: z.string().optional(),
  classificationEvidence: z.array(z.string()),
  confidence: z.number(),
});
export type Component = z.infer<typeof ComponentSchema>;
export const ObservationSchema = z.object({
  state: AppStateSchema,
  elements: z.array(ElementSchema),
  components: z.array(ComponentSchema),
  links: z.array(z.string()),
  observedAt: z.string(),
});
export type Observation = z.infer<typeof ObservationSchema>;
export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  rule: z.string(),
  intent: z.literal("unknown"),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// Value-free browser evidence captured around one discovered action. The
// schema deliberately contains aggregate counts and allowlisted event fields;
// it has no place for page text, form values, cookie contents, or request URLs.
export const BrowserPageSnapshotSchema = z
  .object({
    navigationType: z.enum(["navigate", "reload", "back_forward"]).optional(),
    historyLength: z.number().int().nonnegative().optional(),
    navigationEntryIndex: z.number().int().nonnegative().optional(),
    busyCount: z.number().int().nonnegative(),
    alertCount: z.number().int().nonnegative(),
    statusCount: z.number().int().nonnegative(),
    emptyCueCount: z.number().int().nonnegative(),
    successCueCount: z.number().int().nonnegative(),
    errorCueCount: z.number().int().nonnegative(),
    formCount: z.number().int().nonnegative(),
    fieldCount: z.number().int().nonnegative(),
    invalidFieldCount: z.number().int().nonnegative(),
    invalidReasons: z.record(z.string(), z.number().int().nonnegative()),
    searchControlCount: z.number().int().nonnegative(),
    filterControlCount: z.number().int().nonnegative(),
    passwordControlCount: z.number().int().nonnegative(),
    identifierControlCount: z.number().int().nonnegative(),
    signInControlCount: z.number().int().nonnegative(),
    signOutControlCount: z.number().int().nonnegative(),
    resultItemCount: z.number().int().nonnegative(),
    localStorageEntryCount: z.number().int().nonnegative().optional(),
    sessionStorageEntryCount: z.number().int().nonnegative().optional(),
    cookieCount: z.number().int().nonnegative().optional(),
    secureCookieCount: z.number().int().nonnegative().optional(),
    httpOnlyCookieCount: z.number().int().nonnegative().optional(),
    sessionCookieCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BrowserPageSnapshot = z.infer<typeof BrowserPageSnapshotSchema>;

export const BrowserEventSchema = z
  .object({
    kind: z.enum([
      "navigation_request",
      "navigation_start",
      "redirect",
      "network_request",
      "network_response",
      "tab_opened",
      "tab_closed",
      "tab_activated",
      "download",
      "dialog",
      "permission_query",
      "permission_request",
    ]),
    offsetMs: z.number().int().nonnegative(),
    tabId: z.string().max(32).optional(),
    parentTabId: z.string().max(32).optional(),
    navigationReason: z
      .enum([
        "anchorClick",
        "formSubmissionGet",
        "formSubmissionPost",
        "httpHeaderRefresh",
        "initialFrameNavigation",
        "metaTagRefresh",
        "other",
        "pageBlockInterstitial",
        "reload",
        "scriptInitiated",
      ])
      .optional(),
    navigationType: z
      .enum([
        "reload",
        "reloadBypassingCache",
        "restore",
        "restoreWithPost",
        "historySameDocument",
        "historyDifferentDocument",
        "sameDocument",
        "differentDocument",
      ])
      .optional(),
    disposition: z
      .enum(["currentTab", "newTab", "newWindow", "download"])
      .optional(),
    origin: z.string().max(255).optional(),
    status: z.number().int().min(100).max(599).optional(),
    method: z
      .enum([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "HEAD",
        "OTHER",
      ])
      .optional(),
    resourceType: z.string().max(32).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    failed: z.boolean().optional(),
    dialogType: z
      .enum(["alert", "beforeunload", "confirm", "prompt"])
      .optional(),
    permission: z
      .enum([
        "notifications",
        "geolocation",
        "camera",
        "microphone",
        "clipboard",
        "midi",
        "push",
        "storage",
        "sensors",
        "usb",
        "serial",
        "bluetooth",
        "display_capture",
        "other",
      ])
      .optional(),
    permissionState: z
      .enum(["prompt", "granted", "denied", "other"])
      .optional(),
    outcome: z
      .enum(["started", "canceled", "dismissed", "observed"])
      .optional(),
    count: z.number().int().positive().optional(),
  })
  .strict();
export type BrowserEvent = z.infer<typeof BrowserEventSchema>;

export const BrowserPersistenceProbeSchema = z
  .object({
    origin: z.string().max(255),
    localStorageEntryCount: z.number().int().nonnegative(),
    restoredLocalStorageEntryCount: z.number().int().nonnegative(),
    cookieCount: z.number().int().nonnegative(),
    restoredCookieCount: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserPersistenceProbe = z.infer<
  typeof BrowserPersistenceProbeSchema
>;

export const BrowserEvidenceSchema = z
  .object({
    version: z.literal(1),
    sourceTabId: z.string().max(32),
    activeTabId: z.string().max(32),
    activeTabParentId: z.string().max(32).optional(),
    before: BrowserPageSnapshotSchema,
    after: BrowserPageSnapshotSchema,
    isolatedContextPersistence: BrowserPersistenceProbeSchema.optional(),
    events: z.array(BrowserEventSchema).max(120),
  })
  .strict();
export type BrowserEvidence = z.infer<typeof BrowserEvidenceSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  runId: z.string(),
  fromStateId: z.string(),
  toStateId: z.string().optional(),
  elementId: z.string(),
  targetName: z.string(),
  action: z.string(),
  effectFlags: z.array(z.string()),
  decision: z.enum(["executed", "skipped_policy", "failed"]),
  restoreRecipeId: z.string(),
  evidencePaths: z.array(z.string()),
  elapsedMs: z.number().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  policy: PolicyDecisionSchema,
  worker: z.number(),
  depth: z.number(),
  createdAt: z.string(),
  confidence: z.number(),
  intent: z.literal("unknown"),
  signals: z.array(z.string()),
  browserEvidence: BrowserEvidenceSchema.optional(),
  beforeUrl: z.string(),
  afterUrl: z.string().optional(),
});
export type ActionEdge = z.infer<typeof ActionSchema>;
export const ApiCallSchema = z.object({
  id: z.string(),
  runId: z.string(),
  taskId: z.string(),
  actionId: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  observedAt: z.string().optional(),
  method: z.string(),
  url: z.string(),
  resourceType: z.string(),
  status: z.number().int().optional(),
  failed: z.boolean().default(false),
  durationMs: z.number().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  responseBody: z.string().optional(),
  timings: z.record(z.string(), z.number()).optional(),
  fromStateId: z.string().optional(),
  toStateId: z.string().optional(),
});
export type ApiCall = z.infer<typeof ApiCallSchema>;
export const TaskLeaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  key: z.string(),
  kind: z.enum(["route", "action"]),
  url: z.string(),
  stateId: z.string().optional(),
  elementId: z.string().optional(),
  action: z.enum(["click", "hover", "fill", "select"]),
  valueKey: z.string().optional(),
  depth: z.number(),
  priority: z.number(),
  status: z.enum(["pending", "leased", "done", "failed"]),
  attempts: z.number(),
  worker: z.number().optional(),
  leaseUntil: z.number().optional(),
});
export type TaskLease = z.infer<typeof TaskLeaseSchema>;
export const RunSchema = z.object({
  id: z.string(),
  projectId: z.string().uuid().optional(),
  name: z.string(),
  status: z.enum([
    "queued",
    "running",
    "pausing",
    "paused",
    "completed",
    "limited",
    "failed",
  ]),
  config: ConfigSchema,
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  elapsedMs: z.number().default(0),
  ownerPid: z.number().optional(),
  ownerLeaseUntil: z.number().optional(),
  error: z.string().optional(),
  stopReason: z.string().optional(),
  resources: z
    .object({
      samples: z.number(),
      peakBrowserRssMB: z.number(),
      peakBrowserCpuPercent: z.number(),
      browserCpuMs: z.number(),
      peakContexts: z.number(),
      requests: z.number(),
      responseBytes: z.number(),
      appErrors: z.number(),
    })
    .optional(),
});
export type Run = z.infer<typeof RunSchema>;
export const ProjectInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(""),
  baseUrl: httpUrl,
  scanConfig: z.record(z.string(), z.unknown()).default({}),
  agentInstructions: z.string().max(12000).default(""),
});
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  baseUrl: httpUrl,
  scanConfig: ConfigSchema,
  agentInstructions: z.string().max(12000),
  // AppMCP's per-connection browser (packages/mcp/src/app-server.ts): run it
  // headed instead of headless, for local debugging.
  appMcpHeaded: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  discoveryCount: number;
  latestDiscovery?: RunSummary;
  stats: {
    states: number;
    actions: number;
    components: number;
    verified: number;
  };
}
export interface ProjectData {
  project: Project;
  discoveries: RunSummary[];
  stats: {
    states: number;
    actions: number;
    components: number;
    verified: number;
  };
  agent: { name: string; instructions: string; systemPrompt: string };
  mcp: {
    endpoint: string;
    tools: string[];
    resources: string[];
    prompts: string[];
  };
}
export interface RunStats {
  states: number;
  routes: number;
  actions: number;
  executed: number;
  blocked: number;
  failed: number;
  components: number;
  elements: number;
  verified: number;
  pending: number;
  active: number;
}
export interface RunSummary extends Run {
  stats: RunStats;
}
export interface RunData {
  run: RunSummary;
  states: AppState[];
  elements: UIElement[];
  components: Component[];
  actions: ActionEdge[];
  apiCalls: ApiCall[];
  tasks: TaskLease[];
  events: RunEvent[];
}
export interface RunEvent {
  id: number;
  runId: string;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
  worker?: number;
}
export function publicConfig(config: ScanConfig): ScanConfig {
  const cleanUrl = (raw: string) => {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()])
      if (/token|secret|password|auth|key|session|code/i.test(key))
        u.searchParams.set(key, "[redacted]");
    return u.href;
  };
  // Run configs are stored as raw JSON and read back without re-validation
  // (unlike project configs, which go through ConfigSchema.parse() on every
  // read — see Store.project()), so a run saved before a field existed
  // simply won't have it. Guard every array field here instead of trusting
  // the ScanConfig type, or an old run crashes this on read.
  return {
    ...config,
    baseUrl: cleanUrl(config.baseUrl),
    seeds: (config.seeds || []).map(cleanUrl),
    networkWriteBlocklist: (config.networkWriteBlocklist || []).map((e) => ({
      ...e,
      url: cleanUrl(e.url),
    })),
    authStatePath: config.authStatePath ? "[local session]" : undefined,
    formValues: (config.formValues || []).map((v) => ({
      ...v,
      value: "[redacted]",
    })),
    // A setup step can be (and, via auto-recorded login steps, often is) a
    // login form's fill — redact every fill value here the same way
    // formValues are redacted above, not just ones explicitly flagged
    // `secret` (a manually-authored step never gets that flag, but can
    // still hold a real typed password).
    setupSteps: (config.setupSteps || []).map((step) =>
      step.type === "fill" ? { ...step, value: "[redacted]" } : step,
    ),
  };
}

/**
 * A plausible, obviously-synthetic value for a form field discovery never
 * had an explicit `ScanConfig.formValues` entry for — used so a fillable
 * field actually gets filled (and a fillable `<select>` gets a real option
 * picked) during a crawl by default, rather than every field going unfilled
 * until a human configures one. Heuristic only: checks `inputType` first,
 * then falls back to keyword-matching the field's own accessible
 * name/label — good enough to get past client-side format validation
 * (email/url/tel/number patterns), not an attempt to guess real-looking
 * data. Never used for a `<select>` (packages/worker/src/index.ts picks a
 * real `<option>` value for those instead, since an arbitrary string won't
 * match any option).
 */
export function synthesizeFormValue(
  inputType: string | undefined,
  label: string | undefined,
): string {
  const type = (inputType || "").toLowerCase();
  const name = (label || "").toLowerCase();
  if (type === "email" || /e-?mail/.test(name))
    return "unfold-discovery@example.com";
  if (type === "password" || /password/.test(name)) return "Unfold-Test-1!";
  if (type === "tel" || /phone|mobile/.test(name)) return "+15555550123";
  if (type === "url" || /url|website|link/.test(name))
    return "https://example.com";
  if (type === "number" || /number|quantity|qty|amount|zip|postal/.test(name))
    return "1";
  if (type === "date") return new Date().toISOString().slice(0, 10);
  if (type === "search" || /search|query|keyword|filter/.test(name))
    return "test";
  if (/name/.test(name)) return "Unfold Tester";
  return "Unfold test value";
}

// AI Browse: a live session either connected (via Playwright's
// connectOverCDP) to the user's own local Chrome, or launched fresh as a
// throwaway isolated browser the server owns outright — driven by an LLM
// tool-calling agent loop either way. See apps/server/src/browse-session.ts
// for the session manager and packages/mcp/src/browse-tools.ts for the
// tools the agent calls. The two modes have different, deliberately
// asymmetric teardown rules (browse-session.ts): "connect" must never call
// browser.close()/context.close() (it isn't ours to close), while "launch"
// must, since the server owns that browser exclusively and nothing else is
// keeping it running.
export const BrowseSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  mode: z.enum(["connect", "launch"]),
  /** Only meaningful for mode "connect" — the CDP endpoint the user supplied. */
  cdpEndpoint: z.string().optional(),
  status: z.enum(["connecting", "live", "closed", "failed"]),
  createdAt: z.string(),
  closedAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type BrowseSession = z.infer<typeof BrowseSessionSchema>;

// One entry in a browse session's live transcript: a tool call the agent
// made, a chat message, a console log line, or a network request/response
// observed on the attached page. Unlike discovery's ApiCall/BrowserEvent
// evidence, this is captured unredacted — it's the user inspecting their own
// live session, not evidence collected for storage/sharing.
export const BrowseEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sequence: z.number().int().nonnegative(),
  time: z.string(),
  kind: z.enum([
    "agent_tool",
    "agent_message",
    "console",
    "network_request",
    "network_response",
    "status",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
export type BrowseEvent = z.infer<typeof BrowseEventSchema>;

// A captured login session for a project: a human logs into the target app
// in a fresh, isolated, visible browser window (apps/server/src/auth-capture.ts
// — deliberately NOT AI Browse's "connect" mode, which would export every
// cookie in the user's real Chrome profile, nor its "launch" mode, which is
// headless and would require typing a password into the chat box), then the
// resulting Playwright storageState() is saved to disk and its path can be
// set as a discovery run's ScanConfig.authStatePath.
export const AuthCaptureSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  baseUrl: z.string(),
  status: z.enum(["open", "captured", "cancelled", "failed"]),
  /** Only set once status is "captured" — path to the storage-state JSON file. */
  path: z.string().optional(),
  cookieCount: z.number().int().nonnegative().optional(),
  domains: z.array(z.string()).optional(),
  createdAt: z.string(),
  capturedAt: z.string().optional(),
  lastError: z.string().optional(),
  /**
   * Auto-recorded while the capture browser was open (clicks and field
   * fills the user actually performed, translated into the same
   * WorkflowStep vocabulary ConfigSchema.setupSteps uses) — a replayable
   * login recipe the user can review/edit, then save onto the project
   * (`scanConfig.setupSteps`) so a future session refresh never needs a
   * human to log in by hand again. Empty when nothing was recorded (e.g.
   * the capture failed before any interaction) or the user hasn't finished
   * reviewing it yet. Any password-field fill in here always has
   * `value: ""` (`secret: true`) — see WorkflowStepSchema's `fill` variant.
   */
  loginSteps: z.array(WorkflowStepSchema).max(30).default([]),
});
export type AuthCapture = z.infer<typeof AuthCaptureSchema>;

// Automation: the Workflow tab (a named sequence of steps + an expected
// outcome, run against the project's app) and the Framework tab (a real
// Cypress/Playwright project edited in-browser and executed server-side).
// See apps/server/src/automation-workflows.ts, automation-framework.ts, and
// packages/worker/src/workflow-runner.ts. WorkflowStepSchema itself now
// lives near the top of this file (before ConfigSchema), since
// ConfigSchema.setupSteps reuses it directly.
export const AutomationWorkflowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  steps: z.array(WorkflowStepSchema).max(50),
  outcome: z.object({
    description: z.string().max(500),
    assertion: WorkflowStepSchema.optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AutomationWorkflow = z.infer<typeof AutomationWorkflowSchema>;

export const WorkflowStepResultSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
  evidenceId: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type WorkflowStepResult = z.infer<typeof WorkflowStepResultSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  status: z.enum(["queued", "running", "passed", "failed", "error"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  stepResults: z.array(WorkflowStepResultSchema),
  outcomeMet: z.boolean().optional(),
  error: z.string().optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

// The GitHub PAT a FrameworkProject is connected with is never embedded
// here — it lives only in Store's framework_github_tokens table (see
// Store.setFrameworkGithubToken/frameworkGithubToken) so a FrameworkProject
// read from any route can be returned to the client as-is.
export const FrameworkProjectSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  framework: z.enum(["cypress", "playwright"]),
  origin: z.enum(["boilerplate", "scratch"]),
  workspacePath: z.string(),
  /** Which package manager automation-execution.ts uses to install deps and invoke the framework's CLI. Defaults to npm for projects created before this existed. */
  packageManager: z.enum(["npm", "yarn", "pnpm"]).default("npm"),
  github: z
    .object({
      repoUrl: httpUrl,
      defaultBranch: z.string().min(1).max(200).default("main"),
      connectedAt: z.string(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FrameworkProject = z.infer<typeof FrameworkProjectSchema>;

export const TestCaseResultSchema = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

export const TestRunSchema = z.object({
  id: z.string(),
  frameworkProjectId: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  status: z.enum(["queued", "running", "passed", "failed", "error"]),
  command: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  exitCode: z.number().int().optional(),
  resultsSummary: z
    .object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    })
    .optional(),
  cases: z.array(TestCaseResultSchema).default([]),
  logPath: z.string().optional(),
  error: z.string().optional(),
});
export type TestRun = z.infer<typeof TestRunSchema>;

// One dependency add/remove against a FrameworkProject's package.json —
// run as a real `npm install`/`yarn add`/`pnpm add` (or remove) subprocess
// in the background, same fire-and-forget shape as TestRun, so the
// package-installation wizard can poll it instead of blocking on an
// install that can take anywhere from a couple seconds to a minute.
export const PackageOperationSchema = z.object({
  id: z.string(),
  frameworkProjectId: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  action: z.enum(["add", "remove"]),
  packageName: z.string(),
  version: z.string().optional(),
  dev: z.boolean().optional(),
  status: z.enum(["running", "done", "error"]),
  command: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  /** Tail of combined stdout/stderr, truncated — enough to show in the wizard without persisting unbounded output. */
  output: z.string().optional(),
});
export type PackageOperation = z.infer<typeof PackageOperationSchema>;
