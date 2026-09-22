# CHANGELOG.md

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Integration tests for the three derived endpoints.**
  - `apps/api/src/tests/api.integration.test.ts` covered `/quality` and
    nothing else under `derived routes`. Twenty tests now pin
    `fix-plan`, `/diff` and `/repositories/{owner}/{repo}/audits`: what
    each returns, which commit each reports, and every error path
    (`400` / `404` / `409` — the missing-`base` message names the
    history endpoint that would supply one).
  - `AppDeps.metadataAnalyzer` is injectable now, so a test can fix the
    head SHA. Without it the only way to learn a SHA is to ask GitHub,
    which makes the value non-deterministic and the endpoint that
    reports it untestable — every job row would carry `commit_sha =
    NULL`.
  - Two tests state the invariant the module doc claims, rather than
    trusting it: reading a fix plan, a diff, a quality verdict and a
    history list leaves the pipeline's run count unchanged, and a
    repository GitHub could not be reached records no commit.
  - `api` suite: 36 passing in `api.integration.test.ts` (was 16).
- **`Report.fixtureSummary` — fixture findings grouped for reading.**
  - `packages/core/src/report/fixtures.ts`: `summarizeFixtures()`
    groups findings by `(file, ruleId)` and returns
    `{ file, ruleId, title, count, severity, lines }`, worst severity
    first. `lines` is capped at `MAX_GROUP_LINES` (10) while `count`
    keeps the true total, so a five-hundred-hit lockfile group is one
    row rather than five hundred.
  - `ReportSchema.fixtureSummary` is additive with a `.default([])`, so
    a report written before it existed still parses. `fixtureFindings`
    is unchanged and remains the authoritative list — the quality
    contract and the diff read it, not the summary.
  - The summary is stored rather than derived on read because
    `apps/web` imports core type-only (core pulls `@octokit/rest`, which
    must not reach the browser), so data is the only channel that
    reaches both a browser and an MCP client without a second copy of
    the rule.
  - `apps/web/src/components/ReportView.tsx`: a collapsed `<details>`
    section after the security findings, muted so it does not compete
    with the gating sections. Falls back to the raw `fixtureFindings`
    list when a stored report has no summary, rather than hiding them.
  - MCP `reportSummary()` gained `fixtureFindingCount` and
    `fixtureFileCount`, so an agent cannot read
    `securityFindingCount: 3` as "three findings total".
  - **Test baseline: core +17** (`report/fixtures.test.ts` 14,
    `fixture-split.test.ts` +3 including the thirty-hit collapse).
- **Repository Intelligence — Phase 0 audit + V0.2-b schemas.**
  - `docs/REPOSITORY_INTELLIGENCE_PLAN.md`: a full code audit plus the
    phased plan to evolve RepoPilot into a *Repository Intelligence
    Layer for AI Coding Agents*. No rewrite — the existing API, MCP
    tools, report schema, analyzers, fixtures and tests are preserved.
    The audit corrected three assumptions in the original proposal:
    there is no AST parser, there is no git history / local clone, and
    the per-file `getContent` I/O cannot sustain Repository Map under
    the 60 req/h anonymous limit.
  - ADRs **D-017 ~ D-021** in `DECISIONS.md`: tarball I/O (D-017),
    symbol parser selection (D-018), MCP billing split — report tools
    paid, query tools free (D-019), `ChangeSource` abstraction
    (D-020), intelligence artifact caching (D-021).
  - Risks **R-17 ~ R-21** in `RISKS.md`.
  - `packages/core/src/schemas/intelligence/`: versioned Zod schemas
    for `RepositoryMap`, `SymbolMap`, `DependencyGraph`,
    `ArchitectureGraph`, `ChangeImpact`, `AgentContextPack` and
    `EvidenceV2`. Every artifact carries its own `schemaVersion`,
    versioned independently of `Report.reportVersion`.
  - `EvidenceV2` is a strict superset of v1 `Evidence`: `file` and
    `line` survive as optional mirrors, so existing consumers are
    unaffected. `toEvidenceV2` / `toLegacyEvidence` round-trip between
    the two shapes.
