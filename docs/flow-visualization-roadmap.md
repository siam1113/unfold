# Flow visualization plan: 70 views and lenses

This is the authoritative catalog supplied by the user. It describes discovery
evidence: observed routes, screens, controls, actions, outcomes, requests, and
artifacts. It does not describe real-user traffic, usage frequency, or
popularity unless analytics are added separately. “Not observed” means the
capture has no evidence; it does not mean the behavior or feature does not
exist.

The 70 ideas are a catalog, not a requirement for 70 permanent top-level tabs.
Related views should be grouped into navigable families so the explorer stays
usable. Status below is the current implementation audit: **Ready** means the
existing dashboard directly supports the core view; **Partial** means a
related view exists but misses part of the requested scope; **Planned** means
the dedicated view is not yet implemented; **Capture-dependent** means the
current data model needs additional observations before a truthful view is
possible. Statuses will be revised as implementation proceeds.

## Catalog and implementation audit

| # | View | Purpose | Status / current evidence |
|---:|---|---|---|
| 1 | Route Map | Show routes as connected groups, with arrows for observed navigation and expandable screen states. | Ready — Routes groups observed screens, labels navigation, and expands each route into selectable screen states. |
| 2 | Semantic zoom | Extend the map so zooming out shows route groups, and zooming in reveals screens and actions. | Ready — Route analysis has route-summary and screen-detail zoom modes. |
| 3 | Route hierarchy | Show URL paths as a tree, with observed links between branches. | Ready — Route analysis nests URL path segments and overlays observed successful links between route branches. |
| 4 | Journey lanes | Follow an entry screen through observed actions and resulting states, including branches. | Ready — Journey follows first-discovery branches; Replay Storyboard adds screenshots and linked evidence along a selected path. |
| 5 | UI + API swimlane | Align each screen action with the API calls observed during it. | Ready — UI + API aligns actions with calls carrying the same recorded action ID. |
| 6 | Component reuse map | Show shared interface components and the screens where they appear. | Ready — Components view groups component families across screens. |
| 7 | Coverage map | Mark observed states and controls by recorded outcome: completed, failed, skipped, or with no action recorded. | Ready — Coverage Map distinguishes executed, failed, skipped, and no-action-recorded evidence. |
| 8 | Route matrix | Compare routes in a grid to see which observed transitions connect them. | Ready — Matrix counts observed route transitions. |
| 9 | Replay timeline | Show one journey in time order with screenshots, actions, outcomes, and evidence. | Ready — Replay Storyboard follows a captured first-discovery path with screenshots, outcomes, requests, and evidence. |
| 10 | Dead ends and loops | Highlight screens with no recorded outgoing actions, plus transitions that loop back to an earlier state. | Ready — Route analysis marks observation-scoped terminal screens and recorded loops. |
| 11 | Discovery comparison | Compare two discovery runs to see which routes, screens, actions, or outcomes changed. | Ready — Compare shows added/removed routes and screen fingerprints plus action-signature and outcome deltas, with run-setup caveats. |
| 12 | Form flow | Trace fields through entry, validation, submission, and the resulting screen or API calls. | Partial — Browser snapshots record form/field counts and native invalidity reasons around actions; field controls, submit outcomes, routes, and APIs link where captured. Custom validation and business success remain app-specific. |
| 13 | Failure and policy view | Focus on actions that failed or were skipped, where they happened, and what they affected. | Ready — Failures and Policy views distinguish execution errors from policy skips. |
| 14 | Service dependency map | Group observed API calls by host or service and connect them to the routes and actions that triggered them. | Ready — Services groups captured hosts and connects recorded routes/actions. |
| 15 | UI state machine | Focus on within-page changes such as dialogs, menus, tabs, and drawers, including how users open and close them. | Ready — Workflow Quality compares captured control and dialog/menu/tab cues between action source and destination states; unavailable snapshots remain unknown. |
| 16 | Route complexity map | Compare routes by observed screens, branches, and exploration depth to find the most complex areas. | Ready — Route analysis compares routes by captured screens, branching, and exploration depth. |
| 17 | Entry and exit map | Show where discovery starts, where journeys end, and which actions navigate outside the platform. | Ready — entry/terminal states, blocked destinations, cross-origin document navigation, and outside-origin browser request events link to observed actions and source routes. |
| 18 | Outcome heatmap | Summarize completed, failed, and skipped actions by route and interaction type. | Ready — Execution Analysis provides a route × interaction-type heatmap for executed, failed, and policy-skipped actions. |
| 19 | Evidence storyboard | Arrange screenshots in observed transition order, with the action and evidence attached to each step. | Ready — Replay Storyboard places available screenshots and evidence in first-discovery transition order. |
| 20 | Shared-control impact map | Show what happens after using a shared control, such as the main navigation, across different routes. | Ready — Workflow Quality groups matching controls across screens and shows recorded outcomes and destinations. |
| 21 | Reachability map | Trace states back to a starting route and flag states with no observed incoming path. | Ready — Route analysis traces successful state-linked transitions from each observed start and marks states without a captured path. |
| 22 | Validation and recovery flows | Show invalid submissions, error states, corrections, retries, and successful outcomes. | Partial — native invalidity reasons and local status-region cues are captured with retries/corrections; custom validation rules and business checkpoints remain unknown. Status text is classified in-page and not stored. |
| 23 | API health and timing map | Connect actions to API status codes, failures, and response times. | Ready — API Health groups captured host/path/source route/status and failure counts with duration buckets, median, p95, and available network phases. |
| 24 | URL and redirect map | Show route variants, redirects, and navigation to external destinations. | Ready — Chromium redirect responses are grouped by status and origin, with action before/after routes and external navigation evidence. Redirect paths and query values are omitted from browser evidence. |
| 25 | Accessibility semantics view | Inspect captured control roles and names, and flag missing or ambiguous labels where the data allows. | Ready — Workflow Quality inventories captured role/name/state, flags missing semantics, and groups same-screen duplicate names as potentially ambiguous. |
| 26 | Authentication and session flow | Map sign-in, sign-out, protected routes, and session states when discovery captures them. | Partial — value-free password/identifier and sign-in/out control counts link with routes, 401/403 responses, and storage-count changes. These cues do not establish identity or successful authentication. |
| 27 | Responsive comparison | Compare screens and flows across viewport sizes; this requires discoveries at multiple sizes. | Ready — compares screenshots, control geometry, and action outcomes/destinations across exact-route and fingerprint-matched states; action rows align by action type and captured control label. |
| 28 | Policy impact map | Connect policy rules and skip reasons to the controls and routes they affect. | Ready — Execution Analysis links recorded policy decisions with routes, controls, rule names, and skip reasons. |
| 29 | Change impact map | Compare discoveries and highlight which routes, components, APIs, and journeys may be affected by changes. | Ready — compares routes, component families, endpoints, action signatures, and bounded contiguous action paths between discoveries. Missing evidence can reflect exploration coverage. |
| 30 | UI lifecycle map | Track loading, empty, success, and error states around an interaction. | Partial — action-window snapshots add busy/alert/status/empty cues, invalidity reasons, and locally classified success/error wording; semantic meaning remains heuristic and transient states can be missed. |
| 31 | Route variant map | Compare dynamic URL variants, such as different record IDs or query parameters, and show how their states differ. | Ready — groups ID-like path segments and query parameter profiles by safe coarse value shape (numeric, UUID-like, date-like, and text length); raw query values are never shown or used as match keys. |
| 32 | Automation readiness map | Show which controls have usable locators and replay steps, and where automation evidence is missing. | Ready — Workflow Quality summarizes locator candidates, replay steps, and verification. |
| 33 | Control inventory | List buttons, fields, links, and menus by screen, with their captured names and observed actions. | Ready — Controls view inventories observed elements and actions. |
| 34 | Evidence lineage | Trace how a state was reached, including its triggering action, screenshot, replay recipe, and discovery time. | Ready — Journey, Replay Storyboard, and Evidence expose captured transition, screenshot, restore recipe, and observation-time links where available. |
| 35 | Confidence map | Highlight lower-confidence state, action, or component observations for review. | Partial — evidence completeness now includes browser action snapshots alongside screenshots, controls, components, and replay steps; it remains a completeness checklist, not a calibrated confidence probability. |
| 36 | Branch comparison | Compare the different actions and outcomes available from the same screen. | Ready — Route analysis compares outgoing branches and their recorded outcomes. |
| 37 | Screen snapshot diff | Compare screenshots and captured interface details for the same route across discoveries. | Ready — snapshot comparison includes an opt-in pixel diff with threshold, changed-pixel ratio, and overlay controls, plus captured metadata differences. |
| 38 | Journey performance path | Show where time is spent across actions and their API calls. | Ready — action/API durations and available browser navigation, DOMContentLoaded, load, and paint timings are aligned; absent metrics remain unknown. |
| 39 | Origin boundary map | Show movement between the app, its API services, and external sites. | Ready — route-level API services, browser-observed request origins, redirect origins, and blocked/external navigation are linked to triggering actions. Paths and request payloads are omitted from the browser-origin events. |
| 40 | Crawl health map | Show how exploration progressed by depth, including which areas were reached or left unexplored. | Partial — Frontier shows per-depth task outcomes, observed states/actions, and worker spread. Routes outside the discovered frontier cannot be known from browser evidence alone. |
| 41 | Live exploration pulse | During a running discovery, show which screens workers are exploring and where they are heading next. | Ready — the pulse refreshes the active run every five seconds and shows leases, pending work, workers, and recent events. |
| 42 | Worker activity map | Show how exploration branches were distributed across workers and where each branch ended. | Ready — worker lanes show linked action paths, destination/outcome records, and assigned task status totals; task-to-action causality is not claimed. |
| 43 | State recurrence map | Highlight screens that discovery repeatedly encountered or recognized as the same state. | Ready — lifecycle recurrence groups repeated fingerprints and state references. |
| 44 | Evidence completeness map | Show which screens have screenshots, replay steps, controls, components, and API observations. | Ready — Workflow Quality compares available evidence types per screen. |
| 45 | Control-to-effect map | Start from a button or field and trace the UI states and API calls it affects. | Ready — Execution Analysis follows controls through their recorded actions, state transitions, effect signals, and linked calls. |
| 46 | Test scenario map | Turn observed paths into candidate test scenarios and show which steps have enough evidence to replay. | Ready — Workflow Quality builds candidate scenarios from observed paths and lists per-step locator, restore, action, and outcome evidence; candidates are not runnable tests. |
| 47 | Annotated flow map | Let teams attach notes, owners, or review status to routes and transitions. This would need manual metadata. | Ready — notes, owners, and statuses are stored per run in the browser and can be exchanged by validated JSON import/export; collaboration is manual. |
| 48 | Role-based journey comparison | Compare what different user roles can reach or do. Requires discoveries captured for each role. | Ready — compatible discoveries can be compared by user-supplied role labels; labels do not independently verify identity or permissions. |
| 49 | Locale coverage comparison | Compare route and screen coverage across languages. Requires discoveries captured in multiple locales. | Ready — optional locale labels and coverage comparison are implemented for compatible runs; labels and multiple runs are required. |
| 50 | Field-to-API lineage | Connect a form field and its submission action to the resulting API request, without exposing entered values. | Ready — Workflow Quality follows element/action/request IDs and omits request values. |
| 51 | Recovery path map | Show how users get back on track after errors, including retry, correction, and back navigation. | Ready — failed actions link to observed retries/corrections and page History API breadcrumbs; links are inferred where signatures/routes are used, and toolbar use is not attributed. |
| 52 | Browser side-effect map | Track observed downloads, new tabs, permission prompts, and other effects beyond page navigation. This may need extra capture support. | Partial — Chromium tab/download/dialog events and allowlisted permission API attempts/outcomes are captured. Browser permission API use does not guarantee a visible system prompt. |
| 53 | Performance regression view | Compare action and API timings for matching flows across discoveries. | Ready — lifecycle view aligns matching action/request timing records across runs. |
| 54 | Path convergence map | Show where different journeys lead to the same screen, revealing shared destinations. | Ready — Route analysis highlights paths that reach shared state fingerprints. |
| 55 | Navigation provenance map | Distinguish screens reached from a starting URL, an in-app link, an action, or a redirect. | Ready — start routes, renderer navigation reasons, Chromium history/reload events, redirects, popup lineage, and external origins are classified; ambiguous browser “other” events remain labeled unknown. |
| 56 | Route alias map | Group different URLs that appear to resolve to the same observed screen or state. | Ready — exact normalized-path matches and conservative inferred cross-path candidates are grouped using captured title, structure, and control similarity; candidate matches are clearly labeled and do not claim equivalence. |
| 57 | Request lifecycle trace | Align API request start, response, and failure with the screen transition that triggered it. | Ready — request start, response status/failure, browser timing phases, and source/destination states are shown where recorded; unavailable phases remain unknown. |
| 58 | Search and filter behavior map | Show how search terms or filter choices change results and lead to other states. | Ready — links candidate controls and API/state outcomes with before/after visible result-item and empty/status cue counts. Search terms and field values are not stored. |
| 59 | Capture gaps map | Highlight parts of a journey where the discovery lacks a screenshot, action result, or linked API evidence. | Ready — Workflow Quality shows missing screenshot/action/component/request evidence by screen. |
| 60 | Browser history map | Show how Back, Forward, and Reload change the current screen. | Ready — combines page History API calls with Chromium reload/history traversal types and navigation-entry index deltas. Direction is labeled as a candidate when the index changes; physical toolbar input cannot always be proved. |
| 61 | Session persistence map | Show which states survive reloads, navigation, or a new session. | Partial — compares states and value-free storage counts; reload/history actions also verify cookie/local-storage count restoration in a fresh isolated context. Session storage, server sessions, and browser-restart persistence remain unknown. |
| 62 | Multi-tab flow map | Track journeys that open or hand off between browser tabs. | Ready — popup parent/child relationships receive stable logical tab IDs that link states and actions across restored task contexts. IDs model discovery lineage, not continuously open browser processes. |
| 63 | Cross-route consistency view | Compare shared navigation and components across routes to spot differences. | Ready — lifecycle compares component families and shared navigation controls, outcomes, and destinations across routes; uncertain matches are labeled inferred. |
| 64 | Repeatability map | Compare repeated discoveries to see which transitions behave consistently or vary. | Ready — current discovery compares transition coverage and outcomes across up to four recent compatible same-project runs. |
| 65 | Evidence freshness view | Show when each route, state, and action was last observed. | Ready — Workflow Quality and Run Analysis show observation timestamps and freshness. |
| 66 | Path finder | Select a starting screen and destination; highlight an observed path between them. | Ready — Route analysis computes an observed route between selected states. |
| 67 | Route similarity map | Group screens with similar structure or components to reveal duplicate or near-duplicate pages. | Ready — inferred similarity uses structure tokens and captured component families where available. |
| 68 | Task cluster view | Group observed journeys by likely task, such as finding an item or updating settings; label these groupings as inferred. | Partial — task clusters use route, action kind, and value-free form/search/auth/navigation structure. User intent remains inferred and can be ambiguous. |
| 69 | Transition spotlight | Select a control or action and highlight every route and state it connects to. | Ready — selecting an action/control highlights matching observed transitions, their source/destination states, and affected routes; label matching is heuristic. |
| 70 | Flow export | Export a view as an image or as Mermaid/JSON so teams can share or document it. | Ready — filtered JSON, Mermaid, and sanitized route-level SVG exports are available. |

