# BACKLOG.md

Tracked work, in priority order, updated as items are completed.

## P0 — landed in 0.1.0-rc.2

- [x] **Production guards.** Schema-level refusal of
  `production + PAYMENT_MODE=mock` and `production +
  AUDIT_QUEUE_DRIVER=inline`. Encoded in `apps/api/src/config.ts`
  and `scripts/env-check.ts`. R-02 + R-16 marked mitigated in
  `RISKS.md` (still release-blockers until verified against prod).
- [x] **AuditQueue interface + two adapters.** `AuditQueue` with
  `InlineAuditQueue` (SQLite dev / tests / verify:release) and
  `PgBossAuditQueue` (production, pg-boss 12.26.1).
- [x] **Single `AuditWorker`.** Owns the state machine; idempotent
  at jobId; never bypasses payment; never re-validates payment.
- [x] **Audit API 202 contract.** `POST /api/v1/audits` always
  returns 202 + `Location` + `Retry-After: 1`. `GET /api/v1/audits/:jobId`
  returns 202 while queued/processing and 200 when completed.
  OpenAPI updated. `verify:release` adapted.
- [x] **Idempotency-Key** first-class: unique index on
  `jobs.idempotency_key`, sequential + concurrent tests.
- [x] **Graceful shutdown.** `SHUTDOWN_GRACE_PERIOD_MS` (default
  30000). `onClose` drains in-flight workers, closes the queue,
  then the DB. `/health` reports `queue.acceptingJobs=false` while
  shutting down.
- [x] **/health queue block** (driver, status, acceptingJobs). No
  secrets, no connection strings.
- [x] **Jobs table migrations** for both backends:
  `attempts`, `started_at`, `completed_at`, `failed_at`,
  `error_code`, `idempotency_key` (unique). Conditional
  `queued → processing` transitions.
- [x] **Documentation.** `CHANGELOG.md`, `RISKS.md`, `DECISIONS.md`,
  `PROJECT_STATE.md`, `ROADMAP.md`, `BACKLOG.md`, `.env.example`
  updated.
- [x] **Version bump** 0.1.0-rc.1 → 0.1.0-rc.2 across all
  package.json files.
- [x] **End-to-end Postgres integration** is **not** in rc.2 — the
  PgBoss adapter ships and is unit-test covered locally, but the
  CI Postgres job runs only the public adapter API. Full
  end-to-end Postgres verification remains a release-blocker and
  is tracked below.

## P0 — must land for 0.1.0-rc.1 (shipped in 0.1.0-rc.1)

- [x] **CI** (`.github/workflows/ci.yml`): Node 22 + pnpm 11 + Postgres 16 service + lint + typecheck + test + build
- [x] **Docker CI** (`.github/workflows/docker.yml`): setup-buildx, no-push, health-check
- [x] **env:check** (`scripts/env-check.ts`): validate env vars, never print values, fail loud
- [x] **verify:release** (`scripts/verify-release.ts`): full end-to-end smoke
- [x] **docs/EXTERNAL_ACTIONS.md**: only user-side items
- [x] **docs/RELEASE_CHECKLIST.md**: pre-tag checklist
- [x] **docs/MCP_CLIENT_SETUP.md**: client examples (Codex, Claude Code, OpenClaw, generic)
- [x] **docs/HERO_IMAGE_BRIEF.md**: hero asset spec
- [x] **docs/ARCHITECTURE.md**: replace inline README architecture section
- [x] **docs/DEPLOYMENT.md**: nginx / caddy / docker / vps / railway / render
- [x] **docs/SECURITY.md**: threat model + mitigations
- [x] **docs/API.md**: full HTTP reference
- [x] **PostgreSQL integration test**: under CI service container
- [x] **docker:check** script (`scripts/docker-check.sh`)
- [x] **lint** (`eslint` flat config + `pnpm lint`)
- [x] **OkxPaymentAdapter stub marker**: visible in code, documented in EXTERNAL_ACTIONS
- [x] **Document cleanup**: remove duplicated CN/EN from README
- [x] **Free Check** endpoint (`POST /api/v1/free-check`): 5 quick checks, never 402, free of payment
- [x] **Report cache** (per repo + commit SHA, 1 h default TTL, persistent, request-coalescing)

## P1 — post-rc.2

- [x] **Standalone worker process.** Extracted from the API
  process. New `src/worker.ts` entry point; shared
  `src/queue/build-queue.ts` factory. Production uses
  `AUDIT_QUEUE_DRIVER=pg-boss` and the API runs in
  `REPOPILOT_API_MODE=http` (enqueue-only) while the worker
  process consumes. Inline driver is refused in `http` mode
  to prevent silent job loss. New `pnpm dev:api`, `dev:worker`,
  `start:api`, `start:worker` scripts. `verify:release` and
  the existing `pnpm dev` flow stay on combined mode for
  backward compatibility. 4 new tests in `src/worker.test.ts`.
- [ ] **End-to-end Postgres CI job for the queue.** Exercise
  PgBossAuditQueue end-to-end against the CI Postgres service
  container (enqueue + work + completed + retry). Currently the
  CI Postgres job only exercises the public adapter API.
- [ ] **MCP HTTP transport (SSE).** Deferred per rc.2 scope.
- [ ] **OpenAPI generator script** to publish `/docs/openapi.json`
- [ ] **OpenTelemetry traces**
- [ ] **Rate-limit per API key** (not just IP) — once key issuance is shipped
- [ ] **Dead-Letter UI** for permanently failed jobs (intentionally
  not in rc.2; `jobs.error` and `jobs.error_code` already capture
  the reason)

## P2 — backlog

- [ ] Drizzle migration generator for Postgres (currently the SQLite schema
  is hand-written; would be nice to drive it from `drizzle-kit generate`)
- [ ] Admin UI: job list / job detail (currently only a single-shot form)
- [ ] i18n in web UI (currently English only)
- [ ] Markdown export of report
- [ ] PDF export of report
- [ ] VSCode extension embedding MCP server
- [ ] Re-pop analysis (compare current vs previous commit)
- [ ] Multi-repo scan (org-level)
