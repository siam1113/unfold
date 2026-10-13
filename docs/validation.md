# Validation guide

Use the narrowest check that covers the changed layer, then run broader checks when a change crosses package boundaries. Commands are defined in the root `package.json`; this page describes what they cover. Results can vary with the Node version, Chromium build, operating system, and target fixture.

## Build and static checks

- `npm run typecheck` checks TypeScript across the workspace.
- `npm run build:engine` compiles the server, CLI, packages, and scripts into `dist/engine`.
- `npm run build` runs type checking, engine compilation, and the dashboard production build.
- `npm run lint` checks formatting in application code, scripts, tests, JSON configuration, and CI configuration.

## Test layers

- `npm test` runs the Vitest unit tests for policy, normalization, and queue behavior.
- `npm run test:hardening` exercises security and resilience cases, including authenticated context isolation, URL and robots restrictions, retries, resource limits, and evidence sanitization.
- `npm run test:integration` checks run lifecycle and persistence, including pause/resume, process restart, lease recovery, deduplication, policy decisions, form values, and budgets.
- `npm run test:ui` drives the dashboard in Chromium and checks core graph, inspector, component, interaction, configuration-error, and mobile flows. It requires the app to be running with a populated discovery.
- `npm run check:generated` produces and type-checks generated Playwright helpers against the fixture.

## Fixture workflows

`npm run dev` starts the dashboard, API, and Atlas fixture. `npm run demo` performs a live fixture exploration and persists the result. `npm run benchmark` compares bounded fixture runs across worker counts and checks route/state coverage, action effects, replayed locators, and fixture mutations. It starts a dedicated fixture on port 4175 unless `FIXTURE_URL` points to an existing fixture. Set `BENCHMARK_WORKERS=4` for a shorter four-worker run.

Benchmark databases, generated helpers, and the latest raw result are written beneath `.local/benchmark/`. UI-check screenshots are written beneath `.local/ui-check/`. These are local artifacts and are not part of the documentation set.

## Run the full suite

```bash
npm run build
npm run lint
npm test
npm run test:hardening
npm run test:integration
npm run check:generated
npm run benchmark
npm run test:ui
```

Some integration and UI workflows expect the app or fixture to be running separately. Follow the relevant command notes in the [root README](../README.md#validation) before running them.