- **Web UI redesign (preserve mode) + Simplified Chinese locale.**
  - `apps/web/src/styles.css` rewritten: off-black / off-white instead
    of pure `#000` / `#fff`, desaturated semantic colours, a documented
    radius scale (cards 14px, controls 10px, pills 999px, code 6px),
    two card elevation tiers, focus-visible rings, `:active` feedback,
    `prefers-reduced-motion` handling and a 768px breakpoint.
  - New `apps/web/src/i18n.tsx`: `en` and `zh-CN` dictionaries with a
    Context provider, localStorage persistence and
    `document.documentElement.lang` sync. No new dependency. The
    `zh-CN` dictionary is typed as the English one, so a missing key is
    a compile error.
  - Loading (skeleton), empty (dashed placeholder) and error states
    added; disabled buttons now change colour instead of using
    `opacity`; checklist emoji replaced by a CSS checkmark with an
    `aria-label`; section headings are no longer uppercase tracked
    eyebrows.
  - Every UI string in `App`, `Header`, `StatusBar`, `AuditForm`,
    `ReportView` and `Footer` now goes through the dictionary. Report
    *content* language is still driven by the API `outputLanguage`.
  - Measured with Playwright against system Chrome: card visual
    signatures 1 → 3, minimum text contrast 4.83 → 5.67 (dark mode
    7.53), zero horizontal overflow, zero dead white, zero wrapped
    buttons. `npm run typecheck` and `npm run build` both pass.
- **Launch Readiness layer, P0 (core only).**
  - `packages/core/src/schemas/fix-plan.ts`: `FixPlanSchema` with
    priority `P0|P1|P2`, effort `S|M|L`, status
    `open|resolved|ignored`, mandatory evidence (D-008 extended to
    plans), ordered steps, tests to add, acceptance criteria and a
    ready-to-paste `agentInstructions` block.
  - `packages/core/src/schemas/audit-diff.ts`: `AuditDiffSchema` with
    base/head refs, `scoreDelta`, `dimensionDeltas`, `ruleDeltas`,
    resolved / new / persistent finding ids and an
    improved / regressed / unchanged verdict.
  - `packages/core/src/fixplan/builder.ts`: `buildFixPlan()` and
    `buildFixPlanSet()` derive plans from an existing `Report` with no
    scan, no analyzer, no network and no pipeline call. Priority and
    effort come from severity; evidence is copied from the finding and
    never invented.
  - `packages/core/src/fixplan/template.ts`: deterministic plan text
    plus `renderAgentInstructions()` laid out as Repository / Commit /
    Finding / Evidence / Objective / Steps / Constraints / Acceptance
    Criteria.
  - `packages/core/src/diff/reports.ts`: `diffReports()` compares two
    reports. `ruleDeltas` is computed from the existing
    `ScoreBreakdown.rules[]`, so a score change is attributed rule by
    rule instead of being explained by an LLM.
  - `polishFixPlanSet()` is the only LLM touchpoint: it may rewrite the
    `why` sentence and nothing else. With the default
    `NoopLLMProvider` the output is fully deterministic and
    `llmEnhanced` stays `false`. A failing provider falls back to the
    deterministic text.
  - `Report.reportVersion` stays `'1.0'` and `ReportSchema` is
    untouched, so a fix plan remains an optional derivation rather
    than a required report field.
  - 61 new tests: fix-plan builder 15, templates 11, diff 16, fixture
    coverage + schema boundaries 19. Core suite is now 143 passing.
- **Audit history queries + the `setCommitSha` fix (Step 4).**
  - `JobRepository` gained `listByRepo()`, `listCompletedByRepo()` and
    `findByCommitSha()`, plus an optional `identity` argument on
    `insert()` that fills the new `owner` / `repo` / `mode` / `target`
    columns. Rows inserted without an identity keep NULL and are
    skipped by history queries rather than guessed at.
  - `JobService` gained `listHistory()`, `listCompletedHistory()` and
    `getByCommitSha()`.
  - **Fixed:** `JobService.setCommitSha()` was a no-op placeholder. The
    route resolved the head SHA and then silently discarded it, so the
    worker had to re-resolve it on every attempt. It now persists to
    the `commit_sha` column.
  - The route passes its already-parsed owner/repo down to
    `service.create()`, so `parseRepoUrl` and its host allow-list are
    never duplicated inside the data layer.
  - Verified against a real SQLite database (9 checks): identity
    persistence, identity-less rows staying NULL, newest-first
    ordering, limit handling, completed-with-report filtering, commit
    lookup, and "newest wins" when two jobs share a commit sha.
