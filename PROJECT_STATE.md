# PROJECT_STATE.md

**Project:** RepoPilot — GitHub Repository Launch-Readiness Audit
**Repository:** `/home/gem/workspace/agent/workspace/repopilot`
**Current version:** 0.1.0-rc.2
**Current stage:** Release Candidate preparation
**Last updated:** 2026-07-19 12:38 UTC

> 📚 Single entry point for every document in the repo:
> [docs/INDEX.md](docs/INDEX.md). This file is the **maintainer
> view**; the user / buyer view lives in [README.md](README.md).

## One-line description

RepoPilot audits public GitHub repositories and returns a structured launch report with
evidence-backed findings, reproducible scoring and ready-to-paste launch copy. Static
analysis only; never executes the audited repository's code.

## Stack

- Node.js 22 LTS, TypeScript 5.7 strict + NodeNext ESM
- pnpm 11.x workspaces (apps + packages)
- Fastify 5, Zod 3.24, Octokit, Drizzle ORM (SQLite / Postgres)
- Vitest, Pino 10, React 18 + Vite 6
- @modelcontextprotocol/sdk 1.22 (official MCP TS SDK, stdio transport)
- viem 2.x (EIP-3009 / EIP-712 verification for OKX adapter)
- Docker (multi-stage) + docker-compose

## Layout

```
repopilot/
  apps/
    api/      # Fastify HTTP API
    web/      # React + Vite admin UI
  packages/
    core/        # analyzers + scoring + report + security + schemas + llm
    mcp-server/  # MCP server (stdio)
    okx-adapter/ # PaymentAdapter interface + mock + okx
  fixtures/      # 5 sample repos
  docs/          # Deployment / MCP / External actions
  .github/workflows/  # ci.yml + docker.yml (new in this RC pass)
```

## Service endpoints (local)

- `GET /health` — liveness + payment mode + db status
- `GET /api/v1/capabilities` — service metadata + input/output schema + pricing
- `POST /api/v1/audits` — start a new audit, returns 402 + challenge on first call, 200 + report after X-PAYMENT replay
- `GET /api/v1/audits/:jobId` — fetch job status + report
- `GET /docs/openapi.json` — OpenAPI 3.1 doc (consumed by web UI)
- Web UI: http://localhost:5173 (dev) / static `apps/web/dist` in Docker

## Process model (0.1.0-rc.3)

- The audit pipeline is async. The API process enqueues jobs, the
  worker process consumes them.
- Two deployment shapes are supported:
  - **Combined**: one process runs HTTP + queue + worker. Default
    for `pnpm dev`, `pnpm start`, `verify:release`, and tests.
    Backward compatible with the rc.2 flow.
  - **Split** (production): one process is the HTTP server
    (`pnpm start:api`, `REPOPILOT_API_MODE=http`), another is the
    worker (`pnpm start:worker`). Both share a Postgres-backed
    pg-boss queue. The API enqueues, the worker is the sole
    consumer (`PgBossAuditQueue({ consume: false })` in the API,
    `consume: true` in the worker).
- The inline driver is refused in `http` mode at boot time to
  prevent silent job loss.

## MCP server

- Transport: stdio
- Tools: `audit_github_repository`, `get_audit_status`, `get_repopilot_capabilities`
- Bin: `packages/mcp-server/dist/cli.js` (also `repopilot-mcp`)

## Payment model

- `PAYMENT_MODE=mock` (default): in-process mock adapter, end-to-end without external
- `PAYMENT_MODE=okx`: x402 v2 + EIP-3009 `TransferWithAuthorization` signature
  verification on XLayer/Ethereum/Base/Arbitrum/BSC, USDT settlement.
  - **STUB** boundary: when `recipientAddress` is empty (Beta not enabled),
    `OkxPaymentAdapter.isConfigured()` returns `false` and `buildPaymentAdapter()`
    in `packages/okx-adapter/src/factory.ts` MUST refuse to construct one.
    The factory must never silently fall back to mock.
  - All gates documented in `docs/EXTERNAL_ACTIONS.md` and `README_OKX.md`.

## Test baseline (2026-07-19 10:08 UTC)

- @repopilot/core: 61/61
- @repopilot/okx-adapter: 16/16
- @repopilot/api: 26/26 + 2 skipped (Postgres, run in CI)
- @repopilot/mcp-server: 1/1
- @repopilot/web: 0 (skipped intentionally)
- **Total: 104/104 (106/106 with the Postgres tests when CI is green)**

## Quality gates already passing

