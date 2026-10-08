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
- [x] **End-to-end Postgres integration** was **not** in rc.2 — the
  PgBoss adapter shipped and was unit-test covered locally, but the
  CI Postgres job ran only the public adapter API. That stayed a
  release-blocker until 2026-10-06, when
  `apps/api/src/tests/pg-boss.integration.test.ts` landed and the
  `db: postgres` matrix leg began running the queue end to end.

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

- [x] **The lint gate builds before it type-checks.** Done in R-33. `apps/*`
  reach `@repopilot/core` through its `exports` field, so their `tsc --noEmit`
  reads `dist/*.d.ts` from disk; a stale `dist` made `pnpm lint` print
  `✓ tsc clean` about the previous contract — and it did, hiding two
  independent violations that CI found. `scripts/lint.ts` step 1 now compares
  each package's newest `src` mtime against its newest `dist` mtime and builds
  the ones whose `dist` is older, in the same step, printing which it rebuilt.
  Conditional rather than unconditional so a `lint` run does not rewrite `dist`
  on every invocation and so a stale tree is a fact the gate *reports* rather
  than one it silently repairs. `DECISIONS.md` D-041.
- [x] **A step that cannot fail is not a step.** Done in R-26. `verify:release`
  step 2 ran `pnpm -r lint` — five `echo skip-package-lint` stubs — with
  `allowFail: true` inside a `try`/`catch`, so the release verifier reported OK
  for a lint it never ran; step 5 ran `pnpm build` with `allowFail: true`, so a
  failed build printed OK and surfaced as "the api did not answer `/health`" or
  not at all. The stubs are deleted, both `allowFail`s are gone, step 2 runs
  the real gate and prints its output, and `scripts/lint.ts` gained
  `no-noop-script` — it reports any manifest script whose body is a bare
  `echo`, `true`, `:` or `exit 0`. `DECISIONS.md` D-042.
- [ ] **Give the inline queue a deadline and a terminal state.** R-43, found by
  this batch. `AuditWorker.runOnce` reverts a *retryable* failure to
  `processing` and re-throws so the queue can re-deliver; `pg-boss` re-delivers
  and expires the job at `expireInSeconds` (300 s), while `buildAuditQueue`
  hands the inline driver neither `retryLimit` nor `jobTimeoutMs` and
  `InlineAuditQueue.dispatch()` swallows the throw — so the row stays
  `processing` and nothing moves it. Reachable in local dev, tests and
  `verify:release`, not in production (R-16 refuses the driver there). Fix:
  wrap `runOne` in the `AUDIT_QUEUE_JOB_TIMEOUT_MS` that `build-queue.ts`
  already reads, and mark the row `failed` with `errorCode: 'UPSTREAM_FAILED'`
  on expiry or on a thrown retryable error. Needs a test pinning that a
  retryable failure on the inline driver reaches a terminal state — which is
  why it is not in this batch.
- [ ] **Type-check `scripts/`.** R-31, still open and now measured twice:
  a `tsconfig.scripts.json` over `scripts/**/*.ts` produces **52** errors
  (51 when the risk was written on 2026-10-02; 56 on 2026-10-08, 55 after the
  `okx-seller-smoke.ts` fix, 56 when this batch added `scripts/test-baseline.ts`,
  and 52 once the `verify-release.ts` refactor removed four `possibly null`
  sites — the number tracks the code, not progress). Ten are `TS1470`, one per
  file, and go away with `"type": "module"` in the root `package.json`; one is
  `zod` resolving at runtime but not for `tsc`; two are real null-safety sites
  in `okx-seller-smoke.ts`; the remaining thirty are the
  `noUncheckedIndexedAccess` family, two thirds of them in `docs-facts.ts` (23)
  and `lint.ts` (13) — the only group where narrowing the flag for `scripts/`,
  with the reason written down, may be the honest answer. All-or-nothing: the
  config cannot land until the count is zero. It has now cost two real errors
  found by hand (`api.kill` during R-42, the x402 `accepts[]` mismatch), which
  is the trigger written into `RISKS.md` R-31.
