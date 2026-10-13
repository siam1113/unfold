# Unfold domain

This glossary defines the product language shared by the discovery engine, dashboard, API, storage, and project assistant.

## Workspace

**Project**:
A scoped workspace for one target application origin. It owns the application URL, discovery settings, discovery history, MCP context, and project assistant instructions.
_Avoid_: Workspace (when referring to the durable domain object), app (ambiguous between Unfold and the target application)

**Discovery**:
A saved exploration of a project's target application. In code and API payloads, a discovery is represented as a `Run`.
_Avoid_: Scan (except when describing the CLI command or scan configuration), session

**Global settings**:
User-level preferences and default discovery controls that apply across projects when a new discovery is created.
_Avoid_: Project settings (when referring to user preferences)

## Observed application

**State**:
A distinct observed interface condition, identified using the URL and visible structure and content. A state can be a page, an open dialog, a selected tab, or another meaningful UI condition.
_Avoid_: Page (when the distinction matters; a page can have many states)

**Route**:
A normalized URL location associated with one or more observed states.
_Avoid_: State (a route can have several states)

**Action**:
A recorded attempt to interact with a control in a source state. It includes the policy decision, result, effects, and linked evidence.
_Avoid_: Transition (the action may be skipped or fail and may have no destination)

**Transition**:
An observed relationship from a source state to a destination state caused by an action. A flow arrow represents this source-to-destination relationship.
_Avoid_: Action (a transition is the resulting graph edge, not just the attempted input)

**Evidence**:
Stored observations that support a claim about the target application, such as screenshots, state inventories, action records, browser events, or API calls.
_Avoid_: Inference (an inferred similarity or interpretation must be labeled separately)

**Component**:
A semantic or structural region detected in an observed state, with its associated controls and classification evidence.
_Avoid_: Business component (the discovery engine does not establish business intent)

**Verified locator**:
A locator candidate that resolved uniquely after the engine restored the state in a real browser context.
_Avoid_: Suggested selector (when it has passed replay verification)

## Execution and assistance

**Policy decision**:
The recorded allow-or-skip result for a proposed browser action under the discovery configuration.
_Avoid_: User intent (policy uses conservative rules and does not claim to know intent)

**Restore recipe**:
The seed URL and replay steps used to return a worker to an observed state before another action is attempted.
_Avoid_: Browser session (recipes describe reproducible steps, not a persistent tab)

**Project assistant**:
The chat experience that can query one project's MCP evidence and request a new discovery. Its conversation sessions are separated by project in browser storage.
_Avoid_: Agent runtime (the server-side model/tool loop and the product UI are different parts)

**MCP connection**:
A project-scoped Model Context Protocol endpoint exposing that project's discovery evidence and allowed project actions.
_Avoid_: Global MCP server (connections are scoped to a project)
