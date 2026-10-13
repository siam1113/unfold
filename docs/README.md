# Unfold documentation

Start with the guide that matches what you need to do.

## Onboarding

- [Platform guide](platform-guide.md) — product model, architecture, discovery lifecycle, UI, assistant/MCP, and contributor map.
- [Setup guide](setup.md) — local development, Auth0, assistant configuration, CLI use, and common setup issues.
- [Discovery engine](discovery-engine.md) — how the frontier, replay, policy, browser workers, evidence, and resume loop work.
- [System design](system-design.md) — package boundaries, request paths, data ownership, persistence, and deployment shape.
- [Domain glossary](../CONTEXT.md) — canonical meanings for project, discovery, state, action, transition, and evidence.
- [Architecture decisions and limits](architecture.md) — how persistence, replay, state identity, evidence, generation, and the UI work.
- [Root README](../README.md) — local setup, configuration, commands, and operational notes.

## Operations and validation

- [Auth0 setup](auth0-setup.md) — application and callback configuration.
- [Validation guide](validation.md) — validation commands and outcomes.
- [Flow visualization roadmap](flow-visualization-roadmap.md) — evidence view catalog and implementation audit.
- [Free deployment plan](deployment-free.md) — a cost-aware single-host deployment proposal and its operational limits.

## How to read the project

1. Read the [platform guide](platform-guide.md) for the end-to-end picture.
2. Read the [domain glossary](../CONTEXT.md) before changing product terms or data relationships.
3. Follow the package map in the guide to the code that owns the behavior.
4. Read the relevant decision and validation documents before changing discovery semantics.
