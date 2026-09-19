# DECISIONS.md

Architecture Decision Records (ADR-style, lightweight).

---

## D-001 — TypeScript strict + NodeNext ESM

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** Project started fresh; need a single, modern, deployable target.
- **Decision:** `tsconfig.base.json` uses `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`, `module: NodeNext`, `moduleResolution: NodeNext`.
- **Consequences:** All internal imports use `.js` extension (NodeNext requires it
  even though source is `.ts`). tsc emits `.d.ts` and `.js` per package; no bundler
  in the back-end. Slightly noisier type errors near index access — a feature, not a bug.

## D-002 — pnpm workspaces + `allowBuilds` for native modules

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** better-sqlite3 and esbuild need post-install native build steps.
- **Decision:** `pnpm-workspace.yaml` uses `allowBuilds:` (not the older
  `onlyBuiltDependencies:`) to whitelist `better-sqlite3` and `esbuild`.
- **Consequences:** Reproducible installs across Node 22, no interactive approval.

## D-003 — Zod 3.24.1 + MCP SDK 1.22.0

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** `@modelcontextprotocol/sdk@1.23.0+` imports `zod/v3` subpath,
  which zod 3.25.x added. The deployment mirror (`registry.npmmirror.com`)
  does not currently ship a 3.25.x dist tarball, so a clean install cannot
  resolve `zod/v3` and TypeScript fails to type-check.
- **Decision:** Pin Zod to `^3.24.1` and `@modelcontextprotocol/sdk` to
  exactly `1.22.0` (last version that still allows Zod 3.24).
- **Consequences:** No `zod/v3` import in our code. The MCP features we
  use (`Server`, `StdioServerTransport`, `tool()`) all work on 1.22.0.
  When the registry starts serving zod 3.25 dists, we can revisit.

## D-004 — Pino 10 + named import

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** Pino 9/10 changed ESM exports; the default export is no
  longer a callable function. fastify 5 forces pino >= 10.
- **Decision:** Always use `import { pino } from 'pino'`. Pin `pino@^10.0.0`
  across all three back-end packages so types align with fastify 5.10's
  transitive pino@10.3.1.
- **Consequences:** If we accidentally use `import pino from 'pino'`,
  `pino()` will fail with "pino is not a function" at runtime. tsc
  catches it; we keep the lint rule for safety.

## D-005 — Drizzle hand-rolled migrations (no `drizzle-kit`)

- **Date:** 2026-07-19
- **Status:** Accepted (revisit at 0.4.0)
- **Context:** `drizzle-kit generate` currently targets a single dialect.
  We want one schema that works on both SQLite (dev) and Postgres (prod).
- **Decision:** Hand-write CREATE statements in `apps/api/src/db/client.ts`
  and call them through `db.run` (SQLite) or `client.query` (Postgres).
- **Consequences:** Boring SQL, no `drizzle-kit` dependency, but we have
  to keep two paths in sync. Documented in `docs/DEPLOYMENT.md` and
  revisited in P1 backlog.

## D-006 — Mock payment is the dev default, OKX is opt-in

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** OKX.AI Beta is not open. Local development must work
  end-to-end with no external services.
- **Decision:** Default `PAYMENT_MODE=mock`. The factory refuses to
  construct an `OkxPaymentAdapter` if `isConfigured()` is false; the API
  starts with a clear error in production mode if OKX is requested
  but unconfigured. The mock is not wired into the OKX path.
- **Consequences:** Zero risk of a real charge during dev. Switching
  to OKX in production requires explicit configuration. The `paymentMode`
  in `/health` always reflects the active adapter.

## D-007 — Static analysis only

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** The system ingests untrusted repositories. Running their
  npm scripts, Makefile, Dockerfile or shell would be a sandbox escape
  waiting to happen.
- **Decision:** We never execute target repo code. We only read text.
  Binary files are sniffed and skipped. The pipeline stops at string
  analysis. We mark this explicitly in the report's `limitations` field
  and in `MARKETPLACE_LISTING.md`.
- **Consequences:** The product is honest about what it is. We do not
  ship a "run this in a sandbox" mode. Even sandboxed execution is
  out of scope for the MVP.

## D-008 — Evidence is mandatory for every finding

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** Reports must be consumed by other AI agents and humans.
  A score with no proof is useless and dangerous.
- **Decision:** `ReportBuilder` rejects any finding whose `evidence` is
  empty. Tests assert that every item in `blockers / documentationGaps /
  securityFindings / deploymentPlan / recommendedTasks` has at least one
  evidence entry with `file` and `reason`.
- **Consequences:** The schema cannot drift into "AI gave a 9 out of 10
  because it felt like it". LLM providers are only allowed to write
  natural-language copy, never the score or the evidence.

## D-009 — LLM is optional, not load-bearing

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** A user without an OpenAI key still needs a useful report.
- **Decision:** `LLM_PROVIDER=noop` (default) routes all LLM calls to
  `NoopLlmProvider`, which uses template-generated `summary` and
  `launchCopy`. `OpenAICompatibleProvider` exists for opt-in.
- **Consequences:** The MVP has zero LLM cost in dev or production. The
  report is always schema-valid. LLM is purely an upgrade, not a
  dependency.

## D-010 — Single-process API + worker model (for now)