## Shared evidence model and safeguards

- All counts and connections describe recorded discovery evidence only.
- A missing screenshot, control, transition, or API link is shown as missing
  evidence, not proof that the application lacks it.
- Form values, credentials, tokens, and other sensitive input contents must
  never be exposed in these views or exports.
- Similarity, confidence, route aliases, and task clusters must be labeled as
  inferred when they are computed rather than directly captured.
- Views that compare roles, locales, viewport sizes, sessions, or repeated runs
  require explicit metadata and multiple compatible discoveries.
- Existing view families include Canvas, Routes, Journey, Matrix, Timeline,
  Coverage, Actions, Blocks, Text, Components, Controls, Similarity, Outcomes,
  Failures, Policy, Latency, API Map, Request Trace, Workers, Frontier,
  Evidence, and Compare. The 70-item catalog should be delivered through these
  families and focused subviews, not 70 crowded top-level tabs.

## Delivery plan

Implementation is split into parallel, isolated view modules and capture/model
work, followed by one integration pass. The available environment supports at
most four concurrent sessions including the integrator, so additional
workstreams run in successive waves. Each feature will be marked ready only after its actual
UI and evidence prerequisites have been checked.

## Verification

The implementation audit counts 61 Ready and 9 Partial items, with no
remaining Capture-dependent items. The remaining partials require app-specific
validation/auth semantics, measured confidence calibration, routes outside the
observed crawl frontier, visible operating-system permission prompts, or
server/session behavior that cannot be established by value-free browser
storage counts. Browser evidence now stores bounded action-window snapshots,
Chromium navigation/redirect events, origin-only request metadata, logical tab
lineage, and value-free storage restoration counts. `npm run build` passed on
2026-10-13, including project typecheck, worker compilation, and the dashboard
production build. The new view families are lazy-loaded. Vite reports the main
JavaScript bundle at 530 kB, above its 500 kB advisory threshold. The dashboard
and worker assets were copied into the running `unfold-app` container and it
was restarted. The app root returned HTTP 200, and all 130 JavaScript and CSS
assets returned HTTP 200 from inside the container. Existing discovery runs
retain their prior evidence; rerun discovery to populate the new browser
snapshots and event lineage.