- `pnpm install` (no errors, only peer-dependency hints)
- `pnpm -r typecheck` (strict, no errors)
- `pnpm -r test` (104/104; Postgres integration test runs in CI)
- `pnpm build` (all 5 packages + 2 apps)
- `pnpm env:check` (validates dev / production / okx mode; never prints secrets; also covers queue driver rules)
- `pnpm lint` (tsc + project-specific static rules; 0 issues)
- `pnpm docker:check` (static review; Docker CLI not in dev sandbox)
- `pnpm compose:check` (compose file sanity; 0 issues)
- `pnpm verify:release` (full end-to-end smoke; covers 202 + Location + Retry-After, cache miss/hit, cache disabled, free-check 200)
- API smoke: `/health`, `/api/v1/capabilities`, free-check, paid audit
  lifecycle, cache miss/hit, cache disabled
- MCP smoke: stdio initialize + tools/list
- **`pnpm verify:release` all green (2026-07-19 12:38 UTC).** 17 steps pass, including live
  `octocat/Hello-World` audit (3s, full report, score 45.2/100), cache miss/hit, cache
  disabled, free-check, MCP stdio tools/list. Fixed bug: `AuditWorker.classify()` regex
  `/not found|404/` was case-sensitive; GitHub's "Not Found" (capital N/F) didn't match,
  so 404s fell through to `UPSTREAM_FAILED` (retryable=true) and stuck the inline queue
  at `processing` forever. Added `/i` flag, rebuilt, retest → 1434ms.
- **`onchainos 4.2.6` binary** downloaded and preflight-passed (BLOCKING step complete).
  `web3.okx.com` is unreachable from the sandbox (HTTP CONNECT times out) so the actual
  wallet login must run on the user's host. See `docs/OKX_LIVE_INTEGRATION.md`.
- **Live audit smoke** (anecdotal, not in `verify:release`): `octocat/Hello-World` returned
  a full report in ~3s with cache miss → 1st request, no rate-limit issues.
- Docker CI: `.github/workflows/docker.yml` (buildx + smoke `/health`)

## Repository Intelligence upgrade (planning, Phase 0 done)

RepoPilot is being progressively upgraded from a *launch-readiness audit
tool* into a **Repository Intelligence Layer for AI Coding Agents**
(Codex / Claude Code / OpenCode / OpenClaw). No rewrite — the existing
stack, API, MCP, DB, analyzers, fixtures and tests all stay.

- Full code audit + phased plan:
  [docs/REPOSITORY_INTELLIGENCE_PLAN.md](docs/REPOSITORY_INTELLIGENCE_PLAN.md)
- Phase 0 completed 2026-09-19 against commit `f95ccb5`.
- Three assumptions in the original proposal were corrected by the audit:
  1. `@repopilot/core` has **no AST parser** — Symbol Map needs one
     (ADR D-018 proposes `typescript` compiler API + regex fallback).
  2. There is **no git history / local clone** — Change Impact must use
     the GitHub Compare API, not `git diff` (ADR D-020).
  3. `fetchContents` is **one API request per file** — Repository Map
     would blow the 60 req/h anonymous limit. Switch to tarball
     download first (ADR D-017). **This is the V0.2 blocker.**
- **Done 2026-09-19:** ADRs D-017 ~ D-021 are in `DECISIONS.md`, risks
  R-17 ~ R-21 are in `RISKS.md`, and the intelligence Zod schemas are
  landed in `packages/core/src/schemas/intelligence/` with unit tests
  (V0.2-b). Nothing in the existing API / MCP / report / DB surface
  changed.
- Next: V0.2-c — replace the per-file `getContent` I/O with the
  tarball source (D-017), then V0.2-d Repository Map builder.

## Launch Readiness layer — P0 core (done 2026-09-20)

RepoPilot is gaining a closed loop:
**Audit → Evidence → Findings → Fix Plan → Agent Instructions →
Re-Audit → Compare**. The P0 slice is core-only; API, MCP and Web are
not wired yet.

- `FixPlanSchema` / `AuditDiffSchema` — own `schemaVersion`, versioned
  independently of `Report.reportVersion`.
- `buildFixPlan()` / `buildFixPlanSet()` — pure derivations from an
  existing `Report`. No scan, no analyzer, no network, no
  `AuditPipeline.run()`.
- `diffReports()` — `ruleDeltas` computed from the existing
  `ScoreBreakdown.rules[]`, so score movement is attributed rule by
  rule. Finding classification is a set operation on `finding.id`.
- `renderAgentInstructions()` — Repository / Commit / Finding /
  Evidence / Objective / Steps / Constraints / Acceptance Criteria,
  ready to paste into Codex, Claude Code or OpenCode.
