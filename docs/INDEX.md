# RepoPilot documentation index

This is the single entry point for every document in the repository.
Pick the one that matches your role and jump straight in.

## For users / buyers

- [README.md](../README.md) — what RepoPilot is, quick start, free check,
  paid audit flow, tech stack overview.
- [docs/MCP_CLIENT_SETUP.md](MCP_CLIENT_SETUP.md) — how to point an MCP
  client (Claude Code, Codex, OpenClaw, or any generic client) at the
  MCP server, and what its <!-- docs-facts:mcp-tool-count -->14<!-- docs-facts:end --> tools do.
- [MARKETPLACE_LISTING.md](../MARKETPLACE_LISTING.md) — the ready-to-paste
  OKX.AI Marketplace copy (name, tagline, description) in English and
  Chinese.

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
- [docs/REPOSITORY_INTELLIGENCE_PLAN.md](REPOSITORY_INTELLIGENCE_PLAN.md)
  — the repository intelligence roadmap (Phase 0 analysis, and the
  extension points for fix plans and diffs).
- [docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — pre-release
  verification (`pnpm verify:release`).
- [docs/OKX_REQUIREMENTS_SNAPSHOT.md](OKX_REQUIREMENTS_SNAPSHOT.md) —
  the OKX.AI requirements that were captured before GA (kept for
  traceability of the historical "Beta" wording that has since been
  retired).
- [docs/OKX_LIVE_INTEGRATION.md](OKX_LIVE_INTEGRATION.md) — the live
  integration matrix (which OKX CLI steps are ready, which require
  user action).
- [docs/HERO_IMAGE_BRIEF.md](HERO_IMAGE_BRIEF.md) — the 2:1 listing
  banner (`docs/brand/hero.png`) used on the Marketplace listing page.
- [docs/AVATAR_BRIEF.md](AVATAR_BRIEF.md) — the 1:1 registration picture
  (`docs/brand/avatar.png`) passed to `onchainos agent create --picture`.
  Not the same asset as the banner; see the table in that file.
- [ROADMAP.md](../ROADMAP.md) — what is in the current sprint, what is
  gated on external approvals, and in what order it lands.
- [BACKLOG.md](../BACKLOG.md) — tracked work in priority order, with the
  already-landed items kept in place so the ordering stays legible.

## For reviewers / auditors

The three documents that record *why* the code looks the way it does,
and what changed along the way. Read these before proposing a change to
anything load-bearing.

- [DECISIONS.md](../DECISIONS.md) — the ADR log. Every architectural
  choice (D-001 onward) with its context, decision and consequences.
  When a design looks odd, the answer is usually here.
- [RISKS.md](../RISKS.md) — the risk register. Each entry carries a
  severity, a likelihood and the mitigation actually in the code.
- [CHANGELOG.md](../CHANGELOG.md) — release-by-release record of what
  changed, following Keep a Changelog.

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

A second cluster — **ROADMAP.md**, **BACKLOG.md** and **PROJECT_STATE.md**
— all answer some form of "what's next":

- **ROADMAP.md** is the *release* view: what must land before the next
  tag, and what is gated on external approvals.
- **BACKLOG.md** is the *work-item* view: the same work broken into
  priorities, with the already-landed items left in place so the
  ordering stays legible.
- **PROJECT_STATE.md** is the *as-built* view: what is actually running
  today, with the test baseline that proves it.

When they disagree, **PROJECT_STATE.md** wins for "what exists" and
**ROADMAP.md** wins for "what is committed to".
