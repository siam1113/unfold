import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { allowedUrl, riskyUrl, decide } from "../../core/src/policy.js";
import { classify, redact } from "../../analysis/src/index.js";
import type {
  ScanConfig,
  TaskLease,
  AppState,
  UIElement,
  ActionEdge,
  Observation,
  Component,
  RecipeStep,
  ApiCall,
  BrowserEvent,
  BrowserEvidence,
} from "../../shared/src/index.js";
import { Store, artifactRoot } from "../../storage/src/index.js";
import { observe, resolveTarget, stabilize, verify } from "./observe.js";
import { probeIsolatedContextPersistence, snapshotBrowserPage } from "./browser-evidence.js";
export { chromium };
export interface ProbeResult {
  observation?: Observation;
  edge?: ActionEdge;
  verifiedElements?: UIElement[];
  verifiedComponents?: Component[];
  signals: string[];
  apiCalls: ApiCall[];
}
const safeApiUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    // Query values can contain tokens, identifiers, and user data. Preserve keys only.
    url.search = [...url.searchParams.keys()]
      .map((key) => `${encodeURIComponent(key)}=[redacted]`)
      .join("&");
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
};
const apiBodyLimit = 64 * 1024;
const sensitiveApiKey =
  /password|token|secret|authorization|api[_-]?key|cookie|session/i;
const permissionGroup = (name: string): BrowserEvent["permission"] => {
  if (name === "notifications") return "notifications";
  if (name === "geolocation") return "geolocation";
  if (name === "camera") return "camera";
  if (name === "microphone") return "microphone";
  if (/clipboard/.test(name)) return "clipboard";
  if (name === "midi" || name === "push") return name;
  if (/storage/.test(name)) return "storage";
  if (/accelerometer|gyroscope|magnetometer|sensors/.test(name)) return "sensors";
  if (name === "usb") return "usb";
  if (name === "serial") return "serial";
  if (name === "bluetooth") return "bluetooth";
  if (/window-management|display-capture/.test(name)) return "display_capture";
  return "other";
};
const safeMethod = (method: string): BrowserEvent["method"] =>
  /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method)
    ? (method as BrowserEvent["method"])
    : "OTHER";