- LLM boundary: `polishFixPlanSet()` may rewrite the `why` sentence and
  nothing else. Priority, effort, evidence, steps and criteria are
  deterministic. `NoopLLMProvider` keeps the whole path LLM-free.
- Analysis + plan: `docs/REPOSITORY_INTELLIGENCE_PLAN.md` (Phase 0) and
  the Launch Readiness analysis in the workspace.
- **Test baseline: core 143/143 passing** (61 new: builder 15,
  templates 11, diff 16, fixtures + schema boundaries 19).
- `apps/web` now imports report types from `@repopilot/core`
  (type-only) instead of a hand-copied duplicate.
- **DB migration done 2026-09-20 (Step 3):** `jobs` gained `owner`,
  `repo`, `commit_sha`, `mode`, `target` plus two indexes, on both
  SQLite and Postgres. Verified against a real SQLite database: fresh
  create, idempotent re-run, in-place upgrade of a pre-migration table,
  and an `EXPLAIN QUERY PLAN` assertion that
  `idx_jobs_owner_repo_created` is actually chosen. Rows written before
  the migration keep NULL by design and are excluded from history
  queries rather than guessed at.
- **History queries done 2026-09-20 (Step 4):** `JobRepository` gained
  `listByRepo()` / `listCompletedByRepo()` / `findByCommitSha()` and an
  optional `identity` on `insert()`; `JobService` gained
  `listHistory()` / `listCompletedHistory()` / `getByCommitSha()`. The
  route now passes its already-parsed owner/repo into `service.create()`
  so URL parsing stays in one place.
- **Bug fixed:** `JobService.setCommitSha()` was a no-op placeholder —
  the route resolved the head SHA and threw it away, forcing the worker
  to re-resolve it on every attempt. It now writes the `commit_sha`
  column.
- **Derived endpoints done 2026-09-20 (Step 5):**
  `GET /api/v1/audits/:jobId/fix-plan`,
  `GET /api/v1/audits/:jobId/diff?base=:jobId` and
  `GET /api/v1/repositories/:owner/:repo/audits`. All three are free,
  read-only derivations of stored reports — no payment challenge, no
  repository access. The route module imports none of `AuditPipeline`,
  fetcher, queue or payment adapter, and a test asserts that.
  `AuditJobSchema` gained `commitSha` so fix-plan instructions can name
  the exact commit. OpenAPI documents all three.
- **Derived endpoints covered 2026-09-22:** those three routes had
  `/quality` tested and nothing else. Twenty tests now pin what each
  returns, which commit each reports, and every error path (`400` /
  `404` / `409`). `AppDeps.metadataAnalyzer` became injectable so a test
  can fix the head SHA without asking GitHub. Two tests assert the
  invariant the module doc claims: reading a fix plan, a diff, a
  verdict and a history list leaves the pipeline's run count unchanged,
  and an unreachable GitHub records no commit. `api.integration`
  suite: 36 passing (was 16).
- **Bug fixed 2026-09-22:** an unreachable GitHub was recorded as the
  commit `'unknown'`. `commit_sha` is nullable and `getByCommitSha`
  filters on it, so the sentinel read as a real SHA. Now `null`, and
  `setCommitSha()` takes `string | null`.
- **Web UI connected 2026-09-20 (Step 8):** the report page now ends
  with a fix-plan section, and a `Report / History / Comparison` tab
  strip appears once an audit completes. Comparison shows rule-level
  attribution of the score change, plus resolved / new / still-open
  findings. Score deltas use the Chinese convention (rise red, fall
  green). All new strings are bilingual.
- **Loop closed 2026-09-20 (Step 9):**
  `POST /api/v1/repositories/:owner/:repo/reaudit` runs a fresh audit
  from path coordinates, sharing one closure with `POST /audits` so
  payment, idempotency and enqueueing cannot drift between them. The
  full cycle — audit → fix plan → fix → re-audit → compare — is now
  reachable end to end.
- **MCP surface done 2026-09-20 (Step 7):** seven tools now. The four
  new ones are `get_fix_plan`, `compare_audits` and `list_audit_history`
  (free — pure derivations of stored reports) plus the paid
  `reaudit_repository`. `get_repopilot_capabilities` returns a `billing`
  map so an agent can tell free from paid, which matters on the OKX.AI
  marketplace. Failures are structured payloads, not thrown exceptions.
- The Launch Readiness loop is now reachable from **both** surfaces:
  HTTP (`/audits/:jobId/fix-plan`, `/diff`, `/repositories/:owner/:repo/audits`,
  `/reaudit`) and MCP (the seven tools above).
