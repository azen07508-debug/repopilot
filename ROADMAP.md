# ROADMAP.md

RepoPilot is being prepared for a **0.1.0-rc.2** release candidate.
Beyond that, the project moves into a **beta** phase gated on external approvals.

## 0.1.0-rc.2 (current sprint)

**Goal:** Production-safe deployment. Replace the synchronous audit
path with a stable async queue, and harden production configuration
against the two highest-impact misconfigurations: Mock Payment in
production and an in-process queue in production.

### Scope (must land before tagging)

- [x] **Production guards.** Schema-level refusal of
  `NODE_ENV=production` + `PAYMENT_MODE=mock` and
  `NODE_ENV=production` + `AUDIT_QUEUE_DRIVER=inline`. The same rules
  are encoded in `pnpm env:check`. Error messages never include
  secrets. R-02 and the new R-16 are marked mitigated in `RISKS.md`,
  but the production `/health` check remains a release-blocker.
- [x] **AuditQueue interface + two adapters.** `AuditQueue` defines
  `start / stop / enqueue / health`. `InlineAuditQueue` covers SQLite
  dev, tests, and `verify:release`. `PgBossAuditQueue` covers
  production with persistent jobs, retry, and graceful shutdown.
  Business code does not depend on pg-boss.
- [x] **Single `AuditWorker`.** Owns the state machine
  (`queued → processing → completed | failed`), calls the existing
  Report Cache, never re-validates payment, never bypasses payment,
  is idempotent at jobId, classifies errors for retry decisions.
- [x] **Audit API 202 contract.** `POST /api/v1/audits` always
  returns 202 + `Location` + `Retry-After: 1`. `GET /api/v1/audits/:jobId`
  returns 202 while queued/processing and 200 when completed.
  Failed jobs return a stable structured error. OpenAPI updated.
- [x] **Idempotency.** `Idempotency-Key` header is first-class
  (unique index on `jobs.idempotency_key`, sequential + concurrent
  tests). `X-PAYMENT` already deduplicated by `payment_id`; both
  keys coexist.
- [x] **Graceful shutdown.** `SHUTDOWN_GRACE_PERIOD_MS` (default
  30000). Fastify onClose stops accepting jobs, drains in-flight
  workers, closes the queue, then the DB. `/health` reports
  `queue.acceptingJobs=false` while shutting down.
- [x] **/health queue block.** Reports `driver`, `status`,
  `acceptingJobs`. Never returns the connection string, internal
  worker ids, or secrets.
- [x] **Jobs table migrations** for both backends: `attempts`,
  `started_at`, `completed_at`, `failed_at`, `error_code`,
  `idempotency_key` (unique). Conditional `queued → processing`
  transitions.
- [x] **Documentation.** `CHANGELOG.md`, `RISKS.md`, `DECISIONS.md`,
  `PROJECT_STATE.md`, `ROADMAP.md`, `BACKLOG.md`, `.env.example`
  all updated.
- [x] **Version bump.** 0.1.0-rc.1 → 0.1.0-rc.2 across all
  package.json files.

### Done in this RC pass

- New files: `apps/api/src/queue/audit-queue.ts`,
  `apps/api/src/queue/inline-audit-queue.ts`,
  `apps/api/src/queue/pg-boss-audit-queue.ts`,
  `apps/api/src/services/audit-worker.ts`.
- Updated: `apps/api/src/server.ts` (queue wiring + graceful
  shutdown), `apps/api/src/routes/audits.ts` (202 contract), the
  jobs repository (new columns + conditional update), DB schema
  (SQLite + Postgres), `openapi.ts` (202 + Location + Retry-After
  + queue block), `config.ts` (production guards), `env-check.ts`
  (queue rules), `.env.example` (queue + shutdown + cache TTL),
  tests (api / sqlite / postgres integration).
- Local SQLite test path uses `InlineAuditQueue`. The Postgres CI
  test path uses the public PgBoss adapter API and the same worker
  code.

### Verification

- `pnpm lint` — 0 issues.
- `pnpm -r typecheck` — 0 errors.
- `pnpm env:check` — 0 error / 0 warning / 0 info.
- `pnpm -r test` — 104 tests pass, 2 skipped (Postgres requires a
  live database; covered in CI).
