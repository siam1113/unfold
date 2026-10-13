# Architecture and implementation decisions

## Live evidence pipeline

1. A validated configuration creates a durable run and seed tasks.
2. Workers lease the shallowest available tasks, with route discovery before interaction probes.
3. Every task receives a fresh Chromium context and optional cloned storage state.
4. Interaction tasks replay the shortest stored recipe and check the exact fingerprint at every step and before the final action.
5. The worker resolves a unique, visible, enabled target, applies policy again, performs a real Playwright interaction, waits for a bounded quiet DOM window, and captures the result.
6. A SQLite transaction inserts the observed state, element/component inventories, edge, queue expansion, and task completion together.
7. Exports include only controls actually verified after restoring a state. Failure and policy records stay visible.

State identity includes normalized URL, visible semantic regions, selected/expanded controls, disabled state, and normalized main content. Exact hashes are checked first. The similarity fallback requires identical URL and control inventories plus >98.5% stable-text token similarity. This favors preserving distinct states over aggressive merging. Hash collisions are not expected at the truncated SHA-256 length used here.

Context isolation prevents workers from editing each other's DOM. It does not isolate a shared database or test account. Any configured network writes reduce effective execution to a single worker. Origin navigation is paced using the configured interval and robots crawl delay. Browser CPU/RSS samples, rising failures, and observed 429/5xx responses reduce concurrency. Crossing the memory budget stops new leases and preserves the frontier. Browser resource samples and request/error counters are exported in run metadata.

## Durability and budgets

Queue keys are unique by run, state fingerprint, element signature, and action. Routes have separate unique keys. Task attempts are persisted when leased and retries reuse the task identity. In-progress leases return to the pending frontier on recovery. A coordinator lease/heartbeat and process check prevent simultaneous ownership under normal local operation.

The action budget counts attempted interaction tasks, including retries; policy skips do not consume browser attempts. The state budget limits committed nodes. At a state limit, an already executing action can produce an observation that cannot be committed; that task is retained for a later resume. Time budgets stop new leasing; active tasks drain under finite action/task deadlines. Depth-limited states remain visible even when their outgoing controls have not been activated.

## Evidence and automation

Locator candidates use exact role/name, label, test ID, placeholder, semantic-container scope, and structural CSS fallbacks. Uniqueness is checked at discovery. Replay verification is a separate operation, recorded for all controls in the restored state. Ambiguous or hidden candidates retain failure history.

Components use semantic landmarks, roles, forms, dialogs, tables, articles, explicit data-component boundaries, and containment. Repeated sibling shapes with three or more visible instances, meaningful descendants, and layout boundaries are also detected; their deterministic family IDs connect matching structures across states. These are evidence-based structural families, not inferred business components. Generated page classes represent individual UI states and include restore recipes. Component classes expose verified roots and verified element getters. Generated action helpers reproduce observed clicks; callers supply business assertions and any synthetic values.

Failure traces deliberately omit network exchanges and DOM snapshots, which reduces trace-viewer detail but avoids exporting authentication headers and resource payloads. Structured action JSON and masked before/after screenshots provide the primary evidence.

## UI design

The graph is the main working surface. A route index narrows scope; a state/action inspector provides detail without leaving the discovery. Discovery paths are shown by default, with all transitions available as an explicit view. Route columns and readable initial zoom avoid shrinking the whole graph into an unreadable thumbnail. Large catalogs use search and pagination; graph nodes are culled outside the viewport. The inspector can scroll independently and expand to full screen.

The current visual tokens live in `apps/dashboard/src/styles.css`: IBM Plex Sans for interface copy, Space Grotesk for headings, slate ink, a light canvas and surface system, teal action color, and configurable theme, palette, and font settings. The top navigation centers Dashboard; project selection and creation are adjacent, while project tools open from the project header. Keep chrome quiet, use progressive disclosure for dense evidence, and preserve keyboard focus and reduced-motion behavior. See the [platform guide](platform-guide.md) for interaction patterns and design intent.

## Known limits and remaining evaluation

- Controlled Atlas and authenticated hardening fixtures cover known scenarios; real-app coverage depends on evaluation against an authorized target.
- This is a single-host Chromium engine. Distributed execution, native apps, other browsers, and backend account/tenant provisioning are outside v1.
- Discovery is bounded and heuristic. It does not establish exhaustive coverage or intended business behavior. Arbitrary custom controls, shadow-root semantics, iframe interiors, drag/drop, canvas UI, virtualized lists, and multi-step credentials may require explicit extensions.
- Route candidates come from supplied seeds and observed links/interactions. Optional automatic sitemap ingestion is not implemented. Robots groups, allow/disallow patterns, redirects restricted to approved origins, fail-closed server errors, and crawl delay are handled automatically. The bootstrap robots metadata fetch is independent of page URL substring filters.
- Component families use deterministic repeated DOM shapes. Visual/learned similarity and optional LLM naming are not implemented.
- Resource control is sampled once per second and tested on macOS/Linux. CPU uses Chromium process counters; RSS sums Chromium process resident memory and may double-count shared pages. Short-lived processes that disappear between samples can be missed, so CPU totals are a sampled lower bound and peaks can miss brief spikes. These are not OS-enforced memory limits. Windows resource collection is not validated.
- Form fill/select exploration uses explicitly supplied values. Combined fills can expand through replay, but dependent forms can exhaust depth/action budgets before submission. Submitted values never become generated source literals.
- Fingerprint normalization removes common volatile tokens, not every application-specific live update. Replay failures are recorded rather than silently accepted.
- The API returns complete snapshots to the dashboard. The UI paginates catalogs and culls graph nodes; very large multi-gigabyte discovery datasets would need server-side pagination and incremental streaming.
- Auth storage state does not capture sessionStorage. Authentication expires according to the target app; re-run interactive auth when needed.
- Generated helpers type-check and use replay-verified controls, but do not assert business correctness. They depend on the target retaining the observed structure and data.