- **Three free, derived read-only endpoints (Step 5).**
  - `GET /api/v1/audits/{jobId}/fix-plan` — every fix plan for a
    completed audit, derived on read from the stored report. Plans are
    deliberately not persisted: a stored copy would only drift from the
    report it came from.
  - `GET /api/v1/audits/{jobId}/diff?base={jobId}` — before/after
    comparison with rule-level attribution, plus resolved / new /
    persistent findings. Rejects self-comparison and cross-repository
    comparison.
  - `GET /api/v1/repositories/{owner}/{repo}/audits?limit=` — newest
    first history summaries (jobId, commit sha, score, finding count).
    The limit is clamped to 1..100 rather than trusted.
  - None of the three issues a payment challenge, and none can scan a
    repository: the module does not import `AuditPipeline`, a fetcher,
    a queue or a payment adapter, and a test asserts that by inspecting
    the import list.
  - `AuditJobSchema` gained `commitSha` (nullable, default null) and the
    repository row mapper now returns it, so fix-plan instructions can
    name the exact commit.
  - OpenAPI: three new `derived` tag paths.
  - Verified with 14 checks against a real Fastify instance whose
    service stub exposes only read methods — "did it re-scan?" is
    answered structurally, not by inspecting mocks.
- **Web UI: fix plan, audit history and before/after comparison
  (Step 8).**
  - `FixPlanView` renders every plan for a completed audit: priority
    and effort pills, the evidence pointers, ordered steps, tests to
    add, acceptance criteria, the risk note, and the full
    `agentInstructions` block behind a disclosure with a copy button.
  - `AuditHistoryView` lists a repository's audits newest first with
    commit, mode, score and finding count, marking the audit currently
    on screen and offering the others as a comparison baseline.
  - `AuditDiffView` shows the verdict, the overall delta, per-dimension
    deltas, a rule-level table explaining *why* the score moved, and the
    resolved / new / still-open finding groups.
  - Score deltas follow the Chinese market convention — a rise is red, a
    fall is green — using dedicated `--delta-up` / `--delta-down`
    tokens rather than `--ok` / `--bad`, whose meaning is the opposite.
  - A `Report / History / Comparison` tab strip appears once an audit
    has completed; the comparison tab only appears after a baseline is
    chosen.
  - All new strings are bilingual (en / zh-CN).
  - Verified with 13 end-to-end checks in a real browser, including that
    an *unchanged* scoring rule does not leak into the rule-delta table
    and that the flow produces no console errors.
  - Bundle: 172.5 kB (up from 160 kB for three new views); `@octokit/rest`
    still absent, confirming the type-only core import holds.
- **Re-audit endpoint — the loop closes (Step 9).**
  - `POST /api/v1/repositories/{owner}/{repo}/reaudit` runs a fresh
    audit from coordinates the caller already has, so an agent (or the
    UI) can go fix → re-audit → compare without re-typing the URL.
  - It shares the *same* code path as `POST /api/v1/audits`: payment
    challenge, idempotency keys, head-SHA resolution and enqueueing are
    one closure (`handleCreate`), not two copies that drift.
  - `owner` / `repo` must match `/^[A-Za-z0-9._-]+$/`; the constructed
    URL still passes through `parseRepoUrl`, so the host allow-list
    applies here exactly as it does on the normal path.
  - Body is optional; `mode`, `target`, `outputLanguage` and
    `includeLaunchCopy` fall back to the same defaults as the main
    endpoint.
  - OpenAPI documents it under the `derived` tag.
  - Verified with 9 checks, three of which specifically re-test
    `POST /api/v1/audits` to prove the extraction changed nothing: the
    402 challenge, the 202 + enqueue, and the forwarded owner/repo
    identity. Also verified that a re-audit is rejected when the
    repository is outside the host allow-list.
