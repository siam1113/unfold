# Unfold

A live application discovery engine with a visual explorer. Unfold opens a real Chromium browser, restores application states, activates permitted controls, records what happened, and turns that evidence into a searchable graph and reusable Playwright code.

**New to Unfold?** Start with the [documentation index](docs/README.md) and [platform guide](docs/platform-guide.md) for the product model, architecture, discovery lifecycle, design intent, and contributor workflow.

## Start locally

Requires Node **22.13+** and npm. SQLite is built into Node; Node 22 may print an experimental SQLite warning.

For Auth0, Assistant, Docker, and CLI setup details, see the [setup guide](docs/setup.md).

```bash
npm ci
npx playwright install chromium
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port **4310**, and the included Atlas fixture on **4174**. Create a project for an application, then start discoveries inside that project. Each project keeps its own discovery history, MCP endpoint, and assistant instructions.

For a complete, repeatable fixture discovery, leave `npm run dev` running and use another terminal:

```bash
npm run demo
```

The demo starts the fixture itself if necessary, performs live interactions, persists the results, and prints the run URL. It does not load invented discovery data.

### Production build

```bash
npm run build
npm start
```

The server serves both the dashboard and API at **http://127.0.0.1:4310**. `npm run fixture` starts Atlas separately if you want to explore it.

### Docker

```bash
docker compose up --build -d
docker compose exec -d unfold npm run fixture
docker compose exec unfold npm run demo
```

Open **http://127.0.0.1:4310**. Both published ports bind to localhost. Inside Docker, `localhost` refers to the container. Use `http://host.docker.internal:<port>` for an app running on the host, and explicitly include any additional resource origins in your scan configuration.

## Projects, MCP, and project assistant

The dashboard is organized around projects. A project owns its application URL and scan settings, all of its discoveries, a project-only MCP server, and editable assistant instructions. Legacy discoveries are associated with projects by application origin during database startup.

Open a project's **MCP** tool to copy its Streamable HTTP endpoint and client configuration. The server exposes project-scoped tools for overview, discovery listing, searching and reading state/component/interaction evidence, comparing discoveries, and starting a discovery. It also exposes a project context resource and a `project-expert` prompt. The HTTP endpoint is stateless and scoped to the project ID.

The **Assistant** opens as a project-scoped full-screen tool; from the flow explorer it opens in a right drawer. It uses the project's MCP tools to inspect evidence and start browser discoveries, and can draft Playwright tests or project prompts in chat. Choose the model in the assistant composer. The live browser view is tied to discovery activity; chat requests alone do not start browser work. Configure the OpenAI-compatible runtime with `OPENAI_API_KEY`; `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`, and `OPENAI_MODEL` defaults to `gpt-4.1-mini` as the initial selection. The assistant only receives this project's MCP tools, and browser execution follows its discovery policy and scan configuration. For external local clients that support MCP over stdio, use:

```bash
npm run appscan -- mcp --project <project-id>
```

The CLI process reads the local Unfold database and serves only that project over stdio. A client can launch it with a command configuration such as `{"command":"npm","args":["run","appscan","--","mcp","--project","<project-id>"]}`.

## Explore the results

- **Flow explorer:** pan, zoom, route selection, discovery paths or all transitions, and filters for effect, outcome, depth, and worker. Nodes are UI states, including overlays and selections. Click a node or transition to inspect evidence.
- **States & routes:** screenshot catalog, search, and pagination. Direct state URLs use `/projects/:projectId/discoveries/:discoveryId/states/:stateId`.
- **Components:** semantic regions, repeated card/row families, nested children, controls, ranked locator alternatives, confidence, and separate discovery/replay verification labels.
- **Interactions:** executed actions, policy skips, failures, observed effects, before/after images, side-effect signals, and replay steps.
- **Artifacts:** code and JSON previews, a ZIP download, a standalone HTML report, and engine activity.
- **Run controls:** create, pause, resume, and extend a depleted budget. Pausing drains active work before recording a checkpoint.

The interface supports small screens, keyboard navigation, search shortcuts, and reduced motion. Graph nodes outside the viewport are not rendered; catalogs are paginated.

## CLI

