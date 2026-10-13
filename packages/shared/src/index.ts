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
    concurrency: z.number().int().min(1).max(16).default(4),
    maxDepth: z.number().int().min(0).max(20).default(6),
    maxStates: z.number().int().min(1).max(10000).default(250),
    maxActions: z.number().int().min(1).max(50000).default(1500),
    maxDurationMinutes: z.number().positive().max(240).default(15),
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
    networkWriteAllowlist: z
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
  return {
    ...config,
    baseUrl: cleanUrl(config.baseUrl),
    seeds: config.seeds.map(cleanUrl),
    networkWriteAllowlist: config.networkWriteAllowlist.map((e) => ({
      ...e,
      url: cleanUrl(e.url),
    })),
    authStatePath: config.authStatePath ? "[local session]" : undefined,
    formValues: config.formValues.map((v) => ({ ...v, value: "[redacted]" })),
  };
}