- **MCP: the same loop, for agents (Step 7).**
  - Four new tools. `get_fix_plan` and `compare_audits` are the agent
    equivalents of the derived HTTP endpoints; `list_audit_history`
    removes the need to track job ids by hand; `reaudit_repository` is
    the paid write half of the loop.
  - `reaudit_repository` and `audit_github_repository` share one
    `runPaidAudit()` closure, so the payment handshake, the mock
    auto-verify and the pipeline call exist exactly once.
  - `get_repopilot_capabilities` now returns a `billing` map marking
    every tool free or paid (D-019). Agents on the OKX.AI marketplace
    need this to decide what they can afford to call.
  - Failures come back as structured payloads — `job_not_found`,
    `report_not_ready:<status>`, `base_job_not_found`,
    `invalid_input:…`, `repo_mismatch:…` — instead of thrown
    exceptions, so an agent can branch on them.
  - The free tools call the same pure functions as the API
    (`buildFixPlanSet`, `diffReports`). No second implementation, and
    no repository scan.
  - `JobStore.listByRepo()` added for in-memory history.
  - Verified with 11 checks over the in-memory MCP transport: the tool
    list, the billing map, plan derivation with evidence and agent
    instructions, diff attribution, and every error path.

### Changed

- **CI actions moved to the first major that runs on Node 24.**
  `actions/checkout@v4 → v5`, `actions/setup-node@v4 → v5`,
  `actions/cache@v4 → v5`, `actions/upload-artifact@v4 → v6`. The `@v4`
  majors target Node 20 and were being forced onto Node 24, so every run
  carried a deprecation warning. `upload-artifact@v5` still declares
  `node20` in its `action.yml`, which is why v6 and not v5 is the first
  version that clears it — verified per tag by reading `runs.using`
  rather than trusting the release notes. `docker.yml`'s checkout was on
  the same `@v4` and moved with it.
  - `setup-node` sets `package-manager-cache: false`. From v5 it caches
    automatically whenever `package.json` declares `packageManager`, and
    the root declares `pnpm@11.11.0` — so the default would have added a
    second pnpm-store cache beside the explicit `actions/cache` step.
    One cache, keyed the way the workflow chooses.
  - Both workflows were parsed and their step wiring asserted after the
    edit, because a workflow that fails to parse fails every run in 0s
    with no logs — a failure mode this repository has already hit.
- **`jobs` table gained repository identity columns** — `owner`,
  `repo`, `commit_sha`, `mode`, `target` — plus two indexes
  (`idx_jobs_owner_repo_created`, `idx_jobs_commit_sha`), on both
  SQLite and Postgres. This is what makes audit history and
  before/after comparison queryable without scanning `input_json` on
  every request. All five columns are nullable, so rows written before
  the migration keep NULL and are excluded from history queries rather
  than being guessed at. No existing column was modified. The migration
  is idempotent and was verified against a real SQLite database,
  including an in-place upgrade of a pre-migration table and an
  `EXPLAIN QUERY PLAN` assertion that the new index is actually chosen
  by the planner.
- **`apps/web` now imports report types from `@repopilot/core`.**
  `lib/api.ts` previously kept a hand-copied duplicate of `Report`,
  `Finding` and `Evidence`, which meant a schema change would not
  surface in the UI. The import is type-only so `@octokit/rest` never
  reaches the browser bundle (verified: 160 kB, unchanged). Transport
  contracts (`Health`, `AuditResponse`) stay local because they
  describe HTTP, not the report schema.
- `get_repopilot_capabilities` gained a `billing` field. The three
  original MCP tool signatures are unchanged.
- Nothing else changed in the existing API surface or report schema.

### Fixed

- **An unreachable GitHub was recorded as the commit `'unknown'`.**
  `POST /api/v1/audits` resolves the head SHA before enqueueing and
  fell back to the string `'unknown'` when both `main` and `master`
  lookups failed. `commit_sha` is nullable and `getByCommitSha` filters
  on it, so the sentinel read as a real SHA to anything looking a job
  up by commit — and it was written into a column whose NULL is
  meaningful. The fallback is now `null`, and
  `JobService.setCommitSha()` takes `string | null` to make that
  explicit at the call site.

