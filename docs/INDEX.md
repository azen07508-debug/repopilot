# RepoPilot documentation index

This is the single entry point for every document in the repository.
Pick the one that matches your role and jump straight in.

## For users / buyers

- [README.md](../README.md) — what RepoPilot is, quick start, free check,
  paid audit flow, tech stack overview.
- [docs/MCP_CLIENT_SETUP.md](MCP_CLIENT_SETUP.md) — how to point an MCP
  client (Claude Desktop, Cursor, etc.) at the local MCP server.

## For operators / integrators

- [README_OKX.md](../README_OKX.md) — end-to-end OKX.AI integration
  walkthrough (x402 challenge, EIP-3009 settlement, marketplace listing).
- [docs/EXTERNAL_ACTIONS.md](EXTERNAL_ACTIONS.md) — the user-side
  checklist of remaining manual steps (GitHub push, ASP registration,
  real buyer payment).
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — production deployment
  (PostgreSQL, pg-boss, reverse proxy, TLS).
- [docs/API.md](API.md) — HTTP API reference.
- [docs/SECURITY.md](SECURITY.md) — security model, secret handling,
  the things we never log.

## For maintainers / contributors

- [PROJECT_STATE.md](../PROJECT_STATE.md) — current shipped state
  (test baseline, recent changes, process model, known blockers).
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — package structure, module
  boundaries, data flow.
- [docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — pre-release
  verification (`pnpm verify:release`).
- [docs/OKX_REQUIREMENTS_SNAPSHOT.md](OKX_REQUIREMENTS_SNAPSHOT.md) —
  the OKX.AI requirements that were captured before GA (kept for
  traceability of the historical "Beta" wording that has since been
  retired).
- [docs/OKX_LIVE_INTEGRATION.md](OKX_LIVE_INTEGRATION.md) — the live
  integration matrix (which OKX CLI steps are ready, which require
  user action).
- [docs/HERO_IMAGE_BRIEF.md](HERO_IMAGE_BRIEF.md) — the hero image
  used in the Marketplace listing (`docs/brand/hero.png`).

## Design intent

Two documents intentionally cover overlapping ground:

- **README.md** is the *user / buyer* view: what the product is, how
  to try it, what's currently shipping.
- **PROJECT_STATE.md** is the *maintainer* view: what tests pass
  right now, what shipped in the last release, what is still external
  and why.

When they disagree, treat **PROJECT_STATE.md** as the source of truth
for "is the code ready"; **README.md** is the source of truth for "how
does a user use it".