```bash
npm run appscan -- run --config scan.config.json
npm run appscan -- list
npm run appscan -- pause --run <run-id>
npm run appscan -- resume --run <run-id>
npm run appscan -- resume --run <run-id> --max-actions 1000 --max-states 500 --max-duration-minutes 30
npm run appscan -- export --run <run-id>
```

An active CLI scan also pauses on **Ctrl+C**. Leased tasks are recovered after a process restart; already committed observations and queue keys remain durable.

### Authentication

Set `authStatePath` in a local config, then run:

```bash
npm run appscan -- auth --config scan.config.json
```

Sign in in the opened browser and press Enter in the terminal. The storage state is saved with file permissions `0600`. `.local/` is gitignored. A missing auth file means an unauthenticated scan. Authentication is cloned into independent contexts; `sessionStorage` and cross-account backend isolation are not provided by storage state.

## Configuration

See [scan.config.json](scan.config.json) for a ready-to-run fixture scan and [the schema](packages/shared/src/index.ts) for all validated fields.

```json
{
  "name": "Staging workspace",
  "baseUrl": "http://localhost:3000",
  "seeds": ["http://localhost:3000/"],
  "allowedOrigins": [],
  "concurrency": 4,
  "maxDepth": 6,
  "maxStates": 250,
  "maxActions": 1500,
  "maxDurationMinutes": 15,
  "safeMode": true,
  "actionAllowlist": [],
  "formSubmitAllowlist": [],
  "formValues": [],
  "networkWriteAllowlist": []
}
```

The base URL's origin is automatically allowed. Additional origins must be exact, without a trailing slash or wildcard. Requests, popups, and replay navigation all use the configured origin boundary; unlisted CDNs and APIs are blocked too. Service workers and WebSockets are blocked during discovery.

Unknown controls are skipped in safe mode. Semantic disclosures, tabs, accordions, internal links, and non-committing hover probes can be explored. Keyword-denied controls and form submission need explicit, exact approvals:

```json
{
  "actionAllowlist": [{ "route": "/reports", "name": "Refresh preview" }],
  "formValues": [
    {
      "route": "/projects",
      "label": "Project name",
      "value": "Synthetic project"
    }
  ],
  "formSubmitAllowlist": [{ "route": "/projects", "name": "Apply filters" }]
}
```

These arrays are extra configuration fields, not a complete scan configuration. POST/PUT/PATCH/DELETE requests remain blocked unless an exact URL and method appear in `networkWriteAllowlist`. Runs with such a network write allowlist serialize browser work to reduce shared-backend interference. There is no guarantee that an application's GET requests are free of side effects; use an authorized, disposable test environment.

`dryRun: true` inventories routes and records policy decisions without activating controls. `denyUrlPatterns` and `allowUrlPatterns` use literal URL substrings. Tracking parameters are normalized; sensitive query keys are redacted in exported URLs. Credential-bearing seed URLs are rejected; use saved authentication state.

Robots rules are loaded from `/robots.txt` on each approved origin at run start, using the `Unfold` product token. Disallowed requests are blocked, and `Crawl-delay` increases the navigation interval. Robots network/server failures fail closed; 4xx responses other than 429 mean no published rules. Redirects stay inside approved origins. The robots metadata request is independent of page URL substring filters.

`maxBrowserMemoryMB` (default 4096) and `maxBrowserCpuPercent` (default 800, where 100 is one CPU core) control resource pressure. Worker capacity halves on high CPU, memory, rising failures, or HTTP 429/5xx responses. Reaching the memory threshold stops leasing and drains active tasks; the frontier remains resumable. Measurements are sampled, so this is not an OS-enforced hard memory ceiling.

### Storage and environment