- Next: no Launch Readiness phase is outstanding. Remaining work is the
  pre-existing V0.2 blocker (tarball fetch instead of per-file
  `getContent`, ADR D-017) and the user-side marketplace step
  `onchainos agent register --role asp`.

## Recent shipped changes (0.1.0-rc.2)

- Fixture findings are readable again: `Report.fixtureSummary` groups
  `fixtureFindings` by `(file, ruleId)` with a capped line list, and the
  web report renders them in a collapsed section instead of a wall.
  MCP `reportSummary()` reports `fixtureFindingCount` /
  `fixtureFileCount` so an agent is not told "3 findings" when there are
  542. `fixtureFindings` stays lossless — the quality contract and the
  diff still read it individually.
- Report versioning is honest: `REPORT_VERSION` is `1.1` with
  `SUPPORTED_REPORT_VERSIONS = ['1.0', '1.1']`. `FreeCheckReportSchema`
  deliberately stays at `1.0` — it is a different document and sharing
  the constant would make it accept versions it never emits.
- `computeMoved` pairs moved findings by nearest neighbour inside a
  `(rule, file)` group with `MAX_MOVE_DISTANCE = 50`, instead of a map
  lookup that collapsed three shifted secrets into one arbitrary pair.
- `GET /api/v1/audits/:jobId/quality` serves the quality contract on
  read, from the same function the MCP `quality_status` tool uses.
- CI pins `ubuntu-24.04` instead of tracking `ubuntu-latest`.
- CI's `actions/*` steps moved to the first major that runs on Node 24:
  `checkout@v5`, `setup-node@v5`, `cache@v5`, `upload-artifact@v6`. The
  `@v4` majors target Node 20 and were being forced onto Node 24 with a
  deprecation warning on every run. `upload-artifact@v5` still declares
  `node20`, so v6 is the first major that actually clears it. Verified
  per tag by reading `runs.using` from each action's own `action.yml`.
  `setup-node` sets `package-manager-cache: false` because the root
  `package.json` declares `packageManager`, which from v5 turns on
  automatic caching that would duplicate the explicit `actions/cache`
  step.
- Production guards: `production + PAYMENT_MODE=mock` and
  `production + AUDIT_QUEUE_DRIVER=inline` now both fail app start
  with a clear, secret-free error (schema-level + env-check).
- Fastify boots without deprecation warnings. `server.ts` no longer sets
  `disableRequestLogging: false` — it is the default, the option warns on
  presence not value, and fastify@6 removes it. Request logging is
  unaffected.
- Async audit queue: `AuditQueue` interface with two adapters
  (`InlineAuditQueue`, `PgBossAuditQueue`) and a single
  `AuditWorker` owning the state machine.
- `POST /api/v1/audits` always returns 202 + `Location` +
  `Retry-After: 1`. `GET /api/v1/audits/:jobId` returns 202 while
  queued/processing and 200 when completed.
- `Idempotency-Key` is first-class: unique index + concurrent test.
- `jobs` table gained `attempts`, `started_at`, `completed_at`,
  `failed_at`, `error_code`, `idempotency_key`.
- Graceful shutdown: `SHUTDOWN_GRACE_PERIOD_MS` (default 30000).
- `/health` includes a `queue` block (driver, status,
  `acceptingJobs`).
- R-02 (Mock Payment guard) and the new R-16 (Inline queue guard)
  are marked mitigated in `RISKS.md`; both remain release-blockers
  until verified against the production environment.

## Known external blockers

These are NOT code TODOs and do not block the Release Candidate:

1. Docker CLI not present in this sandbox → `docker build` not run here
2. OKX.AI Agent Marketplace listing not yet submitted → run
   `onchainos agent register --role asp` (GA since 2026-06-30; this is a
   single CLI call, not a code change). The `OkxPaymentAdapter` is fully
   wired and accepts `PAYMENT_MODE=okx` out of the box once a valid
   `OKX_PAYMENT_ADDRESS` is set.
3. Production GitHub Token not provided → anonymous 60 req/h in dev
4. Production PostgreSQL credentials not provided → SQLite in dev
5. Domain / DNS / TLS cert not configured → reverse-proxy templates only
6. ~~Marketplace hero image asset not provided~~ → generated `docs/brand/hero.png`
   (1280×640 PNG, 525 KB, see `docs/HERO_IMAGE_BRIEF.md`)

See `docs/EXTERNAL_ACTIONS.md` for the user-side checklist.