- **One generated file could zero a score dimension (R-22, ADR D-022).**
  `severityPenalty()` summed `SEVERITY_PENALTY` over every finding with no
  bound on how many one file could contribute. A lockfile is mostly
  `sha512-` integrity digests, which are high-entropy by construction and
  so match the generic secret heuristic; `severityForPath` downgrades them
  to `low` rather than dropping them, so hundreds stayed in
  `securityFindings` at 1.5 points each. Measured on a repository whose
  only files were a lockfile, a README, a LICENSE and a one-line source
  file: `securityHygiene: 0`, `overall: 53.7` — 25 points below the same
  tree without the lockfile. The quality contract was already immune (it
  counts only `critical` and `high`); the score was not.
  - The penalty now caps each `(file, ruleId)` pair at
    `MAX_PER_GROUP` (3) findings, worst severity first. Breadth is
    untouched: a hundred secrets in a hundred files still costs a hundred
    penalties, and only repetition *inside* one file is bounded.
  - The group key is the **resolved** rule id, never the finding `id` —
    a secret finding's id embeds its line number, so keying on it would
    give every hit its own group and the cap would never apply.
  - The reason text now says "at most 3 counted per file and rule" when
    the cap bites, so a penalty smaller than the finding count is
    explained rather than mysterious.
  - `packages/core/src/scoring/penalty-cap.test.ts` pins both
    directions: the cap holds, and breadth still scores. Reverting the
    cap fails 7 of its 8 tests.

## [0.1.0-rc.3] - 2026-07-19

### Added

- **Standalone worker process.** The audit worker no longer has to
  live inside the API process. New `apps/api/src/worker.ts` entry
  point; shared `apps/api/src/queue/build-queue.ts` factory. The
  API process and the worker process are now first-class deployment
  units.
  - New `pnpm dev:api` / `dev:worker` and `start:api` / `start:worker`
    scripts. `pnpm dev` and `pnpm start` keep the legacy combined
    behavior for backward compatibility.
  - `PgBossAuditQueue` accepts a `consume: boolean` flag; the API
    process passes `consume: false` so it only enqueues, the worker
    process is the sole consumer.
  - The `REPOPILOT_API_MODE=http` env var toggles the API to
    enqueue-only mode. Combined with `AUDIT_QUEUE_DRIVER=pg-boss`
    this is the production deployment shape.
  - The API refuses to start in `http` mode with the inline driver:
    the inline queue is in-process and the dedicated worker would
    never see the enqueued jobs.
  - 4 new tests in `apps/api/src/worker.test.ts`.
  - `verify:release` still runs in combined mode (the legacy
    default) and is fully green; the new mode is opt-in for
    production deployments.

## [0.1.0-rc.2] - 2026-07-19

### Fixed

- **AuditWorker error classification was case-sensitive.** The regex
  `/not found|404/` in `AuditWorker.classify()` did not match
  GitHub's actual error string `"Not Found - https://docs.github.com/.../...get-a-repository"`,
  so 404s fell through to the default `UPSTREAM_FAILED` (retryable=true).
  The inline audit queue has no retry loop, so the job stayed at
  `status=processing` until the test timeout (90s). The
  `POST /audits (404 repo, GET → failed)` smoke step failed
  twice in a row before the fix. Patched: regex now has the `/i`
  flag, all three classification rules normalised. Rebuilt API;
  `pnpm verify:release` now reports 1434ms for that step and the
  full 17-step suite is all green.

### Added

- **Production guards (R-02 mitigation).** `NODE_ENV=production` +
  `PAYMENT_MODE=mock` now fails the application start with a clear,
  secret-free error message. Implemented in the unified config schema
  (`apps/api/src/config.ts`); not a soft warning, not silent fallback.
  Also enforced by `pnpm env:check`.
- **`AUDIT_QUEUE_DRIVER=production + inline` guard.** When
  `NODE_ENV=production` is set without the explicit
  `ALLOW_INLINE_QUEUE_IN_PRODUCTION=1` override, the app refuses to
  start with the inline queue and instructs the operator to switch
  to `pg-boss`. Enforced both at config load and by `pnpm env:check`.