- `.local/unfold.sqlite`: WAL SQLite database, queue, run configuration, states, components, locators, actions, and events.
- `artifacts/<run-id>/`: JSON, screenshots, sanitized failure traces, generated TypeScript, and standalone report.
- `UNFOLD_DATA_DIR`, `UNFOLD_ARTIFACT_DIR`: override storage directories.
- `UNFOLD_BROWSER_EXECUTABLE`: use an existing Chromium binary when the Playwright-managed browser is unavailable.
- `PORT`: API port, default `4310`.
- `HOST`: server listen address, default `127.0.0.1`. The Docker image uses `0.0.0.0` inside the container and publishes only localhost ports.
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, and `AUTH0_SECRET`: enable Auth0 sign-in, sign-up, sessions, and password recovery. Put the values from the Auth0 Regular Web Application in `.env.local`; the local scripts and Docker Compose load that file. `AUTH0_SESSION_SECRET` remains a supported alias for `AUTH0_SECRET`.
- `AUTH0_AUDIENCE`: optional identifier for a custom Auth0 API. Set it when Unfold needs JWT access tokens for that API; regular login sessions only need the validated ID token.
- `AUTH0_CONNECTION`: Auth0 database connection used to send password reset emails; defaults to `Username-Password-Authentication`.
- `APP_BASE_URL`: browser-facing origin used for login callbacks and logout, for example `http://127.0.0.1:4310` locally or your HTTPS application URL in production. `APP_ORIGIN` remains a supported alias. Add `${APP_BASE_URL}/auth/callback` to Auth0's Allowed Callback URLs and `${APP_BASE_URL}` to its Allowed Logout URLs.
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`: configure the OpenAI-compatible runtime used by the in-app project agent. The key is read by the server and never sent to the dashboard.

See [Auth0 setup](docs/auth0-setup.md) for the tenant and database connection settings.

The API checks Host and Origin headers, requires JSON mutations, and scopes projects, discoveries, and generated artifacts to the authenticated Auth0 subject. Passwords are handled by Auth0 Universal Login; the app stores encrypted server-side token sessions and uses an HttpOnly cookie. Keep one host/runtime responsible for a database; do not concurrently write to the same SQLite database from host and container processes.

Screenshots mask inputs, textareas, `[data-private]`, and `[data-sensitive]` by default. Add `redactSelectors` for application-specific sensitive regions. Traces retain action timing but remove network/resource payloads, snapshots, and action parameters. Automatic text redaction is heuristic; inspect artifacts before sharing them.

## Validation

```bash
npm run build
npm run lint
npm test
npm run test:hardening
npm run fixture                 # separate terminal for the next commands
npm run test:integration
npm run demo
npm run check:generated
npm run benchmark
npm start                       # separate terminal for the UI check
npm run test:ui
```

The benchmark compares bounded fixture discoveries at several worker counts and checks route/state coverage, observed effects, locator replay, and unsafe mutations. `BENCHMARK_WORKERS=4 npm run benchmark` runs a shorter CI gate; `FIXTURE_URL` can point it at an already running Atlas fixture. Benchmark data and generated output are stored under `.local/benchmark/`, separate from normal discovery data. The integration check covers pause/resume, process restart, expired leases, duplicate prevention, unsafe actions, form values, and strict action/state budgets. The hardening check covers authenticated context isolation, robots/network restrictions, repeated DOM components, resource limits, retries, and failure evidence. See the [validation guide](docs/validation.md) for the purpose of each check.

## Structure

| Directory            | Responsibility                                                |
| -------------------- | ------------------------------------------------------------- |
| `apps/dashboard`     | React, Vite, React Flow, catalogs and evidence UI             |
| `apps/server`        | Local HTTP API, run controls and artifact serving             |
| `apps/cli`           | Configuration, auth, run, pause, resume and export commands   |
| `apps/fixture`       | Five-route Atlas evaluation application                       |
| `packages/shared`    | Zod contracts and shared types                                |
| `packages/core`      | Coordinator, budgets, policy and work expansion               |
| `packages/worker`    | Isolated Playwright contexts, replay, observations and probes |
| `packages/analysis`  | Fingerprints, conservative similarity, effects and locators   |
| `packages/storage`   | SQLite transactions, durable leases and graph records         |
| `packages/generator` | Verified page/component helpers and export reports            |

For a newcomer-friendly map of the product, architecture, discovery lifecycle, evidence model, design intent, and contribution workflow, start at the [documentation index](docs/README.md) and [platform guide](docs/platform-guide.md). See [architecture and limitations](docs/architecture.md) for implementation choices and remaining scope.
