# Setup guide

This guide gets the dashboard, API, fixture, assistant, and CLI ready for local development. The root [README](../README.md) has the short command list; [Auth0 setup](auth0-setup.md) has the provider-specific application fields.

## Prerequisites

- Node.js `22.13` or newer and npm.
- Git and a terminal.
- Chromium and its system dependencies, installed by Playwright for local development.
- Docker and Docker Compose only if you want to run the containerized stack.
- An Auth0 Regular Web Application for the authenticated dashboard.
- An OpenAI-compatible API key only if you want to use the in-app Assistant.

## 1. Install and start the app

From the repository root:

```bash
npm ci
npx playwright install chromium
npm run dev
```

The development script compiles the Node engine and starts:

| Service       | Address                 | Purpose                                          |
| ------------- | ----------------------- | ------------------------------------------------ |
| Dashboard     | `http://127.0.0.1:5173` | Vite development server                          |
| API           | `http://127.0.0.1:4310` | Projects, discoveries, assistant, MCP, artifacts |
| Atlas fixture | `http://127.0.0.1:4174` | Controlled application for discovery             |

Vite proxies dashboard API requests to port `4310`. The API checks Auth0 configuration before allowing authenticated project routes, so set up Auth0 before expecting the Dashboard to work end to end.

## 2. Configure Auth0 for the dashboard

Create an Auth0 **Regular Web Application**. Follow [Auth0 setup](auth0-setup.md) for the exact callback, logout, and web-origin values. For local development, set:

```dotenv
AUTH0_DOMAIN=your-tenant.example.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_SECRET=replace-with-a-private-random-value-at-least-32-characters
APP_BASE_URL=http://127.0.0.1:4310
```

Save this as `.env.local` in the repository root. Do not commit real credentials. The local server and Docker Compose load `.env` and `.env.local`. Restart the server after changing environment values.

After restart, open the dashboard and sign in. The Auth0 account subject owns the projects created through the dashboard.

## 3. Create a project and run a discovery

Create a project for a target application, set its base URL and allowed origins, then create a discovery from the project. Start with small limits against a safe test app. The base URL origin is allowed automatically; add other exact resource origins explicitly.

For a repeatable live run against Atlas, keep `npm run dev` running and use another terminal:

```bash
npm run demo
```

The demo performs live browser work and writes results to the local database and artifact directory. It does not load fixture evidence from a static result file.

## 4. Configure the project Assistant (optional)

Add the server-side model settings to `.env.local`:

```dotenv
OPENAI_API_KEY=your-server-side-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

The key is read by the Node server and is not sent to the dashboard. The Assistant offers the supported model choices returned by the server. It uses the selected project's MCP tools; chat requests that do not start a discovery do not launch a browser run.

## 5. Use the CLI (optional)

The default `scan.config.json` targets the local Atlas fixture. Edit a copy to point to your authorized target. Then:

```bash
npm run appscan -- run --config scan.config.json
npm run appscan -- list
npm run appscan -- export --run <run-id>
```

To capture an authenticated target session, set `authStatePath` in the scan config or use the default `.local/auth-state.json`:

```bash
npm run appscan -- auth --config scan.config.json
npm run appscan -- run --config scan.config.json
```

Sign in in the opened Chromium window and press Enter in the terminal. The state file has restrictive file permissions and should remain private. CLI commands use the local Unfold database directly; they do not sign in through the Dashboard's Auth0 session.

The CLI can expose one project's MCP tools to a local MCP client:

```bash
npm run appscan -- mcp --project <project-id>
```

## 6. Run with Docker

For a containerized local setup:

```bash
docker compose up --build -d
docker compose exec -d unfold npm run fixture
docker compose exec unfold npm run demo
```

Compose binds ports `4310` and `4174` to localhost and mounts `.local`, `artifacts`, and `docs`. The container uses `HOST=0.0.0.0` internally. Inside Docker, `localhost` refers to the container; use `http://host.docker.internal:<port>` to reach a host-run target app and allow any additional resource origins in the scan configuration.

The same SQLite database must not be written by a host process and a container at the same time. Pick one runtime for all writes.

## Local data locations

- `.local/unfold.sqlite` — projects, runs, graph evidence, frontier, settings, and Auth0 session records.
- `.local/auth-state.json` — optional target-app browser storage state for CLI discoveries.
- `artifacts/<discovery-id>/` — screenshots, traces, JSON exports, generated helpers, and report.
- `.local/benchmark/` and `.local/ui-check/` — local benchmark outputs and UI-check screenshots.

`.local/`, `artifacts/`, database files, environment files, and browser auth state are ignored by Git. Back up local data before deleting these directories.

## Common setup problems

| Symptom                                | Check                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/api` returns `auth0_not_configured`  | Add all required Auth0 values, ensure `AUTH0_SECRET` has at least 32 characters, and restart the server.                          |
| Auth0 callback fails                   | Match `APP_BASE_URL` exactly and add its `/auth/callback` URL to Auth0's Allowed Callback URLs.                                   |
| Host/origin rejected                   | Use `APP_BASE_URL` for the canonical origin; for additional domains, configure `APP_ALLOWED_ORIGINS` and `APP_ALLOWED_HOSTS`.       |
| Chromium executable missing            | Run `npx playwright install chromium`; in a container use the provided Dockerfile which installs the browser and OS dependencies. |
| Target page fails from Docker          | Use `host.docker.internal` for a host-run app; confirm the target and its APIs are in `allowedOrigins`.                           |
| Assistant reports model not configured | Set `OPENAI_API_KEY` in the server environment and restart.                                                                       |
| Assistant cannot start discovery       | Check that the project is not archived and that the target URL remains inside the project's configured origin and policy.         |

For safety defaults, budgets, and the full configuration schema, see the [root README](../README.md#configuration). For production-like hosting, see the [free deployment plan](deployment-free.md).