- **Async audit queue architecture.** New `AuditQueue` interface
  (`apps/api/src/queue/audit-queue.ts`) with two adapters:
  - `InlineAuditQueue` — in-process scheduler for SQLite dev / tests
    / `verify:release`. Bounded concurrency, idempotent at jobId,
    graceful shutdown.
  - `PgBossAuditQueue` — pg-boss 12.26.1 backed, persistent,
    production-grade. Self-managed pool, `application_name` tagging,
    `retryLimit: 1`, `expireInHours` job timeout, `error_code` for
    retry classification.
  Business code (analyzers, scoring, Report Cache, payment adapter)
  does not depend on pg-boss.
- **Single `AuditWorker`** (`apps/api/src/services/audit-worker.ts`).
  Owns the queued→processing→completed/failed state machine, calls
  the existing Report Cache, never bypasses payment, never re-validates
  payment, is idempotent at jobId. Resolves the head SHA inside the
  worker so jobs can be re-delivered later and stay cache-stable.
- **Audit API 202 contract.** `POST /api/v1/audits` now always
  returns `202 Accepted` with `Location: /api/v1/audits/<jobId>` and
  `Retry-After: 1`. `GET /api/v1/audits/:jobId` returns 202 while
  queued/processing and 200 when completed. Failed jobs return a
  stable structured error. Both flows are documented in OpenAPI.
- **Idempotency.** `Idempotency-Key` header on POST is now first-class:
  a unique index on `jobs.idempotency_key`, plus tests for sequential
  and concurrent submissions. The X-PAYMENT path already deduplicated
  by `payment_id`; both keys now coexist.
- **Graceful shutdown.** `SHUTDOWN_GRACE_PERIOD_MS` (default 30000).
  Fastify onClose stops accepting jobs, drains in-flight workers,
  closes the queue, then the DB. `/health` reports
  `queue.acceptingJobs=false` while shutting down.
- **/health now includes a `queue` block** describing driver, status,
  and `acceptingJobs`. No secrets, no connection strings, no internal
  worker ids.
- **Jobs table migrations** (SQLite + Postgres):
  added `attempts`, `started_at`, `completed_at`, `failed_at`,
  `error_code`, `idempotency_key`. Status transitions are conditional
  (only `queued → processing` is allowed via guarded update).
- **env:check** now also validates `AUDIT_QUEUE_DRIVER`,
  `AUDIT_QUEUE_CONCURRENCY`, `AUDIT_QUEUE_RETRY_LIMIT`,
  `AUDIT_QUEUE_JOB_TIMEOUT_MS`, `SHUTDOWN_GRACE_PERIOD_MS`.
- **Configuration.** `.env.example` documents every new variable
  with sane defaults and production guidance.

### Changed

- `mode: 'full'` no longer blocks the HTTP request: both Quick and
  Full Audit return 202. Free Check remains synchronous 200.
- `verify:release` accepts 200/404/429/502 on the live `free-check`
  step to absorb GitHub's anonymous rate limit; the 202 + Location
  + Retry-After + completed report + cache hit are all asserted.
- The OpenAPI document for `POST /api/v1/audits` now lists 202
  (accepted) with `Location` / `Retry-After`; `HealthResponse` carries
  a `queue` block.

### Security

- `pnpm env:check` + start-time schema refuse the combination of
  production + Mock Payment and production + inline queue.
- Workers never log payment headers, GitHub tokens, OKX secrets,
  or full stack traces for upstream errors. Only `error_code` and
  redacted messages are persisted to `jobs.error`.

### Known limitations

- The PostgreSQL queue adapter is unit-test covered locally; the
  `PgBossAuditQueue` is shipped but the CI Postgres job exercises
  pg-boss through the public adapter API, not the full end-to-end
  queue path. End-to-end Postgres verification remains a release-blocker
  and is tracked in BACKLOG.md.
- Redis, WebSocket, SSE, scheduled jobs, dashboards, and a Dead-Letter
  UI are intentionally out of scope for rc.2.

## [0.1.0-rc.1] - 2026-07-19

### Added

- 7 static analyzers: metadata, stack, documentation, reproducibility,
  secrets, web3, hackathon
