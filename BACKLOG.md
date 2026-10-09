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
- [x] **`apps/web`'s build emitted 61 files that the next command deleted.**
  Done, and found by trying to run the gate twice. `build` was
  `tsc -p tsconfig.json && vite build` with both writing `./dist`, and
  `vite build` empties its output directory first — so the emit was discarded
  before the build finished, and nothing consumes it (`@repopilot/web` is private
  with no `main`/`exports`/`types`/`files`, nothing depends on it, and the `web`
  image serves `dist` as static files). `tsc` is there to type-check, which the
  package's own `typecheck` script already said, so it is `--noEmit` now. The
  visible symptom was a gate that could not be re-run: the second run had 61
  files to empty, over the bulk-delete guard's threshold. Worth writing down
  because the guard was the messenger, not the cause.
- [x] **Give the inline queue a deadline and a terminal state.** Done — and it
  was not only the inline queue. `AuditWorker.runOnce` left a *retryable*
  failure in `processing`; the inline driver never re-delivered and never
  terminated, and the pg-boss driver *did* re-deliver but the retry was a no-op
  — `runOnce` skips a job it finds in `processing`, so the redelivery arrived,
  found its own leftovers, and returned. `retryLimit` was configured, read, and
  meaningless on both. The fix puts the attempt budget and the deadline in the
  worker, where the row's `attempts` count is: the take increments it, a failure
  is terminal when the classification is permanent *or* the budget is spent, a
  retryable failure with an attempt left parks the row in `queued` (claimable,
  and true), and one attempt is bounded by `AUDIT_QUEUE_JOB_TIMEOUT_MS` and
  reported as the new `JOB_TIMEOUT`. `buildAuditQueue` hands the inline driver
  the same `retryLimit` pg-boss gets, and pg-boss's `expireInSeconds` gained
  30 s of headroom so the worker's deadline is the one that fires.
  `apps/api/src/services/audit-worker.test.ts` pins the invariant, and three
  mutations of the fix turn it red. Two corrections to what this item said: the
  expiry code is `JOB_TIMEOUT`, not `UPSTREAM_FAILED` (a hung request is not a
  rejected one), and the defect was not inline-only — the production driver had
  it too, one layer down. Residuals (the `classify` ordering heuristic, and a
  row that cannot be read at all) are recorded in `RISKS.md` R-43.
- [x] **Type-check `scripts/`.** Done — R-31, closed 2026-10-08 with the count at
  **0**. The number had been measured four times (51, 56, 55, 56) and tracked the
  code rather than progress; the final measurement was 52, and this entry's own
  breakdown of it was right except in three places, all corrected in `RISKS.md`:
  - the ten `TS1470`s went away with `"type": "module"` in the root
    `package.json`. It had been sitting in the root `tsconfig.json`, which is a
    `package.json` header — and TypeScript never reads that field from a
    tsconfig, so it had no effect anywhere;
  - the `zod` error was **not** a type-resolution difference. `env-check.ts`
    imported `z` and never used it, and `tsx`'s esbuild transform elides unused
    imports, so nothing resolved it at runtime either. One deleted line, no
    dependency added to the root;
  - the thirty `noUncheckedIndexedAccess` sites were not noise, so the flag was
    **not** narrowed. `lines[i] ?? ''` would have made every rule in `lint.ts`
    silently skip its line — R-26's shape — where `lines.entries()` removes the
    index, and `docs-facts.ts` already had `required()` throwing "fix the
    pattern rather than trusting the result" for a new `capture()` to extend.

  The config is the root `tsconfig.json`, not the `tsconfig.scripts.json` this
  entry named: `scripts/` is the only TypeScript at the root and an editor
  resolves the *nearest* `tsconfig.json`, so a second file would be the same
  rules under a name the editor does not look for. `pnpm lint` step 1 now runs
  two `tsc` passes and prints a tick for each, and `pnpm typecheck` at the root
  covers both — the gate names its scope, because the scope of a tick is part of
  the tick (`Scope: 5 of 6 workspace projects` was pnpm's own output, sitting
  directly above `✓ tsc clean`, saying so all along). Eight of the 42 non-config
  errors were real defects and are listed in `CHANGELOG.md`. Three mutations
  confirm the new tick can fail: one probe file tripping all six line-reading
  rules, one planted `TS2322` in `scripts/env-check.ts` (caught by the new pass,
  exit 1), and a poisoned `capture()` (`docs:check` exit 1).
  `fixtures/` is deliberately still uncovered — its seven `.ts` files sit inside
  sample repositories read as data, and `lint.ts` already excludes them by path.