- **Date:** 2026-07-19
- **Status:** Accepted (revisit at 0.2.0)
- **Context:** `mode: 'full'` is currently synchronous inside the HTTP
  request. Acceptable for `quick` and for the `complete-project` fixture,
  but not for large repos.
- **Decision:** Keep synchronous in 0.1.0. Add a queue + worker in
  0.2.0 (P1). The MCP `get_audit_status` tool is already designed
  to poll, so the future migration is non-breaking.
- **Consequences:** `full` audits on > 50 MiB repos will time out.
  We document the 50 MiB / 2000-file limit in `/api/v1/capabilities`.

## D-011 — Two payment tests, never one shared one

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** During development, the integration test was flaky
  because `findByPaymentId` could return the wrong job when tests
  shared a database.
- **Decision:** Each POST creates a fresh `paymentId` (no `quoteKey`
  caching in the mock). The route layer is the only place that
  performs `paymentId → job` lookup and reuses the existing job.
  The mock test asserts that *the API route* (not the adapter) is
  the source of idempotency.
- **Consequences:** Adapter tests stay simple. Route tests exercise
  idempotency explicitly with two POSTs sharing an `X-PAYMENT` header.

## D-012 — Pino redact covers all known secret paths

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** Headers like `Authorization`, `X-PAYMENT`, `X-PAYMENT-SIGNATURE`
  and field names like `password / token / apiKey / secret / privateKey /
  mnemonic` must never appear in logs.
- **Decision:** Configure Pino redact at the Fastify logger level using
  the standard path syntax. Add an integration test that POSTs a request
  with known secrets and asserts they do not appear in captured logs.
- **Consequences:** If a future field is added, the redact list must be
  updated. We surface this requirement in `docs/SECURITY.md`.

## D-013 — AuditQueue interface + two adapters (Inline / PgBoss)

- **Date:** 2026-07-19
- **Status:** Accepted (0.1.0-rc.2)
- **Context:** Audits must become asynchronous (HTTP 202) so that
  long-running `full` audits do not block HTTP workers, and so that
  multiple API replicas can share work. The system must not couple
  business code to any one queue library.
- **Decision:** Introduce a single `AuditQueue` interface
  (`apps/api/src/queue/audit-queue.ts`) with `start`, `stop`, `enqueue`,
  `health`. Implement two adapters:
  - `InlineAuditQueue` for SQLite dev, unit tests, and `verify:release`.
    Bounded by `AUDIT_QUEUE_CONCURRENCY` (default 1), idempotent at
    jobId, supports graceful shutdown.
  - `PgBossAuditQueue` (pg-boss 12.26.1) for production. The pg-boss
    queue owns its own connection pool; we pass
    `application_name: 'repopilot-audit-worker'` for observability.
  Analyzers, scoring, Report Cache, payment adapter, and routes do
  not import pg-boss.
- **Consequences:** When the queue driver changes, only
  `server.ts` (which wires the adapter) and the adapter itself
  change. Worker code is the same for both.

## D-014 — Single `AuditWorker` is the only state-machine owner

- **Date:** 2026-07-19
- **Status:** Accepted (0.1.0-rc.2)
- **Context:** Naively, the route could enqueue and update job status
  directly. That makes idempotency, retries, and graceful shutdown
  ambiguous.
- **Decision:** All job state transitions go through
  `services/audit-worker.ts`. The route layer only: validates input,
  verifies payment, creates a `queued` job, enqueues. The worker:
  loads by jobId, atomically transitions `queued → processing`,
  calls the existing Report Cache, persists `completed` or `failed`,
  and returns void / throws `AuditError(retryable)`. The queue
  adapter decides whether to retry.
- **Consequences:** Two code paths can never disagree on the
  state machine. Retry semantics live with the queue, not the route.
  Payment is verified exactly once, in the route, before enqueue.

## D-015 — Audit POST always returns 202, Free Check stays 200

- **Date:** 2026-07-19
- **Status:** Accepted (0.1.0-rc.2)
- **Context:** The previous `mode: 'quick' → 200, mode: 'full' → 202`
  distinction was unstable: clients had to know which mode was which.
  Free Check is a low-cost, synchronous readiness signal.
- **Decision:** `POST /api/v1/audits` always returns 202 + `Location`
  + `Retry-After: 1` regardless of mode. `POST /api/v1/free-check`
  stays synchronous 200. `GET /api/v1/audits/:jobId` returns 202 while
  queued/processing and 200 when completed; failed jobs return a
  stable structured error.
- **Consequences:** Clients have a single async contract. Free Check
  remains a fast no-payment readiness probe.

## D-016 — Production must use a persistent queue

- **Date:** 2026-07-19
- **Status:** Accepted (0.1.0-rc.2)
- **Context:** The inline queue does not survive process restarts
  and is unsafe for multi-replica deployments.
- **Decision:** `NODE_ENV=production` requires
  `AUDIT_QUEUE_DRIVER=pg-boss`. `production + inline` fails the start.
  An explicit `ALLOW_INLINE_QUEUE_IN_PRODUCTION=1` exists for
  documented disaster-recovery but is not advertised in
  `.env.example`. `pnpm env:check` enforces the rule.
- **Consequences:** Production deploys cannot accidentally run with
  an in-process queue. The `queue` block in `/health` is the
  operator's primary detection signal.