- `pnpm build` — all 5 packages + 2 apps compile clean.
- `pnpm verify:release` — full smoke green (202 + Location +
  Retry-After, cache miss/hit, free-check 200/404/429/502 accepted).
- Secret scan: no `.env`, OKX secret, GitHub token, database
  password, or payment header was found in tracked or staged files.

## 0.1.0-rc.1 (previous)

**Goal:** A reviewer can clone the repo, run `pnpm install && pnpm verify:release`,
and see all 104 tests pass plus a successful mock-payment audit cycle. No
production credentials required.

### Scope (must land before tagging)

- [x] Core: 7 analyzers + scoring + report builder + secret + injection
- [x] API: routes, services, repositories, Drizzle schema, migration, health, capabilities
- [x] MCP: stdio server, 3 tools, JSON-RPC, smoke-tested
- [x] Mock payment adapter: 13 tests covering idempotency, status machine, envelope parsing
- [x] OKX adapter: STUB with EIP-3009/EIP-712 + viem signature verification when configured
- [x] 5 fixtures: complete / minimal / no-readme / prompt-injection / secret-leak / web3-hackathon
- [x] API integration test: full happy-path + error contracts
- [x] End-to-end pipeline test against complete-project fixture
- [x] GitHub Actions CI (Node 22 + pnpm 11 + Postgres service container)
- [x] GitHub Actions Docker build (setup-buildx, no push)
- [x] env:check script + tightened .env.example
- [x] docs/EXTERNAL_ACTIONS.md
- [x] docs/RELEASE_CHECKLIST.md
- [x] docs/MCP_CLIENT_SETUP.md
- [x] docs/HERO_IMAGE_BRIEF.md
- [x] docs/ARCHITECTURE.md
- [x] docs/DEPLOYMENT.md
- [x] docs/SECURITY.md
- [x] docs/API.md
- [x] scripts/verify-release.ts + `pnpm verify:release`
- [x] PostgreSQL integration test (in CI)
- [x] scripts/docker-check.sh + `pnpm docker:check`
- [x] Lint configuration (eslint flat config) + `pnpm lint`
- [x] Mark OkxPaymentAdapter as STUB explicitly + add docs reference
- [x] Project management files: PROJECT_STATE / ROADMAP / BACKLOG / DECISIONS / RISKS / CHANGELOG
- [x] Documentation cleanup: remove duplicated CN/EN blocks from README
- [x] **Free Check** endpoint (`POST /api/v1/free-check`) — 5 quick checks, never 402, free of payment
- [x] **Report cache** — persistent cache (SQLite + Postgres), TTL configurable, request-coalescing, key includes commit SHA so SHA changes invalidate; cache never bypasses payment

## 0.1.0 (after rc.2)

- Tag rc.2 once 14+ days pass with no critical bugs from CI
- Announce on README + GitHub Releases
- Publish Docker image to GHCR (no production secrets)

## 0.2.0 (next minor, post-Beta)

- Real OKX on-chain settlement once Beta access granted
- Replace stub `OkxPaymentAdapter` with documented production wiring
- Add `x402` receipt verification against on-chain `authorizationUsed` state
- Standalone worker process extracted from API process
- Add an MCP HTTP transport (SSE) alongside stdio
- API key rate limiting (per-key) once the key issuance flow is shipped

## 0.3.0 (LLM-enhanced)

- Wire OpenAI-compatible provider for `summary` + `launchCopy`
- Keep scoring rule-based; LLM is only allowed to write natural-language
- Provider interface already shipped; no business-logic changes needed

## 0.4.0 (Web3 hackathon season)

- Multi-network analysis (read both XLayer + mainnet)
- Solidity static analysis hardening (Slither integration optional, sandboxed)
- Live contract-read integration (read-only RPC) for ABI verification

## Out of scope (intentionally not in MVP)

- Running target repo code (forbidden by security model)
- Private repositories (SSRF + auth surface)
- Formal security audit claims (we explicitly disclaim in MARKETPLACE_LISTING)
- Price recommendations / trading signals
- Token / wallet management
- Redis, WebSocket, SSE progress streaming (rc.2 ships 202 + polling only)
