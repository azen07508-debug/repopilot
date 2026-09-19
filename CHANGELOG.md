# CHANGELOG.md

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
