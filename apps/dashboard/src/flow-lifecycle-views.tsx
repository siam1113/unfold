import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  FileImage,
  GitCompareArrows,
  Info,
  Link2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import type {
  ActionEdge,
  ApiCall,
  AppState,
  Component,
  RunData,
  RunSummary,
  UIElement,
} from "../../../packages/shared/src/index";
import { FrontierQueueMap, WorkerSwimlanes } from "./flow-ops-views";
import "./flow-lifecycle-views.css";

export type LifecycleSelection = { kind: "state" | "action"; id: string };
export type RunPairProps = {
  earlier: RunData;
  later: RunData;
  onSelect?: (side: "earlier" | "later", selection: LifecycleSelection) => void;
};

const pathname = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
};
const endpointIdentity = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return pathname(url);
  }
};
const safeAuthEndpoint = (url: string) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split("/")
      .map((segment) =>
        /token|secret|password|auth|session|credential|api[_-]?key|^[a-f0-9]{24,}$/i.test(
          segment,
        )
          ? "[redacted]"
          : segment,
      )
      .join("/");
    return `${parsed.host}${path}`;
  } catch {
    return "Endpoint details unavailable";
  }
};
const parseTabSignal = (signal: string) => {
  const match = /^tab:(tab-[^:]+):(.+)$/.exec(signal);
  return match ? { tabId: match[1], event: match[2] } : undefined;
};

const stateName = (state: AppState) =>
  state.title?.trim() || pathname(state.url) || state.routeKey;
const stateRoute = (state: AppState) => {
  try {
    return new URL(state.url).pathname;
  } catch {
    return state.routeKey || state.url;
  }
};
const dateValue = (date?: string) => (date ? Date.parse(date) || 0 : 0);
const showTime = (date?: string) => {
  if (!date) return "Not recorded";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString();
};
const loadSameOriginImage = (path: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = new URL(`/artifacts/${path}`, window.location.origin);
    if (url.origin !== window.location.origin) {
      reject(new Error("Screenshot is not a same-origin asset."));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Screenshot could not be loaded."));
    image.src = url.href;
  });