- [ ] **Check the Postgres test baseline in CI.** `scripts/test-baseline.ts`
  landed with `verify:release` step 4b, but `verify:release` runs in CI's
  sqlite leg only (`.github/workflows/ci.yml:187`), so the
  `**postgres**` line in `PROJECT_STATE.md` is verified by **nothing**. The
  fix is small and needs a transcript: the existing `Test` step captures
  `pnpm -r test | tee "$RUNNER_TEMP/test-output.txt"` with
  `set -o pipefail` (without it the pipeline returns `tee`'s exit code and a
  failing suite reports success — the trap that makes this more than a
  one-liner), then a `pnpm test:baseline --check --from
  "$RUNNER_TEMP/test-output.txt"` step runs on both legs, each checking its
  own line. Not done in the same batch as the generator because it is a CI
  behaviour change that cannot be exercised locally, and a gate change that
  lands unverified is how R-33 happened.
- [x] **The test baseline in `PROJECT_STATE.md` is generated and checked.**
  Done — `scripts/test-baseline.ts`. It had drifted in this batch (the file
  said 1101 while the suite reported 1108) and the drift was found by running
  the tests, not by a gate. `scripts/docs-facts.ts` excludes test totals on
  purpose — a generator cannot know them without running the suite, which
  would make the check circular — so this one **consumes** a run instead of
  producing one: `verify:release` step 4b parses the transcript of the run
  step 4 just performed and compares it against the generated block in
  `PROJECT_STATE.md`, per leg, failing with both numbers when they disagree.
  `pnpm test:baseline --write` regenerates the block. Two properties are
  load-bearing and both are mutation-tested: a transcript with no summary
  lines reports a **parse failure**, not `0 passed` (R-26's shape), and a
  drifted total reports both numbers rather than "mismatch".
- [x] **Persist the burned authorization nonces.** Done in R-42. The burn is a
  call on an injected `NonceStore` (`packages/okx-adapter/src/nonce-store.ts`)
  instead of `OkxPaymentAdapter`'s in-process `Set`, and `apps/api` injects
  `NonceRepository` — a `burned_nonces` table whose primary key is the
  `(from, nonce)` pair, so the insert *is* the single-use check rather than a
  `SELECT` followed by one. `packages/mcp-server` keeps the in-memory default on
  purpose: it verifies payments only in mock mode, where no nonce is ever
  reached. `DECISIONS.md` D-040 records the rest — why the burn does not need to
  share a transaction with the job it pays for (the route creates the job before
  it mints the challenge, so the window the original entry worried about does not
  exist), and what the buyer gives up in exchange for at-most-once. R-40's
  "durability gap" paragraph in `RISKS.md` is closed.
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
- [x] **End-to-end Postgres CI job for the queue.** `PgBossAuditQueue`
  is exercised end to end against the CI Postgres service container by
  `apps/api/src/tests/pg-boss.integration.test.ts`: enqueue → work →
  completion, a failure retried up to `retryLimit` and then stopping,
  and the `consume: false` split where one instance enqueues and
  another consumes. Five cases; the `consume` one was mutation-checked
  (forcing the guard to `true` turns it red). Verified locally against
  a real Postgres before the push, not only in CI.
  `PgBossAuditQueueDeps` gained an optional `queueName` so the cases do
  not share a queue — a pg-boss queue is global to the database, not
  the process.
- [ ] **MCP HTTP transport (SSE).** Deferred per rc.2 scope.
- [ ] **OpenAPI generator script** to publish `/docs/openapi.json`
- [ ] **OpenTelemetry traces**
- [ ] **Rate-limit per API key** (not just IP) — once key issuance is shipped
- [ ] **Dead-Letter UI** for permanently failed jobs (intentionally
  not in rc.2; `jobs.error` and `jobs.error_code` already capture
  the reason)

## P2 — backlog

- [ ] **`scripts/okx-seller-smoke.ts` has the startup-wait defect that was just
  fixed in `verify:release.ts`, in a third copy.** `waitForHealth(15_000)`
  hard-codes the same budget that was too short on a cold start, and the script
  discards the child's stdout and stderr (`proc.stdout.on('data', () => {})`),
  so a server that died on a port clash produces one message that names the
  symptom and hides the cause. Not in the R-26/R-33 batch on purpose: it is not
  run in CI, so the cost of leaving it is a confusing local failure rather than
  a false green, and mixing an unrelated refactor into a gate-fix commit makes
  the next CI failure ambiguous. The fix is to reuse the three-state wait
  (`spawnError` / exited / alive-and-silent) that `verify-release.ts` now has —
  which probably means lifting it into a small shared module rather than
  copying it a fourth time.
- [ ] **Give every entry in `RISKS.md` a `Status:` line.** Twenty of forty-one
  have one as of 2026-10-08; the other twenty-one predate the convention and
  are closed in fact rather than in form. Without the line, "which of these are
  still open?" is only answerable by reading every entry end to end — a search
  for "open" returns a partial answer that looks complete. A one-line-per-entry
  sweep, then the convention is uniform and the grep is reliable.
- [ ] Drizzle migration generator for Postgres (currently the SQLite schema
  is hand-written; would be nice to drive it from `drizzle-kit generate`)
- [ ] Admin UI: job list / job detail (currently only a single-shot form)
- [ ] i18n in web UI (currently English only)
- [ ] Markdown export of report
- [ ] PDF export of report
- [ ] VSCode extension embedding MCP server
- [ ] Re-pop analysis (compare current vs previous commit)
- [ ] Multi-repo scan (org-level)
- [ ] **A check that `RISKS.md`'s Contents lists every `## R-NN` heading, and
  nothing else.** R-36 and R-37 were both added to the body without reaching
  the Contents, and nothing noticed — the same defect as the duplicated
  `### Changed` in `CHANGELOG.md`, in the one file that is deliberately
  block-free. Fix the instance by hand (done) and then make it a check, with
  its own injection test, rather than a convention.
- [ ] **Nothing executes the commands the documents tell a human to run.**
  `docs:check` verifies `pnpm <script>` references and, since 2026-10-05, the
  one `docker run` environment pair that `validateProductionConfig` refuses
  (`checkDockerRunConfig()`). The rest of every fenced block is unchecked
  prose. The three copies of the single-image Docker instructions were that
  defect, and so is every `curl` example: `docs/API.md`'s 402 body was wrong in
  *shape* — `payment.accepts` where the route returns
  `payment.challenge.accepts` — and only a human reading `audits.ts` was ever
  going to catch it. Running a block needs a live service and is out of reach;
  comparing a documented response body against the route's own JSON schema is
  not, and that is the half worth building.
- [ ] **The MCP `capabilities` tool reports its own limits, and an agent may
  read them as the service's.** `packages/mcp-server/src/index.ts` publishes
  `DEFAULT_LIMITS`, which is the correct answer for that process — it builds
  `AuditPipeline` without passing `maxFiles`/`maxFileBytes`/`maxTotalBytes`, so
  the library defaults are what it enforces. The defect is the one the HTTP
  endpoint had before 2026-10-05, one layer out: a caller that reads the MCP
  tool to size a repository, then sends it to the paid API, is using numbers
  from a different process. The tool description now says so, which is a
  mitigation and not a fix. It needs a decision rather than a patch: read
  `GET /api/v1/capabilities` from the configured base URL, drop the block, or
  rename the key so it cannot be mistaken for the service's. The three answers
  differ in what an agent learns, so it is recorded instead of guessed at. The
  other two blocks were answerable and are answered: `endpoints` is `{}` and
  `cache.enabled` is `false`, because both are true of this process — it
  exposes no HTTP routes and holds no audit cache — and reporting them beats
  omitting them, which cannot be told apart from a server built before the
  fields existed.
- [ ] **`verify:release`'s 15 s health budget is tight enough to fail a slow
  machine.** `scripts/verify-release.ts` spawns `apps/api/dist/server.js` on
  port 4099 and waits `waitForHttp('http://127.0.0.1:4099/health', 15000)`.
  Measured 2026-10-06 on the maintainer's Intel Mac with nothing else running:
  **ready after 16 844 ms** — so the step fails locally, by about two seconds,
  every time. The server is not broken: it answers `/health` 200 and logs
  `RepoPilot API listening on http://127.0.0.1:4099`; it is just slower than
  the budget. CI (fresh runner, warm cache) comes up inside 15 s, which is why
  this has never been seen there. The fix is one number — raise the budget, or
  make it configurable — and it is not in R-39's scope, so it is recorded
  rather than changed. Worth noting before raising it: the startup cost itself
  (≈15 s) is the interesting number, and it is not the DB (`buildApp` finishes
  its SQLite migrations in milliseconds).
