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

## Recent shipped changes (0.1.0-rc.2)

- Production guards: `production + PAYMENT_MODE=mock` and
  `production + AUDIT_QUEUE_DRIVER=inline` now both fail app start
  with a clear, secret-free error (schema-level + env-check).
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