const containScreenshot = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) => {
  const scale = Math.min(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
};
const screenshotPixelView = (
  pair: {
    width: number;
    height: number;
    earlier: Uint8ClampedArray;
    later: Uint8ClampedArray;
  },
  threshold: number,
  mode: "difference" | "overlay",
  blend: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = pair.width;
  canvas.height = pair.height;
  const context = canvas.getContext("2d");
  if (!context) return { src: "", changed: 0 };
  const output = context.createImageData(pair.width, pair.height);
  let changed = 0;
  for (let index = 0; index < pair.earlier.length; index += 4) {
    const delta = Math.max(
      Math.abs(pair.earlier[index] - pair.later[index]),
      Math.abs(pair.earlier[index + 1] - pair.later[index + 1]),
      Math.abs(pair.earlier[index + 2] - pair.later[index + 2]),
    );
    const isChanged = delta > threshold;
    if (isChanged) changed += 1;
    if (mode === "overlay") {
      const ratio = blend / 100;
      output.data[index] = Math.round(
        pair.earlier[index] * (1 - ratio) + pair.later[index] * ratio,
      );
      output.data[index + 1] = Math.round(
        pair.earlier[index + 1] * (1 - ratio) + pair.later[index + 1] * ratio,
      );
      output.data[index + 2] = Math.round(
        pair.earlier[index + 2] * (1 - ratio) + pair.later[index + 2] * ratio,
      );
    } else if (isChanged) {
      output.data[index] = 238;
      output.data[index + 1] = 63;
      output.data[index + 2] = 65;
    } else {
      const gray = Math.round(
        (pair.earlier[index] +
          pair.earlier[index + 1] +
          pair.earlier[index + 2]) /
          3,
      );
      output.data[index] = gray;
      output.data[index + 1] = gray;
      output.data[index + 2] = gray;
    }
    output.data[index + 3] = 255;
  }
  context.putImageData(output, 0, 0);
  return { src: canvas.toDataURL("image/png"), changed };
};
const elementCountByState = (data: RunData) => {
  const result = new Map<string, UIElement[]>();
  for (const element of data.elements)
    result.set(element.stateId, [
      ...(result.get(element.stateId) || []),
      element,
    ]);
  return result;
};
const componentRouteMap = (data: RunData) => {
  const states = new Map(data.states.map((state) => [state.id, state]));
  const result = new Map<string, Set<string>>();
  for (const component of data.components) {
    const state = states.get(component.stateId);
    if (!state) continue;
    const key = `${component.familyId || component.name}:${component.kind}`;
    result.set(key, new Set([...(result.get(key) || []), stateRoute(state)]));
  }
  return result;
};
const actionIdentity = (action: ActionEdge, states: Map<string, AppState>) => {
  const source = states.get(action.fromStateId);
  const target = action.toStateId ? states.get(action.toStateId) : undefined;
  return [
    source?.fingerprint || (source ? stateRoute(source) : "unknown-source"),
    action.action,
    action.targetName.trim().toLowerCase(),
    target?.fingerprint || (target ? stateRoute(target) : "no-target"),
  ].join("\u0000");
};

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "caution";
}) {
  const Icon = tone === "info" ? Info : AlertCircle;
  return (
    <p className={`flv-notice ${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </p>
  );
}

function Prerequisite({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="flv" aria-label={title}>
      <header className="flv-heading">
        <div>
          <h2>{title}</h2>
          <p>Data requirement</p>
        </div>
      </header>
      <div className="flv-prerequisite">
        <ShieldAlert size={19} aria-hidden="true" />
        <strong>This view needs data the run does not record.</strong>
        <span>{detail}</span>
      </div>
    </section>
  );
}

/** Compare two discoveries by exact state fingerprints and observed records. */
export function DiscoveryComparisonView({
  earlier,
  later,
  onSelect,
}: RunPairProps) {
  const earlierRoutes = new Set(earlier.states.map(stateRoute));
  const laterRoutes = new Set(later.states.map(stateRoute));
  const earlierFingerprints = new Map(
    earlier.states.map((state) => [state.fingerprint, state]),
  );
  const laterFingerprints = new Map(
    later.states.map((state) => [state.fingerprint, state]),
  );
  const addedStates = later.states.filter(
    (state) => !earlierFingerprints.has(state.fingerprint),
  );
  const removedStates = earlier.states.filter(
    (state) => !laterFingerprints.has(state.fingerprint),
  );
  const addedRoutes = [...laterRoutes]
    .filter((route) => !earlierRoutes.has(route))
    .sort();
  const removedRoutes = [...earlierRoutes]
    .filter((route) => !laterRoutes.has(route))
    .sort();
  const oldActionCounts = new Map<string, number>();
  const newActionCounts = new Map<string, number>();
  const actionLabels = new Map<string, string>();
  const countActions = (run: RunData, into: Map<string, number>) => {
    const states = new Map(run.states.map((state) => [state.id, state]));
    for (const action of run.actions) {
      const signature = `${actionIdentity(action, states)}\u0000${action.decision}`;
      into.set(signature, (into.get(signature) || 0) + 1);
      actionLabels.set(
        signature,
        `${action.action} ${action.targetName || "control"} · ${action.decision}`,
      );
    }
  };
  countActions(earlier, oldActionCounts);
  countActions(later, newActionCounts);
  const actionDelta = [
    ...new Set([...oldActionCounts.keys(), ...newActionCounts.keys()]),
  ]
    .map((key) => ({
      key,
      before: oldActionCounts.get(key) || 0,
      after: newActionCounts.get(key) || 0,
    }))
    .filter((item) => item.before !== item.after);
  const oldOutcomes = {
    executed: earlier.actions.filter((a) => a.decision === "executed").length,
    skipped: earlier.actions.filter((a) => a.decision === "skipped_policy")
      .length,
    failed: earlier.actions.filter((a) => a.decision === "failed").length,
  };
  const newOutcomes = {
    executed: later.actions.filter((a) => a.decision === "executed").length,
    skipped: later.actions.filter((a) => a.decision === "skipped_policy")
      .length,
    failed: later.actions.filter((a) => a.decision === "failed").length,
  };
  const sameProject =
    earlier.run.projectId && earlier.run.projectId === later.run.projectId;
  const viewportChanged =
    earlier.run.config.viewport.width !== later.run.config.viewport.width ||
    earlier.run.config.viewport.height !== later.run.config.viewport.height;
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  const hostChanged =
    hostOf(earlier.run.config.baseUrl) !== hostOf(later.run.config.baseUrl);

  return (
    <section className="flv" aria-labelledby="flv-compare-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-compare-title">Discovery comparison</h2>
          <p>
            Exact fingerprint matches plus route and action outcome changes.
          </p>
        </div>
        <div className="flv-run-pair">
          <span>{earlier.run.name}</span>
          <ArrowRight size={14} />
          <span>{later.run.name}</span>
        </div>
      </header>
      {(!sameProject || viewportChanged || hostChanged) && (
        <Notice tone="caution">
          {[
            !sameProject && "These runs do not share a recorded project ID.",
            hostChanged && "The base URL hosts differ.",
            viewportChanged && "The configured viewports differ.",
          ]
            .filter(Boolean)
            .join(" ")}{" "}
          Matching uses exact recorded fingerprints and URL paths; differences
          may reflect scan setup as well as product changes.
        </Notice>
      )}
      <div className="flv-stat-grid">
        <Metric
          label="Routes"
          before={earlierRoutes.size}
          after={laterRoutes.size}
          added={addedRoutes.length}
          removed={removedRoutes.length}
        />
        <Metric
          label="Exact screen fingerprints"
          before={earlier.states.length}
          after={later.states.length}
          added={addedStates.length}
          removed={removedStates.length}
        />
        <Metric
          label="Action records"
          before={earlier.actions.length}
          after={later.actions.length}
        />
        <Metric
          label="API calls"
          before={earlier.apiCalls.length}
          after={later.apiCalls.length}
        />
      </div>
      <div className="flv-columns">
        <section className="flv-list-panel">
          <h3>Routes added</h3>
          <RecordList
            items={addedRoutes}
            empty="No new URL paths in the later run."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Routes no longer observed</h3>
          <RecordList
            items={removedRoutes}
            empty="All earlier URL paths appear in the later run."
          />
        </section>
        <section className="flv-list-panel">
          <h3>New screen fingerprints</h3>
          <RecordList
            items={addedStates.map((state) => stateName(state))}
            empty="No new exact fingerprints."
            onItems={addedStates.map(
              (state) => () =>
                onSelect?.("later", { kind: "state", id: state.id }),
            )}
          />
        </section>
        <section className="flv-list-panel">
          <h3>Missing screen fingerprints</h3>
          <RecordList
            items={removedStates.map((state) => stateName(state))}
            empty="No earlier fingerprints are missing."
            onItems={removedStates.map(
              (state) => () =>
                onSelect?.("earlier", { kind: "state", id: state.id }),
            )}
          />
        </section>
      </div>
      <section className="flv-table-wrap">
        <h3>Action outcomes</h3>
        <table className="flv-table">
          <thead>
            <tr>
              <th>Outcome</th>
              <th>{earlier.run.name}</th>
              <th>{later.run.name}</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {(["executed", "skipped", "failed"] as const).map((key) => (
              <tr key={key}>
                <th>{key === "skipped" ? "Skipped by policy" : key}</th>
                <td>{oldOutcomes[key]}</td>
                <td>{newOutcomes[key]}</td>
                <td
                  className={
                    newOutcomes[key] > oldOutcomes[key]
                      ? "negative"
                      : newOutcomes[key] < oldOutcomes[key]
                        ? "positive"
                        : ""
                  }
                >
                  {signed(newOutcomes[key] - oldOutcomes[key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flv-footnote">
          Action signature differences: {actionDelta.length}. Signatures align
          source/target fingerprints, action, target label, and outcome; they
          are a heuristic when discovery paths differ.
        </p>
      </section>
      {actionDelta.length > 0 && (
        <section className="flv-table-wrap">
          <h3>Action signature count changes</h3>
          <table className="flv-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>{earlier.run.name}</th>
                <th>{later.run.name}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {actionDelta.slice(0, 30).map((item) => (
                <tr key={item.key}>
                  <th>{actionLabels.get(item.key) || "Observed action"}</th>
                  <td>{item.before}</td>
                  <td>{item.after}</td>
                  <td>{signed(item.after - item.before)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flv-footnote">
            Signatures use exact source and destination fingerprints, action,
            target label, and outcome. A missing record can reflect incomplete
            exploration.
          </p>
        </section>
      )}
    </section>
  );
}

function Metric({
  label,
  before,
  after,
  added,
  removed,
}: {
  label: string;
  before: number;
  after: number;
  added?: number;
  removed?: number;
}) {
  return (
    <article className="flv-metric">
      <span>{label}</span>
      <strong>{after}</strong>
      <small>
        previously {before}
        {added !== undefined && ` · +${added} / −${removed || 0}`}
      </small>
    </article>
  );
}

function RecordList({
  items,
  empty,
  onItems,
}: {
  items: string[];
  empty: string;
  onItems?: Array<() => void>;
}) {
  return items.length ? (
    <ul className="flv-record-list">
      {items.slice(0, 12).map((item, index) => (
        <li key={`${item}-${index}`}>
          {onItems?.[index] ? (
            <button type="button" onClick={onItems[index]}>
              {item}
            </button>
          ) : (
            <span>{item}</span>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p className="flv-empty-inline">{empty}</p>
  );
}
const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

/** Side-by-side screenshot and recorded metadata comparison for a chosen pair. */
export function ScreenSnapshotDiffView({
  earlier,
  later,
  earlierState,
  laterState,
}: {
  earlierState?: AppState;
  laterState?: AppState;
  earlier: RunData;
  later: RunData;
}) {
  const [oldId, setOldId] = useState(
    earlierState?.id || earlier.states[0]?.id || "",
  );
  const selectedOld =
    earlierState || earlier.states.find((state) => state.id === oldId);
  const defaultLater =
    laterState ||
    later.states.find(
      (state) => state.fingerprint === selectedOld?.fingerprint,
    ) ||
    later.states.find(
      (state) =>
        stateRoute(state) === (selectedOld ? stateRoute(selectedOld) : ""),
    ) ||
    later.states[0];
  const [newId, setNewId] = useState(laterState?.id || defaultLater?.id || "");
  useEffect(() => {
    if (earlierState) setOldId(earlierState.id);
    else if (!earlier.states.some((state) => state.id === oldId))
      setOldId(earlier.states[0]?.id || "");
  }, [earlier.run.id, earlier.states, earlierState?.id]);
  useEffect(() => {
    if (laterState) setNewId(laterState.id);
    else if (!later.states.some((state) => state.id === newId))
      setNewId(defaultLater?.id || "");
  }, [later.run.id, later.states, laterState?.id, defaultLater?.id]);
  const oldState =
    earlier.states.find((state) => state.id === oldId) || selectedOld;
  const newState =
    later.states.find((state) => state.id === newId) || defaultLater;
  const [pixelPair, setPixelPair] = useState<{
    width: number;
    height: number;
    earlier: Uint8ClampedArray;
    later: Uint8ClampedArray;
  }>();
  const [pixelThreshold, setPixelThreshold] = useState(32);
  const [overlayBlend, setOverlayBlend] = useState(50);
  const [pixelMode, setPixelMode] = useState<"difference" | "overlay">(
    "difference",
  );
  const [pixelStatus, setPixelStatus] = useState("");
  const [pixelPreview, setPixelPreview] = useState<{
    src: string;
    changed: number;
  }>();
  useEffect(() => {
    setPixelPair(undefined);
    setPixelPreview(undefined);
    setPixelStatus("");
  }, [earlier.run.id, later.run.id, oldState?.id, newState?.id]);
  useEffect(() => {
    if (!pixelPair) return;
    try {
      setPixelPreview(
        screenshotPixelView(pixelPair, pixelThreshold, pixelMode, overlayBlend),
      );
    } catch {
      setPixelPreview(undefined);
      setPixelStatus(
        "The browser could not render this screenshot comparison.",
      );
    }
  }, [pixelPair, pixelThreshold, pixelMode, overlayBlend]);
  const computePixelDiff = async () => {
    if (!oldState?.screenshotPath || !newState?.screenshotPath) return;
    setPixelPair(undefined);
    setPixelPreview(undefined);
    setPixelStatus("Loading screenshots for comparison…");
    try {
      const [oldImage, newImage] = await Promise.all([
        loadSameOriginImage(oldState.screenshotPath),
        loadSameOriginImage(newState.screenshotPath),
      ]);
      const scale = Math.min(
        1,
        1600 /
          Math.max(
            oldImage.naturalWidth,
            oldImage.naturalHeight,
            newImage.naturalWidth,
            newImage.naturalHeight,
          ),
      );
      const width = Math.max(
        1,
        Math.round(
          Math.max(oldImage.naturalWidth, newImage.naturalWidth) * scale,
        ),
      );
      const height = Math.max(
        1,
        Math.round(
          Math.max(oldImage.naturalHeight, newImage.naturalHeight) * scale,
        ),
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      containScreenshot(context, oldImage, width, height);
      const earlierPixels = context.getImageData(0, 0, width, height).data;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      containScreenshot(context, newImage, width, height);
      const laterPixels = context.getImageData(0, 0, width, height).data;
      setPixelPair({
        width,
        height,
        earlier: new Uint8ClampedArray(earlierPixels),
        later: new Uint8ClampedArray(laterPixels),
      });
      setPixelStatus("");
    } catch {
      setPixelStatus(
        "Pixel comparison is unavailable: a screenshot is missing, unreadable, or the browser blocked canvas access.",
      );
    }
  };
  if (!oldState || !newState)
    return (
      <Prerequisite
        title="Screen snapshot comparison"
        detail="Choose two discoveries that contain captured screens. This comparison can show saved screenshots and metadata, but the records do not include a pixel-diff result."
      />
    );
  const oldElements = elementCountByState(earlier).get(oldState.id) || [];
  const newElements = elementCountByState(later).get(newState.id) || [];
  const oldTokens = new Set(oldState.structureTokens);
  const newTokens = new Set(newState.structureTokens);
  return (
    <section className="flv" aria-labelledby="flv-snapshot-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-snapshot-title">Screen snapshot comparison</h2>
          <p>
            Compare saved captures and recorded interface details side by side.
          </p>
        </div>
      </header>
      <Notice>
        Images are displayed as captured. This view does not compute a
        pixel-level image diff.
      </Notice>
      <div className="flv-snapshot-pickers">
        <label>
          {earlier.run.name}
          <select
            value={oldState.id}
            onChange={(event) => {
              setOldId(event.target.value);
              setNewId("");
            }}
            aria-label="Earlier screen"
          >
            {earlier.states.map((state) => (
              <option key={state.id} value={state.id}>
                {stateName(state)} · {stateRoute(state)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {later.run.name}
          <select
            value={newState.id}
            onChange={(event) => setNewId(event.target.value)}
            aria-label="Later screen"
          >
            {later.states.map((state) => (
              <option key={state.id} value={state.id}>
                {stateName(state)} · {stateRoute(state)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flv-screenshot-pair">
        <Snapshot
          run={earlier}
          state={oldState}
          elements={oldElements.length}
        />
        <Snapshot run={later} state={newState} elements={newElements.length} />
      </div>
      <section
        className="flv-pixel-diff"
        aria-labelledby="flv-pixel-diff-title"
      >
        <header>
          <div>
            <h3 id="flv-pixel-diff-title">Optional pixel comparison</h3>
            <p>
              Compute only when requested. Images are contained on a shared
              white canvas, capped at 1600 pixels on the longest side.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void computePixelDiff()}
            disabled={
              !oldState.screenshotPath ||
              !newState.screenshotPath ||
              pixelStatus.startsWith("Loading")
            }
          >
            <GitCompareArrows size={13} />
            Compute pixel diff
          </button>
        </header>
        <div className="flv-pixel-controls">
          <label>
            Difference threshold
            <span>{pixelThreshold} / 255</span>
            <input
              type="range"
              min="0"
              max="255"
              value={pixelThreshold}
              onChange={(event) =>
                setPixelThreshold(Number(event.target.value))
              }
              disabled={!pixelPair}
            />
          </label>
          <label>
            View
            <select
              value={pixelMode}
              onChange={(event) =>
                setPixelMode(event.target.value as "difference" | "overlay")
              }
              disabled={!pixelPair}
            >
              <option value="difference">Highlight changed pixels</option>
              <option value="overlay">Blend the two screenshots</option>
            </select>
          </label>
          {pixelMode === "overlay" && (
            <label>
              Later screenshot blend
              <span>{overlayBlend}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={overlayBlend}
                onChange={(event) =>
                  setOverlayBlend(Number(event.target.value))
                }
                disabled={!pixelPair}
              />
            </label>
          )}
        </div>
        {pixelStatus && (
          <p className="flv-pixel-status" role="status">
            {pixelStatus}
          </p>
        )}
        {(!oldState.screenshotPath || !newState.screenshotPath) && (
          <p className="flv-pixel-status" role="status">
            Pixel comparison needs a captured screenshot on both sides.
          </p>
        )}
        {pixelPair && pixelPreview?.src && (
          <div className="flv-pixel-result">
            <div>
              <strong>
                {(
                  (pixelPreview.changed /
                    (pixelPair.width * pixelPair.height)) *
                  100
                ).toFixed(2)}
                % pixels exceed the threshold
              </strong>
              <small>
                Aligned canvas {pixelPair.width} × {pixelPair.height} · changed
                pixel ratio uses RGB channel difference &gt; {pixelThreshold}
              </small>
            </div>
            <img
              src={pixelPreview.src}
              alt={
                pixelMode === "difference"
                  ? "Pixel difference preview with changed pixels in red"
                  : "Blended screenshot overlay preview"
              }
            />
            {pixelMode === "difference" && (
              <small>
                Red pixels exceed the threshold; grayscale pixels do not.
              </small>
            )}
          </div>
        )}
      </section>
      <div className="flv-stat-grid">
        <Metric
          label="Interactive controls"
          before={oldElements.length}
          after={newElements.length}
        />
        <Metric
          label="Structure tokens"
          before={oldTokens.size}
          after={newTokens.size}
        />
        <Metric
          label="Visible region labels"
          before={oldState.visibleRegionSummary.length}
          after={newState.visibleRegionSummary.length}
        />
      </div>
      <div className="flv-columns">
        <section className="flv-list-panel">
          <h3>Only in earlier structure</h3>
          <RecordList
            items={[...oldTokens].filter((token) => !newTokens.has(token))}
            empty="No structure tokens differ."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Only in later structure</h3>
          <RecordList
            items={[...newTokens].filter((token) => !oldTokens.has(token))}
            empty="No structure tokens differ."
          />
        </section>
      </div>
    </section>
  );
}

function Snapshot({
  run,
  state,
  elements,
}: {
  run: RunData;
  state: AppState;
  elements: number;
}) {
  return (
    <article className="flv-snapshot">
      <header>
        <strong>{run.run.name}</strong>
        <time>{showTime(state.discoveredAt)}</time>
      </header>
      <div className="flv-snapshot-image">
        {state.screenshotPath ? (
          <img
            src={`/artifacts/${state.screenshotPath}`}
            alt={`Captured screen: ${stateName(state)}`}
            loading="lazy"
          />
        ) : (
          <span>
            <FileImage size={20} />
            No screenshot was captured
          </span>
        )}
      </div>
      <h3>{stateName(state)}</h3>
      <a href={state.url} target="_blank" rel="noreferrer">
        {pathname(state.url)}
        <ExternalLink size={11} />
      </a>
      <small>
        {elements} interactive controls · depth {state.depth}
      </small>
      <p>
        {state.visibleRegionSummary.slice(0, 4).join(" · ") ||
          "No visible region labels were recorded."}
      </p>
    </article>
  );
}

/** Request sequence attached to an action and any recorded screen endpoints. */
export function RequestLifecycleTraceView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const actionById = new Map(data.actions.map((action) => [action.id, action]));
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  const groups = new Map<string, ApiCall[]>();
  for (const call of data.apiCalls) {
    const key = call.actionId || `unassigned:${call.fromStateId || "none"}`;
    groups.set(key, [...(groups.get(key) || []), call]);
  }
  const sortedGroups = [...groups.entries()].sort(([, a], [, b]) =>
    (a[0]?.observedAt || "").localeCompare(b[0]?.observedAt || ""),
  );
  return (
    <section className="flv" aria-labelledby="flv-requests-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-requests-title">Request lifecycle trace</h2>
          <p>
            Follow captured requests around the action and screen transition
            they reference.
          </p>
        </div>
        <span className="flv-heading-count">
          {data.apiCalls.length} requests
        </span>
      </header>
      <Notice tone="caution">
        The data records request observation time, duration, status, and
        optional state links. It does not contain a separate response timestamp,
        so duration is shown as a reported value rather than an exact
        response-time marker.
      </Notice>
      {sortedGroups.length === 0 ? (
        <div className="flv-empty">
          No API request records were captured for this run.
        </div>
      ) : (
        <div className="flv-request-groups">
          {sortedGroups.map(([key, calls]) => {
            const action = actionById.get(key);
            const from = action
              ? stateById.get(action.fromStateId)
              : stateById.get(calls[0]?.fromStateId || "");
            const to = action?.toStateId
              ? stateById.get(action.toStateId)
              : stateById.get(calls[0]?.toStateId || "");
            return (
              <article className="flv-request-group" key={key}>
                <header>
                  <div>
                    <strong>
                      {action
                        ? `${action.action} ${action.targetName || "control"}`
                        : "Requests without a linked action"}
                    </strong>
                    <small>
                      {from ? stateName(from) : "Unknown source"}
                      {to
                        ? ` → ${stateName(to)}`
                        : " · no destination screen recorded"}
                    </small>
                  </div>
                  <span>
                    {calls.length} call{calls.length === 1 ? "" : "s"}
                  </span>
                </header>
                {action && (
                  <button
                    className="flv-text-link"
                    type="button"
                    onClick={() => onSelect({ kind: "action", id: action.id })}
                  >
                    Inspect action <ArrowRight size={12} />
                  </button>
                )}
                <ol>
                  {[...calls]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((call) => (
                      <li key={call.id}>
                        <span className="flv-sequence">{call.sequence}</span>
                        <div className="flv-request-line">
                          <strong>{call.method}</strong>
                          <code>{pathname(call.url)}</code>
                          <span
                            className={
                              call.failed
                                ? "failed"
                                : call.status && call.status >= 400
                                  ? "failed"
                                  : "ok"
                            }
                          >
                            {call.failed
                              ? "failed"
                              : (call.status ?? "status not recorded")}
                          </span>
                          <small>
                            {call.resourceType}
                            {call.durationMs !== undefined
                              ? ` · ${call.durationMs} ms`
                              : " · duration not recorded"}
                          </small>
                          {call.observedAt && (
                            <time>{showTime(call.observedAt)}</time>
                          )}
                        </div>
                      </li>
                    ))}
                </ol>
                {(from || to) && (
                  <div className="flv-request-endpoints">
                    {from && (
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: "state", id: from.id })}
                      >
                        Source screen
                      </button>
                    )}
                    {to && (
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: "state", id: to.id })}
                      >
                        Destination screen
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Compare action and API durations across two runs, only where both recorded them. */
export function PerformanceRegressionView({ earlier, later }: RunPairProps) {
  const rows = useMemo(() => {
    const getActions = (run: RunData) => {
      const stateMap = new Map(run.states.map((state) => [state.id, state]));
      const groups = new Map<string, number[]>();
      for (const action of run.actions)
        if (action.elapsedMs !== undefined) {
          const key = actionIdentity(action, stateMap);
          groups.set(key, [...(groups.get(key) || []), action.elapsedMs]);
        }
      return groups;
    };
    const old = getActions(earlier);
    const next = getActions(later);
    return [...old.keys()]
      .filter((key) => next.has(key))
      .map((key) => {
        const a = old.get(key)!;
        const b = next.get(key)!;
        return {
          key: key.split("\u0000").slice(0, 3).join(" · "),
          before: median(a),
          after: median(b),
          beforeP90: percentile(a, 0.9),
          afterP90: percentile(b, 0.9),
          beforeN: a.length,
          afterN: b.length,
        };
      })
      .sort(
        (a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before),
      );
  }, [earlier, later]);
  const oldCalls = apiDurationGroups(earlier.apiCalls);
  const newCalls = apiDurationGroups(later.apiCalls);
  const apiRows = [...oldCalls.keys()]
    .filter((key) => newCalls.has(key))
    .map((key) => ({
      key,
      before: median(oldCalls.get(key)!),
      after: median(newCalls.get(key)!),
      beforeP90: percentile(oldCalls.get(key)!, 0.9),
      afterP90: percentile(newCalls.get(key)!, 0.9),
      beforeN: oldCalls.get(key)!.length,
      afterN: newCalls.get(key)!.length,
    }))
    .sort(
      (a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before),
    );
  return (
    <section className="flv" aria-labelledby="flv-perf-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-perf-title">Performance comparison</h2>
          <p>
            Compare matched action and endpoint duration distributions across
            discoveries.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        These are captured durations, not page render or paint metrics. Rows use
        the median and 90th percentile from each run; samples can still differ
        in paths, network conditions, and sample counts.
      </Notice>
      <DurationTable title="Matched action durations" rows={rows} />
      <DurationTable title="Matched API endpoint durations" rows={apiRows} />
    </section>
  );
}
function apiDurationGroups(calls: ApiCall[]) {
  const groups = new Map<string, number[]>();
  for (const call of calls)
    if (call.durationMs !== undefined) {
      const key = `${call.method} ${endpointIdentity(call.url)}`;
      groups.set(key, [...(groups.get(key) || []), call.durationMs]);
    }
  return groups;
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] || 0
  );
}
function median(values: number[]) {
  return percentile(values, 0.5);
}
function DurationTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    key: string;
    before: number;
    after: number;
    beforeP90: number;
    afterP90: number;
    beforeN: number;
    afterN: number;
  }>;
}) {
  return (
    <section className="flv-table-wrap">
      <h3>{title}</h3>
      {rows.length ? (
        <table className="flv-table">
          <thead>
            <tr>
              <th>Matched record</th>
              <th>Earlier median</th>
              <th>Later median</th>
              <th>Median change</th>
              <th>Samples</th>
              <th>90th percentile, earlier → later</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((row) => (
              <tr key={row.key}>
                <th>{row.key}</th>
                <td>{Math.round(row.before)} ms</td>
                <td>{Math.round(row.after)} ms</td>
                <td
                  className={row.after > row.before ? "negative" : "positive"}
                >
                  {signed(Math.round(row.after - row.before))} ms
                </td>
                <td>
                  {row.beforeN} / {row.afterN}
                </td>
                <td>
                  {Math.round(row.beforeP90)} → {Math.round(row.afterP90)} ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="flv-empty-inline">
          No matching records with durations are present in both runs.
        </p>
      )}
    </section>
  );
}

/** Repeatability compares saved evidence only; it does not measure user traffic or deterministic behavior. */
export function RepeatabilityView({
  runs,
  candidates = [],
  selectedRunIds = [],
  onSelectionChange,
}: {
  runs: RunData[];
  candidates?: RunSummary[];
  selectedRunIds?: string[];
  onSelectionChange?: (runIds: string[]) => void;
}) {
  const rows = runs.map((run) => {
    const states = new Map(run.states.map((state) => [state.id, state]));
    const transitionOutcomes = new Map<string, Set<string>>();
    const transitionLabels = new Map<string, string>();
    for (const action of run.actions) {
      const transition = actionIdentity(action, states);
      const source = states.get(action.fromStateId);
      const target = action.toStateId
        ? states.get(action.toStateId)
        : undefined;
      transitionLabels.set(
        transition,
        `${source ? stateName(source) : "Unknown screen"} · ${action.action}${action.targetName ? ` ${action.targetName}` : ""}${target ? ` → ${stateName(target)}` : ""}`,
      );
      const outcomes = transitionOutcomes.get(transition) || new Set<string>();
      outcomes.add(action.decision || "unrecorded");
      transitionOutcomes.set(transition, outcomes);
    }
    return {
      run,
      fingerprints: new Set(run.states.map((state) => state.fingerprint)),
      routes: new Set(run.states.map(stateRoute)),
      transitionOutcomes,
      transitionLabels,
    };
  });
  const reference = rows[0];
  const allTransitions = new Set(
    rows.flatMap((row) => [...row.transitionOutcomes.keys()]),
  );
  return (
    <section className="flv" aria-labelledby="flv-repeat-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-repeat-title">Repeatability across runs</h2>
          <p>
            Compare observed transition and outcome consistency across up to
            five saved discoveries.
          </p>
        </div>
      </header>
      {candidates.length > 0 && (
        <fieldset className="flv-repeat-selector">
          <legend>Recent compatible discoveries (up to 4)</legend>
          {candidates.map((candidate) => (
            <label key={candidate.id}>
              <input
                type="checkbox"
                checked={selectedRunIds.includes(candidate.id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selectedRunIds, candidate.id].slice(-4)
                    : selectedRunIds.filter((id) => id !== candidate.id);
                  onSelectionChange?.(next);
                }}
              />
              <span>{candidate.name}</span>
              <small>
                {new Date(candidate.createdAt).toLocaleDateString()}
              </small>
            </label>
          ))}
        </fieldset>
      )}
      <Notice tone="caution">
        This compares saved discovery evidence, not real user traffic. A missing
        transition means it was not recorded in that run; it does not prove the
        route or action is unavailable. Coverage and exploration depth can
        differ between runs.
      </Notice>
      {runs.length < 2 && (
        <Prerequisite
          title="Repeatability"
          detail="Select at least one recent compatible discovery to compare its recorded transitions and outcomes with the current run."
        />
      )}
      {runs.length >= 2 && (
        <div className="flv-table-wrap">
          <table className="flv-table">
            <thead>
              <tr>
                <th>Observed transition</th>
                <th>Run coverage</th>
                <th>Recorded outcomes across covered runs</th>
              </tr>
            </thead>
            <tbody>
              {[...allTransitions].map((transition) => {
                const covered = rows.filter((row) =>
                  row.transitionOutcomes.has(transition),
                );
                const outcomes = new Map<string, number>();
                for (const row of covered)
                  for (const outcome of row.transitionOutcomes.get(
                    transition,
                  ) || [])
                    outcomes.set(outcome, (outcomes.get(outcome) || 0) + 1);
                return (
                  <tr key={transition}>
                    <th>
                      {rows
                        .find((row) => row.transitionLabels.has(transition))
                        ?.transitionLabels.get(transition) ||
                        "Unidentified transition"}
                    </th>
                    <td>
                      {covered.length} / {rows.length} runs
                    </td>
                    <td>
                      {[...outcomes]
                        .map(([outcome, count]) => `${outcome}: ${count}`)
                        .join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="flv-muted">
        Screen fingerprints:{" "}
        {rows
          .map((row) => `${row.run.run.name} ${row.fingerprints.size}`)
          .join(" · ")}{" "}
        · Matching route paths against the current discovery:{" "}
        {reference.routes.size} observed.
      </p>
    </section>
  );
}

/** Show timestamps of latest saved artifacts as relative evidence age. */
export function EvidenceFreshnessView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect?: (selection: LifecycleSelection) => void;
}) {
  const latestState = [...data.states].sort(
    (a, b) => dateValue(b.discoveredAt) - dateValue(a.discoveredAt),
  )[0];
  const latestAction = [...data.actions].sort(
    (a, b) => dateValue(b.createdAt) - dateValue(a.createdAt),
  )[0];
  const latestCall = [...data.apiCalls].sort(
    (a, b) => dateValue(b.observedAt) - dateValue(a.observedAt),
  )[0];
  const rows = [
    {
      label: "Screenshots and state metadata",
      date: latestState?.discoveredAt,
      count: data.states.length,
      selection: latestState
        ? { kind: "state" as const, id: latestState.id }
        : undefined,
    },
    {
      label: "Action records",
      date: latestAction?.createdAt,
      count: data.actions.length,
      selection: latestAction
        ? { kind: "action" as const, id: latestAction.id }
        : undefined,
    },
    {
      label: "API observations",
      date: latestCall?.observedAt,
      count: data.apiCalls.length,
    },
    { label: "Run created", date: data.run.createdAt, count: 1 },
  ];
  const now = Date.now();
  return (
    <section className="flv" aria-labelledby="flv-fresh-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-fresh-title">Evidence freshness</h2>
          <p>When each evidence type was last observed in this run.</p>
        </div>
      </header>
      <Notice tone="caution">
        This measures capture age against the current time. It does not check
        whether the live application has since changed.
      </Notice>
      <div className="flv-fresh-grid">
        {rows.map((row) => (
          <article key={row.label}>
            <span>{row.label}</span>
            <strong>
              {row.date ? ageLabel(now - dateValue(row.date)) : "No timestamp"}
            </strong>
            <time>{showTime(row.date)}</time>
            <small>
              {row.count} record{row.count === 1 ? "" : "s"}
            </small>
            {row.selection && onSelect && (
              <button type="button" onClick={() => onSelect(row.selection!)}>
                Open latest <ArrowRight size={12} />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function ageLabel(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "Timestamp unavailable";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

type Annotation = {
  id: string;
  targetKind: "state" | "action";
  targetId: string;
  note: string;
  owner: string;
  status: "open" | "reviewing" | "resolved";
  updatedAt: string;
};
const ANNOTATION_FILE_VERSION = 1;
const MAX_ANNOTATION_FILE_BYTES = 1024 * 1024;
const MAX_IMPORTED_ANNOTATIONS = 500;
function validateAnnotationFile(
  raw: string,
  runId: string,
): { annotations?: Annotation[]; error?: string } {
  if (new TextEncoder().encode(raw).byteLength > MAX_ANNOTATION_FILE_BYTES)
    return { error: "File is too large (maximum 1 MB)." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "File is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object")
    return { error: "File must contain a flow annotation export." };
  const file = parsed as Record<string, unknown>;
  if (
    file.format !== "unfold-flow-annotations" ||
    file.version !== ANNOTATION_FILE_VERSION
  )
    return { error: "Unsupported annotation file format or version." };
  if (file.runId !== runId)
    return {
      error:
        "This file belongs to a different discovery. Import was not applied.",
    };
  if (
    !Array.isArray(file.annotations) ||
    file.annotations.length > MAX_IMPORTED_ANNOTATIONS
  )
    return {
      error: `File must contain at most ${MAX_IMPORTED_ANNOTATIONS} annotations.`,
    };
  const annotations: Annotation[] = [];
  for (const item of file.annotations) {
    if (!item || typeof item !== "object")
      return { error: "An annotation record is malformed." };
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 100 ||
      (entry.targetKind !== "state" && entry.targetKind !== "action") ||
      typeof entry.targetId !== "string" ||
      !entry.targetId ||
      entry.targetId.length > 200 ||
      typeof entry.note !== "string" ||
      entry.note.length > 5000 ||
      typeof entry.owner !== "string" ||
      entry.owner.length > 120 ||
      (entry.status !== "open" &&
        entry.status !== "reviewing" &&
        entry.status !== "resolved") ||
      typeof entry.updatedAt !== "string" ||
      entry.updatedAt.length > 50 ||
      !Number.isFinite(Date.parse(entry.updatedAt))
    )
      return {
        error:
          "An annotation has invalid fields or exceeds a field size limit.",
      };
    annotations.push({
      id: entry.id,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      note: entry.note,
      owner: entry.owner,
      status: entry.status,
      updatedAt: entry.updatedAt,
    });
  }
  return { annotations };
}
/** User notes are stored in this browser only and do not modify discovery evidence. */
export function AnnotatedFlowNotes({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const storageKey = `unfold:flow-notes:${data.run.id}`;
  const [items, setItems] = useState<Annotation[]>([]);
  const [ready, setReady] = useState(false);
  const [targetKind, setTargetKind] = useState<"state" | "action">("state");
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("");
  const [storageIssue, setStorageIssue] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [transferMessage, setTransferMessage] = useState("");
  const targets =
    targetKind === "state"
      ? data.states.map((state) => ({ id: state.id, label: stateName(state) }))
      : data.actions.map((action) => ({
          id: action.id,
          label: `${action.action} ${action.targetName || "control"}`,
        }));
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setItems(JSON.parse(stored) as Annotation[]);
    } catch {
      setStorageIssue(true);
    }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      setStorageIssue(true);
    }
  }, [items, ready, storageKey]);
  const add = () => {
    if (!targetId || !note.trim()) return;
    if (items.length >= MAX_IMPORTED_ANNOTATIONS) {
      setTransferMessage(
        `This browser already has the maximum of ${MAX_IMPORTED_ANNOTATIONS} annotations.`,
      );
      return;
    }
    setItems((current) => [
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        targetKind,
        targetId,
        note: note.trim(),
        owner: owner.trim(),
        status: "open",
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setNote("");
  };
  const exportAnnotations = () => {
    if (items.length > MAX_IMPORTED_ANNOTATIONS) {
      setTransferMessage(
        `Export is limited to ${MAX_IMPORTED_ANNOTATIONS} annotations. Remove some notes first.`,
      );
      return;
    }
    const file = {
      format: "unfold-flow-annotations",
      version: ANNOTATION_FILE_VERSION,
      runId: data.run.id,
      annotations: items,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `flow-annotations-${data.run.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setTransferMessage(`${items.length} annotations exported to a local file.`);
  };
  const readAnnotationFile = async (file?: File) => {
    setTransferMessage("");
    setImportText("");
    if (!file) return;
    if (file.size > MAX_ANNOTATION_FILE_BYTES) {
      setTransferMessage(
        "File is too large (maximum 1 MB). Choose another file.",
      );
      return;
    }
    try {
      const text = await file.text();
      const validation = validateAnnotationFile(text, data.run.id);
      if (validation.error) {
        setTransferMessage(validation.error);
        return;
      }
      setImportText(text);
      setTransferMessage(
        `${validation.annotations?.length || 0} annotations ready to ${importMode}.`,
      );
    } catch {
      setTransferMessage("Could not read the selected annotation file.");
    }
  };
  const importAnnotations = () => {
    const validation = validateAnnotationFile(importText, data.run.id);
    if (validation.error || !validation.annotations) {
      setTransferMessage(
        validation.error || "Annotation file could not be validated.",
      );
      return;
    }
    const incoming = validation.annotations;
    if (importMode === "replace") {
      setItems(incoming);
    } else {
      const merged = new Map(items.map((item) => [item.id, item]));
      for (const item of incoming) merged.set(item.id, item);
      if (merged.size > MAX_IMPORTED_ANNOTATIONS) {
        setTransferMessage(
          `Merged result would exceed ${MAX_IMPORTED_ANNOTATIONS} annotations. Choose replace or remove local notes first.`,
        );
        return;
      }
      setItems((current) => {
        const merged = new Map(current.map((item) => [item.id, item]));
        for (const item of incoming) merged.set(item.id, item);
        return [...merged.values()];
      });
    }
    setImportText("");
    setTransferMessage(
      `${incoming.length} annotations ${importMode === "replace" ? "replaced" : "merged"} into this browser's local notes.`,
    );
  };
  const labelFor = (item: Annotation) =>
    item.targetKind === "state"
      ? data.states.find((state) => state.id === item.targetId)
        ? stateName(data.states.find((state) => state.id === item.targetId)!)
        : "Screen from another run"
      : data.actions.find((action) => action.id === item.targetId)
        ? `${data.actions.find((action) => action.id === item.targetId)!.action} ${data.actions.find((action) => action.id === item.targetId)!.targetName}`
        : "Action from another run";
  return (
    <section className="flv" aria-labelledby="flv-notes-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-notes-title">Flow annotations</h2>
          <p>Add review notes and owners to captured screens or actions.</p>
        </div>
      </header>
      <Notice tone={storageIssue ? "caution" : "info"}>
        {storageIssue
          ? "Browser storage is unavailable; notes remain only until this page closes."
          : "Notes are saved in this browser for this discovery. They are not uploaded or included in exported evidence."}
      </Notice>
      <section
        className="flv-annotation-transfer"
        aria-label="Annotation file transfer"
      >
        <div>
          <h3>Share annotation file</h3>
          <p>
            Manual file sharing only. Files stay on this device unless you
            choose to share them; there is no live collaboration or upload.
          </p>
        </div>
        <button type="button" onClick={exportAnnotations} disabled={!ready}>
          Export JSON
        </button>
        <label className="flv-annotation-file">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              void readAnnotationFile(event.target.files?.[0])
            }
          />
        </label>
        <label>
          Import choice
          <select
            value={importMode}
            onChange={(event) =>
              setImportMode(event.target.value as "merge" | "replace")
            }
          >
            <option value="merge">
              Merge (file entries replace matching IDs)
            </option>
            <option value="replace">Replace all local notes</option>
          </select>
        </label>
        <button
          type="button"
          onClick={importAnnotations}
          disabled={!importText}
        >
          Apply import
        </button>
        {transferMessage && (
          <p role="status" className="flv-annotation-transfer-message">
            {transferMessage}
          </p>
        )}
      </section>
      <div className="flv-note-editor">
        <label>
          Attach to
          <select
            value={targetKind}
            onChange={(event) => {
              const kind = event.target.value as "state" | "action";
              setTargetKind(kind);
              setTargetId("");
            }}
          >
            <option value="state">Screen</option>
            <option value="action">Action</option>
          </select>
        </label>
        <label>
          Record
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Choose a {targetKind}</option>
            {targets.map((target) => (
              <option value={target.id} key={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Optional name"
          />
        </label>
        <label className="flv-note-text">
          Review note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Add context for the next reviewer"
          />
        </label>
        <button
          type="button"
          className="flv-primary"
          onClick={add}
          disabled={
            !targetId ||
            !note.trim() ||
            items.length >= MAX_IMPORTED_ANNOTATIONS
          }
        >
          Save note
        </button>
      </div>
      {items.length === 0 ? (
        <div className="flv-empty">No browser-local notes yet.</div>
      ) : (
        <div className="flv-annotation-list">
          {items.map((item) => (
            <article key={item.id}>
              <header>
                <div>
                  <span className={`flv-review-status ${item.status}`}>
                    {item.status}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({ kind: item.targetKind, id: item.targetId })
                    }
                  >
                    {labelFor(item)} <ArrowRight size={12} />
                  </button>
                </div>
                <time>{showTime(item.updatedAt)}</time>
              </header>
              <label className="flv-edit-note">
                Review note
                <textarea
                  rows={3}
                  value={item.note}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? {
                              ...entry,
                              note: event.target.value,
                              updatedAt: new Date().toISOString(),
                            }
                          : entry,
                      ),
                    )
                  }
                />
              </label>
              <div className="flv-annotation-actions">
                <label>
                  Owner
                  <input
                    value={item.owner}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                owner: event.target.value,
                                updatedAt: new Date().toISOString(),
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    value={item.status}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                status: event.target
                                  .value as Annotation["status"],
                                updatedAt: new Date().toISOString(),
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="open">Open</option>
                    <option value="reviewing">Reviewing</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setItems((current) =>
                      current.filter((entry) => entry.id !== item.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compare route-matched states across discoveries with different viewports. */
export function ResponsiveComparisonView({ runs }: { runs: RunData[] }) {
  if (
    runs.length < 2 ||
    new Set(
      runs.map(
        (run) =>
          `${run.run.config.viewport.width}x${run.run.config.viewport.height}`,
      ),
    ).size < 2
  )
    return (
      <Prerequisite
        title="Responsive comparison"
        detail="Load at least two discoveries captured at different viewport sizes. This run records one viewport configuration per discovery."
      />
    );
  const viewportRuns = runs.filter((run) => run.states.length > 0);
  const routeKeys = [
    ...new Set(viewportRuns.flatMap((run) => run.states.map(stateRoute))),
  ].sort();
  const routeStates = (run: RunData, route: string) =>
    run.states.filter((state) => stateRoute(state) === route);
  const stateGroups = (route: string) => {
    const groups = new Map<
      string,
      { label: string; statesByRun: Map<string, AppState[]> }
    >();
    for (const run of viewportRuns) {
      for (const state of routeStates(run, route)) {
        // Fingerprints are the only cross-run state match. Unmatched states stay
        // run-specific so a similar title is never presented as an exact match.
        const key = state.fingerprint
          ? `fingerprint:${state.fingerprint}`
          : `unmatched:${run.run.id}:${state.id}`;
        const group = groups.get(key) || {
          label: stateName(state),
          statesByRun: new Map<string, AppState[]>(),
        };
        group.statesByRun.set(run.run.id, [
          ...(group.statesByRun.get(run.run.id) || []),
          state,
        ]);
        groups.set(key, group);
      }
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  };
  const stateGeometry = (run: RunData, state: AppState) => {
    const elements = run.elements.filter(
      (element) => element.stateId === state.id,
    );
    const width = run.run.config.viewport.width;
    const height = run.run.config.viewport.height;
    const overflow = elements.filter(
      (element) =>
        element.box.x < 0 ||
        element.box.y < 0 ||
        element.box.x + element.box.width > width ||
        element.box.y + element.box.height > height,
    ).length;
    const mean = (values: number[]) =>
      values.length
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 0;
    return {
      count: elements.length,
      overflow,
      meanWidth: mean(elements.map((element) => element.box.width)),
      meanHeight: mean(elements.map((element) => element.box.height)),
      minX: elements.length
        ? Math.round(Math.min(...elements.map((element) => element.box.x)))
        : undefined,
      minY: elements.length
        ? Math.round(Math.min(...elements.map((element) => element.box.y)))
        : undefined,
      maxRight: elements.length
        ? Math.round(
            Math.max(
              ...elements.map((element) => element.box.x + element.box.width),
            ),
          )
        : undefined,
      maxBottom: elements.length
        ? Math.round(
            Math.max(
              ...elements.map((element) => element.box.y + element.box.height),
            ),
          )
        : undefined,
    };
  };
  return (
    <section className="flv" aria-labelledby="flv-responsive-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-responsive-title">Responsive comparison</h2>
          <p>
            Compare screenshots and recorded control geometry for matching
            states across configured viewports.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Routes match by exact URL path. States match only when their captured
        fingerprints match; otherwise they remain separate. These are captures
        from separate discoveries, so differences may reflect run content or
        exploration variance and do not prove screen identity.
      </Notice>
      <div className="flv-responsive-routes">
        {routeKeys.map((route) => (
          <section className="flv-responsive-route" key={route}>
            <header>
              <h3>{route}</h3>
              <span>Exact URL path match</span>
            </header>
            {stateGroups(route).map((group) => {
              const exactMatchCount = [...group.statesByRun.values()].filter(
                (states) => states.length > 0,
              ).length;
              const actionRows = new Map<
                string,
                { label: string; byRun: Map<string, ActionEdge[]> }
              >();
              for (const run of viewportRuns) {
                for (const state of group.statesByRun.get(run.run.id) || []) {
                  for (const action of run.actions.filter(
                    (item) => item.fromStateId === state.id,
                  )) {
                    const label = `${action.action} · ${(action.targetName || "unnamed control").trim().replace(/\s+/g, " ")}`;
                    const key = label.toLocaleLowerCase();
                    const row = actionRows.get(key) || {
                      label,
                      byRun: new Map<string, ActionEdge[]>(),
                    };
                    row.byRun.set(run.run.id, [
                      ...(row.byRun.get(run.run.id) || []),
                      action,
                    ]);
                    actionRows.set(key, row);
                  }
                }
              }
              return (
                <div className="flv-responsive-state" key={group.key}>
                  <div className="flv-responsive-state-title">
                    <strong>{group.label}</strong>
                    <small>
                      {group.key.startsWith("fingerprint:") &&
                      exactMatchCount > 1
                        ? `Same captured fingerprint in ${exactMatchCount} runs`
                        : "No matching state fingerprint across runs"}
                    </small>
                  </div>
                  <div className="flv-responsive-run-grid">
                    {viewportRuns.map((run) => {
                      const states = group.statesByRun.get(run.run.id) || [];
                      return (
                        <article
                          className="flv-responsive-run"
                          key={run.run.id}
                        >
                          <header>
                            <strong>{run.run.name}</strong>
                            <small>
                              {run.run.config.viewport.width} ×{" "}
                              {run.run.config.viewport.height}
                            </small>
                          </header>
                          {states.length ? (
                            states.map((state) => {
                              const geometry = stateGeometry(run, state);
                              return (
                                <div
                                  className="flv-responsive-capture"
                                  key={state.id}
                                >
                                  {state.screenshotPath ? (
                                    <img
                                      src={`/artifacts/${state.screenshotPath}`}
                                      alt={`Captured ${stateName(state)} at ${run.run.config.viewport.width} by ${run.run.config.viewport.height}`}
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="flv-responsive-missing">
                                      <FileImage size={16} /> Screenshot not
                                      captured
                                    </div>
                                  )}
                                  <small>{showTime(state.discoveredAt)}</small>
                                  <div className="flv-responsive-geometry">
                                    <span>{geometry.count} controls</span>
                                    <span>
                                      Mean box {geometry.meanWidth} ×{" "}
                                      {geometry.meanHeight}px
                                    </span>
                                    <span>
                                      {geometry.overflow} outside viewport
                                    </span>
                                    {geometry.count > 0 && (
                                      <span>
                                        Bounds x {geometry.minX}–
                                        {geometry.maxRight}, y {geometry.minY}–
                                        {geometry.maxBottom}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="flv-responsive-missing">
                              No matching state observed in this run
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  <div className="flv-responsive-actions">
                    <h4>Observed action path comparison</h4>
                    <p>
                      Actions are aligned by captured action type and control
                      label from states with the same fingerprint. Destinations
                      and outcomes remain per-run evidence.
                    </p>
                    {[...actionRows.entries()].map(([key, row]) => (
                      <div className="flv-responsive-action-row" key={key}>
                        <strong>{row.label}</strong>
                        {viewportRuns.map((run) => {
                          const matches = row.byRun.get(run.run.id) || [];
                          return (
                            <span key={run.run.id}>
                              <small>
                                {run.run.config.viewport.width}×
                                {run.run.config.viewport.height}
                              </small>
                              {matches.length ? (
                                matches.map((action) => {
                                  const destination = action.toStateId
                                    ? run.states.find(
                                        (item) => item.id === action.toStateId,
                                      )
                                    : undefined;
                                  return (
                                    <em key={action.id}>
                                      {action.decision.replaceAll("_", " ")} →{" "}
                                      {destination
                                        ? stateRoute(destination)
                                        : "destination unknown"}
                                    </em>
                                  );
                                })
                              ) : (
                                <em>Not observed</em>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                    {!actionRows.size && (
                      <small>
                        No linked action records were captured for these
                        matching states.
                      </small>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}

/** Authentication-like records are surfaced as candidates, never asserted as successful auth. */
export function AuthenticationSessionView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const terms =
    /sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|auth|account|session|password|protected/i;
  const signInTerms = /sign[ -]?in|log[ -]?in|authenticate/i;
  const signOutTerms = /sign[ -]?out|log[ -]?out|logout/i;
  const statesById = new Map(data.states.map((state) => [state.id, state]));
  const states = data.states.filter((state) =>
    terms.test(
      [state.url, state.title, ...state.visibleRegionSummary].join(" "),
    ),
  );
  const actions = data.actions.filter((action) => {
    const evidence = action.browserEvidence;
    const directAuthCue = Boolean(
      evidence &&
      [
        evidence.before.passwordControlCount,
        evidence.after.passwordControlCount,
        evidence.before.identifierControlCount,
        evidence.after.identifierControlCount,
        evidence.before.signInControlCount,
        evidence.after.signInControlCount,
        evidence.before.signOutControlCount,
        evidence.after.signOutControlCount,
      ].some((count) => count > 0),
    );
    return (
      directAuthCue ||
      terms.test(
        `${action.targetName} ${action.beforeUrl} ${action.afterUrl || ""}`,
      )
    );
  });
  const authActions = actions.map((action) => {
    const label = `${action.action} ${action.targetName}`;
    const evidence = action.browserEvidence;
    const before = evidence?.before;
    const after = evidence?.after;
    const kinds = [
      before?.passwordControlCount || after?.passwordControlCount
        ? "password field observed"
        : undefined,
      before?.identifierControlCount || after?.identifierControlCount
        ? "identifier field observed"
        : undefined,
      before?.signInControlCount || after?.signInControlCount
        ? "sign-in control observed"
        : undefined,
      before?.signOutControlCount || after?.signOutControlCount
        ? "sign-out control observed"
        : undefined,
    ].filter((item): item is string => Boolean(item));
    const kind = kinds.length
      ? kinds.join(" · ")
      : signInTerms.test(label)
        ? "Sign-in-like action"
        : signOutTerms.test(label)
          ? "Sign-out-like action"
          : "Authentication-related action";
    const from = statesById.get(action.fromStateId);
    const to = action.toStateId ? statesById.get(action.toStateId) : undefined;
    return { action, kind, from, to };
  });
  const protectedResponses = data.apiCalls
    .filter((call) => call.status === 401 || call.status === 403)
    .map((call) => {
      const action = call.actionId
        ? data.actions.find((candidate) => candidate.id === call.actionId)
        : undefined;
      const from =
        (call.fromStateId && statesById.get(call.fromStateId)) ||
        (action && statesById.get(action.fromStateId));
      const to =
        (call.toStateId && statesById.get(call.toStateId)) ||
        (action?.toStateId && statesById.get(action.toStateId));
      return { call, action, from, to };
    });
  const authStateConfigured = Boolean(data.run.config.authStatePath);
  return (
    <section className="flv" aria-labelledby="flv-auth-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-auth-title">Authentication and session candidates</h2>
          <p>
            Browser-observed password/identifier fields and sign-in/out
            controls, response statuses, and route changes.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Password and identifier field counts plus visible sign-in/out control
        counts are direct structural cues; they do not prove identity or
        successful authentication. HTTP 401/403 statuses are direct response
        evidence. Credentials, tokens, request bodies, field values, and the
        configured auth file path are never shown here.
      </Notice>
      <div
        className="flv-auth-summary"
        aria-label="Authentication evidence summary"
      >
        <span>
          <strong>{authActions.length}</strong> actions with auth-related cues
          or labels
        </span>
        <span>
          <strong>{protectedResponses.length}</strong> API 401/403 responses
        </span>
        <span>
          <strong>{authStateConfigured ? "Configured" : "Not recorded"}</strong>{" "}
          auth state
        </span>
      </div>
      <Notice>
        Identity and session state transitions are unknown unless the run
        explicitly records them. A changed screen or route alone does not prove
        sign-in or sign-out succeeded.
      </Notice>
      <div className="flv-columns">
        <section className="flv-list-panel">
          <h3>Candidate screens ({states.length})</h3>
          <ul className="flv-record-list">
            {states.map((state) => (
              <li key={state.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "state", id: state.id })}
                >
                  {stateName(state)}
                  <small>{pathname(state.url)}</small>
                </button>
              </li>
            ))}
          </ul>
          {states.length === 0 && (
            <p className="flv-empty-inline">
              No authentication-like screen labels were captured.
            </p>
          )}
        </section>
        <section className="flv-list-panel">
          <h3>Sign-in and sign-out candidates ({authActions.length})</h3>
          <ul className="flv-record-list">
            {authActions.map(({ action, kind, from, to }) => (
              <li key={action.id} className="flv-auth-record">
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "action", id: action.id })}
                >
                  <strong>{kind}</strong>
                  <span>
                    {action.action} {action.targetName}
                  </span>
                  <small>
                    {from ? stateRoute(from) : pathname(action.beforeUrl)}
                    {to || action.afterUrl
                      ? ` → ${to ? stateRoute(to) : pathname(action.afterUrl!)}`
                      : " → outcome unknown"}
                    {` · ${action.decision}`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {actions.length === 0 && (
            <p className="flv-empty-inline">
              No sign-in/out-like action labels were captured.
            </p>
          )}
        </section>
      </div>
      <section className="flv-list-panel flv-auth-responses">
        <h3>Protected-route response evidence ({protectedResponses.length})</h3>
        {protectedResponses.length ? (
          <ul className="flv-record-list">
            {protectedResponses.map(({ call, action, from, to }) => (
              <li key={call.id} className="flv-auth-record">
                <div className="flv-auth-response">
                  <span className="flv-auth-status">HTTP {call.status}</span>
                  <span>
                    {call.method.toUpperCase()} {safeAuthEndpoint(call.url)}
                  </span>
                  <small>
                    {from ? stateRoute(from) : "Source route unknown"}
                    {to
                      ? ` → ${stateRoute(to)}`
                      : action?.afterUrl
                        ? ` → ${pathname(action.afterUrl)}`
                        : " → resulting route unknown"}
                  </small>
                  <small>
                    {action
                      ? "Linked to an observed action"
                      : "No linked action; trigger unknown"}
                  </small>
                </div>
                <div className="flv-auth-links">
                  {action && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({ kind: "action", id: action.id })
                      }
                    >
                      Open action
                    </button>
                  )}
                  {from && (
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "state", id: from.id })}
                    >
                      Open source state
                    </button>
                  )}
                  {to && (
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "state", id: to.id })}
                    >
                      Open resulting state
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flv-empty-inline">
            No API responses with HTTP 401 or 403 were recorded in this run.
          </p>
        )}
      </section>
    </section>
  );
}

/** Browser effect flags and tab-scoped signals attached to observed actions. */
export function BrowserSideEffectView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const relevant = new Set([
    "download",
    "open_new_tab",
    "external_navigation",
    "navigate_same_tab",
  ]);
  const groups = new Map<
    string,
    Array<{ action: ActionEdge; detail: string }>
  >();
  const add = (key: string, action: ActionEdge, detail = "") =>
    groups.set(key, [...(groups.get(key) || []), { action, detail }]);
  for (const action of data.actions) {
    for (const flag of action.effectFlags.filter((item) => relevant.has(item)))
      add(flag, action);
    for (const raw of action.signals) {
      const signal = parseTabSignal(raw);
      if (!signal) continue;
      const { event, tabId } = signal;
      if (event.startsWith("history:"))
        add(
          "history_api",
          action,
          `${event.slice("history:".length)} · ${tabId}`,
        );
      else if (event.startsWith("dialog:"))
        add("dialog", action, `${event.slice("dialog:".length)} · ${tabId}`);
      else if (
        [
          "download",
          "popup_opened",
          "popup_active",
          "external_navigation",
          "external_navigation_blocked",
        ].includes(event)
      )
        add(event, action, tabId);
    }
    for (const event of action.browserEvidence?.events || []) {
      if (event.kind === "download")
        add("download", action, event.outcome || "observed");
      else if (event.kind === "dialog")
        add(
          "dialog",
          action,
          `${event.dialogType || "unknown"} · auto-dismissed`,
        );
      else if (
        event.kind === "tab_opened" ||
        event.kind === "tab_activated" ||
        event.kind === "tab_closed"
      )
        add(
          event.kind,
          action,
          `${event.tabId || "tab unknown"}${event.parentTabId ? ` · opener ${event.parentTabId}` : ""}`,
        );
      else if (
        event.kind === "permission_request" ||
        event.kind === "permission_query"
      )
        add(
          event.kind,
          action,
          `${event.permission || "other"} · ${event.permissionState || "state unknown"}`,
        );
      else if (event.kind === "redirect")
        add(
          "redirect",
          action,
          `HTTP ${event.status || "unknown"} · ${event.origin || "origin unknown"}`,
        );
    }
  }
  const title: Record<string, string> = {
    download: "Downloads",
    open_new_tab: "New tabs (action flag)",
    popup_opened: "Popups opened",
    popup_active: "Popups activated",
    external_navigation: "External navigation",
    external_navigation_blocked: "Blocked external navigation",
    navigate_same_tab: "Same-tab navigation",
    history_api: "Page History API calls",
    dialog: "Browser dialogs",
    tab_opened: "Tabs opened",
    tab_activated: "Tabs activated",
    tab_closed: "Tabs closed",
    permission_request: "Permission API requests",
    permission_query: "Permission API status checks",
    redirect: "Redirect hops",
  };
  return (
    <section className="flv" aria-labelledby="flv-side-effect-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-side-effect-title">Browser side effects</h2>
          <p>Show side-effect flags recorded on observed interactions.</p>
        </div>
      </header>
      <Notice tone="caution">
        Groups include browser protocol navigation, network-origin, popup,
        download, dialog, and permission API events. Tab IDs last for one action
        replay and are linked only within that action. The capture stores
        origins and aggregate storage counts, never paths, values, or cookie
        contents.
      </Notice>
      {groups.size === 0 ? (
        <div className="flv-empty">
          No browser side-effect flags were recorded.
        </div>
      ) : (
        <div className="flv-columns">
          {[...groups.entries()].map(([flag, entries]) => (
            <section className="flv-list-panel" key={flag}>
              <h3>
                {title[flag]} <span>{entries.length}</span>
              </h3>
              <ul className="flv-record-list">
                {entries.map(({ action, detail }, index) => (
                  <li key={`${action.id}:${flag}:${index}`}>
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({ kind: "action", id: action.id })
                      }
                    >
                      {action.targetName || action.action}
                      <small>
                        {detail ? `${detail} · ` : ""}
                        {pathname(action.beforeUrl)}
                        {action.afterUrl
                          ? ` → ${pathname(action.afterUrl)}`
                          : ""}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export function ChangeImpactView({ earlier, later }: RunPairProps) {
  const earlierComponentRoutes = componentRouteMap(earlier);
  const laterComponentRoutes = componentRouteMap(later);
  const earlierApi = new Set(
    earlier.apiCalls.map(
      (call) => `${call.method} ${endpointIdentity(call.url)}`,
    ),
  );
  const laterApi = new Set(
    later.apiCalls.map(
      (call) => `${call.method} ${endpointIdentity(call.url)}`,
    ),
  );
  const oldRoutes = new Set(earlier.states.map(stateRoute));
  const newRoutes = new Set(later.states.map(stateRoute));
  const addedRoutes = [...newRoutes].filter((route) => !oldRoutes.has(route));
  const removedRoutes = [...oldRoutes].filter((route) => !newRoutes.has(route));
  const allFamilies = new Set([
    ...earlierComponentRoutes.keys(),
    ...laterComponentRoutes.keys(),
  ]);
  const changedFamilies = [...allFamilies].filter((family) => {
    const oldRoutes = [...(earlierComponentRoutes.get(family) || [])]
      .sort()
      .join("|");
    const nextRoutes = [...(laterComponentRoutes.get(family) || [])]
      .sort()
      .join("|");
    return oldRoutes !== nextRoutes;
  });
  const addedApi = [...laterApi].filter(
    (endpoint) => !earlierApi.has(endpoint),
  );
  const removedApi = [...earlierApi].filter(
    (endpoint) => !laterApi.has(endpoint),
  );
  const actionEvidence = (run: RunData) => {
    const stateMap = new Map(run.states.map((state) => [state.id, state]));
    const evidence = new Map<
      string,
      { action: ActionEdge; source?: AppState; destination?: AppState }[]
    >();
    for (const action of run.actions) {
      const signature = `${actionIdentity(action, stateMap)}\u0000${action.decision}`;
      evidence.set(signature, [
        ...(evidence.get(signature) || []),
        {
          action,
          source: stateMap.get(action.fromStateId),
          destination: action.toStateId
            ? stateMap.get(action.toStateId)
            : undefined,
        },
      ]);
    }
    return evidence;
  };
  const previousActionEvidence = actionEvidence(earlier);
  const currentActionEvidence = actionEvidence(later);
  const previousActions = new Set(previousActionEvidence.keys());
  const currentActions = new Set(currentActionEvidence.keys());
  const addedActions = [...currentActions].filter(
    (signature) => !previousActions.has(signature),
  );
  const removedActions = [...previousActions].filter(
    (signature) => !currentActions.has(signature),
  );
  const journeyPaths = (run: RunData) => {
    const stateById = new Map(run.states.map((state) => [state.id, state]));
    const outgoing = new Map<string, ActionEdge[]>();
    const incoming = new Set(
      run.actions
        .map((action) => action.toStateId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const action of run.actions)
      outgoing.set(action.fromStateId, [
        ...(outgoing.get(action.fromStateId) || []),
        action,
      ]);
    const starts = run.states.filter((state) => !incoming.has(state.id));
    const paths = new Set<string>();
    let visits = 0;
    const walk = (stateId: string, chain: string[], visited: Set<string>) => {
      if (visits++ >= 4000 || chain.length >= 8) {
        if (chain.length) paths.add(chain.join(" → "));
        return;
      }
      const next = outgoing.get(stateId) || [];
      if (!next.length) {
        if (chain.length) paths.add(chain.join(" → "));
        return;
      }
      for (const action of next) {
        const source = stateById.get(action.fromStateId);
        const destination = action.toStateId
          ? stateById.get(action.toStateId)
          : undefined;
        const step = `${source ? stateRoute(source) : "unknown source"} · ${action.action} ${action.targetName || "unnamed control"} · ${action.decision} → ${destination ? stateRoute(destination) : "unknown"}`;
        const nextChain = [...chain, step];
        if (!action.toStateId || visited.has(action.toStateId))
          paths.add(nextChain.join(" → "));
        else
          walk(
            action.toStateId,
            nextChain,
            new Set([...visited, action.toStateId]),
          );
      }
    };
    starts.forEach((state) => walk(state.id, [], new Set([state.id])));
    if (!starts.length)
      run.states
        .slice(0, 20)
        .forEach((state) => walk(state.id, [], new Set([state.id])));
    return paths;
  };
  const previousJourneys = journeyPaths(earlier);
  const currentJourneys = journeyPaths(later);
  const addedJourneys = [...currentJourneys].filter(
    (path) => !previousJourneys.has(path),
  );
  const removedJourneys = [...previousJourneys].filter(
    (path) => !currentJourneys.has(path),
  );
  return (
    <section className="flv" aria-labelledby="flv-impact-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-impact-title">Change impact</h2>
          <p>
            Map observed route, component-family, and endpoint differences
            between runs.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Impact is based on recorded differences only. A route or endpoint
        missing from a run may reflect exploration coverage, not a product
        removal.
      </Notice>
      <div className="flv-stat-grid">
        <Metric
          label="Route paths"
          before={oldRoutes.size}
          after={newRoutes.size}
          added={addedRoutes.length}
          removed={removedRoutes.length}
        />
        <Metric
          label="Component families"
          before={earlierComponentRoutes.size}
          after={laterComponentRoutes.size}
        />
        <Metric
          label="Observed endpoints"
          before={earlierApi.size}
          after={laterApi.size}
          added={addedApi.length}
          removed={removedApi.length}
        />
        <Metric
          label="Action signatures"
          before={previousActions.size}
          after={currentActions.size}
          added={addedActions.length}
          removed={removedActions.length}
        />
        <Metric
          label="Observed journey paths"
          before={previousJourneys.size}
          after={currentJourneys.size}
          added={addedJourneys.length}
          removed={removedJourneys.length}
        />
      </div>
      <div className="flv-columns">
        <section className="flv-list-panel">
          <h3>New routes</h3>
          <RecordList
            items={addedRoutes}
            empty="No new route paths were observed."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Routes no longer observed</h3>
          <RecordList
            items={removedRoutes}
            empty="No earlier route path is missing."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Component families with changed route coverage</h3>
          <RecordList
            items={changedFamilies}
            empty="No route coverage changes among component families."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Endpoints observed only later</h3>
          <RecordList
            items={addedApi}
            empty="No new endpoints were observed."
          />
        </section>
        <section className="flv-list-panel">
          <h3>Endpoints observed only earlier</h3>
          <RecordList
            items={removedApi}
            empty="All earlier endpoints appear in the later run."
          />
        </section>
        <section className="flv-list-panel flv-impact-paths">
          <h3>Journey paths changed</h3>
          <p className="flv-footnote">
            Contiguous recorded action sequences, traced from start states up to
            eight steps. Paths are bounded to 4,000 expansions per discovery.
          </p>
          <strong>
            {addedJourneys.length} added · {removedJourneys.length} no longer
            observed
          </strong>
          <RecordList
            items={[
              ...addedJourneys.slice(0, 4).map((path) => `Added: ${path}`),
              ...removedJourneys.slice(0, 4).map((path) => `Earlier: ${path}`),
            ]}
            empty="No journey path changed within the captured graph."
          />
        </section>
        {(
          [
            {
              title: "Newly observed action paths",
              signatures: addedActions,
              evidence: currentActionEvidence,
              empty: "No new action signature was observed.",
            },
            {
              title: "Previously observed action paths",
              signatures: removedActions,
              evidence: previousActionEvidence,
              empty: "No earlier action signature is missing.",
            },
          ] as const
        ).map(({ title, signatures, evidence, empty }) => (
          <section className="flv-list-panel flv-impact-paths" key={title}>
            <h3>{title}</h3>
            <p className="flv-footnote">
              {signatures.length} signature{signatures.length === 1 ? "" : "s"}{" "}
              · evidence from saved action records
            </p>
            {signatures.length ? (
              <ol className="flv-impact-path-list">
                {signatures.slice(0, 8).map((signature) => {
                  const [
                    sourceFingerprint,
                    actionKind,
                    targetName,
                    targetFingerprint,
                    decision,
                  ] = signature.split("\u0000");
                  const records = evidence.get(signature) || [];
                  return (
                    <li key={signature}>
                      <strong>
                        {actionKind} {targetName || "control"} · {decision}
                      </strong>
                      <small className="flv-impact-signature">
                        State signature: {sourceFingerprint} →{" "}
                        {targetFingerprint}
                      </small>
                      <div className="flv-impact-fragments">
                        {records
                          .slice(0, 4)
                          .map(({ action, source, destination }, index) => (
                            <div
                              className="flv-impact-fragment"
                              key={`${action.id}:${index}`}
                            >
                              <span>
                                {source
                                  ? stateRoute(source)
                                  : "Unknown source state"}
                              </span>
                              <b aria-label={`Action: ${action.action}`}>
                                {action.action} {action.targetName || "control"}
                              </b>
                              <ArrowRight size={12} aria-hidden="true" />
                              <span>
                                {destination
                                  ? stateRoute(destination)
                                  : "Unknown destination state"}
                              </span>
                            </div>
                          ))}
                        {records.length > 4 && (
                          <small>
                            {records.length - 4} additional matching records
                            omitted
                          </small>
                        )}
                      </div>
                    </li>
                  );
                })}
                {signatures.length > 8 && (
                  <li className="flv-impact-more">
                    {signatures.length - 8} additional signatures omitted
                  </li>
                )}
              </ol>
            ) : (
              <p className="flv-empty-inline">{empty}</p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

export function LiveExplorationPulse({
  data,
  onRefresh,
  autoRefresh = false,
}: {
  data: RunData;
  onRefresh?: () => void | Promise<void>;
  autoRefresh?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const running = ["running", "pausing", "queued"].includes(data.run.status);
  const leased = data.tasks.filter((task) => task.status === "leased");
  const pending = data.tasks.filter((task) => task.status === "pending");
  const byWorker = new Map<number, typeof leased>();
  for (const task of leased)
    if (task.worker !== undefined)
      byWorker.set(task.worker, [...(byWorker.get(task.worker) || []), task]);
  const recentEvents = [...data.events]
    .sort((a, b) => dateValue(b.time) - dateValue(a.time))
    .slice(0, 8);
  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    setRefreshError(false);
    try {
      await onRefresh();
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!autoRefresh || !onRefresh || !running) return;
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, data.run.status, onRefresh, refreshing]);
  return (
    <section className="flv" aria-labelledby="flv-live-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-live-title">Live exploration pulse</h2>
          <p>
            Snapshot of current run status, leases, pending tasks, and recent
            events.
          </p>
        </div>
        <span className={`flv-live-state ${running ? "active" : ""}`}>
          {running ? "Run active" : data.run.status}
        </span>
        {onRefresh && (
          <button
            className="flv-refresh"
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh run snapshot"
          >
            <RefreshCw size={13} className={refreshing ? "spinning" : ""} />
            {refreshing ? "Refreshing" : "Refresh snapshot"}
          </button>
        )}
      </header>
      <div className="flv-stat-grid">
        <PulseMetric label="Screens recorded" value={data.states.length} />
        <PulseMetric label="Tasks leased" value={leased.length} />
        <PulseMetric label="Tasks pending" value={pending.length} />
        <PulseMetric label="Workers with leases" value={byWorker.size} />
      </div>
      {refreshError && (
        <Notice tone="caution">
          Could not refresh this snapshot. Retry or wait for the host run view
          to update.
        </Notice>
      )}
      {!running && (
        <Notice>
          The run is not currently active; this view reflects the latest stored
          snapshot.
        </Notice>
      )}
      <div className="flv-columns">
        <section className="flv-list-panel">
          <h3>Worker leases ({byWorker.size})</h3>
          {byWorker.size ? (
            [...byWorker.entries()]
              .sort(([a], [b]) => a - b)
              .map(([worker, tasks]) => (
                <div className="flv-worker-pulse" key={worker}>
                  <strong>Worker {worker}</strong>
                  {tasks.map((task) => (
                    <span key={task.id}>
                      {task.action} · depth {task.depth} · {pathname(task.url)}
                    </span>
                  ))}
                </div>
              ))
          ) : (
            <p className="flv-empty-inline">
              No task is currently assigned to a worker.
            </p>
          )}
        </section>
        <section className="flv-list-panel">
          <h3>Recent recorded events</h3>
          {recentEvents.length ? (
            <ul className="flv-record-list">
              {recentEvents.map((event) => (
                <li key={event.id}>
                  <span>
                    {event.message}
                    <small>
                      {showTime(event.time)}
                      {event.worker !== undefined
                        ? ` · Worker ${event.worker}`
                        : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flv-empty-inline">No events were captured.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function PulseMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="flv-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>in the latest supplied run snapshot</small>
    </article>
  );
}

/** Follow a selected screen's recorded provenance chain and show action/API time per step. */
export function JourneyPerformancePath({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const terminalStates = [...data.states].sort(
    (a, b) => dateValue(b.discoveredAt) - dateValue(a.discoveredAt),
  );
  const [targetId, setTargetId] = useState(terminalStates[0]?.id || "");
  const target = data.states.find((state) => state.id === targetId);
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  const actionById = new Map(data.actions.map((action) => [action.id, action]));
  const callsByAction = new Map<string, ApiCall[]>();
  for (const call of data.apiCalls) {
    if (call.actionId)
      callsByAction.set(call.actionId, [
        ...(callsByAction.get(call.actionId) || []),
        call,
      ]);
  }
  const reversedPath: Array<{ state: AppState; action?: ActionEdge }> = [];
  const visited = new Set<string>();
  let cursor = target;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const action = cursor.provenanceActionId
      ? actionById.get(cursor.provenanceActionId)
      : undefined;
    reversedPath.push({ state: cursor, action });
    cursor = action ? stateById.get(action.fromStateId) : undefined;
  }
  const path = reversedPath.reverse();
  const maxActionMs = Math.max(
    1,
    ...path.map(({ action }) => action?.elapsedMs || 0),
  );
  if (!target)
    return (
      <Prerequisite
        title="Journey performance path"
        detail="This run has no captured screen to trace. A path needs provenance-linked screens or action records."
      />
    );
  return (
    <section className="flv" aria-labelledby="flv-path-time-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-path-time-title">Journey performance path</h2>
          <p>
            Show recorded action time and correlated API duration along a saved
            provenance chain.
          </p>
        </div>
      </header>
      <label className="flv-target-picker">
        Journey destination
        <select
          value={target.id}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {terminalStates.map((state) => (
            <option key={state.id} value={state.id}>
              {stateName(state)} · depth {state.depth}
            </option>
          ))}
        </select>
      </label>
      <Notice tone="caution">
        Request durations are independent observations and can overlap. They are
        shown beside action duration, not added to it. Missing timing is left
        blank.
      </Notice>
      {path.length > 1 ? (
        <ol className="flv-journey-time">
          {path.map(({ state, action }, index) => {
            const calls = action ? callsByAction.get(action.id) || [] : [];
            const requestMs = calls.flatMap((call) =>
              call.durationMs === undefined ? [] : [call.durationMs],
            );
            const requestTotal = requestMs.reduce(
              (sum, value) => sum + value,
              0,
            );
            return (
              <li key={state.id}>
                <span className="flv-journey-index">{index + 1}</span>
                <div className="flv-journey-step">
                  <button
                    className="flv-path-state"
                    type="button"
                    onClick={() => onSelect({ kind: "state", id: state.id })}
                  >
                    {stateName(state)}
                    <small>{stateRoute(state)}</small>
                  </button>
                  {action ? (
                    <>
                      <div className="flv-journey-action">
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({ kind: "action", id: action.id })
                          }
                        >
                          {action.action} {action.targetName || "control"}
                          <small>
                            {action.decision} ·{" "}
                            {action.elapsedMs !== undefined
                              ? `${action.elapsedMs} ms action time`
                              : "action duration not recorded"}
                          </small>
                        </button>
                        <div className="flv-time-bars">
                          <span>
                            Action{" "}
                            {action.elapsedMs !== undefined
                              ? `${action.elapsedMs} ms`
                              : "—"}
                          </span>
                          <i>
                            <b
                              style={{
                                width: `${action.elapsedMs === undefined ? 0 : Math.max(3, (action.elapsedMs / maxActionMs) * 100)}%`,
                              }}
                            />
                          </i>
                          <span>
                            API{" "}
                            {requestMs.length
                              ? `${requestTotal} ms across ${requestMs.length} timed calls`
                              : "duration not recorded"}
                          </span>
                          <i className="api">
                            <b
                              style={{
                                width: `${requestMs.length ? Math.max(3, (requestTotal / maxActionMs) * 100) : 0}%`,
                              }}
                            />
                          </i>
                        </div>
                        <small className="flv-api-timing-list">
                          {calls
                            .map(
                              (call) =>
                                `${call.method} ${pathname(call.url)}: ${call.durationMs === undefined ? "—" : `${call.durationMs} ms`}`,
                            )
                            .join(" · ") ||
                            "No request records linked to this action."}
                        </small>
                      </div>
                    </>
                  ) : (
                    <span className="flv-path-start">
                      Starting or unlinked screen
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flv-empty">
          No action-linked path is recorded for this screen.
        </div>
      )}
    </section>
  );
}

/** Assign a source category only when a stored action, recipe seed, or href supports it. */
export function NavigationProvenanceView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const actionById = new Map(data.actions.map((action) => [action.id, action]));
  const elementById = new Map(
    data.elements.map((element) => [element.id, element]),
  );
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  const rows = data.states.map((state) => {
    const action = state.provenanceActionId
      ? actionById.get(state.provenanceActionId)
      : undefined;
    const source = action ? stateById.get(action.fromStateId) : undefined;
    const element = action ? elementById.get(action.elementId) : undefined;
    const seedMatch = [data.run.config.baseUrl, ...data.run.config.seeds].some(
      (url) => {
        try {
          return new URL(url).href === new URL(state.recipe.seed).href;
        } catch {
          return url === state.recipe.seed;
        }
      },
    );
    const hrefClass = element?.href
      ? (() => {
          try {
            return (
              new URL(element.href, action?.beforeUrl).origin ===
              new URL(action?.beforeUrl || data.run.config.baseUrl).origin
            );
          } catch {
            return false;
          }
        })()
      : false;
    const redirectInferred = Boolean(
      action?.decision === "executed" &&
      element?.href &&
      action.beforeUrl &&
      (action.afterUrl || state.url) &&
      (() => {
        try {
          const expected = new URL(element.href, action.beforeUrl);
          const actual = new URL(action.afterUrl || state.url);
          return expected.href !== actual.href;
        } catch {
          return false;
        }
      })(),
    );
    const category = action
      ? action.effectFlags.includes("open_new_tab") ||
        action.signals.some(
          (raw) => parseTabSignal(raw)?.event === "popup_active",
        )
        ? "Popup handoff"
        : action.effectFlags.includes("external_navigation") ||
            action.signals.some((raw) =>
              ["external_navigation", "external_navigation_blocked"].includes(
                parseTabSignal(raw)?.event || "",
              ),
            )
          ? "External navigation"
          : redirectInferred
            ? "Redirect inferred"
            : element?.href && hrefClass
              ? "In-app link"
              : "Action"
      : !state.provenanceActionId &&
          state.recipe.steps.length === 0 &&
          seedMatch
        ? "Starting URL"
        : "Unknown source";
    const tabSignals =
      action?.signals.flatMap((raw) => {
        const parsed = parseTabSignal(raw);
        return parsed ? [`${parsed.tabId}: ${parsed.event}`] : [];
      }) || [];
    return { state, action, source, element, category, tabSignals };
  });
  return (
    <section className="flv" aria-labelledby="flv-provenance-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-provenance-title">Navigation provenance</h2>
          <p>
            Show the captured source for each screen and link back through
            recorded actions.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Captured hrefs and popup/history/external-navigation signals can refine
        the source label. “Redirect inferred” means an executed link action
        ended at a URL different from its captured href target. Client-side
        routing or URL rewriting can also cause that mismatch.
      </Notice>
      <div className="flv-provenance-list">
        {rows.map(
          ({ state, action, source, element, category, tabSignals }) => (
            <article key={state.id}>
              <span
                className={`flv-provenance-type ${category === "Unknown source" ? "unknown" : ""}`}
              >
                {category}
              </span>
              <div className="flv-provenance-chain">
                {source ? (
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "state", id: source.id })}
                  >
                    {stateName(source)}
                  </button>
                ) : (
                  <span>
                    {category === "Starting URL"
                      ? `Seed ${pathname(state.recipe.seed)}`
                      : "Source not recorded"}
                  </span>
                )}
                {action && (
                  <>
                    <ArrowRight size={12} />
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({ kind: "action", id: action.id })
                      }
                    >
                      {action.action} {action.targetName || "control"}
                    </button>
                  </>
                )}
                <ArrowRight size={12} />
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "state", id: state.id })}
                >
                  {stateName(state)}
                </button>
              </div>
              <small>
                {source
                  ? `Recorded destination from ${pathname(source.url)}`
                  : state.recipe.steps.length
                    ? `${state.recipe.steps.length} replay steps exist, but no provenance action is linked to this screen`
                    : state.provenanceActionId
                      ? "A provenance action ID exists but the action record is unavailable"
                      : category === "Starting URL"
                        ? "Matches configured base or seed URL"
                        : "No seed/action source match found"}
                {element?.href
                  ? ` · link target ${pathname(element.href)}`
                  : ""}
                {category === "Redirect inferred"
                  ? ` · final URL ${pathname(action?.afterUrl || state.url)}`
                  : ""}
                {tabSignals.length ? ` · ${tabSignals.join("; ")}` : ""}
              </small>
            </article>
          ),
        )}
      </div>
    </section>
  );
}

export function StateRecurrenceView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const occurrences = new Map<string, AppState[]>();
  for (const state of data.states)
    occurrences.set(state.fingerprint, [
      ...(occurrences.get(state.fingerprint) || []),
      state,
    ]);
  const repeated = [...occurrences.values()]
    .filter((states) => states.length > 1)
    .sort((a, b) => b.length - a.length);
  return (
    <section className="flv" aria-labelledby="flv-recurrence-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-recurrence-title">State recurrence</h2>
          <p>Group observations with the exact same fingerprint in one run.</p>
        </div>
      </header>
      <Notice>
        Repeated fingerprints identify a state the discovery recognized before.
        They do not by themselves indicate a loop or repeated user visit.
      </Notice>
      {repeated.length ? (
        <div className="flv-recurrence-list">
          {repeated.map((states) => (
            <article key={states[0].fingerprint}>
              <header>
                <strong>{states.length} observations</strong>
                <code>{states[0].fingerprint.slice(0, 12)}</code>
              </header>
              <ul>
                {states.map((state) => (
                  <li key={state.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "state", id: state.id })}
                    >
                      {stateName(state)}
                    </button>
                    <small>
                      Worker {state.worker} · depth {state.depth} ·{" "}
                      {showTime(state.discoveredAt)}
                    </small>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <div className="flv-empty">
          No fingerprint was observed more than once.
        </div>
      )}
    </section>
  );
}
export function CrossRouteConsistencyView({ data }: { data: RunData }) {
  const families = new Map<
    string,
    {
      routes: Set<string>;
      observations: number;
      confidenceTotal: number;
      kinds: Set<string>;
      labels: Set<string>;
    }
  >();
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  for (const component of data.components) {
    const state = stateById.get(component.stateId);
    if (!state) continue;
    const key = `${component.familyId || component.name}:${component.kind}`;
    const family = families.get(key) || {
      routes: new Set<string>(),
      observations: 0,
      confidenceTotal: 0,
      kinds: new Set<string>(),
      labels: new Set<string>(),
    };
    family.routes.add(stateRoute(state));
    family.observations += 1;
    family.confidenceTotal += component.confidence;
    family.kinds.add(component.kind);
    family.labels.add(component.name);
    families.set(key, family);
  }
  const shared = [...families.entries()]
    .filter(([, family]) => family.routes.size > 1)
    .sort((a, b) => b[1].routes.size - a[1].routes.size);
  const elementsById = new Map(
    data.elements.map((element) => [element.id, element]),
  );
  const actionsByElement = new Map<string, ActionEdge[]>();
  for (const action of data.actions) {
    const list = actionsByElement.get(action.elementId) || [];
    list.push(action);
    actionsByElement.set(action.elementId, list);
  }
  const navigationControls = new Map<
    string,
    Map<
      string,
      {
        label: string;
        outcomes: Set<string>;
        destinations: Set<string>;
        count: number;
      }
    >
  >();
  for (const component of data.components.filter(
    (item) => item.kind === "navigation",
  )) {
    const state = stateById.get(component.stateId);
    if (!state) continue;
    for (const elementId of component.elementIds) {
      const element = elementsById.get(elementId);
      if (!element) continue;
      const rawLabel =
        element.accessibleName?.trim() ||
        element.textSnippet?.trim() ||
        element.href?.trim() ||
        element.role;
      const label = rawLabel.replace(/\s+/g, " ");
      const identity = `${element.role.toLowerCase()}::${label.toLowerCase()}`;
      const route = stateRoute(state);
      const routes = navigationControls.get(identity) || new Map();
      const row = routes.get(route) || {
        label,
        outcomes: new Set<string>(),
        destinations: new Set<string>(),
        count: 0,
      };
      row.count += 1;
      const actions = actionsByElement.get(elementId) || [];
      if (!actions.length) row.outcomes.add("No action recorded");
      for (const action of actions) {
        row.outcomes.add(
          action.decision === "executed"
            ? "Completed"
            : action.decision === "failed"
              ? "Failed"
              : "Skipped",
        );
        const destination = action.toStateId
          ? stateById.get(action.toStateId)
          : undefined;
        row.destinations.add(
          destination ? stateRoute(destination) : "Destination unknown",
        );
      }
      routes.set(route, row);
      navigationControls.set(identity, routes);
    }
  }
  const sharedNavigation = [...navigationControls.entries()]
    .filter(([, routes]) => routes.size > 1)
    .sort((a, b) => b[1].size - a[1].size);
  return (
    <section className="flv" aria-labelledby="flv-consistency-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-consistency-title">Cross-route consistency</h2>
          <p>
            Compare component families and route coverage from captured screens.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Shared family labels are based on discovery classification. They suggest
        observed reuse or consistency, but do not prove the app uses one shared
        implementation or that each instance behaves the same.
      </Notice>
      {shared.length ? (
        <div className="flv-table-wrap">
          <table className="flv-table">
            <thead>
              <tr>
                <th>Component family</th>
                <th>Routes</th>
                <th>Observed routes</th>
                <th>Screen observations</th>
                <th>Mean classification confidence</th>
                <th>Observed names</th>
              </tr>
            </thead>
            <tbody>
              {shared.map(([family, value]) => (
                <tr key={family}>
                  <th>{family}</th>
                  <td>{value.routes.size}</td>
                  <td>{[...value.routes].sort().join(", ")}</td>
                  <td>{value.observations}</td>
                  <td>
                    {(value.confidenceTotal / value.observations).toFixed(2)}
                  </td>
                  <td>{[...value.labels].sort().join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flv-empty">
          No component family was observed on multiple routes.
        </div>
      )}
      <div className="flv-consistency-section">
        <div>
          <h3>Shared navigation controls and behavior</h3>
          <p>
            Controls are grouped by captured role and accessible name. Outcomes
            and destinations come only from linked actions; missing action
            records remain unknown.
          </p>
        </div>
        {sharedNavigation.length ? (
          <div className="flv-table-wrap">
            <table className="flv-table">
              <thead>
                <tr>
                  <th>Control (inferred match)</th>
                  <th>Routes</th>
                  <th>Observed route behavior</th>
                </tr>
              </thead>
              <tbody>
                {sharedNavigation.map(([identity, routes]) => (
                  <tr key={identity}>
                    <th>{[...routes.values()][0]?.label}</th>
                    <td>{routes.size}</td>
                    <td>
                      <ul className="flv-consistency-route-list">
                        {[...routes.entries()]
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([route, value]) => (
                            <li key={route}>
                              <strong>{route}</strong>
                              <span>
                                {[...value.outcomes].sort().join(", ")}
                              </span>
                              <small>
                                {value.count} captured instance
                                {value.count === 1 ? "" : "s"}; destinations:{" "}
                                {[...value.destinations].sort().join(", ") ||
                                  "Unknown"}
                              </small>
                            </li>
                          ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flv-empty">
            No captured navigation control with the same role and accessible
            name appears on multiple routes.
          </div>
        )}
      </div>
    </section>
  );
}

function LabeledJourneyComparison({
  data,
  comparisonRuns,
  labelKey,
  title,
  description,
}: {
  data: RunData;
  comparisonRuns: RunData[];
  labelKey: "roleLabel" | "localeLabel";
  title: string;
  description: string;
}) {
  const currentLabel = data.run.config[labelKey]?.trim();
  if (!currentLabel)
    return (
      <Prerequisite
        title={title}
        detail={`This discovery has no ${labelKey === "roleLabel" ? "role" : "locale"} label. Add it in discovery settings and rerun. Labels describe the configured run; they do not validate identity or language behavior.`}
      />
    );
  const candidates = comparisonRuns.filter(
    (run) =>
      run.run.id !== data.run.id &&
      Boolean(data.run.projectId) &&
      run.run.projectId === data.run.projectId &&
      Boolean(run.run.config[labelKey]?.trim()) &&
      run.run.config[labelKey]!.trim() !== currentLabel,
  );
  if (!candidates.length)
    return (
      <Prerequisite
        title={title}
        detail={`The current discovery is labeled “${currentLabel}”, but no other loaded discovery from this project has a different ${labelKey === "roleLabel" ? "role" : "locale"} label. Tag and load another run to compare paths.`}
      />
    );
  const runs = [data, ...candidates];
  const routes = [
    ...new Set(runs.flatMap((run) => run.states.map(stateRoute))),
  ].sort();
  return (
    <section className="flv" aria-label={title}>
      <header className="flv-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <Notice tone="caution">
        Comparison uses only runs with an explicit{" "}
        {labelKey === "roleLabel" ? "role" : "locale"} label and the same
        project ID. Labels are user-provided metadata; discovery does not verify
        sign-in identity or the page language.
      </Notice>
      <div className="flv-table-wrap">
        <table className="flv-table">
          <thead>
            <tr>
              <th>Route path</th>
              {runs.map((run) => (
                <th key={run.run.id}>
                  {run.run.config[labelKey]}
                  <small className="flv-th-sub">{run.run.name}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route}>
                <th>{route}</th>
                {runs.map((run) => {
                  const matching = run.states.filter(
                    (state) => stateRoute(state) === route,
                  );
                  const actionCount = run.actions.filter((action) =>
                    matching.some((state) => state.id === action.fromStateId),
                  ).length;
                  return (
                    <td key={run.run.id}>
                      {matching.length ? (
                        <>
                          {matching.length} screens
                          <small className="flv-th-sub">
                            {actionCount} observed outgoing actions
                          </small>
                        </>
                      ) : (
                        "Not observed"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flv-table-wrap">
        <h3>Action outcomes by labeled run</h3>
        <table className="flv-table">
          <thead>
            <tr>
              <th>Run / label</th>
              <th>Executed</th>
              <th>Skipped by policy</th>
              <th>Failed</th>
              <th>Routes observed</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.run.id}>
                <th>
                  {run.run.name}
                  <small className="flv-th-sub">
                    {run.run.config[labelKey]}
                  </small>
                </th>
                <td>
                  {
                    run.actions.filter(
                      (action) => action.decision === "executed",
                    ).length
                  }
                </td>
                <td>
                  {
                    run.actions.filter(
                      (action) => action.decision === "skipped_policy",
                    ).length
                  }
                </td>
                <td>
                  {
                    run.actions.filter((action) => action.decision === "failed")
                      .length
                  }
                </td>
                <td>{new Set(run.states.map(stateRoute)).size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function LocaleCoverageView({
  data,
  comparisonRuns = [],
}: {
  data: RunData;
  comparisonRuns?: RunData[];
}) {
  return (
    <LabeledJourneyComparison
      data={data}
      comparisonRuns={comparisonRuns}
      labelKey="localeLabel"
      title="Locale coverage comparison"
      description="Compare observed route and action coverage between discoveries labeled for different locales."
    />
  );
}
export function RoleJourneyComparisonView({
  data,
  comparisonRuns = [],
}: {
  data: RunData;
  comparisonRuns?: RunData[];
}) {
  return (
    <LabeledJourneyComparison
      data={data}
      comparisonRuns={comparisonRuns}
      labelKey="roleLabel"
      title="Role-based journey comparison"
      description="Compare observed routes and interaction outcomes between discoveries labeled for different roles."
    />
  );
}
export function SessionPersistenceView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const states = new Map(data.states.map((state) => [state.id, state]));
  const restorations = data.actions.flatMap((action) => {
    const cues = new Set<string>();
    const browserEvidence = action.browserEvidence;
    for (const signal of action.signals) {
      const event = parseTabSignal(signal)?.event || signal;
      if (
        event === "lifecycle:navigation:reload" ||
        event === "navigation:reload"
      )
        cues.add("Captured reload");
      if (
        event === "lifecycle:navigation:back_forward" ||
        event === "navigation:back_forward" ||
        ["history:back", "history:forward", "history:popstate"].includes(
          event,
        ) ||
        event.startsWith("history:go:")
      )
        cues.add("Captured history restoration");
    }
    for (const event of browserEvidence?.events || []) {
      if (
        event.kind === "navigation_start" &&
        event.navigationType === "reload"
      )
        cues.add("Chromium reload navigation");
      if (
        event.kind === "navigation_start" &&
        (event.navigationType === "historySameDocument" ||
          event.navigationType === "historyDifferentDocument")
      )
        cues.add("Chromium history traversal");
      if (
        event.kind === "navigation_request" &&
        event.navigationReason === "reload"
      )
        cues.add("Chromium reload request");
    }
    const before = browserEvidence?.before;
    const after = browserEvidence?.after;
    const storageChanges =
      before && after
        ? {
            local:
              before.localStorageEntryCount == null ||
              after.localStorageEntryCount == null
                ? undefined
                : after.localStorageEntryCount - before.localStorageEntryCount,
            session:
              before.sessionStorageEntryCount == null ||
              after.sessionStorageEntryCount == null
                ? undefined
                : after.sessionStorageEntryCount -
                  before.sessionStorageEntryCount,
            cookies:
              before.cookieCount == null || after.cookieCount == null
                ? undefined
                : after.cookieCount - before.cookieCount,
          }
        : undefined;
    if (
      storageChanges &&
      Object.values(storageChanges).some(
        (value) => value !== undefined && value !== 0,
      )
    )
      cues.add("Browser storage counts changed");
    const isolatedProbe = browserEvidence?.isolatedContextPersistence;
    if (isolatedProbe)
      cues.add("Storage imported into an isolated browser context");
    if (!cues.size) return [];
    const source = states.get(action.fromStateId);
    const destination = action.toStateId
      ? states.get(action.toStateId)
      : undefined;
    const linked = Boolean(source?.fingerprint && destination?.fingerprint);
    const sameFingerprint = linked
      ? source!.fingerprint === destination!.fingerprint
      : undefined;
    return [
      {
        action,
        cues: [...cues],
        source,
        destination,
        sameFingerprint,
        storageChanges,
        isolatedProbe,
      },
    ];
  });
  return (
    <section className="flv" aria-labelledby="flv-session-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-session-title">Session persistence cues</h2>
          <p>
            Compare linked source and destination fingerprints after a captured
            reload or browser-history restoration cue.
          </p>
        </div>
      </header>
      <Notice tone="caution">
        Chromium navigation events distinguish reloads and same or different
        document history traversals. Value-free storage counts show whether
        local/session storage or cookies changed during the action. For reload
        and history traversals, the worker also checks whether local-storage and
        cookie counts can be imported into an isolated browser context. Stored
        values are never retained in the result. This still cannot prove
        server-side continuity or persistence after a browser restart.
      </Notice>
      {restorations.length ? (
        <div className="flv-annotation-list">
          {restorations.map(
            ({
              action,
              cues,
              source,
              destination,
              sameFingerprint,
              storageChanges,
              isolatedProbe,
            }) => (
              <article key={action.id}>
                <div>
                  {cues.map((cue) => (
                    <span className="flv-review-status open" key={cue}>
                      {cue}
                    </span>
                  ))}
                </div>
                <strong>
                  {sameFingerprint === undefined
                    ? "Unknown — state link missing"
                    : sameFingerprint
                      ? "Same fingerprint observed"
                      : "Different fingerprint observed"}
                </strong>
                <p>
                  {action.action} {action.targetName || "recorded action"}
                </p>
                {storageChanges && (
                  <p>
                    Storage entry-count delta · local{" "}
                    {storageChanges.local ?? "unknown"} · session{" "}
                    {storageChanges.session ?? "unknown"} · cookies{" "}
                    {storageChanges.cookies ?? "unknown"}. Count changes alone
                    do not identify an application session state.
                  </p>
                )}
                {isolatedProbe && (
                  <p>
                    Isolated-context restore counts · local storage{" "}
                    {isolatedProbe.localStorageEntryCount} →{" "}
                    {isolatedProbe.restoredLocalStorageEntryCount} entries ·
                    cookies {isolatedProbe.cookieCount} →{" "}
                    {isolatedProbe.restoredCookieCount} · {isolatedProbe.origin}
                  </p>
                )}
                <div className="flv-annotation-actions">
                  {source ? (
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "state", id: source.id })}
                    >
                      Open source state
                    </button>
                  ) : (
                    <span>Source state unknown</span>
                  )}
                  {destination ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({ kind: "state", id: destination.id })
                      }
                    >
                      Open resulting state
                    </button>
                  ) : (
                    <span>Destination state unknown</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "action", id: action.id })}
                  >
                    Open captured action
                  </button>
                </div>
              </article>
            ),
          )}
        </div>
      ) : (
        <div className="flv-empty">
          This run has no linked action with a captured reload or
          history-restoration cue. Persistence status is unknown.
        </div>
      )}
    </section>
  );
}
export function BrowserHistoryView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const events = data.actions
    .flatMap((action) => [
      ...action.signals.flatMap((raw) => {
        const parsed = parseTabSignal(raw);
        if (!parsed || !parsed.event.startsWith("history:")) return [];
        return [
          {
            action,
            tabId: parsed.tabId,
            event: `Page History API · ${parsed.event.slice("history:".length)}`,
            offsetMs: 0,
          },
        ];
      }),
      ...(action.browserEvidence?.events || []).flatMap((item) => {
        if (item.kind === "navigation_request")
          return [
            {
              action,
              tabId: item.tabId || "tab unknown",
              offsetMs: item.offsetMs,
              event: `Renderer navigation request · ${item.navigationReason || "reason unknown"} · ${item.disposition || "disposition unknown"}`,
            },
          ];
        if (item.kind === "navigation_start") {
          const beforeIndex =
            action.browserEvidence?.before.navigationEntryIndex;
          const afterIndex = action.browserEvidence?.after.navigationEntryIndex;
          const delta =
            beforeIndex == null || afterIndex == null
              ? undefined
              : afterIndex - beforeIndex;
          const direction =
            item.navigationType?.startsWith("history") && delta !== undefined
              ? delta < 0
                ? " · Back candidate"
                : delta > 0
                  ? " · Forward candidate"
                  : " · history index unchanged"
              : "";
          return [
            {
              action,
              tabId: item.tabId || "tab unknown",
              offsetMs: item.offsetMs,
              event: `Chromium navigation · ${item.navigationType || "type unknown"}${direction}`,
            },
          ];
        }
        if (item.kind === "redirect")
          return [
            {
              action,
              tabId: item.tabId || "tab unknown",
              offsetMs: item.offsetMs,
              event: `Redirect response · HTTP ${item.status || "unknown"} · ${item.origin || "origin unknown"}`,
            },
          ];
        return [];
      }),
    ])
    .sort(
      (a, b) =>
        dateValue(a.action.createdAt) - dateValue(b.action.createdAt) ||
        a.offsetMs - b.offsetMs,
    );
  return (
    <section className="flv" aria-labelledby="flv-history-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-history-title">Page history API activity</h2>
          <p>
            Inspect page History API calls alongside Chromium navigation
            reasons, history traversals, reloads, and redirect responses.
          </p>
        </div>
        <span className="flv-heading-count">{events.length} signals</span>
      </header>
      <Notice tone="caution">
        Page History API calls are distinct from Chromium navigation types. A
        history traversal or reload can be captured even when page code did not
        call the History API, but the event does not identify a physical browser
        toolbar button. Tab IDs last only within one worker action.
      </Notice>
      {events.length ? (
        <ol className="flv-history-events">
          {events.map(({ action, tabId, event }, index) => (
            <li key={`${action.id}:${event}:${index}`}>
              <time>{showTime(action.createdAt)}</time>
              <span className="flv-history-kind">{event}</span>
              <span>{tabId}</span>
              <button
                type="button"
                onClick={() => onSelect({ kind: "action", id: action.id })}
              >
                {action.action} {action.targetName || "control"}
                <small>
                  {pathname(action.beforeUrl)}
                  {action.afterUrl ? ` → ${pathname(action.afterUrl)}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flv-empty">
          No page History API or Chromium navigation events were recorded in
          this run.
        </div>
      )}
    </section>
  );
}
export function MultiTabFlowView({
  data,
  onSelect,
}: {
  data: RunData;
  onSelect: (selection: LifecycleSelection) => void;
}) {
  const events = data.actions.flatMap((action) => [
    ...action.signals.flatMap((raw) => {
      const parsed = parseTabSignal(raw);
      if (!parsed || !["popup_opened", "popup_active"].includes(parsed.event))
        return [];
      return [
        { action, ...parsed, parentTabId: undefined as string | undefined },
      ];
    }),
    ...(action.browserEvidence?.events || []).flatMap((event) =>
      ["tab_opened", "tab_activated", "tab_closed"].includes(event.kind)
        ? [
            {
              action,
              tabId: event.tabId || "tab unknown",
              event: event.kind,
              parentTabId: event.parentTabId,
            },
          ]
        : [],
    ),
  ]);
  const byAction = new Map<string, typeof events>();
  for (const event of events)
    byAction.set(event.action.id, [
      ...(byAction.get(event.action.id) || []),
      event,
    ]);
  const tabLineages = new Map<
    string,
    { parent?: string; states: AppState[]; actions: ActionEdge[] }
  >();
  const lineageFor = (id: string, parent?: string) => {
    const row = tabLineages.get(id) || { parent, states: [], actions: [] };
    if (!row.parent && parent) row.parent = parent;
    tabLineages.set(id, row);
    return row;
  };
  const addLineageState = (id: string, state?: AppState) => {
    if (
      state &&
      !lineageFor(id, state.browserTabParentId).states.some(
        (item) => item.id === state.id,
      )
    )
      lineageFor(id, state.browserTabParentId).states.push(state);
  };
  for (const state of data.states) {
    if (!state.browserTabId) continue;
    addLineageState(state.browserTabId, state);
  }
  const stateById = new Map(data.states.map((state) => [state.id, state]));
  for (const action of data.actions) {
    const evidence = action.browserEvidence;
    if (!evidence) continue;
    lineageFor(evidence.sourceTabId).actions.push(action);
    addLineageState(evidence.sourceTabId, stateById.get(action.fromStateId));
    if (evidence.activeTabId !== evidence.sourceTabId) {
      lineageFor(evidence.activeTabId, evidence.activeTabParentId).actions.push(
        action,
      );
      addLineageState(
        evidence.activeTabId,
        action.toStateId ? stateById.get(action.toStateId) : undefined,
      );
    } else if (action.toStateId) {
      addLineageState(evidence.activeTabId, stateById.get(action.toStateId));
    }
  }
  return (
    <section className="flv" aria-labelledby="flv-multitab-title">
      <header className="flv-heading">
        <div>
          <h2 id="flv-multitab-title">Popup and tab handoffs</h2>
          <p>
            Trace popup handoffs and follow logical tab lineages across restored
            action tasks.
          </p>
        </div>
        <span className="flv-heading-count">
          {tabLineages.size} logical tabs · {events.length} tab events
        </span>
      </header>
      <Notice tone="caution">
        Logical tab IDs connect states and actions across discovery tasks; they
        are not browser-process handles. A popup gets a child lineage, and
        actions restored from that state continue on that lineage. Discovery
        still opens an isolated browser context for each action, so this does
        not represent a continuously open real browser window.
      </Notice>
      {tabLineages.size > 0 && (
        <section className="flv-list-panel flv-multitab-lineages">
          <h3>Logical tab journeys</h3>
          {[...tabLineages.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tabId, row]) => (
              <article key={tabId}>
                <header>
                  <strong>{tabId}</strong>
                  <small>
                    {row.parent ? `opened from ${row.parent}` : "entry tab"} ·{" "}
                    {row.states.length} recorded states · {row.actions.length}{" "}
                    linked action records
                  </small>
                </header>
                <ol>
                  {row.states
                    .sort(
                      (a, b) =>
                        dateValue(a.discoveredAt) - dateValue(b.discoveredAt),
                    )
                    .map((state) => (
                      <li key={state.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({ kind: "state", id: state.id })
                          }
                        >
                          {stateName(state)}
                          <small>{stateRoute(state)}</small>
                        </button>
                        {state.provenanceActionId && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelect({
                                kind: "action",
                                id: state.provenanceActionId!,
                              })
                            }
                          >
                            Reached by action
                          </button>
                        )}
                      </li>
                    ))}
                </ol>
              </article>
            ))}
        </section>
      )}
      {byAction.size ? (
        <div className="flv-multitab-list">
          {[...byAction.entries()].map(([actionId, items]) => {
            const action = items[0].action;
            return (
              <article key={actionId}>
                <header>
                  <span>
                    {action.action} · {action.targetName || "control"}
                  </span>
                  <time>{showTime(action.createdAt)}</time>
                </header>
                <div className="flv-multitab-handoff">
                  <span className="flv-tab-chip">Action source</span>
                  <ArrowRight size={13} />
                  {items.map((item, index) => (
                    <React.Fragment
                      key={`${item.tabId}:${item.event}:${index}`}
                    >
                      <span className={`flv-tab-chip ${item.event}`}>
                        {item.event === "popup_opened" ||
                        item.event === "tab_opened"
                          ? "Opened"
                          : item.event === "tab_closed"
                            ? "Closed"
                            : "Activated"}{" "}
                        · {item.tabId}
                        {item.parentTabId ? ` · from ${item.parentTabId}` : ""}
                      </span>
                      {index < items.length - 1 && <ArrowRight size={13} />}
                    </React.Fragment>
                  ))}
                </div>
                <small>
                  {pathname(action.beforeUrl)}
                  {action.afterUrl
                    ? ` → ${pathname(action.afterUrl)}`
                    : " · no destination URL recorded"}
                </small>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "action", id: action.id })}
                >
                  Inspect triggering action
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flv-empty">
          No popup open/activation handoffs were recorded.
        </div>
      )}
    </section>
  );
}

export type LifecycleSubview =
  | "compare"
  | "impact"
  | "snapshot"
  | "performance"
  | "repeatability"
  | "responsive"
  | "freshness"
  | "annotations"
  | "authentication"
  | "live"
  | "workers"
  | "frontier"
  | "recurrence"
  | "consistency"
  | "requests"
  | "side-effects"
  | "journey-time"
  | "provenance"
  | "role"
  | "locale"
  | "session"
  | "history"
  | "multi-tab";

export interface FlowLifecycleHubProps {
  /** Current run whose view is open. */
  data: RunData;
  /** Other fully loaded runs available to this family of views. */
  comparisonRuns?: RunData[];
  /** A list-only index may be passed while the host loads the selected run. */
  availableRuns?: RunSummary[];
  /** Selected recent compatible runs for the multi-run repeatability view. */
  repeatabilityRuns?: RunData[];
  repeatabilityRunIds?: string[];
  onRepeatabilityRunsChange?: (runIds: string[]) => void;
  selectedComparisonId?: string;
  onComparisonChange?: (runId: string) => void;
  onSelect: (selection: LifecycleSelection) => void;
  onSelectComparison?: (runId: string, selection: LifecycleSelection) => void;
  /** Run payload refresh supplied by the host's existing discovery poller. */
  onRefresh?: () => void | Promise<void>;
  autoRefreshPulse?: boolean;
  initialSubview?: LifecycleSubview;
}

const lifecycleLabels: Array<[LifecycleSubview, string]> = [
  ["compare", "Run comparison"],
  ["impact", "Change impact"],
  ["snapshot", "Screen snapshot diff"],
  ["performance", "Performance comparison"],
  ["repeatability", "Repeatability"],
  ["responsive", "Responsive comparison"],
  ["freshness", "Evidence freshness"],
  ["annotations", "Flow annotations"],
  ["authentication", "Authentication candidates"],
  ["live", "Live exploration pulse"],
  ["workers", "Worker activity map"],
  ["frontier", "Frontier and queue"],
  ["recurrence", "State recurrence"],
  ["consistency", "Cross-route consistency"],
  ["requests", "Request lifecycle trace"],
  ["side-effects", "Browser side effects"],
  ["journey-time", "Journey performance path"],
  ["provenance", "Navigation provenance"],
  ["role", "Role journey comparison"],
  ["locale", "Locale coverage"],
  ["session", "Session persistence"],
  ["history", "Browser history"],
  ["multi-tab", "Multi-tab flow"],
];

/**
 * Integration point for the lifecycle/comparison family. The host loads
 * comparisonRuns once and controls which alternative is selected; all
 * comparisons then reuse that same selected run.
 */
export function FlowLifecycleHub({
  data,
  comparisonRuns = [],
  availableRuns = [],
  repeatabilityRuns = [],
  repeatabilityRunIds = [],
  onRepeatabilityRunsChange,
  selectedComparisonId,
  onComparisonChange,
  onSelect,
  onSelectComparison,
  onRefresh,
  autoRefreshPulse = false,
  initialSubview = "compare",
}: FlowLifecycleHubProps) {
  const [subview, setSubview] = useState<LifecycleSubview>(initialSubview);
  const selectedRun = selectedComparisonId
    ? comparisonRuns.find((run) => run.run.id === selectedComparisonId)
    : comparisonRuns.find((run) => run.run.id !== data.run.id);
  const choiceIndex = availableRuns.length
    ? availableRuns
    : comparisonRuns.map((run) => run.run);
  const choices = choiceIndex.filter((run) => run.id !== data.run.id);
  const compatibleRuns = availableRuns
    .filter(
      (run) => run.id !== data.run.id && run.projectId === data.run.projectId,
    )
    .filter(
      (run) =>
        (run.config.roleLabel || "") === (data.run.config.roleLabel || "") &&
        (run.config.localeLabel || "") === (data.run.config.localeLabel || ""),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 4);
  const history = [
    data,
    ...repeatabilityRuns.filter((run) => run.run.id !== data.run.id),
  ];
  const [earlier, later] =
    selectedRun &&
    Date.parse(selectedRun.run.createdAt) <= Date.parse(data.run.createdAt)
      ? [selectedRun, data]
      : [data, selectedRun];
  const hasPair = Boolean(earlier && later);

  return (
    <div className="flv-hub">
      <div className="flv-hub-bar">
        <label>
          View
          <select
            value={subview}
            onChange={(event) =>
              setSubview(event.target.value as LifecycleSubview)
            }
            aria-label="Lifecycle view"
          >
            {lifecycleLabels.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            "compare",
            "impact",
            "snapshot",
            "performance",
            "repeatability",
            "responsive",
            "role",
            "locale",
          ] as LifecycleSubview[]
        ).includes(subview) &&
          choices.length > 0 && (
            <label>
              Compare with
              <select
                value={selectedComparisonId || selectedRun?.run.id || ""}
                onChange={(event) => onComparisonChange?.(event.target.value)}
                aria-label="Choose comparison discovery"
              >
                <option value="">Choose a discovery</option>
                {choices.map((run) => (
                  <option value={run.id} key={run.id}>
                    {run.name}
                  </option>
                ))}
              </select>
            </label>
          )}
      </div>
      {subview === "compare" &&
        (hasPair ? (
          <DiscoveryComparisonView
            earlier={earlier!}
            later={later!}
            onSelect={(side, selection) => {
              const selectedData = side === "earlier" ? earlier! : later!;
              if (selectedData.run.id === data.run.id) onSelect(selection);
              else onSelectComparison?.(selectedData.run.id, selection);
            }}
          />
        ) : (
          <Prerequisite
            title="Run comparison"
            detail={
              choices.length
                ? "Choose another discovery. The host must load its RunData before comparison can render."
                : "Load another discovery for this project to compare routes, screens, and action outcomes."
            }
          />
        ))}
      {subview === "impact" &&
        (hasPair ? (
          <ChangeImpactView
            earlier={earlier!}
            later={later!}
            onSelect={(side, selection) => onSelect(selection)}
          />
        ) : (
          <Prerequisite
            title="Change impact"
            detail="Load a second discovery to compare observed route, component, and endpoint differences."
          />
        ))}
      {subview === "snapshot" &&
        (hasPair ? (
          <ScreenSnapshotDiffView earlier={earlier!} later={later!} />
        ) : (
          <Prerequisite
            title="Screen snapshot comparison"
            detail="Load a second discovery with captured screens. The view compares screenshots and recorded interface details side by side."
          />
        ))}
      {subview === "performance" &&
        (hasPair ? (
          <PerformanceRegressionView earlier={earlier!} later={later!} />
        ) : (
          <Prerequisite
            title="Performance comparison"
            detail="Load a second discovery with matching action or API records that include durations."
          />
        ))}
      {subview === "repeatability" && (
        <RepeatabilityView
          runs={history}
          candidates={compatibleRuns}
          selectedRunIds={repeatabilityRunIds}
          onSelectionChange={onRepeatabilityRunsChange}
        />
      )}
      {subview === "responsive" && <ResponsiveComparisonView runs={history} />}
      {subview === "freshness" && (
        <EvidenceFreshnessView data={data} onSelect={onSelect} />
      )}
      {subview === "annotations" && (
        <AnnotatedFlowNotes data={data} onSelect={onSelect} />
      )}
      {subview === "authentication" && (
        <AuthenticationSessionView data={data} onSelect={onSelect} />
      )}
      {subview === "live" && (
        <LiveExplorationPulse
          data={data}
          onRefresh={onRefresh}
          autoRefresh={autoRefreshPulse}
        />
      )}
      {subview === "workers" && (
        <WorkerSwimlanes
          data={data}
          states={data.states}
          actions={data.actions}
          onSelect={onSelect}
        />
      )}
      {subview === "frontier" && (
        <FrontierQueueMap
          data={data}
          states={data.states}
          actions={data.actions}
          onSelect={onSelect}
        />
      )}
      {subview === "recurrence" && (
        <StateRecurrenceView data={data} onSelect={onSelect} />
      )}
      {subview === "consistency" && <CrossRouteConsistencyView data={data} />}
      {subview === "requests" && (
        <RequestLifecycleTraceView data={data} onSelect={onSelect} />
      )}
      {subview === "side-effects" && (
        <BrowserSideEffectView data={data} onSelect={onSelect} />
      )}
      {subview === "journey-time" && (
        <JourneyPerformancePath data={data} onSelect={onSelect} />
      )}
      {subview === "provenance" && (
        <NavigationProvenanceView data={data} onSelect={onSelect} />
      )}
      {subview === "role" && (
        <RoleJourneyComparisonView
          data={data}
          comparisonRuns={comparisonRuns}
        />
      )}
      {subview === "locale" && (
        <LocaleCoverageView data={data} comparisonRuns={comparisonRuns} />
      )}
      {subview === "session" && (
        <SessionPersistenceView data={data} onSelect={onSelect} />
      )}
      {subview === "history" && (
        <BrowserHistoryView data={data} onSelect={onSelect} />
      )}
      {subview === "multi-tab" && (
        <MultiTabFlowView data={data} onSelect={onSelect} />
      )}
    </div>
  );
}