- [x] **Check the Postgres test baseline in CI.** Done. `scripts/test-baseline.ts`
  landed with `verify:release` step 4b, and `verify:release` runs in CI's sqlite
  leg only (`.github/workflows/ci.yml`), so the `**postgres**` line in
  `PROJECT_STATE.md` was verified by **nothing**. The `Test` step now captures
  its output (`pnpm -r test | tee "$RUNNER_TEMP/test-output.txt"` under
  `set -o pipefail` — without it the pipeline returns `tee`'s exit code and a
  failing suite reports success, which is the trap that makes this more than a
  one-liner), and a `test:baseline --check --from …` step runs on **both** matrix
  legs against that transcript, each checking its own line. The leg is read from
  `DATABASE_URL`, the same way the suite reads it, so what gets checked is the
  line matching the database the tests actually ran against — which is why the
  expression is duplicated rather than replaced by `matrix.db`.
  The batch that did this also verified the number itself by hand against the
  postgres leg's own log (run `37772501733`, job `113295256011`: 104 + 904 + 57
  + 17 + 42 = 1124 passed, 0 skipped), because a CI behaviour change cannot be
  exercised locally and a gate change that lands unverified is how R-33
  happened. That check is now automated; what remains manual is nothing.
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

- [x] **`scripts/okx-seller-smoke.ts` had the startup-wait defect that was just
  fixed in `verify:release.ts`, in a third copy.** Done — 2026-10-08, and the
  guess in this entry was right: the fix was to lift the wait into a shared
  module (`scripts/child-wait.ts`) rather than copy it a fourth time. What the
  entry could not say, because it had not been measured, is which of the two
  halves was doing the work. It was the *diagnostics*: with the port occupied,
  the child exits with `EADDRINUSE` and prints why, and the only reason nobody
  saw it was that the script discarded the pipe. `waitForHealth(15_000)` was
  also too short, but that is a second-order problem — a short budget costs
  time, a hidden cause costs an afternoon. Measured before and after in
  `CHANGELOG.md`. Two notes for whoever reads this next:
  - the shared wait is worth having only for its failure branches, so they now
    have a probe (`pnpm probe:child-wait`, five cases, exits non-zero). It is a
    probe and not a test because there is nowhere to put a test yet — see the
    entry below;
  - the first attempt at reproducing the port clash used an 8 s override and
    reported "alive and silent" for a child that was merely still booting. This
    machine's shell preloads `NODE_OPTIONS` and that costs ~20 s of startup. A
    wrong measurement of a budget looks exactly like a wrong budget.
- [ ] **`scripts/` has no test runner, so a test next to a script is a test
  nothing runs.** `pnpm -r test` walks the workspace packages and the root is
  not one of them — the same fact that made `scripts/` invisible to `tsc` for
  six months (R-31), one directory over. It is why `scripts/child-wait-probe.ts`
  is a hand-run probe rather than a `*.test.ts`, and it is the reason the
  module's failure branches needed a bespoke mechanism at all. Three answers,
  and they differ in what a change to `scripts/` costs: give the root a `test`
  script and add a step to `verify:release` (then the test totals and the step
  list in `PROJECT_STATE.md` both move); move the shared modules into a
  workspace package so the existing runner picks them up (then `scripts/` stops
  being a directory with its own rules); or leave it and keep hand-run probes
  (then every future shared helper has to reinvent this). Recorded rather than
  picked, because it is a decision about the gate.
