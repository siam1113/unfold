import type {
  AppState,
  ActionEdge,
  RunData,
} from "../packages/shared/src/index.js";
import baseline from "../tests/baseline.json" with { type: "json" };
// This is a fixture-specific contract, independent of engine fingerprint and classification code.
export function fixtureStateKey(state: AppState) {
  const flags: string[] = [];
  const regions = state.visibleRegionSummary;
  const expanded = (name: string) =>
    state.structureTokens.some((t) =>
      t.startsWith(`button:${name}:expanded=true:`),
    );
  if (regions.some((r) => r.startsWith("menu:"))) flags.push("menu");
  if (regions.some((r) => r.startsWith("dialog:"))) flags.push("dialog");
  if (regions.some((r) => r.startsWith("drawer:"))) flags.push("drawer");
  if (regions.includes("tab:Active projects")) flags.push("active");
  if (regions.includes("tab:Archived projects")) flags.push("archived");
  if (regions.includes("form:Project filters")) flags.push("filters");
  for (const [name, flag] of [
    ["Show earlier activity", "earlier"],
    ["Appearance preferences", "appearance"],
    ["Notification preferences", "notifications"],
    ["How do projects work?", "projects-help"],
    ["Where can I find activity?", "activity-help"],
  ])
    if (expanded(name)) flags.push(flag);
  return `${new URL(state.url).pathname}|${flags.sort().join(",") || "base"}`;
}
const routes: Record<string, string> = {
  Overview: "/",
  Projects: "/projects",
  Activity: "/activity",
  Settings: "/settings",
  Help: "/help",
  "Explore projects": "/projects",
  "View activity": "/activity",
  "View settings": "/settings",
  Preferences: "/settings",
  "Support center": "/help",
  "Explore activity": "/activity",
};
export function expectedEffects(edge: ActionEdge, before: AppState): string[] {
  const route = new URL(before.url).pathname;
  const key = fixtureStateKey(before).split("|")[1];
  const name = edge.targetName;
  if (routes[name]) {
    if (route !== routes[name]) return ["navigate_same_tab", "change_content"];
    return [
      key === (route === "/projects" ? "active" : "base")
        ? "no_observed_change"
        : "change_content",
    ];
  }
  if (name === "Open help in a new tab")
    return ["open_new_tab", "change_content"];
  if (name === "Download sample report") return ["download"];
  if (name === "Workspace details") return ["open_modal", "change_content"];
  if (name === "Close details" || name === "Close insights")
    return ["change_content"];
  if (name === "Workspace menu")
    return key.includes("menu")
      ? ["change_content"]
      : ["open_menu", "expand_region", "change_content"];
  if (name === "View insights")
    return key.includes("drawer")
      ? ["change_content"]
      : ["open_drawer", "expand_region", "change_content"];
  if (name === "Active projects")
    return key.includes("active")
      ? ["no_observed_change"]
      : ["switch_tab", "change_content"];
  if (name === "Archived projects")
    return key.includes("archived")
      ? ["no_observed_change"]
      : ["switch_tab", "change_content"];
  if (name === "Show filters")
    return key.includes("filters")
      ? ["change_content"]
      : ["reveal_form", "expand_region", "change_content"];
  const disclosures: Record<string, string> = {
    "Show earlier activity": "earlier",
    "Appearance preferences": "appearance",
    "Notification preferences": "notifications",
    "How do projects work?": "projects-help",
    "Where can I find activity?": "activity-help",
  };
  if (disclosures[name])
    return key.includes(disclosures[name])
      ? [
          name === "Show earlier activity"
            ? "no_observed_change"
            : "change_content",
        ]
      : ["expand_region", "change_content"];
  throw new Error(`Unspecified fixture action: ${name}`);
}
export function evaluateFixture(data: RunData) {
  const keys = data.states.map(fixtureStateKey);
  const expected = new Set(baseline.expectedStates);
  const found = baseline.expectedStates.filter((key) => keys.includes(key));
  const actions = data.actions.filter((a) => a.decision === "executed");
  const mismatches = actions.flatMap((edge) => {
    const before = data.states.find((s) => s.id === edge.fromStateId)!;
    const expected = expectedEffects(edge, before).sort();
    const actual = [...edge.effectFlags].sort();
    return JSON.stringify(expected) === JSON.stringify(actual)
      ? []
      : [
          {
            actionId: edge.id,
            from: fixtureStateKey(before),
            target: edge.targetName,
            expected,
            actual,
          },
        ];
  });
  return {
    expectedStateCount: expected.size,
    foundExpectedStates: found,
    stateRecall: found.length / expected.size,
    missingStates: [...expected].filter((k) => !keys.includes(k)),
    unexpectedStates: keys.filter((k) => !expected.has(k)),
    equivalentStateDuplicationRate: 1 - new Set(keys).size / keys.length,
    classifiedActions: actions.length,
    classificationAccuracy: actions.length
      ? 1 - mismatches.length / actions.length
      : 0,
    mismatches,
  };
}