function safeApiBody(raw: string | undefined, contentType = "") {
  if (
    !raw ||
    /multipart\/|octet-stream|image\/|audio\/|video\//i.test(contentType)
  )
    return undefined;
  let value = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    const clean = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(clean);
      if (input && typeof input === "object")
        return Object.fromEntries(
          Object.entries(input).map(([key, item]) => [
            key,
            sensitiveApiKey.test(key) ? "[redacted]" : clean(item),
          ]),
        );
      return input;
    };
    value = JSON.stringify(clean(parsed));
  } catch {
    value = value
      .replace(
        /((?:password|token|secret|authorization|api[_-]?key|cookie|session)[^=:\s]*\s*[=:]\s*)[^&\s,;]+/gi,
        "$1[redacted]",
      )
      .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]");
  }
  value = redact(value);
  return value.length > apiBodyLimit
    ? `${value.slice(0, apiBodyLimit)}\n… truncated at 64 KB`
    : value;
}
function safeApiHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|cookie|token|secret|api[_-]?key/i.test(key)
        ? "[redacted]"
        : value.length > 2000
          ? `${value.slice(0, 2000)}…`
          : value,
    ]),
  );
}
async function sanitizedTrace(context: BrowserContext, path: string) {
  await mkdir(dirname(path), { recursive: true });
  await context.tracing.stop({ path });
  // Native traces carry request headers. Retain action timing only; omit network, resources, snapshots and console payloads.
  const entries = unzipSync(await readFile(path));
  const clean: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".trace")) continue;
    const lines = strFromU8(bytes)
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const v = JSON.parse(line);
          if (!["context-options", "before", "after"].includes(v.type))
            return [];
          // Use an allowlist: context options contain storageState, and results may contain DOM data.
          const safe: Record<string, unknown> = {};
          const fields =
            v.type === "context-options"
              ? [
                  "version",
                  "type",
                  "origin",
                  "browserName",
                  "platform",
                  "wallTime",
                  "monotonicTime",
                  "sdkLanguage",
                  "contextId",
                ]
              : v.type === "before"
                ? [
                    "type",
                    "callId",
                    "startTime",
                    "wallTime",
                    "apiName",
                    "class",
                    "method",
                    "pageId",
                    "parentId",
                  ]
                : ["type", "callId", "endTime"];
          for (const key of fields)
            if (v[key] !== undefined) safe[key] = v[key];
          if (v.type === "context-options")
            safe.options = { viewport: v.options?.viewport };
          if (v.type === "before") safe.params = {};
          if (v.error)
            safe.error = {
              message: "Action failed; see structured action evidence",
            };
          return [JSON.stringify(safe)];
        } catch {
          return [];
        }
      });
    clean[name] = strToU8(lines.join("\n") + "\n");
  }
  await writeFile(path, zipSync(clean));
}
export class BrowserWorker {
  constructor(
    private browser: Browser,
    private store: Store,
    private config: ScanConfig,
    private throttle: (origin: string) => Promise<void>,
    private robots?: { allows(url: string): boolean },
    private metrics?: {
      requests: number;
      responseBytes: number;
      appErrors: number;
    },
  ) {}
  async probe(task: TaskLease, worker: number): Promise<ProbeResult> {
    const c = this.config,
      signals: string[] = [];
    const apiCalls: ApiCall[] = [];
    const apiCallsByRequest = new Map<object, ApiCall>();
    const pendingApiBodies: Promise<void>[] = [];
    const settleApiBodies = () =>
      Promise.allSettled(pendingApiBodies).then(() => undefined);
    const started = Date.now();
    let acting = false;
    let browserActionStartedAt = started;
    let browserEvents: BrowserEvent[] = [];
    let browserBefore: BrowserEvidence["before"] | undefined;
    const recordBrowserEvent = (event: Omit<BrowserEvent, "offsetMs">) => {
      if (task.kind !== "action" || !acting) return;
      const aggregate = event.kind === "network_request" || event.kind === "network_response" || event.kind === "redirect";
      if (aggregate) {
        const current = browserEvents.find((item) =>
          item.kind === event.kind && item.tabId === event.tabId && item.origin === event.origin &&
          item.status === event.status && item.method === event.method &&
          item.resourceType === event.resourceType && item.failed === event.failed,
        );
        if (current) {
          current.count = (current.count || 1) + 1;
          return;
        }
      }
      if (browserEvents.length >= 120) return;
      browserEvents.push({
        ...event,
        ...(aggregate ? { count: 1 } : {}),
        offsetMs: Math.max(0, Date.now() - browserActionStartedAt),
      });
    };
    const context = await this.browser.newContext({
      viewport: c.viewport,
      userAgent:
        "Mozilla/5.0 (compatible; Unfold/1.0; authorized application discovery)",
      storageState:
        c.authStatePath && existsSync(c.authStatePath)
          ? c.authStatePath
          : undefined,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    // Browser-side events are sent through a structured binding. Only fixed
    // event names and a bounded history.go delta cross from page context; no
    // page text, URLs, form values, or console messages are collected here.
    const pageTabIds = new WeakMap<Page, string>();
    const pageTabParents = new WeakMap<Page, string>();
    let nextTabId = 0;
    const setTabId = (p: Page, id: string, parentId?: string) => {
      pageTabIds.set(p, id.slice(0, 32));
      if (parentId) pageTabParents.set(p, parentId.slice(0, 32));
    };
    const tabIdFor = (p: Page) => {
      let id = pageTabIds.get(p);
      if (!id) {
        id = `tab-${++nextTabId}`;
        pageTabIds.set(p, id);
      }
      return id;
    };
    const popupTabIdFor = (id: string) => {
      let hash = 2166136261;
      for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return `tab-${(hash >>> 0).toString(36)}`;
    };
    const recordTabSignal = (p: Page, event: string) => {
      // Action-edge signals describe the active control invocation only, not
      // the seed navigation or recipe replay used to restore its start state.
      if (task.kind === "action" && !acting) return;
      if (signals.length < 2000) signals.push(`tab:${tabIdFor(p)}:${event}`);
    };
    const recordTaskBrowserSignal = (signal: string) => {
      if (task.kind === "action" && !acting) return;
      signals.push(signal);
    };
    await context.exposeBinding(
      "__unfoldRecordNavigation",
      (source, payload: unknown) => {
        const p = source.page;
        if (!p || !payload || typeof payload !== "object") return;
        const data = payload as { kind?: unknown; delta?: unknown };
        if (
          data.kind === "pushState" ||
          data.kind === "replaceState" ||
          data.kind === "back" ||
          data.kind === "forward" ||
          data.kind === "go" ||
          data.kind === "popstate"
        ) {
          const suffix = data.kind === "go" && typeof data.delta === "number" &&
            Number.isInteger(data.delta) && Math.abs(data.delta) <= 1000
            ? `:${data.delta}`
            : "";
          recordTabSignal(p, `history:${data.kind}${suffix}`);
        }
      },
    );
    // Lifecycle instrumentation sends only a fixed category and fixed value.
    // The binding validates these again so page code cannot attach arbitrary
    // text, attribute values, permission names, or URLs to action evidence.
    const lifecyclePermissions = new Set([
      "notifications", "geolocation", "camera", "microphone", "clipboard-read",
      "clipboard-write", "midi", "push", "persistent-storage", "background-sync",
      "screen-wake-lock", "accelerometer", "gyroscope", "magnetometer", "local-fonts",
      "payment-handler", "usb", "serial", "bluetooth", "idle-detection", "window-management",
    ]);
    await context.exposeBinding(
      "__unfoldRecordLifecycle",
      (source, payload: unknown) => {
        const p = source.page;
        if (!p || !payload || typeof payload !== "object") return;
        const data = payload as { category?: unknown; value?: unknown; kind?: unknown };
        const simpleValues: Record<string, ReadonlySet<string>> = {
          document: new Set(["loading", "interactive", "complete"]),
          navigation: new Set(["navigate", "reload", "back_forward"]),
          aria_busy: new Set(["present", "absent"]),
          alert: new Set(["present", "absent"]),
          live_region: new Set(["present", "absent"]),
        };
        if (typeof data.category === "string" && typeof data.value === "string" && simpleValues[data.category]?.has(data.value)) {
          recordTabSignal(p, `lifecycle:${data.category}:${data.value}`);
          return;
        }
        if (data.category === "timing") {
          const timingKinds = new Set([
            "navigation_duration_ms", "dom_content_loaded_ms", "load_ms",
            "first_paint_ms", "first_contentful_paint_ms",
          ]);
          if (
            typeof data.kind === "string" && timingKinds.has(data.kind) &&
            typeof data.value === "string" && /^\d{1,8}$/.test(data.value)
          ) {
            const value = Number(data.value);
            if (Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000)
              recordTabSignal(p, `lifecycle:timing:${data.kind}:${value}`);
          }
          return;
        }
        if (
          data.category === "permission_query" || data.category === "permission_request"
        ) {
          if (
            typeof data.kind === "string" && lifecyclePermissions.has(data.kind) &&
            typeof data.value === "string" && ["prompt", "granted", "denied", "other"].includes(data.value)
          ) {
            recordTabSignal(p, `lifecycle:${data.category}:${data.kind}:${data.value}`);
            if (data.category === "permission_request" || data.category === "permission_query")
              recordBrowserEvent({
                kind: data.category,
                tabId: tabIdFor(p),
                permission: permissionGroup(data.kind),
                permissionState: data.value as "prompt" | "granted" | "denied" | "other",
                outcome: "observed",
              });
          }
        }
      },
    );
    await context.addInitScript(() => {
      const report = (kind: string, delta?: number) => {
        try {
          const send = (window as typeof window & {
            __unfoldRecordNavigation?: (event: { kind: string; delta?: number }) => void;
          }).__unfoldRecordNavigation;
          send?.({ kind, delta });
        } catch {
          // Instrumentation must not change application behavior.
        }
      };
      const history = window.history;
      for (const name of ["pushState", "replaceState", "back", "forward", "go"] as const) {
        const original = history[name];
        try {
          Object.defineProperty(history, name, {
            configurable: true,
            writable: true,
            value: function (this: History, ...args: unknown[]) {
              const result = Reflect.apply(original, this, args);
              report(name, name === "go" && typeof args[0] === "number" ? args[0] : undefined);
              return result;
            },
          });
        } catch {
          // Some pages may make History methods non-configurable.
        }
      }
      window.addEventListener("popstate", () => report("popstate"));
    });
    await context.addInitScript(() => {
      type LifecycleCategory = "document" | "navigation" | "aria_busy" | "alert" | "live_region" | "permission_query" | "permission_request" | "timing";
      const permissions = new Set([
        "notifications", "geolocation", "camera", "microphone", "clipboard-read",
        "clipboard-write", "midi", "push", "persistent-storage", "background-sync",
        "screen-wake-lock", "accelerometer", "gyroscope", "magnetometer", "local-fonts",
        "payment-handler", "usb", "serial", "bluetooth", "idle-detection", "window-management",
      ]);
      const report = (category: LifecycleCategory, value: string, kind?: string) => {
        try {
          const send = (window as typeof window & {
            __unfoldRecordLifecycle?: (event: { category: LifecycleCategory; value: string; kind?: string }) => void;
          }).__unfoldRecordLifecycle;
          send?.({ category, value, kind });
        } catch {
          // Instrumentation must not change application behavior.
        }
      };
      const last = new Map<string, string>();
      const reportOnce = (category: LifecycleCategory, value: string, kind?: string) => {
        const key = `${category}:${kind || ""}`;
        if (last.get(key) === value) return;
        last.set(key, value);
        report(category, value, kind);
      };
      const readiness = () => {
        const state = document.readyState;
        if (state === "loading" || state === "interactive" || state === "complete") reportOnce("document", state);
      };
      readiness();
      document.addEventListener("readystatechange", readiness);
      document.addEventListener("DOMContentLoaded", readiness, { once: true });
      window.addEventListener("load", readiness, { once: true });

      const navigationType = () => {
        const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const type = entry?.type;
        if (type === "navigate" || type === "reload" || type === "back_forward") reportOnce("navigation", type);
      };
      navigationType();
      document.addEventListener("DOMContentLoaded", navigationType, { once: true });
      window.addEventListener("pageshow", navigationType, { once: true });

      const reportTiming = (kind: string, raw: number | undefined) => {
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return;
        reportOnce("timing", String(Math.min(Math.round(raw), 86_400_000)), kind);
      };
      const navigationTimings = () => {
        const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (!entry) return;
        reportTiming("navigation_duration_ms", entry.duration);
        // Zero means the browser did not expose a completed event timestamp.
        // Keep it unknown rather than treating a missing metric as zero delay.
        if (entry.domContentLoadedEventEnd > 0) reportTiming("dom_content_loaded_ms", entry.domContentLoadedEventEnd);
        if (entry.loadEventEnd > 0) reportTiming("load_ms", entry.loadEventEnd);
      };
      navigationTimings();
      document.addEventListener("DOMContentLoaded", navigationTimings, { once: true });
      window.addEventListener("load", navigationTimings, { once: true });
      const capturePaintEntries = (entries: PerformanceEntry[]) => {
        for (const entry of entries) {
          if (entry.entryType !== "paint" || entry.startTime < 0) continue;
          if (entry.name === "first-paint") reportTiming("first_paint_ms", entry.startTime);
          if (entry.name === "first-contentful-paint") reportTiming("first_contentful_paint_ms", entry.startTime);
        }
      };
      try {
        capturePaintEntries(performance.getEntriesByType("paint"));
        if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("paint")) {
          const paintObserver = new PerformanceObserver((list) => capturePaintEntries(list.getEntries()));
          paintObserver.observe({ type: "paint", buffered: true });
        }
      } catch { /* Paint timing is optional in some browser contexts. */ }

      const visible = (node: Element) => {
        if (!node.getClientRects().length) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
      };
      let scheduled = false;
      const updateUiCues = () => {
        scheduled = false;
        const busy = document.querySelector('[aria-busy="true"]') !== null;
        const alert = Array.from(document.querySelectorAll('[role="alert"]')).some(visible);
        const live = Array.from(document.querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="log"]')).some(visible);
        reportOnce("aria_busy", busy ? "present" : "absent");
        reportOnce("alert", alert ? "present" : "absent");
        reportOnce("live_region", live ? "present" : "absent");
      };
      const scheduleUiCues = () => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(updateUiCues, 80);
      };
      updateUiCues();
      const observer = new MutationObserver(scheduleUiCues);
      const observe = () => {
        if (document.documentElement) observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["aria-busy", "aria-live", "role", "style", "hidden", "class"],
        });
      };
      observe();
      document.addEventListener("DOMContentLoaded", observe, { once: true });

      const permissionState = (value: unknown) => value === "prompt" || value === "granted" || value === "denied" ? value : "other";
      try {
        const permissionsObject = navigator.permissions;
        const originalQuery = permissionsObject?.query;
        if (originalQuery) {
          Object.defineProperty(permissionsObject, "query", {
            configurable: true,
            writable: true,
            value: function (this: Permissions, descriptor: PermissionDescriptor) {
              const kind = typeof descriptor?.name === "string" && permissions.has(descriptor.name) ? descriptor.name : undefined;
              const result = Reflect.apply(originalQuery, this, [descriptor]);
              if (kind) void Promise.resolve(result).then((status) => report("permission_query", permissionState(status.state), kind)).catch(() => {});
              return result;
            },
          });
        }
      } catch { /* Permission instrumentation is best-effort. */ }
      try {
        const notification = (window as typeof window & { Notification?: typeof Notification }).Notification;
        const originalRequest = notification?.requestPermission;
        if (notification && originalRequest) {
          Object.defineProperty(notification, "requestPermission", {
            configurable: true,
            writable: true,
            value: function (...args: unknown[]) {
              report("permission_request", "prompt", "notifications");
              const result = Reflect.apply(originalRequest, notification, args);
              void Promise.resolve(result).then((value) => report("permission_request", permissionState(value), "notifications")).catch(() => report("permission_request", "other", "notifications"));
              return result;
            },
          });
        }
      } catch { /* Permission instrumentation is best-effort. */ }
      try {
        const geolocation = navigator.geolocation;
        for (const method of ["getCurrentPosition", "watchPosition"] as const) {
          const original = geolocation?.[method];
          if (!original) continue;
          Object.defineProperty(geolocation, method, {
            configurable: true,
            writable: true,
            value: function (success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions) {
              report("permission_request", "prompt", "geolocation");
              const onSuccess: PositionCallback = (position) => { report("permission_request", "granted", "geolocation"); success(position); };
              const onError: PositionErrorCallback = (reason) => { report("permission_request", reason.code === 1 ? "denied" : "other", "geolocation"); error?.(reason); };
              return Reflect.apply(original, geolocation, [onSuccess, onError, options]);
            },
          });
        }
      } catch { /* Permission instrumentation is best-effort. */ }
      try {
        const media = navigator.mediaDevices;
        const original = media?.getUserMedia;
        if (original) Object.defineProperty(media, "getUserMedia", {
          configurable: true,
          writable: true,
          value: function (constraints: MediaStreamConstraints) {
            const requested = [constraints.audio ? "microphone" : undefined, constraints.video ? "camera" : undefined].filter((kind): kind is string => Boolean(kind));
            requested.forEach((kind) => report("permission_request", "prompt", kind));
            const result = Reflect.apply(original, media, [constraints]);
            void Promise.resolve(result).then((stream) => { requested.forEach((kind) => report("permission_request", "granted", kind)); return stream; }, (error: unknown) => {
              const denied = error instanceof DOMException && error.name === "NotAllowedError";
              requested.forEach((kind) => report("permission_request", denied ? "denied" : "other", kind));
              throw error;
            });
            return result;
          },
        });
      } catch { /* Permission instrumentation is best-effort. */ }
      const wrapPromisePermissionRequest = (target: unknown, method: string, permission: string) => {
        if (!target || (typeof target !== "object" && typeof target !== "function")) return;
        const object = target as Record<string, unknown>;
        const original = object[method];
        if (typeof original !== "function") return;
        try {
          Object.defineProperty(object, method, {
            configurable: true,
            writable: true,
            value: function (this: unknown, ...args: unknown[]) {
              report("permission_request", "prompt", permission);
              let result: unknown;
              try { result = Reflect.apply(original, this, args); }
              catch (error) {
                const denied = error instanceof DOMException && error.name === "NotAllowedError";
                report("permission_request", denied ? "denied" : "other", permission);
                throw error;
              }
              void Promise.resolve(result).then(
                () => report("permission_request", "granted", permission),
                (error: unknown) => report("permission_request", error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "other", permission),
              );
              return result;
            },
          });
        } catch { /* The browser may expose a non-configurable method. */ }
      };
      try {
        const media = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream> };
        wrapPromisePermissionRequest(media, "getDisplayMedia", "window-management");
      } catch { /* Display capture is optional. */ }
      try {
        const extendedNavigator = navigator as Navigator & {
          usb?: unknown; serial?: unknown; bluetooth?: unknown; clipboard?: unknown;
        };
        wrapPromisePermissionRequest(extendedNavigator.usb, "requestDevice", "usb");
        wrapPromisePermissionRequest(extendedNavigator.serial, "requestPort", "serial");
        wrapPromisePermissionRequest(extendedNavigator.bluetooth, "requestDevice", "bluetooth");
        wrapPromisePermissionRequest(extendedNavigator.clipboard, "read", "clipboard-read");
        wrapPromisePermissionRequest(extendedNavigator.clipboard, "readText", "clipboard-read");
      } catch { /* Optional browser APIs vary by context. */ }
      try {
        wrapPromisePermissionRequest(Document.prototype, "requestStorageAccess", "persistent-storage");
      } catch { /* Storage access API is optional. */ }
    });
    const taskDeadline = setTimeout(
      () => {
        void context.close().catch(() => {});
      },
      (c.maxDepth + 3) * (c.actionTimeoutMs + 5000),
    );
    context.setDefaultTimeout(c.actionTimeoutMs);
    context.setDefaultNavigationTimeout(c.actionTimeoutMs);
    let traceStarted = false;
    const initialState = task.stateId
      ? this.store.get<AppState>("states", task.stateId)
      : undefined;
    let activeBrowserTabId = initialState?.browserTabId || "tab-root";
    let activeBrowserTabParentId = initialState?.browserTabParentId;
    let page = await context.newPage();
    setTabId(page, activeBrowserTabId, activeBrowserTabParentId);
    let before: AppState | undefined;
    let element: UIElement | undefined;
    let edge: ActionEdge | undefined;
    const actionId = task.id;
    const attach = (p: Page) => {
      p.on("dialog", (d) => {
        recordTabSignal(p, `dialog:${d.type()}`);
        recordTaskBrowserSignal(`browser_dialog:${d.type()}`);
        recordBrowserEvent({
          kind: "dialog",
          tabId: tabIdFor(p),
          dialogType: d.type() as "alert" | "beforeunload" | "confirm" | "prompt",
          outcome: "dismissed",
        });
        void d.dismiss();
      });
      p.on("download", (d) => {
        recordTabSignal(p, "download");
        recordTaskBrowserSignal("download");
        recordBrowserEvent({ kind: "download", tabId: tabIdFor(p), outcome: "started" });
        void d.cancel();
      });
      p.on("close", () => recordBrowserEvent({ kind: "tab_closed", tabId: tabIdFor(p) }));
      p.on("framenavigated", (frame) => {
        if (frame !== p.mainFrame()) return;
        try {
          if (new URL(frame.url()).origin !== new URL(c.baseUrl).origin)
            recordTabSignal(p, "external_navigation");
        } catch {
          // Ignore non-HTTP browser-internal URLs.
        }
      });
      p.on("pageerror", () => {
        signals.push("page_script_error");
        if (this.metrics) this.metrics.appErrors++;
      });
      p.on("requestfinished", (req) => {
        const apiCall = apiCallsByRequest.get(req);
        if (apiCall) {
          const timing = req.timing();
          apiCall.timings = Object.fromEntries(
            Object.entries(timing)
              .filter(([, value]) => typeof value === "number" && value >= 0)
              .map(([key, value]) => [key, value as number]),
          );
          if (timing.responseEnd >= 0 && timing.requestStart >= 0)
            apiCall.durationMs = Math.round(
              timing.responseEnd - timing.requestStart,
            );
        }
        void req
          .sizes()
          .then((size) => {
            if (this.metrics)
              this.metrics.responseBytes +=
                size.responseBodySize + size.responseHeadersSize;
          })
          .catch(() => {});
      });
      p.on("response", (r) => {
        const request = r.request();
        try {
          recordBrowserEvent({
            kind: "network_response",
            tabId: tabIdFor(p),
            origin: new URL(request.url()).origin,
            status: r.status(),
            method: safeMethod(request.method()),
            resourceType: request.resourceType().slice(0, 32),
          });
        } catch { /* malformed or browser-internal URL */ }
        const apiCall = apiCallsByRequest.get(r.request());
        if (apiCall) {
          apiCall.status = r.status();
          pendingApiBodies.push(
            (async () => {
              const headers = await r.allHeaders();
              apiCall.responseHeaders = safeApiHeaders(headers);
              const contentType = headers["content-type"] || "";
              if (
                /json|text|xml|javascript|x-www-form-urlencoded/i.test(
                  contentType,
                )
              ) {
                const length = Number(headers["content-length"] || 0);
                if (!length || length <= apiBodyLimit * 4) {
                  const body = await r.text();
                  apiCall.responseBody = safeApiBody(body, contentType);
                }
              }
            })().catch(() => {}),
          );
        }
        if (r.status() === 429 || r.status() >= 500) {
          signals.push(`http_${r.status()}`);
          if (this.metrics) this.metrics.appErrors++;
        }
      });
      p.on("request", (req) => {
        try {
          if (req.isNavigationRequest() || req.resourceType() === "xhr" || req.resourceType() === "fetch") {
            recordBrowserEvent({
              kind: "network_request",
              tabId: tabIdFor(p),
              origin: new URL(req.url()).origin,
              method: safeMethod(req.method()),
              resourceType: req.resourceType().slice(0, 32),
            });
          }
        } catch { /* malformed or browser-internal URL */ }
        const resourceType = req.resourceType();
        if (
          (resourceType !== "xhr" && resourceType !== "fetch") ||
          !allowedUrl(req.url(), c)
        )
          return;
        const apiCall: ApiCall = {
          id: `${task.id}:api:${apiCalls.length}`,
          runId: task.runId,
          taskId: task.id,
          actionId: task.kind === "action" ? task.id : undefined,
          sequence: apiCalls.length,
          observedAt: new Date().toISOString(),
          method: req.method(),
          url: safeApiUrl(req.url()),
          resourceType,
          requestHeaders: safeApiHeaders(req.headers()),
          requestBody: safeApiBody(
            req.postData() || undefined,
            req.headers()["content-type"] || "",
          ),
          failed: false,
          fromStateId: task.stateId,
        };
        apiCalls.push(apiCall);
        apiCallsByRequest.set(req, apiCall);
      });
      p.on("requestfailed", (req) => {
        try {
          if (req.isNavigationRequest() || req.resourceType() === "xhr" || req.resourceType() === "fetch") {
            recordBrowserEvent({
              kind: "network_response",
              tabId: tabIdFor(p),
              origin: new URL(req.url()).origin,
              method: safeMethod(req.method()),
              resourceType: req.resourceType().slice(0, 32),
              failed: true,
            });
          }
        } catch { /* malformed or browser-internal URL */ }
        const apiCall = apiCallsByRequest.get(req);
        if (apiCall) apiCall.failed = true;
      });
      // Chromium protocol events distinguish document navigation causes and
      // browser history/reload traversal from page History API calls. The
      // destination URL is intentionally discarded; only fixed reason enums
      // and the origin on redirects are retained.
      void (async () => {
        const cdp = await context.newCDPSession(p);
        await cdp.send("Page.enable");
        await cdp.send("Network.enable");
        const frameTree = await cdp.send("Page.getFrameTree");
        const mainFrameId = frameTree.frameTree.frame.id;
        cdp.on("Page.frameRequestedNavigation", (event) => {
          if (event.frameId !== mainFrameId) return;
          recordBrowserEvent({
            kind: "navigation_request",
            tabId: tabIdFor(p),
            navigationReason: event.reason,
            disposition: event.disposition,
          });
        });
        cdp.on("Page.frameStartedNavigating", (event) => {
          if (event.frameId !== mainFrameId) return;
          recordBrowserEvent({
            kind: "navigation_start",
            tabId: tabIdFor(p),
            navigationType: event.navigationType,
          });
        });
        cdp.on("Network.requestWillBeSent", (event) => {
          if (event.type !== "Document" || !event.redirectResponse) return;
          try {
            recordBrowserEvent({
              kind: "redirect",
              tabId: tabIdFor(p),
              origin: new URL(event.redirectResponse.url).origin,
              status: event.redirectResponse.status,
            });
          } catch { /* malformed or browser-internal URL */ }
        });
        p.once("close", () => void cdp.detach().catch(() => {}));
      })().catch(() => {});
    };
    attach(page);
    let popup: Page | undefined;
    let actionPopupCount = 0;
    context.on("page", async (p) => {
      const opener = await p.opener().catch(() => null);
      const parentTabId = opener ? tabIdFor(opener) : activeBrowserTabId;
      const childTabId = acting ? popupTabIdFor(`${actionId}-${++actionPopupCount}`) : `tab-${++nextTabId}`;
      setTabId(p, childTabId, parentTabId);
      attach(p);
      recordBrowserEvent({
        kind: "tab_opened",
        tabId: childTabId,
        ...(parentTabId ? { parentTabId } : {}),
      });
      if (acting) {
        popup = p;
        recordTabSignal(p, "popup_opened");
        signals.push("open_new_tab");
      }
    });
    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (!allowedUrl(url, c)) {
        signals.push(`blocked_origin:${new URL(url).origin}`);
        recordBrowserEvent({
          kind: "network_response",
          tabId: tabIdFor(req.frame().page()),
          origin: new URL(url).origin,
          method: safeMethod(req.method()),
          resourceType: req.resourceType().slice(0, 32),
          failed: true,
        });
        if (req.isNavigationRequest()) {
          recordTaskBrowserSignal("external_navigation");
          try {
            recordTabSignal(req.frame().page(), "external_navigation_blocked");
          } catch {
            // A detached or service-worker request may not have a page.
          }
        }
        await route.abort("blockedbyclient");
        return;
      }
      if (this.robots && !this.robots.allows(url)) {
        signals.push("blocked_robots");
        try {
          recordBrowserEvent({
            kind: "network_response",
            tabId: tabIdFor(req.frame().page()),
            origin: new URL(url).origin,
            method: safeMethod(req.method()),
            resourceType: req.resourceType().slice(0, 32),
            failed: true,
          });
        } catch { /* detached frame */ }
        await route.abort("blockedbyclient");
        return;
      }
      if (
        req.isNavigationRequest() &&
        riskyUrl(url, c) &&
        !c.actionAllowlist.some(
          (a) =>
            a.route === new URL(before?.url || task.url).pathname &&
            a.name === element?.accessibleName,
        )
      ) {
        signals.push("blocked_risky_navigation");
        await route.abort("blockedbyclient");
        return;
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method()) &&
        !c.networkWriteAllowlist.some(
          (a) => a.url === url && a.method === req.method(),
        )
      ) {
        signals.push(`blocked_write:${req.method()}:${new URL(url).pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      if (req.isNavigationRequest()) await this.throttle(new URL(url).origin);
      if (this.metrics) this.metrics.requests++;
      if (signals.length < 1000)
        signals.push(`request:${req.method()}:${new URL(url).pathname}`);
      await route.continue();
    });
    if ("routeWebSocket" in context)
      await context.routeWebSocket(/.*/, (ws) => ws.close());
    try {
      if (c.captureTracesOnFailure) {
        await context.tracing.start({
          screenshots: false,
          snapshots: false,
          sources: false,
        });
        traceStarted = true;
      }
      const source = initialState;
      const recipe = source?.recipe || {
        id: `recipe-${task.id}`,
        seed: task.url,
        steps: [],
      };
      if (!allowedUrl(recipe.seed, c) || riskyUrl(recipe.seed, c))
        throw new Error("POLICY: seed URL is blocked");
      await page.goto(recipe.seed, { waitUntil: "domcontentloaded" });
      await stabilize(page, c.settleMs);
      for (const step of recipe.steps) {
        const current = await observe(
          page,
          task.runId,
          { ...c, captureScreenshots: false },
          recipe,
          task.depth,
          worker,
        );
        const target = current.elements.find(
          (e) => e.structuralSignature === step.elementSignature,
        );
        if (
          !target ||
          !decide(target, current.state.url, c, step.action).allowed
        )
          throw new Error("RESTORE_POLICY: replay target no longer approved");
        const l = await resolveTarget(page, step.locators);
        await this.act(l, step.action, step.valueKey);
        await stabilize(page, c.settleMs);
        const restored = await observe(
          page,
          task.runId,
          { ...c, captureScreenshots: false },
          recipe,
          task.depth,
          worker,
        );
        if (restored.state.fingerprint !== step.expectedFingerprint)
          throw new Error(
            "RESTORE_MISMATCH: intermediate state did not match the verified recipe",
          );
      }
      const pre = await observe(
        page,
        task.runId,
        c,
        recipe,
        task.depth,
        worker,
        undefined,
        activeBrowserTabId,
        activeBrowserTabParentId,
      );
      if (task.kind === "route") {
        for (const call of apiCalls) call.toStateId = pre.state.id;
        await settleApiBodies();
        return { observation: pre, signals, apiCalls };
      }
      before = source;
      if (!before) throw new Error("MISSING_STATE");
      if (pre.state.fingerprint !== before.fingerprint)
        throw new Error(
          "RESTORE_MISMATCH: target state could not be reproduced",
        );
      element = this.store.get<UIElement>("elements", task.elementId!);
      if (!element) throw new Error("MISSING_ELEMENT");
      const policy = decide(element, before.url, c, task.action);
      if (element.href && this.robots && !this.robots.allows(element.href)) {
        policy.allowed = false;
        policy.rule = "robots";
        policy.reason = "Destination disallowed by robots.txt";
      }
      edge = {
        id: actionId,
        runId: task.runId,
        fromStateId: before.id,
        elementId: element.id,
        targetName: element.accessibleName || element.tag,
        action: task.action,
        effectFlags: [],
        decision: "executed",
        restoreRecipeId: recipe.id,
        evidencePaths: before.screenshotPath ? [before.screenshotPath] : [],
        policy,
        worker,
        depth: task.depth,
        createdAt: new Date().toISOString(),
        confidence: 1,
        intent: "unknown",
        signals: [],
        beforeUrl: before.url,
      };
      if (!policy.allowed) {
        edge.decision = "skipped_policy";
        await settleApiBodies();
        return { edge, signals, apiCalls };
      }
      const verifiedElements = await Promise.all(
        this.store
          .all<UIElement>("elements", task.runId)
          .filter((e) => e.stateId === before!.id)
          .map(async (e) => ({
            ...e,
            locatorCandidates: await verify(page, e.locatorCandidates, true),
          })),
      );
      const verifiedComponents = await Promise.all(
        this.store
          .all<Component>("components", task.runId)
          .filter((e) => e.stateId === before!.id)
          .map(async (e) => ({
            ...e,
            rootLocator: (await verify(page, [e.rootLocator], true))[0],
          })),
      );
      const target = await resolveTarget(page, element.locatorCandidates);
      browserEvents = [];
      browserActionStartedAt = Date.now();
      browserBefore = await snapshotBrowserPage(page, context).catch(() => undefined);
      acting = true;
      await this.act(target, task.action, task.valueKey);
      await stabilize(page, c.settleMs);
      if (popup) {
        await popup
          .waitForLoadState("domcontentloaded", { timeout: c.actionTimeoutMs })
          .catch(() => {});
        if (allowedUrl(popup.url(), c)) {
          const previousTabId = tabIdFor(page);
          page = popup;
          activeBrowserTabId = tabIdFor(popup);
          activeBrowserTabParentId = pageTabParents.get(popup) || previousTabId;
          recordTabSignal(popup, "popup_active");
          recordBrowserEvent({ kind: "tab_activated", tabId: tabIdFor(popup), parentTabId: previousTabId });
          await stabilize(page, c.settleMs);
        }
      }
      if (element.isSubmit) signals.push("submit_form");
      const nextRecipe = {
        id: `recipe-${actionId}`,
        seed: recipe.seed,
        steps: [...recipe.steps],
      };
      const post = await observe(
        page,
        task.runId,
        c,
        nextRecipe,
        task.depth,
        worker,
        actionId,
        activeBrowserTabId,
        activeBrowserTabParentId,
      );
      const browserAfter = await snapshotBrowserPage(page, context).catch(() => undefined);
      const persistenceTriggered = browserEvents.some((event) =>
        event.kind === "navigation_start" && (event.navigationType === "reload" || event.navigationType?.startsWith("history")) ||
        event.kind === "navigation_request" && event.navigationReason === "reload",
      ) || signals.some((signal) => /(?:^|:)history:(back|forward|go)(?::|$)/.test(signal));
      const isolatedContextPersistence = persistenceTriggered
        ? await probeIsolatedContextPersistence(this.browser, context, page.url())
        : undefined;
      const step: RecipeStep = {
        elementSignature: element.structuralSignature,
        locators: verifiedElements.find((e) => e.id === element!.id)!
          .locatorCandidates,
        action: task.action,
        valueKey: task.valueKey,
        expectedFingerprint: post.state.fingerprint,
        expectedUrl: post.state.url,
      };
      if (signals.includes("open_new_tab")) {
        nextRecipe.seed = post.state.url;
        nextRecipe.steps = [];
      } else nextRecipe.steps.push(step);
      edge.toStateId = post.state.id;
      edge.afterUrl = post.state.url;
      if (browserBefore && browserAfter) {
        edge.browserEvidence = {
          version: 1,
          sourceTabId: initialState?.browserTabId || "tab-root",
          activeTabId: activeBrowserTabId,
          activeTabParentId: activeBrowserTabParentId,
          before: browserBefore,
          after: browserAfter,
          ...(isolatedContextPersistence ? { isolatedContextPersistence } : {}),
          events: browserEvents.slice(0, 120),
        };
      }
      edge.effectFlags = classify(before, post.state, signals);
      edge.signals = [...new Set(signals)];
      edge.elapsedMs = Date.now() - started;
      if (post.state.screenshotPath)
        edge.evidencePaths.push(post.state.screenshotPath);
      const evidencePath = `${task.runId}/evidence/actions/${actionId}.json`;
      await mkdir(dirname(resolve(artifactRoot(), evidencePath)), {
        recursive: true,
      });
      await writeFile(
        resolve(artifactRoot(), evidencePath),
        JSON.stringify(
          {
            before: before.fingerprint,
            after: post.state.fingerprint,
            edge,
            recipe: nextRecipe,
          },
          null,
          2,
        ),
      );
      edge.evidencePaths.push(evidencePath);
      for (const call of apiCalls) call.toStateId = post.state.id;
      await settleApiBodies();
      return {
        observation: post,
        edge,
        verifiedElements,
        verifiedComponents,
        signals,
        apiCalls,
      };
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : String(e));
      if (task.kind === "action") {
        before = before || this.store.get<AppState>("states", task.stateId!);
        element =
          element || this.store.get<UIElement>("elements", task.elementId!);
        edge = edge || {
          id: actionId,
          runId: task.runId,
          fromStateId: task.stateId!,
          elementId: task.elementId!,
          targetName: element?.accessibleName || "Unknown control",
          action: task.action,
          decision: "failed",
          effectFlags: ["error"],
          restoreRecipeId: before?.recipe.id || "",
          evidencePaths: [],
          policy: {
            allowed: false,
            rule: "failure",
            reason: "State or target could not be verified",
            intent: "unknown",
          },
          worker,
          depth: task.depth,
          createdAt: new Date().toISOString(),
          confidence: 0,
          intent: "unknown",
          signals: [],
          beforeUrl: before?.url || task.url,
        };
        edge.decision = "failed";
        edge.confidence = 0;
        edge.effectFlags = ["error"];
        edge.error = message.slice(0, 700);
        edge.errorCode = message.split(":")[0].slice(0, 80);
        edge.elapsedMs = Date.now() - started;
        edge.signals = [...new Set(signals)];
        if (browserBefore) {
          const browserAfter = await snapshotBrowserPage(page, context).catch(() => undefined);
          if (browserAfter) {
            edge.browserEvidence = {
              version: 1,
              sourceTabId: initialState?.browserTabId || "tab-root",
              activeTabId: activeBrowserTabId,
              activeTabParentId: activeBrowserTabParentId,
              before: browserBefore,
              after: browserAfter,
              events: browserEvents.slice(0, 120),
            };
          }
        }
        if (c.captureScreenshots) {
          const path = `${task.runId}/evidence/screenshots/failure-${actionId}.png`;
          await mkdir(dirname(resolve(artifactRoot(), path)), {
            recursive: true,
          });
          await page
            .screenshot({
              path: resolve(artifactRoot(), path),
              mask: c.redactSelectors.map((s) => page.locator(s)),
            })
            .then(() => edge!.evidencePaths.push(path))
            .catch(() => {});
        }
        if (traceStarted) {
          const path = `${task.runId}/evidence/traces/${actionId}.zip`;
          await sanitizedTrace(context, resolve(artifactRoot(), path))
            .then(() => edge!.evidencePaths.push(path))
            .catch(async () => {
              await unlink(resolve(artifactRoot(), path)).catch(() => {});
            });
          traceStarted = false;
        }
        await settleApiBodies();
        return { edge, signals, apiCalls };
      }
      throw new Error(message);
    } finally {
      clearTimeout(taskDeadline);
      if (traceStarted) await context.tracing.stop().catch(() => {});
      await context.close().catch(() => {});
    }
  }
  private async act(
    target: Awaited<ReturnType<typeof resolveTarget>>,
    action: string,
    key?: string,
  ) {
    if (action === "fill" || action === "select") {
      const v = this.config.formValues.find(
        (v) => `${v.route}:${v.label}` === key,
      );
      if (!v) throw new Error("MISSING_SYNTHETIC_VALUE");
      if (action === "select") await target.selectOption(v.value);
      else await target.fill(v.value);
    } else if (action === "hover") await target.hover();
    else await target.click();
  }
}