- [x] **Give every entry in `RISKS.md` a `Status:` line.** Done 2026-10-08. The
  count in this item was wrong in a way that mattered: it said "twenty of
  forty-one", and the real state was twenty-one of forty-two carrying a status
  and **three of those twenty-one carrying it where no search can see it** —
  folded into the `**Severity:**` line, so `grep '^\*\*Status:'` returned
  eighteen and looked complete. The sweep read the other twenty-four end to end,
  and three of them turned out to be wrong rather than merely unlabelled: R-11
  reported a blocker resolved by the commit that wrote it, R-19 described a
  mitigation in a class that does not exist, R-21 claimed a pin the file it
  named does not carry. That is the argument for the line, and it is not the
  argument this item made: the register's states were not unreadable, they were
  unread and wrong. A fifth value was needed for fourteen of them
  (`Mitigated by design` — the control and the entry shipped together, so there
  is no fix date), and `checkRisksRegister()` now rejects a sixth.
- [ ] Drizzle migration generator for Postgres (currently the SQLite schema
  is hand-written; would be nice to drive it from `drizzle-kit generate`)
- [ ] Admin UI: job list / job detail (currently only a single-shot form)
- [ ] i18n in web UI (currently English only)
- [ ] Markdown export of report
- [ ] PDF export of report
- [ ] VSCode extension embedding MCP server
- [ ] Re-pop analysis (compare current vs previous commit)
- [ ] Multi-repo scan (org-level)
- [x] **A check that `RISKS.md`'s Contents lists every `## R-NN` heading, and
  nothing else.** Done 2026-10-08 as `checkRisksRegister()` in
  `scripts/docs-facts.ts`, and widened once it was being written: the Contents
  check is the cheapest of its three assertions. The anchors are the second —
  `#r-13--a-gate-on-a-large-repository-times-out` and the heading it points at
  are two hand-written strings that have to agree, and a row that resolves to
  nothing is indistinguishable from one that resolves. The third is the one this
  item did not ask for and the sweep turned out to need: exactly one
  `**Status:**` line per entry, starting the line, from a fixed vocabulary.
  Five injections, each exiting 1 with its own message. It carries the
  `entries.length === 0` guard, so a rename or a heading-format change fails
  loudly instead of turning the check into a no-op — which is what this item
  would otherwise have created, since the file is deliberately block-free and
  `checkBlocks()` cannot see it at all.
- [ ] **`RISKS.md`'s `**Mitigation:**` lines are prose, and prose is not
  checked.** The register check covers the file's *shape* — the index, the
  anchors, the status lines — because those are the parts a script can compare.
  The field that says what stops the risk is not one of them, and the sweep that
  added the status lines showed what that costs: reading R-01 end to end to
  write its status, the `**Mitigation:**` three lines below turned out to name
  `GitFetcher` as the thing that rejects `..` and `.git/` (it does no path
  checking; `classifyFile`/`filterFiles` do, and `pipeline.ts:88` is the caller)
  and to describe a `runMigrations` helper in the fetcher sandboxed to
  `/tmp/repopilot-*` (there is no such helper, and no temp directory in
  `packages/core/src` at all — extraction is in memory). Both statements were
  probably true when written and were removed by R-17's work without this entry
  being told. R-01 is corrected; the other forty-one were not read that closely,
  and a `Mitigation` line cannot be checked by grep. The honest options are to
  re-read all of them by hand (a sweep with no automation to share) or to accept
  that this field drifts and say so — recorded rather than picked, because it is
  the same choice as the one above it.
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
- [x] **`verify:release`'s 15 s health budget is tight enough to fail a slow
  machine.** Done, and stale rather than fixed in this batch: the bare
  `waitForHttp('…', 15000)` this quotes was replaced when the three waits moved
  into `scripts/child-wait.ts` (D-044). The budget is now
  `STARTUP_TIMEOUT_MS = Number(process.env['VERIFY_STARTUP_TIMEOUT_MS'] ?? 60_000)`
  — four times the old number and overridable — and the timeout message names
  the variable to raise. Measured 2026-10-08 on the same machine that produced
  the 16 844 ms figure: the `api /health` step took **28 856 ms**, so it fails
  by nothing. The observation underneath the item still stands and is worth
  keeping: ≈15 s of startup is the interesting number, and it is not the
  database — `buildApp` finishes its SQLite migrations in milliseconds.