- Rule-based scoring (configurable, no LLM involvement)
- ReportBuilder enforcing `evidence` on every finding
- Fastify API: `/health`, `/api/v1/capabilities`, `POST /api/v1/audits`,
  `GET /api/v1/audits/:jobId`
- Drizzle ORM — **two schema files** (SQLite + Postgres) and **two
  migration paths**, with a tagged-union `DB` handle in
  `apps/api/src/db/client.ts`. The repository layer is the only
  consumer and works against either backend with an `async` interface.
- `payment_id` has a **unique partial index** on both backends
  (Postgres: `CREATE UNIQUE INDEX ... WHERE payment_id IS NOT NULL`).
  Repository tests assert the constraint.
- PaymentAdapter interface; MockPaymentAdapter (default) and
  OkxPaymentAdapter (x402 v2 + EIP-3009, stub)
- MCP server (stdio) with `audit_github_repository`, `get_audit_status`,
  `get_repopilot_capabilities`
- React + Vite admin UI (form, report view, status bar, download JSON)
- 5 fixture repos: complete / minimal / no-readme / prompt-injection /
  secret-leak / web3-hackathon
- Pino logging with redaction for `Authorization`, `X-PAYMENT`,
  `X-PAYMENT-SIGNATURE`, `X-API-KEY` and `*.password / *.token / ...`
- LLM provider interface; NoopLlmProvider (default) and
  OpenAI-compatible provider
- Dockerfile (multi-stage, non-root, healthcheck) + .dockerignore
- docker-compose (api + Postgres)
- 104 unit + integration tests across 5 packages (including a Postgres
  integration test that activates when `DATABASE_URL` points at a
  Postgres instance, and a SQLite repository test that runs in CI
  by default)
- `POST /api/v1/free-check` — free, no-payment readiness signal
  (5 quick checks, never 402, registered in OpenAPI + capabilities)
- Report cache (per repo + commit SHA, configurable TTL, persistent in
  the same DB as jobs, request-coalescing, never bypasses payment;
  cache key includes commit SHA so SHA changes invalidate)
- Documentation: README, README_OKX, MARKETPLACE_LISTING (CN/EN)
- `.env.example` covering all 20+ environment variables
- `pnpm env:check` validates dev / production / okx mode
- `pnpm verify:release` runs the full end-to-end smoke
- `pnpm docker:check` reviews Docker config statically
- `pnpm lint` runs tsc + project-specific static rules
- GitHub Actions CI: Node 22 + pnpm 11 + SQLite + Postgres service
  container + verify:release
- GitHub Actions Docker: buildx, no push, smoke `/health`
- `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `SECURITY.md`, `API.md`,
  `MCP_CLIENT_SETUP.md`, `EXTERNAL_ACTIONS.md`, `RELEASE_CHECKLIST.md`,
  `HERO_IMAGE_BRIEF.md`
- `docs/deployment/nginx.conf.example`, `Caddyfile.example`
- Project management: PROJECT_STATE, ROADMAP, BACKLOG, DECISIONS, RISKS,
  CHANGELOG

### Security

- URL allowlist (`github.com`, `raw.githubusercontent.com`) — only
- Path traversal blocked; `.git/`, `node_modules/`, suspicious dotfiles ignored
- Binary files sniffed and skipped
- Target repo code is never executed
- Secret findings return only `path:line:type`; values are masked
- Prompt-injection patterns reported as findings, not followed
- API rate limit (60 req/min) on the audit endpoint
- Production CORS must not be `*` (enforced by env-check)
- `PAYMENT_MODE=mock` fails production (enforced by env-check)
- SQLite allowed in dev; warned in production; Postgres required for prod
- The OKX adapter factory refuses to construct when `recipientAddress`
  is empty. The application does not silently fall back to mock.

### Known limitations

- OKX.AI Beta not granted; `OkxPaymentAdapter` is wired but disabled
  unless `OKX_PAYMENT_ADDRESS` is configured. See `docs/EXTERNAL_ACTIONS.md`.
- `mode: 'full'` runs synchronously inside the HTTP request;
  very large repos may time out. 50 MiB / 2000 files documented.
- LLM is opt-in; default is template-based copy. This is by design.
- Hero image asset not provided; brief in `docs/HERO_IMAGE_BRIEF.md`.
