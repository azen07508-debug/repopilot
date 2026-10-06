# DECISIONS.md

Architecture Decision Records (ADR-style, lightweight).

## Contents

- [D-001](#d-001--typescript-strict--nodenext-esm) — TypeScript strict + NodeNext ESM
- [D-002](#d-002--pnpm-workspaces--allowbuilds-for-native-modules) — pnpm workspaces + `allowBuilds` for native modules
- [D-003](#d-003--zod-3241--mcp-sdk-1220) — Zod 3.24.1 + MCP SDK 1.22.0
- [D-004](#d-004--pino-10--named-import) — Pino 10 + named import
- [D-005](#d-005--drizzle-hand-rolled-migrations-no-drizzle-kit) — Drizzle hand-rolled migrations (no `drizzle-kit`)
- [D-006](#d-006--mock-payment-is-the-dev-default-okx-is-opt-in) — Mock payment is the dev default, OKX is opt-in
- [D-007](#d-007--static-analysis-only) — Static analysis only
- [D-008](#d-008--evidence-is-mandatory-for-every-finding) — Evidence is mandatory for every finding
- [D-009](#d-009--llm-is-optional-not-load-bearing) — LLM is optional, not load-bearing
- [D-010](#d-010--single-process-api--worker-model-for-now) — Single-process API + worker model (for now)
- [D-011](#d-011--two-payment-tests-never-one-shared-one) — Two payment tests, never one shared one
- [D-012](#d-012--pino-redact-covers-all-known-secret-paths) — Pino redact covers all known secret paths
- [D-013](#d-013--auditqueue-interface--two-adapters-inline--pgboss)
  — AuditQueue interface + two adapters (Inline / PgBoss)
- [D-014](#d-014--single-auditworker-is-the-only-state-machine-owner)
  — Single `AuditWorker` is the only state-machine owner
- [D-015](#d-015--audit-post-always-returns-202-free-check-stays-200)
  — Audit POST always returns 202, Free Check stays 200
- [D-016](#d-016--production-must-use-a-persistent-queue) — Production must use a persistent queue
- [D-017](#d-017--repository-io-切换到-tarball-批量拉取) — Repository I/O 切换到 tarball 批量拉取
- [D-018](#d-018--symbol-parser-selection-typescript-compiler-api--regex-fallback)
  — Symbol parser selection (TypeScript compiler API + regex fallback)
- [D-019](#d-019--mcp-billing-split-report-tools-paid-query-tools-free)
  — MCP billing split (report tools paid, query tools free)
- [D-020](#d-020--changesource-abstraction-compare-api-first-local-git-later)
  — ChangeSource abstraction (Compare API first, local git later)
- [D-021](#d-021--intelligence-artifact-caching) — Intelligence artifact caching
- [D-022](#d-022--the-severity-penalty-is-capped-per-file-rule) — The severity penalty is capped per `(file, rule)`
- [D-023](#d-023--collectfindings-dedupes-on-the-comparison-key-and-the-finding-id)
  — `collectFindings` dedupes on the comparison key *and* the finding id
- [D-024](#d-024--the-tarball-is-decompressed-in-memory-not-onto-disk)
  — The tarball is decompressed in memory, not onto disk
- [D-025](#d-025--repository-map-importance-is-absolute-and-only-the-tree-is-a-source-of-paths)
  — Repository Map importance is absolute, and only the tree is a source
  of paths
- [D-026](#d-026--symbol-map-syntactic-extraction-and-a-missing-extractor-is-reported-rather-than-guessed)
  — Symbol Map: syntactic extraction, and a missing extractor is reported
  rather than guessed
- [D-027](#d-027--dependency-graph-the-unit-of-an-edge-is-the-unit-the-language-imports)
  — Dependency Graph: the unit of an edge is the unit the language imports
- [D-028](#d-028--the-intelligence-artifacts-get-their-own-tools-and-free-means-no-pipeline)
  — The intelligence artifacts get their own tools, and "free" means no
  pipeline
- [D-029](#d-029--pointing-the-tools-at-a-real-repository-and-what-the-guard-for-the-fix-turned-out-to-be-missing)
  — Pointing the tools at a real repository, and what the guard for the
  fix turned out to be missing
- [D-030](#d-030--the-edge-owns-the-origin-and-the-api-stops-being-the-public-root)
  — The edge owns the origin, and the API stops being the public root
- [D-031](#d-031--schema-bootstrap-is-a-job-that-runs-before-the-api)
  — Schema bootstrap is a job that runs before the API
- [D-032](#d-032--a-rules-scope-is-part-of-the-rule)
  — A rule's scope is part of the rule
- [D-033](#d-033--a-document-states-no-fact-it-can-derive)
  — A document states no fact it can derive
- [D-034](#d-034--the-scope-of-a-check-is-part-of-the-check)
  — The scope of a check is part of the check
- [D-035](#d-035--a-tier-changes-what-a-report-carries-never-what-it-measures)
  — A tier changes what a report carries, never what it measures
- [D-036](#d-036--a-payload-an-external-party-reads-is-compared-not-duplicated)
  — A payload an external party reads is compared, not duplicated
- [D-037](#d-037--one-price-one-product-a-difference-the-buyer-cannot-see-is-not-a-tier)
  — One price, one product: a difference the buyer cannot see is not a tier
- [D-038](#d-038--an-invariant-this-service-stands-in-for-this-service-must-perform)
  — An invariant this service stands in for, this service must perform
- [D-039](#d-039--a-queue-name-belongs-to-the-database-not-the-process)
  — A queue name belongs to the database, not the process
- [D-040](#d-040--a-guard-that-must-survive-a-restart-cannot-live-in-the-process)
  — A guard that must survive a restart cannot live in the process

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
  because it felt like it". The rule that enforced it — an LLM may write
  natural-language copy but never the score or the evidence — was a constraint
  on an interface that no longer exists (R-38); what replaces it is that
  `score.ts` is the only producer of a score and `FindingSchema` is the only
  producer of evidence.

## D-009 — LLM is optional, not load-bearing

- **Date:** 2026-07-19
- **Status:** Accepted
- **Context:** A user without an OpenAI key still needs a useful report.
- **Decision:** `LLM_PROVIDER=noop` (default) routes all LLM calls to
  `NoopLlmProvider`, which uses template-generated `summary` and
  `launchCopy`. `OpenAICompatibleProvider` exists for opt-in.
- **Corrected 2026-10-05 (measured; see RISKS.md R-38):** "exists for opt-in"
  was too strong. `OpenAICompatibleProvider` is implemented and unit-tested,
  but the provider the API builds from `LLM_PROVIDER` is passed into `buildApp`
  and read by no code path, so there is no opt-in to perform — setting the
  variables changes no output. The first half of the decision still holds and
  is the half that matters: `noop` is the only path that runs, and the report
  is deterministic.
- **Corrected again 2026-10-06 (R-38 implemented):** the second half is now
  *deleted* rather than merely annotated. `NoopLlmProvider` (spelled
  `NoopLLMProvider` in the code — the two had drifted apart, which is what
  happens to a name nothing calls), `OpenAICompatibleProvider`, the provider
  interface, the prompt builder, `polishFixPlanSet()` and the four `LLM_*`
  variables are all gone. So is the `llmEnhanced` flag on fix plans, whose only
  possible value was `false`, and `'analyzers.llm'` from the report's
  `analyzerProvenance`, which told every buyer that an LLM analyzer was
  installed and switched off. The decision is unchanged and now enforced by the
  absence of the code: there is no opt-in because there is nothing to opt into.
- **Consequences:** The MVP has zero LLM cost in dev or production. The
  report is always schema-valid. LLM is not an upgrade and not a dependency —
  it is not part of the system.

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
- **Enforced 2026-10-06 (R-39):** The mock adapter obeyed this from the
  start; the OKX adapter did not — it cached challenges on `quoteKey`,
  so a second POST for the same repository returned the first
  `paymentId`, and the route attached it to a new job row whose
  `jobs.payment_id` is UNIQUE → `SQLITE_CONSTRAINT_UNIQUE` → 500 for
  every buyer on `PAYMENT_MODE=okx`. The cache is deleted, and the
  `quoteKey` parameter is removed from `PaymentAdapter.createChallenge`
  so the decision cannot be un-made by re-adding a caller.

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

## D-017 — Repository I/O 切换到 tarball 批量拉取

- **Date:** 2026-09-19
- **Status:** Accepted (V0.2). Implemented 2026-09-23. One detail of the
  mechanism changed in the implementation and is recorded separately as
  D-024: the archive is decompressed in memory, not into a
  `mkdtemp('/tmp/repopilot-')` directory.
- **Context:** `GitHubFetcher.fetchContents()` calls
  `repos.getContent` once per file. With `DEFAULT_LIMITS.maxFiles =
  2000` a single full audit can issue 2000 API requests. Repository
  Map and Symbol Map need to read a large number of source files,
  which blows through the anonymous GitHub limit of 60 req/h (R-03)
  before the analysis finishes. AST parsing also needs complete
  source, not a sample.
- **Decision:** Add a `TarballSource` that downloads the archive once
  (`repos.downloadTarball` / `GET /repos/{owner}/{repo}/tarball/{ref}`)
  into a `mkdtemp('/tmp/repopilot-')` directory and reads from disk
  afterwards. Extraction performs no `spawn` of any kind — D-007
  forbids executing repository code, and decompression is not
  execution. `GitHubFetcher.fetchContents()` stays as the fallback
  path: if the tarball download fails we degrade to it and mark the
  output `degraded: true`.
- **Consequences:** API request count drops from O(files) to O(1).
  New disk and byte caps are required (see R-17). `filterFiles` and
  `classifyFile` are reused unchanged, so the text/binary/ignore
  policy is identical. Tests drive the tarball path via a local
  directory source (fixtures), never the network.

## D-018 — Symbol parser selection (TypeScript compiler API + regex fallback)

- **Date:** 2026-09-19
- **Status:** Accepted (V0.2)
- **Context:** `@repopilot/core` production dependencies are
  `octokit`, `pino`, `zod` only. There is no AST parser, but
  Phase 2 requires a Symbol Map.
- **Decision:** Parse TypeScript/JavaScript with the `typescript`
  compiler API (promoted from devDependency to dependency, aligned
  with the existing `^5.7.2`). Python, Solidity and every other
  language fall back to regex/heuristic extraction. Every symbol
  carries `parser` and `parserConfidence` so precision is traceable.
  We explicitly **do not** introduce tree-sitter: it requires a new
  `allowBuilds` entry (D-002) and changes the Docker multi-stage
  build, and the payoff does not justify that across all languages.
- **Consequences:** TS/JS precision is high; other languages are
  approximate but explainable via `degraded` + `failures[]`. A parser
  failure in one language must never fail the whole audit — this is
  enforced by the `SymbolMapSchema.degraded` / `failures` fields.

## D-019 — MCP billing split (report tools paid, query tools free)

- **Date:** 2026-09-19
- **Status:** Accepted (V0.3)
- **Context:** Every existing MCP tool goes through the
  `paymentAdapter` (x402 / 402 challenge). An agent entering an
  unfamiliar repository typically issues 5–10 queries
  (`repo_map`, `architecture`, `symbols`, `task_context`,
  `get_agent_context`, …). Per-call billing makes those high-frequency
  small queries unusable and would push agents back to "just read the
  whole repo", which is exactly what RepoPilot exists to prevent.
- **Decision:** Split MCP tools into two classes:
  - **Report tools — billed via x402:** `audit_github_repository`,
    and later `generate_fix_plan`.
  - **Query tools — free in both `mock` and `okx` payment modes:**
    `repo_overview`, `repo_map`, `architecture`, `dependency_graph`,
    `symbol_map`, `compare_commits`, `analyze_change_impact`,
    `task_context`, `find_relevant_files`, `security_findings`,
    `test_gaps`, `documentation_gaps`, `get_agent_context`,
    `get_project_conventions`, `get_known_risks`.
  Billing class is an explicit property of each tool, not an implicit
  behaviour. `get_repopilot_capabilities` must return a `billing`
  field per tool so clients can see the split.
- **Consequences:** Free tools must be rate-limited — reuse
  `middleware/rate-limit.ts` and extend it beyond IP to a per-caller
  key. Paid reports keep their value: the paid path remains the only
  way to obtain a full `Report` document.

## D-020 — ChangeSource abstraction (Compare API first, local git later)

- **Date:** 2026-09-19
- **Status:** Accepted (V0.4)
- **Context:** The repository has neither git history nor a local
  clone — the fetcher only uses the Trees API. Change Impact needs a
  base/head diff.
- **Decision:** Define a `ChangeSource` interface with
  `compare(base, head): Promise<ChangedFile[]>`. V0.4 implements only
  `GitHubCompareSource` (`octokit.repos.compareCommits`): zero new
  dependencies, computed remotely, and it never executes repository
  code. `LocalGitSource` (read-only git commands for a local
  worktree / MCP local path) is deferred to V0.5 and is restricted to
  read-only commands such as `git diff --name-status`.
- **Consequences:** When git information is unavailable the engine
  returns `degraded: true` instead of throwing. Compare API
  truncation on very large diffs must be declared in `limitations`
  (see R-19).

## D-021 — Intelligence artifact caching

- **Date:** 2026-09-19
- **Status:** Accepted (V0.3)
- **Context:** `repositoryMap` and `architectureGraph` are large JSON
  documents, and an agent queries the same repository repeatedly
  across requests.
- **Decision:** Add an `intelligence_cache` table keyed by
  (`owner/repo`, `commitSha`, `kind`, `schemaVersion`), reusing the
  `report_cache` TTL and request-coalescing pattern. Intelligence
  artifacts are **not** embedded in `Report` by default — they are
  attached as optional fields only when explicitly requested — so
  the `report_json` column does not balloon (see R-20).
- **Consequences:** Both SQLite and Postgres `CREATE` statements must
  be updated together (D-005). Cache invalidation depends on
  `commitSha`, consistent with the report cache.

## D-022 — The severity penalty is capped per `(file, rule)`

- **Date:** 2026-09-22
- **Status:** Accepted (0.1.0-rc.2)
- **Context:** `severityPenalty()` summed `SEVERITY_PENALTY[severity]` over
  every finding, with no bound on how many findings a single file could
  contribute. That holds until a generated file produces hundreds of
  hits. A lockfile is mostly `sha512-` integrity digests, which are
  high-entropy by construction and therefore match the generic secret
  heuristic; `severityForPath` downgrades those to `low` rather than
  dropping them, so they stay in `securityFindings` and still accumulate.
  Measured (see R-22): a repository whose only files were a lockfile, a
  README, a LICENSE and a one-line source file scored
  `securityHygiene: 0` and `overall: 53.7` — 25 points below the same
  tree without the lockfile. The quality contract was already immune,
  because it counts only `critical` and `high`; the score was not. This
  is the same shape as the 547-blocker `.env.example` run that motivated
  `TEMPLATE_ONLY_KINDS`: the gate was fixed, the score was not.
- **Decision:** Cap the contribution of any one `(file, ruleId)` pair at
  `MAX_PER_GROUP` (3) findings, keeping the worst severities first. The
  group key is the **resolved** rule id (`ruleIdOf`), never the finding
  `id`: a secret finding's id embeds its line number, so keying on it
  would put every hit in a group of its own and the cap would never apply
  to the case it exists for. The true finding count is preserved for the
  `count > 0` gate and for the reason text, which gains "at most 3
  counted per file and rule" when the cap bites. The cap applies to all
  four dimensions, not only security.
- **Alternatives rejected:** Lowering `SEVERITY_PENALTY.low` does not
  work — the count is unbounded, so any non-zero weight still reaches 0
  on a large enough lockfile. Moving generated-file findings into
  `fixtureFindings` would also work, but it changes what
  `securityFindings` means and raises the score for every affected
  repository, a larger semantic change than a cap.
- **Consequences:** Breadth is still punished in full — a hundred secrets
  in a hundred files still costs a hundred penalties — so only repetition
  *inside* one file is bounded, and `scoring/penalty-cap.test.ts` pins
  both directions. A repository that previously scored 0 on a dimension
  because of one generated file now scores higher, and the reported
  breakdown says why.

## D-023 — `collectFindings` dedupes on the comparison key *and* the finding id

- **Date:** 2026-09-23
- **Status:** Accepted (0.1.0-rc.3)
- **Context:** `collectFindings()` deduplicated on `findingKey()` alone.
  A fingerprint is the **cross-report** comparison identity, and it is
  deliberately coarse — resolved rule id plus evidence locations — so two
  different hits of one rule at one place share it. That is exactly right
  for the diff, which asks "is this problem still at this location?", and
  wrong for a function whose callers ask "how many findings does this
  report carry?". `securitySection` compares that count against
  `security.maxSecrets`, so the collision was a **false pass**: a line
  carrying two credential formats — `scanTextForSecrets` emits one hit
  per matching pattern with no per-line dedupe, and every `secret-` slug
  resolves through the registry to one rule id — collapsed to a single
  finding and satisfied a contract that tolerates one. Measured: with
  `maxSecrets: 1` and an AWS key and a Stripe key on one line, the check
  reported `1 credential found` and **passed**; the same input has two.
  The default contract (`maxSecrets: 0`) could not flip, because one
  surviving credential still fails it, so the blast radius was a
  non-default `maxSecrets` or `maxCritical`.
- **Decision:** Key on the pair `(findingKey(f), f.id)`. The id is the
  report-local name the analyzer gave the finding; the fingerprint is the
  cross-report identity. Keying on the pair is strictly finer than either
  alone, so it cannot merge anything the old key kept — it only stops
  merging two hits that are genuinely two findings. `collectFixableFindings`
  already dedupes on `id`, so the fix plan and the gate now agree on the
  count as well.
- **Alternatives rejected:** Keying on `id` alone reverses a stated
  invariant — `contract.test.ts` asserts that two findings sharing an id
  but not a fingerprint are two findings, which is the shape an analyzer
  bug would take, and merging them there would hide the bug. Making the
  fingerprint finer by folding in a discriminator was rejected outright:
  any change to the formula invalidates every stored report's
  fingerprint, so the next comparison reads the entire finding set as
  "all resolved, all new". The one stable discriminator available is the
  `title`, which is copy — a reworded title would do the same thing.
  Fixing the diff's own collapse was rejected too: `AuditDiff.resolved`
  and `.new` are documented as arrays of fingerprints, so a finer key
  there is a schema change, and the collapse is *correct* at the
  granularity the diff operates on.
- **Consequences:** The gate counts findings the way the report lists
  them. `blockingFingerprints` still collapses deliberately — it is a
  list of fingerprints for re-audit, and one fingerprint covering two
  hits still answers "is the blocker gone?" correctly. The diff still
  reports `resolved: 1` for two removed hits on one line: that is the
  documented trade-off, not an oversight, and it is recorded in R-23.
  `contract.test.ts` pins both the count and the false pass, and reverting
  the key fails exactly those two tests out of 48.
## D-024 — The tarball is decompressed in memory, not onto disk

- **Date:** 2026-09-23
- **Status:** Accepted. Supersedes the `mkdtemp` detail of D-017.
- **Context:** D-017 specified downloading the archive into
  `mkdtemp('/tmp/repopilot-')` and reading from disk afterwards, and
  R-17's mitigation is written around that: the directory is removed in a
  `finally` block, and the operator signal is `/tmp` usage on the API
  host. The reader that shipped with it (`git/tar.ts`) takes a `Buffer`
  and indexes into it by offset — it cannot read from a file descriptor
  in chunks without being rewritten.
- **Decision:** Gunzip with `node:zlib` into a `Buffer`, walk that, and
  never touch the filesystem. No `spawn` (D-007: decompression is not
  execution) and no temp directory.
- **Alternatives rejected:** Writing to disk exactly as D-017 describes
  does not buy what it was meant to buy. Because the reader needs a
  contiguous buffer anyway, the peak memory is the archive either way;
  writing it out first only adds a copy, a `mkdtemp`, a `rm -rf` in a
  `finally`, and the disk-exhaustion failure mode R-17 exists to prevent.
  Rewriting the reader to stream from a file descriptor would bound
  memory properly, and is a much larger change than the request-count
  problem D-017 is actually about — worth doing only if archive size ever
  becomes the binding constraint, which for a static-analysis service
  reading at most 50 MiB of text it is not.
- **Consequences:** R-17's disk risk is gone, and two caps stand in for
  it: `MAX_ARCHIVE_BYTES` (64 MiB, compressed) and `MAX_EXTRACTED_BYTES`
  (256 MiB, enforced by zlib's `maxOutputLength`, which is what stops a
  small archive from expanding into a gigabyte). Decompression runs off
  the event loop rather than blocking it, so one large audit does not
  stall concurrent ones — `node:zlib/promises` has no typings in the
  `@types/node` this package pins, hence the small explicit wrapper.
  `/tmp` usage is no longer the operator signal; logged
  `extractedBytes` / `fileCount` are.

## D-025 — Repository Map importance is absolute, and only the tree is a source of paths

- **Date:** 2026-09-24
- **Status:** Accepted. Implements the Repository Map half of V0.2-d
  (`docs/REPOSITORY_INTELLIGENCE_PLAN.md` §9.2, §10.3).
- **Context:** `schemas/intelligence/repository-map.ts` landed in V0.2-b
  with three fields whose meaning is not implied by their names:
  `Module.importance`, `ImportantFile.importance` and
  `RepositoryMap.repository.primaryLanguage`. The plan requires
  importance to come from "fan-in, file count and entrypoint proximity —
  never from an LLM" but does not say what shape that derivation takes,
  and the obvious reading of "0..1" is a ratio against the repository
  being scored. Four smaller questions came with it: whether an
  entrypoint may name a file the tree does not contain, where
  module-level dependencies come from before V0.2-f resolves imports, how
  several reasons for one file combine, and what the root of a flat
  repository is.
- **Decision:**
  1. **Saturating and absolute, not relative.** Each term is
     `x / (x + half)` — 0.5 at three modules of fan-in, 0.5 at twenty
     files — weighted 0.5 / 0.3 / 0.2, with a flat 0.2 for containing an
     entrypoint. A module scores the same in a five-module repository as
     in a five-hundred-module one.
  2. **`primaryLanguage` skips data and documentation formats.**
     `languages` reports every recognised format by bytes, JSON and
     Markdown included; `primaryLanguage` is the largest language left
     after removing them, falling back to `languages[0]` and then to
     GitHub's own value.
  3. **No path outside the tree is ever reported.** Enforced in
     `resolveTarget`, the one place a manifest-declared target becomes a
     path. An entrypoint an agent cannot open is worse than a missing
     entrypoint.
  4. **Module `dependsOn` is read from manifests only**, by matching a
     declared dependency name against another module's name.
     Source-level import resolution is V0.2-f, and the map says so in
     `limitations`.
  5. **Several reasons for one file combine with `max`, not with a
     sum**, and the three constants are ordered so the ranking is
     unambiguous: 0.55–0.9 for an entrypoint by its confidence, 0.8 for
     root configuration, 0.6 for a nested manifest.
  6. **A directory with a manifest is a module, including the root**
     (`path: '.'`) — except that a lone root `pnpm-workspace.yaml` is
     not, because it declares the workspace rather than a package. When
     one directory holds several manifests, a fixed priority
     (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
     `requirements*.txt`, `pnpm-workspace.yaml`) names it, so the answer
     does not depend on the order the tree was listed in.
  7. **Truncation is reported by the code that truncated, never inferred
     by the code that writes the sentence.** `detectEntrypointSet` and
     `collectDependencies` return `total` and `truncated` alongside the
     list, as `listFiles` already did, and `buildLimitations` reads those
     instead of comparing a length against a cap.
- **Alternatives rejected:**
  - *Normalise against the repository's own maximum* — "the module with
    the most fan-in is 1.0". It reads well inside one repository and
    means nothing across two: a 12-file module in a small repo would
    outrank a 400-file module in a large one, because each would be the
    maximum of its own tree. It also makes a map's scores change when an
    unrelated module is added.
  - *Rank `primaryLanguage` purely by bytes.* A fixture-heavy repository
    would report `JSON` — true, and useless. Dropping those formats from
    `languages` altogether was rejected too: "this repository is 40%
    JSON" is occasionally exactly the fact you wanted.
  - *Emit a declared-but-absent target at reduced confidence.* That puts
    a path in the map which `GET /contents` cannot serve, and confidence
    is for uncertainty about a fact, not for a guess at a filename. The
    same reasoning rejected deriving the tarball root from the archive's
    shape (D-017).
  - *Sum the important-file reasons.* The signals overlap — a package's
    root `package.json` is configuration and often sits beside the
    entrypoint — so a sum lets two weak reasons outrank one strong one
    and can exceed the schema's `max(1)`.
  - *Guard the invariant where signals are recorded.* The first version
    had `if (!known.has(path)) return` inside the recorder. It was
    deleted: `resolveTarget` already guarantees the invariant, so the
    guard was unreachable, and unreachable code is untested code. The
    mutation check is what surfaced this — removing the guard changed
    nothing, because no rule can reach it with a path from outside the
    tree.
  - *Let `buildLimitations` decide the caps from the list lengths.* It
    cannot, and decision 7 exists because it tried: a list of exactly
    `MAX_ENTRYPOINTS` entries is either a repository with that many or
    the first slice of more, so `length >= MAX_ENTRYPOINTS` reports the
    second case for the first. The same shape of error compared the
    pre-dedupe declaration count against `MAX_DEPENDENCIES` while
    slicing the deduplicated list, announcing a truncation that had not
    happened and a total that was never true. A module cap produced two
    lines for one fact, from two places, one of which did not know the
    real number. `limitations` is the artifact's honesty channel, so a
    line that states something untrue costs more than a line that is
    missing.
- **Consequences:** Two maps can be compared without knowing what else
  was in either tree, and `importance` is stable to four decimals, so it
  can be snapshotted and cached (D-021). 123 tests cover the builder;
  sixteen mutations, one per invariant above, were each confirmed to turn
  the suite red. The limits of the artifact are stated in `limitations`
  rather than left to be discovered: source-level imports are unresolved
  until V0.2-f, a manifest format outside the five the parser reads is
  named, and every cap (`MAX_MODULES`, `MAX_DEPENDENCIES`,
  `MAX_LISTED_FILES`, `MAX_ENTRYPOINTS`, `MAX_IMPORTANT_FILES`)
  announces itself when it bites — and only then. Nothing is wired into
  the audit path: per R-20 the map is not a `Report` field, and V0.2-g
  exposes it.

## D-026 — Symbol Map: syntactic extraction, and a missing extractor is reported rather than guessed

- **Date:** 2026-09-27
- **Status:** Accepted. Implements V0.2-e
  (`docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.3) on the parser D-018
  proposed.
- **Context:** `schemas/intelligence/symbol-map.ts` landed in V0.2-b with
  a `parser` enum (`typescript-compiler` / `regex` / `heuristic`),
  a per-symbol `parserConfidence`, and one hard rule stated in its
  header: a parser failure in one language must never fail the whole
  audit. What it does not say is which languages get which tier, what
  `startLine` / `endLine` mean when a language has no braces, what to do
  about a language with no extractor at all, and how much of a
  declaration surface a parse can honestly claim without a type checker.
- **Decision:**
  1. **Three tiers, and the tier travels with every symbol.**
     TypeScript and JavaScript use the `typescript` compiler API
     (`typescript-compiler`, 0.95); Python and Solidity use hand-written
     regex scanners (`regex`, 0.75 / 0.7); Go, Rust, Java, Kotlin, Swift,
     Ruby, Shell, Protobuf and GraphQL use line-pattern heuristics
     (`heuristic`, 0.5). The confidence is per symbol, not per map, so a
     consumer can weight a compiler-parsed declaration against a
     line-matched one instead of trusting both equally.
  2. **`createSourceFile`, never a `Program`.** A `Program` type-checks,
     which means resolving imports, loading `lib.d.ts` and walking
     `node_modules` — an audit has no business doing any of that, and it
     is exactly what would make R-18's memory bound untrue. A
     declaration surface needs a parse, not a check. Consequence:
     parents are not set, so `getCombinedModifierFlags` is unusable
     (it walks `node.parent`) and `isExported` reads `ts.getModifiers`
     directly.
  3. **A language with no extractor is named, not guessed.** It produces
     no symbols and a `failures` entry carrying the language and its
     file count, so a partial map announces itself. A guessed symbol
     sends an agent to the wrong line; a missing one sends it to read
     the file.
  4. **A parser failure degrades, never propagates.** Each file is parsed
     inside its own `try`; a failure falls back to the line scanner, and
     a failure of *that* becomes a `failures` entry, and the loop
     continues. Only the compiler API gets a fallback tier — it is the
     one parser here whose failure mode is not just "a regex did not
     match" but a stack overflow on deeply nested input.
  5. **Span semantics are per language, and each one is a decision.**
     Python blocks end by indentation, at the **last statement** rather
     than at trailing blank or comment lines, and a decorated function
     starts at its first `@decorator`. Solidity blocks end by brace
     matching, after comments and string literals are stripped — a
     `revert("unbalanced {")` would otherwise unbalance the count and
     make one symbol swallow the rest of the file. Ruby and Shell end a
     block by indentation **plus** the closing keyword at the same
     indent, because indentation alone leaves the `end` / `}` outside
     the range. A bodiless declaration — an interface method, a field —
     spans one line, never to the end of the file.
  6. **Solidity state variables are recognised by brace depth, not by
     "a contract is open".** `uint local = 1;` inside a function body
     matches the same pattern as `uint256 count;` in a contract body;
     depth is the only thing that tells them apart. The first version
     checked only whether a contract was open — which it is, inside its
     own functions — so an implementation's locals were reported as
     state of the deployed contract, while the comment beside the guard
     claimed the opposite.
  7. **A namespace is a container only.** The schema has no `namespace`
     kind, so a namespace's members report it as their `parent` and the
     namespace itself is not a symbol.
  8. **Truncation is set by the declaration that was refused, and the
     walk descends even when the cap is full** — D-025 decision 7, one
     level down. The first version returned early at the cap, so a
     container reached with the cap already full was never opened: a
     `namespace` contributes no symbol of its own, so its members
     vanished with `truncated: false` and the map read as complete.
  9. **A contract is exported by definition**, and the two kinds the
     schema lacks are documented rather than silently forced: a
     `modifier` is reported as `function` (it is called like one), an
     `event` or `error` as `type` (it is declared, not called).
- **Alternatives rejected:**
  - *A `Program`, or a type checker, for reachability.* It would let the
    map say "this declaration is actually used", which is V0.2-f's job,
    at the cost of resolving imports and loading `lib.d.ts` on every
    audit. Syntactic extraction is the honest ceiling here, which is
    what 0.95 rather than 1 records.
  - *A grammar per language (tree-sitter and friends).* R-21 is zero new
    dependencies; tree-sitter grammars are per-language artifacts, not
    one library.
  - *Emit a low-confidence guess for a language with no extractor.* The
    map is consumed by agents that act on line numbers. A wrong line is
    worse than a named gap.
  - *Read `default` as well as `export` in `isExported`.* Deleted.
    TypeScript only allows `default` on a declaration that already
    carries `export`, so the clause could never be the one that decided
    the answer — and a mutation that swapped it for an unrelated keyword
    survived the whole suite, which is what a dead clause looks like
    from the outside. The comment justifying it ("`export default
    function f()` is reachable from outside") was true of `export`, not
    of `default`.
  - *Cap the per-file symbol list by comparing `drafts.length` against
    the cap.* The length cannot distinguish "exactly the cap" from "more
    than the cap" (D-025 decision 7), and the `EndOfFileToken` makes it
    worse: `ts.forEachChild` visits it, so a file with exactly the cap
    has one child left over, and counting that as a dropped declaration
    is how the first version reported `truncated: true` for a complete
    list.
  - *Guard the cap by returning before descending.* That is the bug in
    decision 8, and it is why the guard is now inside the draft loop
    rather than around the recursion.
- **Consequences:** 78 new tests (core 550 → 628), including one that
  builds a schema-valid map over each of the six real fixtures twice and
  asserts the two are identical. Forty mutations were run; **39 caught,
  1 equivalent, 0 invalid.** The equivalent one is `TAB_WIDTH = 4` →
  `1`: for a file whose indentation is consistent, scaling every indent
  by the same factor preserves every comparison the scanner makes, so it
  differs only for input that mixes tabs and spaces — which Python
  rejects outright and which Ruby and Shell, the two other
  indent-scanned languages, do not require. It is recorded here rather
  than pinned by a test that would encode an arbitrary answer for input
  no language accepts. Three real defects were found by the check and
  fixed: the container cap (decision 8), the dead `default` clause, and
  the Solidity local-as-state (decision 6). `typescript` moves from
  `devDependencies` to `dependencies` — it is imported at runtime, so
  the published package would otherwise be broken for every consumer.
  `references` is 0 everywhere until V0.2-f resolves imports, and the
  schema says so: 0 does not imply dead code. Nothing is wired into the
  audit path; V0.2-g exposes it, as with the Repository Map.

## D-027 — Dependency Graph: the unit of an edge is the unit the language imports

- **Date:** 2026-09-28
- **Status:** Accepted. Implements V0.2-f
  (`docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.3).
- **Context:** `schemas/intelligence/graph.ts` landed in V0.2-b with
  `GraphNode` / `GraphEdge` / `DependencyGraph`, three node kinds
  (`file` / `module` / `external-dependency`) and a `weight` on every
  edge, but nothing said what a node *is* in a given language, when a
  node exists at all, or what happens to an import that names nothing.
  The three questions are entangled: answer "what is a node" wrong and
  every Go repository grows a node per file; answer "what is an
  unresolved import" wrong and the graph invents dependencies.
- **Decision:**
  1. **The unit of an edge is the unit the language imports.**
     TypeScript, JavaScript, Python, Solidity, Rust and the rest import a
     *file*, so the target is a `file` node. Go imports a *package*,
     which is a directory, so the target is a `module` node — and a Go
     import never produces file candidates at all. A bare specifier that
     names nothing in this repository is an `external-dependency`.
  2. **A node exists because an edge touches it.** A file with no
     imports and nothing importing it is not a node. The Repository Map
     already lists files; absence from the graph *is* the answer to
     "what does this import?", and it is a cheaper answer than a node per
     file in a two-thousand-file tree. Consequence: `isolatedModules` is
     computable from the file list, not from the graph, which is where
     V0.2-g will compute it.
  3. **An unresolved import is not an edge.** A relative specifier that
     names no file goes to `limitations` with the file and the line that
     wrote it. Turning it into an edge to the nearest-looking path is the
     one failure mode this artifact must not have: an agent reading a
     plausible wrong file is worse off than an agent told to go read.
  4. **`.js` names `.ts` (D-001).** TypeScript's ESM output requires the
     *emitted* extension in the source, so `import './index.js'` in a
     NodeNext project names `index.ts` on disk. Without the rewrite
     every internal import in such a repository is reported unresolved —
     which is every repository this tool is aimed at, because the
     convention is what `"module": "NodeNext"` asks for. The rewrite is
     limited to TypeScript, JavaScript, Vue and Svelte, and a real `.js`
     file on disk still wins over its `.ts` original.
  5. **An uncertain record may only reach something in the tree.** Python
     `from a.b import c` also tries `a.b.c`, because `c` may be a
     submodule; `from . import models` depends on that second try. When
     it misses, the honest reading is "that is a name inside the module
     already recorded" — not "that is a third-party package". So
     `certain: false` suppresses **both** the `limitations` line and any
     `external-dependency` edge. `from fastapi import FastAPI` yields one
     edge to `external:fastapi`, not a second to
     `external:fastapi.FastAPI`.
  6. **Module conventions are per language, and each one is a decision.**
     Rust: `src/a.rs` owns `src/a/`, while `lib.rs` / `main.rs` /
     `mod.rs` are crate roots that own the directory they sit in, so
     `mod a;` in `src/lib.rs` is `src/a.rs`. `crate::` is rooted at
     `src/`; `self::` and `super::` walk the module directory.
     Python: one leading dot is the file's **own package**, and a pop
     from the root is **refused**, never clamped to the root — a
     root-level `a.py` is not in a package, so `from .. import x` is an
     error, and clamping would resolve it to a file it does not name.
     Java and Kotlin are dotted paths written against a source root, so
     both the repository-relative reading and `src/main/java`-style roots
     are tried, repository-relative first. Go resolves through the
     `go.mod` module path and only ever to a directory.
  7. **Determinism is a property of the bytes, not of the iteration
     order.** Nodes are sorted by id and edges by `(from, to)`. The sort
     is not redundant with iterating a pre-sorted file list: `./b.js`
     sorts before `react` as a *specifier*, but `external:react` sorts
     before `src/b.ts` as a *target*. `localeCompare` is not used — the
     artifacts are snapshotted and cached (D-021), so the ordering has to
     be the same on every machine, and `a < b` on UTF-16 code units is.
  8. **`limitations` is part of the dependency graph, not just the
     architecture graph.** V0.2-b declared it only on
     `ArchitectureGraphSchema`, which meant a `DependencyGraph` could be
     silently incomplete — every cap, every language without an
     extractor, every unresolved import had nowhere to go. It is now on
     `DependencyGraphSchema`, and the architecture graph extends it.
  9. **`DEFAULT_MAX_FILE_BYTES` lives in `intelligence/limits.ts`.**
     Both the Symbol Map and the Dependency Graph read files under the
     same R-18 bound; declared twice it would be two bounds that drift.
- **Alternatives rejected:**
  - *Emit an edge to the nearest-looking path when a relative import
    misses.* This is the failure mode decision 3 exists to forbid. A
    wrong edge is not a degraded answer, it is a wrong one.
  - *A node per file, so the graph is a complete picture of the tree.*
    The Repository Map is already that picture. A graph whose nodes are
    mostly isolated files answers "what does this import?" with "nothing"
    thousands of times.
  - *A `Program` / type checker to resolve imports the way the compiler
    does.* It would resolve tsconfig `paths`, `exports` maps and
    conditional exports — at the cost of loading `lib.d.ts` and walking
    `node_modules` on every audit, which is exactly what makes R-18's
    memory bound untrue. The same reasoning as D-026 decision 2.
  - *Read a lockfile or `package.json` to decide whether a bare
    specifier is external.* It would turn "not in this repository" into
    "in this repository's dependency list", which is a different claim,
    and it would need a lockfile parser per package manager. Zero new
    dependencies (R-21).
  - *Treat a Python dotted miss as `external`.* It is repository-relative
    by nature and the record already says the miss is expected
    (decision 5).
  - *Clamp a Python relative import that walks past the root.* It
    resolves to a file the import does not name — the failure mode of
    decision 3, one level down.
  - *`localeCompare` for the ordering.* Machine-dependent collation in
    an artifact that is snapshotted and compared across machines (D-021).
- **Consequences:** 112 new tests across three files (core 628 → 740),
  including a schema-valid graph over each of the six real fixtures,
  built twice and asserted identical, with every edge checked to point at
  a node that exists and to carry as many evidence lines as its weight.
  Seventy-four mutations were run: **74 caught, 0 missed, 0 invalid.**
  Two real defects were found by the check and fixed:
  - an *uncertain* Python submodule guess that missed was turned into an
    `external-dependency` edge, so `from pkg.util import Thing` produced
    both `pkg/util.py` and `external:pkg.util.Thing` (decision 5);
  - a relative Python import that walked past the root was clamped to the
    root instead of refused, so `from .. import x` in a root-level module
    resolved to a file it does not name (decision 6).
  Two pieces of dead code were also found and deleted: a
  `specifier === clean` clause in `stripRootPrefix` that the following
  `startsWith` check already refused (the condition could never change
  the answer), and a `./` / `../` branch in `pythonCandidates` that was
  equivalent to the leading-dot reading for every input — once the
  clamp in decision 6 was fixed, the branch had nothing left to do.
  Nothing is wired into the audit path; V0.2-g exposes it, as with the
  Repository Map and the Symbol Map. `Symbol.references` is still 0
  everywhere: this graph is what will fill it, and that is V0.2-g's job.

## D-028 — The intelligence artifacts get their own tools, and "free" means no pipeline

- **Date:** 2026-09-28
- **Status:** Accepted. Implements V0.2-g
  (`docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.3).
- **Context:** Three artifacts were built — the Repository Map (V0.2-d),
  the Symbol Map (V0.2-e) and the Dependency Graph (V0.2-f) — and none of
  them had a consumer. They were deliberately kept out of the audit
  pipeline (R-20: an artifact is a large JSON document and `report_json`
  is a database column), so exposing them meant a new surface, and the
  MCP server's own header said free tools *never scan a repository*. That
  rule and the artifacts are incompatible: all three need a file list and
  file contents, and `JobStore` holds reports, not trees. D-019 is why
  they have to be free — an agent asks these questions five to ten times
  per repository, and a paid call at that frequency is a paid call nobody
  makes.
- **Decision:**
  1. **"Free" means no analysis pipeline, not "no network".** The four
     intelligence tools fetch a tree and a tarball (three requests,
     D-017) and derive. Nothing they do scores, judges or scans history.
     The old rule conflated "costs the seller nothing" with "does not
     touch the network", and the conflation is what made this stage look
     blocked.
  2. **MCP-only, until D-021's `intelligence_cache` lands in V0.4.** The
     HTTP API is the paid surface, and an artifact endpoint on it would
     be a request per artifact per audit with nothing in front of it. The
     MCP server is one process per session and caches in-process.
  3. **The server reads the snapshot itself and caches it in process.**
     `RepositorySnapshots` is an LRU bounded by count **and** bytes —
     `MAX_SNAPSHOTS = 8`, `MAX_CACHED_BYTES = 64 MiB`. A count bound
     alone allows eight copies of a 50 MiB repository; a byte bound alone
     lets one enormous repository fill the map. Both, or the bound is not
     a bound. The key is `owner/repo@ref`.
  4. **A snapshot larger than the whole byte bound is still kept.** The
     eviction loop stops at one entry. Without that guard the bound makes
     the cache a no-op for exactly the repositories that cost the most to
     read: each one evicts itself and is re-fetched on every call.
  5. **The ref a caller names back is served from the snapshot already
     held.** `get_repository_context` answers with `repository.ref`, and
     the natural next call — `get_symbol_map` on the same repository —
     passes it straight back. Keyed `url@ref`, `url@` and `url@main` are
     two keys and the repository is fetched twice, which is the one thing
     the cache exists to prevent.
  6. **A failure is a machine-readable error, not an exception.** A tool
     that throws gives an agent nothing to retry with, so every fetch
     failure comes back as `{ error: 'repository_unavailable', message }`.
     The message keeps the HTTP status: 404 / 403 / 502 are three
     different next moves — check the URL, wait, or come back later — and
     a bare sentence leaves the agent guessing which.
  7. **The code that cut the list is the code that says it did** (D-025
     decision 7, met again one level up). Every capped list carries
     `{ returned, total, omitted, note }`, and the note is also merged
     into `limitations` — a caller cannot tell "there were 500" from "the
     first 500 of 9000" by looking at the list.
  8. **The context tool reports what the manifests declare; the graph
     reports what the code imports.** They are different sets in both
     directions — a dev tool is declared and never imported, a phantom
     dependency is imported and never declared — so the context tool
     carries the manifest's `version` and `kind`, names the field
     `declaredDependencies` rather than `externalDependencies`, and says
     in its own description that the imported set lives in
     `get_dependency_graph`.
  9. **`path_prefix` is a directory, matched on segment boundaries, and
     `.` is the root.** `src/deep` must not return `src/deeper/d.ts` or
     `src/deep-notes.ts`: the caller asked about one directory, and
     handing it its neighbours is the same class of error as an edge to
     the nearest-looking path (D-027 decision 3). And the Repository Map
     spells the root module `"."`, so an agent that reads
     `modules[0].path` and passes it back must get the repository rather
     than an empty list with no explanation.
 10. **Externals are pulled out of the node list, and never filtered by
     prefix.** They are the one part of the graph a caller usually wants
     whole, and leaving them mixed into `nodes` is how a node cap ends up
     spending itself on `react` instead of on the repository. A prefix
     cannot filter them usefully either: their ids are
     `external:<package>`, so a directory prefix matches none of them and
     filtering would empty the list. "What does this repository depend
     on" is not a question about a subtree.
 11. **The snapshot test asserts the fixture list, not only the
     artifacts.** A new fixture added to `fixtures/` without being looked
     at is exactly the kind of change that should be visible in a diff,
     and the fixture list is the one thing a snapshot of the artifacts
     cannot show.
- **Alternatives rejected:**
  - *Put the artifacts behind the paid API.* D-019. The whole value is
    the fifth call, not the first.
  - *Have the client send the snapshot in the tool arguments.* It makes
    the caller responsible for a fetch contract it cannot see, doubles
    the payload of every call, and an agent that already has the files is
    not the agent that needs these tools. The user chose server-side.
  - *A count bound alone, or a byte bound alone.* Decision 3.
  - *Return the artifacts whole.* R-20 — an artifact over a
    two-thousand-file repository is megabytes of JSON, which does not
    inform the agent, it fills the context window.
  - *Keep the field named `externalDependencies` and let the description
    explain which set it is.* A name that needs a sentence of
    qualification is the wrong name; the description is not read on every
    call.
  - *Match `path_prefix` as a string prefix.* This is the defect the
    mutation check found — see the consequences.
  - *Read `path_prefix: '.'` as a literal directory name.* Also found by
    the check; it is how the Repository Map spells the root.
  - *Fold the symbol map's `failures` into `limitations`.* D-026: a
    failure names the *language* it could not read, and a generic list
    loses that. The view carries `failures` through unchanged and the
    context tool re-spells each one as `${language}: ${reason}`.
  - *Give the four tools a shared `snapshot` argument so they can be
    composed by hand.* It would make the cache the caller's problem and
    make every call carry a tree.
- **Consequences:** the `packages/mcp-server` suite exists (37 tests: 19
  in `intelligence.test.ts`, 18 in `index.test.ts`); core is 759/759
  (740 + 19 snapshot tests) and the workspace is 875/875. Thirty
  mutations were run over `intelligence.ts` and the new
  `withSnapshot` / `describeError` in `index.ts`: **30 caught, 0 missed,
  0 invalid.**
  Two real defects were found by the check and fixed, and both came from
  the same surviving mutation (`normalisePrefix`'s trailing-slash strip):
  - `path_prefix` was matched as a **string** prefix, so
    `path_prefix: 'src/deep'` also returned `src/deep-notes.ts` and
    `src/deeper/d.ts` — files the caller did not ask about, in an answer
    that looks complete;
  - `path_prefix: '.'` matched nothing, and `"."` is exactly how the
    Repository Map spells the root module.
  Following one surviving mutation to a pair of defects is the pattern
  the mutation-check skill records as 坑 5: a mutation that survives
  because two implementations answer the same question is a signal that
  one of them is wrong, not that the tests are weak.
  The snapshot half of this stage was verified to have teeth before it
  was trusted: changing the evidence `reason` in the Dependency Graph
  from `imports` to `depends on` left all 35 dependency-graph unit tests
  **green** and turned the snapshot **red** with the exact diff. That is
  the whole argument for snapshotting real fixtures on top of unit tests
  that assert fields — a field-level test asserts what someone thought to
  assert, and a snapshot asserts the rest.
  Still outstanding, unchanged by this stage: `security.scanFixtures`
  defaults to `false`; two `ruleId ?? ''` sites remain; and the four
  intelligence tools inherit R-03's anonymous rate limit (60 req/h),
  which is worth watching now that they are free and repeatable.
  `Symbol.references` is still 0 everywhere — the graph is what fills it,
  and that is a later stage.


## D-029 — Pointing the tools at a real repository, and what the guard for the fix turned out to be missing

**Status:** Accepted
**Date:** 2026-09-28
**Depends on:** D-001 (NodeNext emits the extension in source), D-025
(limitations), D-027 (the unit of an edge is the unit the language
imports), D-028 (the four free tools).

**Context.** D-028 shipped the four free Repository Intelligence tools
with 37 tests, and **every one of them injects a fake `SnapshotLoader`**.
Nothing in the suite had ever run the real path — `parseRepoUrl` →
`MetadataAnalyzer` → `GitHubFetcher` (tree + tarball) → the three builders
→ the two views — because it needs the network. Pointing the real loader at
this repository for the first time found a defect that had already shipped,
and the guard written for that defect then turned out to have gaps of its
own. Both halves are recorded here because the second half is the more
generalisable one.

**Decisions**

 1. **`.js` names `.tsx`, so `SOURCE_REWRITES` is a fan-out, not a pair.**
    `Header.tsx` compiles to `Header.js`, so a React project on NodeNext
    writes `import { Header } from './components/Header.js'` for a file
    called `Header.tsx`. The table held only `.js → .ts` — and
    `.jsx → .tsx`, `.mjs → .mts`, `.cjs → .cts` were each a *single*
    target, which is what "pair" means. It is now
    `.js → ['.ts','.tsx','.js','.jsx']`, `.jsx → ['.tsx','.jsx']`,
    `.mjs → ['.mts','.mjs']`, `.cjs → ['.cts','.cjs']`.
    The pairs are **derived, not guessed**: `.ts`/`.tsx`/`.js`/`.jsx` all
    emit `.js`; `.tsx`/`.jsx` emit `.jsx`; `.mts` emits `.mjs`; `.cts`
    emits `.cjs`. The order is a tie-break for a case TypeScript itself
    rejects as ambiguous.
 2. **The guard for a resolver defect is a unit test on the resolver, not a
    fixture snapshot.** A snapshot records behaviour, not correctness: it
    would have recorded the missing `.tsx` target as expected output and
    stayed green. This **downgrades the "snapshots have teeth" argument in
    D-028** to the narrower claim it can support — a snapshot catches a
    change nobody asserted, and a resolver test catches a rule that is
    wrong. Neither substitutes for the other, and the fixture set is also
    the wrong place: it holds no `.tsx`/`.jsx` at all, so the shape that
    found this defect was not representable.
 3. **Every row of the rewrite table is asserted separately.** The mutation
    check found five of the eight rows unguarded (see consequences) — the
    same class of gap that let `.js → .tsx` go missing. A table of rules is
    only as tested as its least-tested row, and the rows are independent:
    covering `.js` says nothing about `.mjs`.
 4. **The path CI cannot reach gets a script, not a test.**
    `scripts/intelligence-smoke.mts` runs the real loader over two
    repositories of different shapes (a one-file repository, where an empty
    graph is a valid answer and must not crash; and this one, which is the
    shape that found the defect). Its central check is written to be
    **independent of `resolve.ts`**: it reads the limitation line, rebuilds
    the path the specifier points at, and asks the file list. A check
    written against `SOURCE_REWRITES` would have agreed with the defect.
    It is `.mts`, not `.ts`, because the repo root has no
    `"type": "module"` and `@repopilot/core`'s `exports` declares only an
    `import` condition — a `require` of it fails with
    `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 5. **`symbols.degraded` is deliberately wider than
    `languageCoverage[*].degraded`, and the comments were wrong, not the
    code.** Four tests pin the wide meaning (no extractor for the language,
    an oversize file skipped, a capped symbol list, a parser that threw).
    Narrowing the code to match the comment would have made
    `get_symbol_map` return 500 of 2062 symbols with `degraded: false`.
 6. **A fetch failure keeps its HTTP status at the tool boundary.** `404`,
    `403` and `502` are three different next moves — "the repository is
    not there", "you are rate-limited", "the proxy or GitHub is
    unhealthy". `describeError` prefixes the status and the smoke script
    adds the one hint that matters when a human runs it: the anonymous
    limit is 60 requests/hour per IP.
 7. **The mutation harness stays out of the repository.** It encodes this
    machine's absolute paths, and the finding that matters is the *test*,
    not the harness. The durable home for the harness fixes is the
    `mutation-check` skill, which is where they went.
 8. **The `vitest.config.ts` weighting is an open V0.2-d item, not fixed
    here.** `vitest.config.ts` ranks 0.8650 in `importantFiles` — above
    every real entrypoint (library 0.8475, server 0.8300). It is a
    config-shaped path that happens to satisfy several entrypoint rules at
    once. Fixing it means changing `importance.ts`'s weights, which is
    V0.2-d's subject and needs its own record; silently retuning a scoring
    curve inside a follow-up would make two stages responsible for one
    number.

**Alternatives rejected**

  - *Add a `.tsx` fixture and let the snapshot catch it.* Decision 2. The
    snapshot would have encoded the bug; and a new fixture belongs with a
    plan, not appended at the end of a stage.
  - *Make the smoke script a test guarded by an env var so CI can skip it.*
    A test that is skipped by default is a test that is green without
    having run, which is the exact failure mode this whole entry is about.
  - *Write the smoke check against `SOURCE_REWRITES`.* It would have
    confirmed the defect instead of finding it.
  - *Trust the mutation check's first run (16 caught / 1 invalid).* The
    invalid row was the harness reading a stale baseline — see
    consequences. The run's own "worktree restored" line was false.
  - *Keep `.js → .ts` a pair and special-case `.tsx` where React is
    detected.* It makes correctness depend on a heuristic about the
    repository, when the rule is a property of the language.
  - *Fold the smoke script into `verify:release`.* That drives the paid
    audit flow; these four tools are the free ones, and the script needs a
    GitHub token and the network.

**Consequences**

The defect and its size, measured on this repository:

| | before | after |
|---|---|---|
| unresolved relative imports | 9 | 0 |
| dependency-graph limitations | 21 | 2 |
| graph edges | 470 | 488 |
| graph nodes | 205 | 206 |
| merged context limitations | — | 10 |

`scripts/intelligence-smoke.mts` runs 13 checks per repository and passes
on both. Its central check was verified to have teeth the same way the
resolver test was: reverting `SOURCE_REWRITES` to the pre-fix table turns
the check **red** with exactly those nine imports listed, and the graph
shrinks back to 470 edges over 205 nodes.

The mutation check ran 17 mutations over `resolve.ts`: **17 caught, 0
missed, 0 invalid, 0 errored** (run in short batches — see below). Its first
run found six genuine gaps, all in the rewrite table and its neighbours:
`.mjs → .mts`, `.cjs → .cts`, Vue and Svelte in `REWRITTEN_LANGUAGES`, the
`.ts`/`.tsx` tie-break, and `isRelativeSpecifier('..')`. Four tests and one
assertion were added; `resolve.test.ts` is 47 → 51.

**Two harness faults were found in the check itself, and they are the part
worth generalising.** Both are now in the `mutation-check` skill as 坑 7
and 坑 8:

  - **A killed run leaves the mutation in the source, and the next run
    snapshots that dirty file as its baseline.** A run stopped by this
    environment's timeout left the *exact defect under test* (`.tsx`
    missing from the `.js` row) in `resolve.ts`, twice. The next run then
    reported that mutation as `INVALID (anchor absent)` and — worse —
    restored from the dirty snapshot, writing the corruption back while
    printing `worktree restored`. The fix is to pin the baseline in a
    separate golden copy outside `/tmp`, run in short batches, and verify
    by md5 afterwards.
  - **A runner that dies is filed as a weak test.** The classifier read
    "no failing count and no `Tests no tests`" as "the suite passed". A
    Go-resolution mutation was reported MISSED this way and a manual run
    proved it is caught. A missing summary line is now its own verdict.

Both faults point the same way: **a mutation check is a measurement, and a
measurement you have not calibrated is a number, not evidence.** The first
run's headline (16 caught / 1 invalid) was wrong in both directions.

Still outstanding, unchanged: `security.scanFixtures` defaults to `false`;
two `ruleId ?? ''` sites remain; the four free tools inherit R-03's
anonymous 60 req/h limit, which the smoke script now makes easy to hit;
`Symbol.references` is still 0 everywhere; and the `vitest.config.ts`
weighting in decision 8.

## D-030 — The edge owns the origin, and the API stops being the public root

**Context.** Three artifacts disagreed about where the UI lives, and none of
them actually served it.

- The `Dockerfile` built `apps/web/dist` and copied it into the API runtime
  image. Nothing in that image reads it: there is no static plugin in
  `apps/api`, no `sendFile`, no catch-all route. The copy was dead weight that
  made the image look like it served a UI.
- `docs/deployment/nginx.conf.example` and `Caddyfile.example` proxied `/` to
  the API and left the UI **commented out** at an `/app/` subpath. As written,
  a visitor to the domain got the API's `GET /` service index — a JSON blob
  naming internal endpoints. Neither template was a deployable shape.
- `PROJECT_STATE.md` said "Web UI: http://localhost:5173 (dev) / static
  `apps/web/dist` in Docker". The second half was aspiration.

**Decision.** One public origin, owned by the edge.

```text
browser ──► web (nginx, the only published port)
              ├── /            → /usr/share/nginx/html (apps/web/dist), SPA fallback
              ├── /assets/*    → the same directory, immutable
              ├── /api/*       → api:4000
              ├── /health      → api:4000
              ├── /docs/*      → api:4000
              └── /healthz     → nginx itself
            api (Fastify :4000, published on 127.0.0.1 only)
            worker (pg-boss consumer)
            db (Postgres)
```

The edge config lives in `deploy/nginx/repopilot.conf` with the response
headers factored into `deploy/nginx/snippets/repopilot-security.conf`, and both
are baked into a `web` stage of the root `Dockerfile`. The `web` stage is
placed **before** `runtime` because Docker's default target is the last stage
and `docker:check` / `docker.yml` build the file without `--target` expecting
the API image.

**Consequences, stated so they are decisions rather than surprises.**

1. **`apps/web` keeps `base: '/'`.** It is served from the origin root, so the
   sub-path deployment question is closed, not deferred. A `/repopilot/`
   deployment would need `base`, the router's basename, *and* the proxy's
   location to agree; choosing the root removes all three. The white-screen
   symptom that prompted the question was never diagnosed because the premise
   is now false.
2. **CORS is not load-bearing in this topology.** Browser requests are
   same-origin. The API keeps `CORS_ORIGINS` configured for local development,
   where the UI runs on `:5173` and the API on `:4000`.
3. **The API's `GET /` is deliberately shadowed.** It stays reachable from
   inside the compose network. An index that enumerates internal endpoints
   should not be the public root.
4. **The API image no longer carries `apps/web/dist`.** The `web` image is the
   only thing that serves it, and the copy that no process read is gone.
5. **The API is published on loopback only** (`127.0.0.1:4000:4000`). This is
   not tidiness — it closes a rate-limit bypass. See R-24.
6. **Two images from one Dockerfile**, selected by `target`. A compose service
   that silently builds the wrong stage is caught by `compose:check`.

**Alternatives rejected.**

- **`@fastify/static` inside the API.** One process, one port, nothing to keep
  in sync — genuinely tempting, and it is the right answer for platforms that
  accept a single container. Rejected as the *default* because it adds a
  dependency to the API, puts a file server in the process that holds the
  database credentials and the GitHub token, and couples every UI deploy to an
  API restart. The split keeps a queue worker free of static-file concerns.
- **Separate subdomains** (`app.example.com` + `api.example.com`). Two
  certificates, CORS becomes load-bearing, and the UI's `fetch` calls are
  relative (`base = ''` in `lib/api.ts`), so every call site would need a
  configured origin.
- **Serving the UI at a subpath.** See consequence 1.

**Verification.** Docker is not available on every machine that has to review
this, so the topology is checked in two places that do not need it:

- `pnpm compose:check` (now a CI step) parses the compose file, asserts the
  `web` service exists on the `web` target with a healthcheck, asserts nothing
  but the edge is published on every interface, and asserts
  `deploy/nginx/repopilot.conf` actually routes `/api/`, `/health`, `/docs/`
  and the SPA fallback, forwards `X-Forwarded-For`, and that every `include` in
  it has a file behind it. Seventeen mutations — each one a real defect from the
  list above, from D-031, or from the Dockerfile's Node base image, its
  install/build filter lists, its install inputs and its runtime COPY list —
  were reintroduced one at a time and every one was caught.
- `.github/workflows/docker.yml` builds both stages and runs them **together on
  one docker network**, then asserts `/` serves the app shell, `/api/*` and
  `/health` proxy through to the API, a deep link returns the shell rather than
  a 404, and `/healthz` answers from the edge. It also now runs on push to
  `main`; it was PR-only, which meant a Dockerfile change could merge without
  its own build ever running.

## D-031 — Schema bootstrap is a job that runs before the API

- **Date:** 2026-09-29
- **Status:** Accepted
- **Context:** D-030 moved the public origin to the edge, which made
  `docker-compose.yml` the recommended deployment path. It was not a working
  one. Neither `server.js` nor `worker.js` calls `runMigrations`, so
  `docker compose up -d` brought up an API whose `checkDatabase` probe
  (`repo.list(1)`, `server.ts`) threw `no such table`. `/health` answered
  `degraded` on every request and every audit failed at the database layer —
  and every container still reported healthy, because `/health` returns HTTP
  200 whether or not the schema exists. `docker compose ps` showed a full set
  of green ticks for a deployment that could not audit anything. The docs had
  said "run `pnpm db:migrate` once", a step that cannot be run: the runtime
  image carries `dist/` and `node_modules/` but not `tsx`, which is what the
  `db:migrate` script shells out to.
- **Decision:** A one-shot `migrate` service applies the schema and exits;
  `api` and `worker` both depend on it with
  `condition: service_completed_successfully`. `restart: "no"`, and the command
  is `node apps/api/dist/db/migrate.js` rather than the `pnpm` script.
- **Consequences:**
  1. **The schema exists before anything queries it.** The ordering is
     expressed in the compose file rather than in a runbook, so it survives a
     reader who never opens the docs.
  2. **`docker compose ps` shows `migrate` as `exited (0)`.** That is success,
     not a crash loop, and the deployment docs now say so explicitly — the
     first thing a reader will otherwise do is restart it.
  3. **Re-running is safe.** Every statement in `runMigrations` is
     `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
     (`apps/api/src/db/client.ts`), so `up -d` against an existing database is
     a no-op.
  4. **The job has to satisfy the production guards**, so it carries the same
     `PAYMENT_MODE` / `AUDIT_QUEUE_DRIVER` / `DATABASE_URL` values as `api`.
     A misconfigured deployment now fails at `migrate` — earlier, and with a
     migration-shaped error, instead of failing a few seconds later inside the
     server.
  5. **`compose:check` asserts the ordering.** Removing the dependency from
     either service, pointing the job at the wrong command, or letting it
     restart are all errors, and all four mutations were falsified.
- **Alternatives rejected.**
  - **Document `docker compose run --rm api pnpm db:migrate`.** It cannot run
    in the runtime image (no `tsx`). This is what the docs said before, and its
    impossibility is precisely why the gap went unnoticed.
  - **Migrate from `server.js` at boot.** Every replica races the same DDL, and
    a process restart becomes a schema change. It also puts a write behind a
    read-only probe.
  - **Make a `degraded` health check fail.** It would have surfaced the
    original bug immediately, and it is tempting for that reason alone.
    Rejected because the deliberate `200` is what lets an operator tell "the
    process is up, a probe failed" apart from "the process is gone"
    (`routes/health.ts`). Fixing the deployment is better than overloading the
    probe. R-25 records what that costs.
- **Verification.** `pnpm compose:check` asserts the job exists, runs the
  compiled runner, does not restart, and is waited on by both processes with
  `service_completed_successfully`; four mutations cover it (M9–M12 in the
  topology falsification harness) and all four are caught. The `docker.yml`
  smoke test performs the same ordering by hand — `node
  apps/api/dist/db/migrate.js && exec node apps/api/dist/server.js` — so a
  regression surfaces as a failing smoke test rather than as a `degraded`
  `/health` that nobody reads.

## D-032 — A rule's scope is part of the rule

- **Date:** 2026-10-02
- **Status:** Accepted
- **Context:** Three real repositories were audited on 2026-10-01
  (`octocat/Hello-World`, `pinojs/pino`, and this one) and every finding was
  read by hand. 676 findings, not one a real credential. The causes were not
  bugs in what the rules *matched*; they were bugs in what the rules *looked
  at*:
  1. The screenshot check asked `filterFiles`' output whether a `.png`
     existed. `filterFiles` removes binaries, and a screenshot is a binary, so
     the answer was "no" before the question was asked (R-27).
  2. Stack and web3 detection read `fixtures/web3-hackathon/` — a fake
     Solidity project inside this repository's own test suite — and reported
     RepoPilot as `Solidity, Foundry`, then ticked "Contracts covered by
     tests" (R-28).
  3. The prompt-injection detector matched keywords against every line of
     every file, so it flagged its own keyword table, its own test suite, and
     `contract as the parent` (where "act as" is a substring of "contract as").
  4. The generic secret heuristic's match class included `/`, so URL path
     segments cleared the entropy threshold, and `sha512-` digests cleared it
     by construction.
  In each case the fix was to change the scope, not the pattern — and in
  cases 1, 2 and 4 the scope had been decided implicitly, by whatever list
  happened to be at hand.
- **Decision:** **What a rule looks at is a decision, and it is recorded
  where the rule is defined.** Concretely:
  1. **Existence questions are asked of the whole tree; content questions are
     asked of what was read.** `ReportBuilderInput` carries `allPaths` beside
     `entries`; `analyzeDocumentation` and `analyzeHackathon` take
     `readonly string[]` rather than `FileEntry[]`, so the filtered set is not
     the convenient argument.
  2. **A predicate that more than one entry point needs lives in one place.**
     `utils/paths.ts` holds `isSampleMaterialPath`, `isProseDocument`, and the
     document-name lists. The free check and the full audit read the same
     constants.
  3. **A rule that folds a list into a reading uses the same fold as every
     other rule that does.** `report/fixtures.ts`'s grouping is named
     `groupFindings` for that reason; the fixture summary and the launch
     checklist's evidence lines are two consumers of one function.
  4. **Where a rule's scope is narrowed, the narrowing is stated at the rule,
     not at the call site.** `security/injection.ts` says prose-only in its
     header, and says why invisible-character detection is exempt.
- **Consequences:**
  1. **A narrowed scope is a claim, and it has to be checked in both
     directions.** Every narrowing here is pinned by a pair of tests: the
     false positive that motivated it, and the true positive of the same shape
     that it must not lose. `secret-scanner.test.ts` has twenty such pairs.
     A detector tuned only against its false positives has stopped detecting.
  2. **Narrowing can hide a defect rather than fix it, so the scope is
     recorded as a gap where that is what happened.** The injection detector
     now looks at prose; the surface that can actually reach a model is the
     repository's GitHub description, and that is not scanned. R-08 says so
     instead of implying full coverage.
  3. **`utils/paths.ts` is a shared vocabulary, and it will drift if it is
     not treated as one.** `isSampleMaterialPath` is deliberately narrower
     than `isFixturePath` — different question, different answer, same
     directory — and both are documented with the case that distinguishes
     them.
  4. **The three-repository audit is the acceptance test for this class.**
     None of the four causes above is visible from reading the code. All four
     appeared within minutes of pointing the tool at real repositories.
- **Alternatives rejected.**
  - **Keep scanning everything and lower the severity.** This is what the
    injection detector already did: it was `low` with a comment admitting
    seven hits out of seven were false. A rule with a 0% hit rate that is
    reported on every audit is not a conservative default; it is noise that
    trains readers to skip the section. Lowering severity treats the symptom.
  - **Suppress findings whose file is the detector's own source.** It would
    have removed the most embarrassing instance and left the class intact —
    and it would have made the rule unable to report a genuine attempt in any
    repository that implements prompt handling.
  - **Truncate the checklist evidence instead of counting it.** Truncation
    drops the two facts that make the row actionable — which file, and how
    many hits — and leaves "and 634 more", which is strictly less informative
    than `×557 in pnpm-lock.yaml`.
  - **Ask each caller to pass the right list.** Four call sites, one of which
    is a test that already carried a stale copy of the wrong one. The input
    shape has to make the wrong argument unavailable, not discouraged.


## D-033 — A document states no fact it can derive

- **Date:** 2026-10-02
- **Status:** Accepted
- **Context:** The same review that produced D-032 also cross-checked every
  document against the code and found **fourteen** places where they disagreed.
  Nearly all of them were one shape: a number or a name that can be read out of
  the source tree, typed into a paragraph by hand, and then kept in step by
  discipline. The MCP tool count appeared as "seven" in `README.md` and
  "thirteen" in the same file's layout section. `PROJECT_STATE.md` listed three
  tools. `docs/RELEASE_CHECKLIST.md` carried a test baseline of 104/104.
  `docs/ARCHITECTURE.md` said the analyzers run in parallel; they run in
  sequence, and there are nine of them rather than seven. Two documents told an
  operator to run `pnpm start:api`, which had never existed.

  This is the same defect as D-032's, one layer up. D-032 says a rule's scope
  must not be decided by whatever list is at hand; this says a document must not
  restate a fact the code already holds. It is also the same defect as R-26 —
  the review was itself a sub-agent reading files by hand, which is a check that
  runs when someone remembers to run it, and the fourteen had accumulated across
  several releases.

- **Decision:** **A fact that can be derived from the repository is derived, and
  a check that cannot fail is not a check.** Concretely:
  1. **Derivable facts are generated into the documents.** `scripts/docs-facts.ts`
     computes the MCP tool list and count (from the `server.tool()` registrations
     *and* the `BILLING` map, which must agree), the compose service table, the
     workspace package names and count, and the `docs/` file list. It writes them
     between `<!-- docs-facts:… -->` markers in `README.md`,
     `PROJECT_STATE.md`, `docs/ARCHITECTURE.md` and `docs/RELEASE_CHECKLIST.md`.
     `pnpm docs:check` recomputes and exits non-zero on divergence; `pnpm docs:facts`
     rewrites. The check is in CI.
  2. **Some invariants need no rendered output, only a check.** Three of them
     carry no block: the `BILLING` map against the registrations, `docs/INDEX.md`
     against the `docs/` directory (coverage, and that every link resolves), and
     every `` `pnpm <script>` `` a document names against the root
     `package.json`. A check does not have to produce anything to be worth
     running.
  3. **A generated block that is absent is a failure, not a pass.** If no markers
     are found anywhere, `docs:check` reports that the check is a no-op rather
     than printing a green tick. A regex that stops matching must not look like
     agreement.
  4. **Per-batch acceptance is a tool, not a ritual.** `scripts/audit-diff.ts`
     runs the four reference audits sequentially and prints the comparison
     against `scripts/audit-baseline.json`. It is deliberately **not** a CI gate.

- **Consequences:**
  1. **The class is closed, not the instances.** Six of the fourteen are fixed by
     hand in the same pass; the rest cannot recur, because the numbers they
     contained are no longer in the documents.
  2. **What is *not* generated is a decision, and it is written down.** Test
     baseline numbers (unknowable until the suite runs, so a generator would be
     circular), version strings, and narrative sentences stay hand-written.
     `PROJECT_STATE.md` owns the baseline; `docs/RELEASE_CHECKLIST.md` points at
     it instead of repeating it. The analyzer count is deliberately not generated
     either, for a different reason: `packages/core/src/analyzers` holds eight
     modules, `ReportBuilder.build()` calls nine functions, and `metadata.ts` is
     called by the pipeline rather than the builder. A generator would have to
     pick one of three defensible numbers and defend it. `docs/ARCHITECTURE.md`
     names the nine calls in order and claims no count at all, which is a
     sentence that cannot go stale.
  3. **The check was verified by mutation, not by inspection: 12 mutations, 12
     caught.** Each block id was corrupted in both directions, a fake `pnpm`
     command was added, a docs file was added without an INDEX link, an INDEX
     link was broken, a compose service was added, and every marker was deleted.
     Two further mutations were *discarded* — they exited non-zero because pnpm
     itself refused to run, not because the check caught anything. Counting those
     as catches would have been the same mistake as a check that cannot fail.
  4. **A baseline is a measurement record, not an expectation.** `audit-diff`
     reports movement; it does not assert. The first version of
     `scripts/audit-baseline.json` was captured against a commit nine commits
     behind, and re-running the self-audit moved `securityHygiene` from 40.5 to
     0.0 — which is how **R-29** (the mnemonic rule firing on the BIP-39 wordlist
     that defines it, 166 findings) was found. A gate would have called that a
     failure and taught everyone to update the baseline without reading it.

- **Alternatives rejected.**
  - **Re-run the sub-agent document check before each release.** This is what
    produced the fourteen. It costs minutes of a model's attention, it is
    non-deterministic, and its coverage is whatever the model happened to read.
    `docs:check` costs a tenth of a second and is total over the facts it owns.
  - **A link checker only.** Cheap and useful, and it would have caught none of
    the fourteen: every one of them was a link that resolved, pointing at a
    document that said something false.
  - **Generate the test baseline too.** It cannot be generated before the tests
    run, so the generator would have to run them, and then CI would be comparing
    a number against itself. `PROJECT_STATE.md` owns it instead, and the
    checklist links there.
  - **Make `audit-diff` a CI gate.** Three of the four targets are other people's
    repositories. pino changes; our score changes; the build goes red for a
    reason nobody can act on. It is an acceptance tool for a human running a
    batch, and it says so in its header.
  - **Exclude the detector's own files from the scan.** R-29's most embarrassing
    instance would vanish and the class would not: a target repository's
    `@scure/bip39` wordlist is the case that matters, and this repository is the
    one repository where the bug is harmless.


## D-034 — The scope of a check is part of the check

- **Date:** 2026-10-02
- **Status:** Accepted
- **Context:** D-033 replaced a document review that ran when someone remembered
  to run it with `docs:check`, which runs on every push. The new check was total
  over the documents it owned. The set of documents it owned was a hand-written
  list of four — `README.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`,
  `docs/RELEASE_CHECKLIST.md` — and `ROADMAP.md` was not on it.

  `ROADMAP.md` had drifted in exactly the way the fourteen had:
  1. **"all 5 packages + 2 apps"** — `packages/` has held three directories
     since the first commit. This was never true, not merely stale.
  2. **"5 fixtures: complete / minimal / no-readme / prompt-injection /
     secret-leak / web3-hackathon"** — a count of five above six names.
  3. **The standalone worker process was listed as future work for 0.2.0**,
     while `CHANGELOG.md`'s rc.3 section said it had shipped and
     `apps/api/src/worker.ts` had been in the tree since the first commit.
  4. **`docs/RELEASE_CHECKLIST.md` had a generated block whose markers had been
     removed**, leaving the sentence "(every workspace: )". `docs:check` could
     not see it: the check compares the blocks it *finds*, and there was nothing
     to find.

  This is D-032's defect one level up, and R-26's defect again. D-032 says a
  rule's scope must not be decided by whatever list is at hand. D-033 then built
  a mechanism whose scope was decided by exactly that.

- **Decision:** **The set of things a check examines is part of the check, and a
  thing outside the set is a failure rather than a silence.** Concretely:
  1. **Every markdown file is in exactly one of two lists.** `BLOCK_DOCS` names
     the documents that may carry generated blocks; `BLOCK_FREE_DOCS` names the
     rest *and gives the reason*. `checkBlockScope()` fails if a file is in
     neither or in both, so adding a document forces a decision instead of
     defaulting to unchecked.
  2. **The reason is the load-bearing part.** "It states no fact the code holds"
     and "its facts are only knowable after a run" are different decisions, and
     the next person to add a number to `RISKS.md` needs to know which one it
     was. A bare list of exempt files would have recorded the exemption and lost
     the argument.
  3. **A deleted block is a defect, not an absence.** `BLOCK_DOCS` therefore
     names not only *which documents* may carry blocks but *which blocks each
     one carries*, and `checkBlocks()` fails on a declared block that is not
     present and on a block that no document declares. This closes a gap that
     the first version of this decision recorded as open, and it was open in a
     way worth naming: the check compared the blocks it *found*, so a block that
     had been deleted had nothing left to be stale, and the
     `docs/RELEASE_CHECKLIST.md` case — markers gone, sentence left behind,
     document still in `BLOCK_DOCS` — passed with a green tick for an unknown
     length of time. **A check whose scope is "whatever I happen to find" cannot
     see a deletion.** Eight mutations against the new rule, eight caught; two
     of the eight passed on the first attempt for the *wrong* reason (a body
     that was both undeclared and stale), and were re-run with a correct body so
     that only the intended rule could fire.

- **Consequences:**
  1. **The document set grew from four to seven, and the mechanism found more
     drift on the way in.** `docs/INDEX.md` and `docs/MCP_CLIENT_SETUP.md` both
     said "thirteen tools"; `README.md` and `PROJECT_STATE.md` both said "6
     sample repos". Four correct numbers that nothing kept correct. All four are
     generated now.
  2. **`fixture-count` is the eighth block id**, reading `fixtures/` the way
     `workspace-count` reads `pnpm-workspace.yaml`.
  3. **Adding a document now has a cost, deliberately.** A new `.md` file fails
     `pnpm docs:check` until it is classified. That is the friction
     `docs/INDEX.md` already imposes — it must link every document — and it is
     the point.
  4. **A historical record may state a number that is no longer true, and this
     is the distinction the classification forces.** `ROADMAP.md`'s rc.1 section
     saying "MCP: stdio server, 3 tools" is a record of rc.1 and is correct;
     `PROJECT_STATE.md`'s tool list saying three tools was a current-state claim
     and was wrong. Both came out of the same re-read; only one was a defect.
  5. **Declaring the block ids turned out to be the same decision applied once
     more, not a separate mechanism.** The first version declared the document
     set and left the block set implicit; the second declares both, and the two
     failures they prevent have the same shape — a thing that is absent from the
     record is indistinguishable from a thing that was never meant to be there.
     The generalisation is worth carrying to the next check: **for every set a
     check iterates, ask what an *empty* member of that set looks like.**

- **Alternatives rejected.**
  - **Fix `ROADMAP.md` by hand and leave the list at four.** This is what the
    plan called for, and it is what produced the problem: the next document
    added would be unchecked by default, exactly as `ROADMAP.md` was.
  - **Check every markdown file for every block id.** Most documents state none
    of these facts, so the check would report dozens of absences and teach
    everyone to ignore it. The classification is what makes the silence mean
    something.
  - **Derive the list from the directory instead of declaring it.** Then a new
    document would be in `BLOCK_DOCS` by default, which is the failure mode with
    extra steps: nothing would be recorded about whether it *should* be.
  - **Make `docs:check` fail on any document not in `BLOCK_DOCS`.** It would
    make `CHANGELOG.md` — a historical record that must not be generated — a
    permanent failure.

---

## D-035 — A tier changes what a report carries, never what it measures

- **Date:** 2026-10-03
- **Status:** Accepted
- **Context:** `mode` was a required field on every audit request and it decided
  the price — 0.02 USDT for `quick`, 0.10 for `full`. It did not decide the
  analysis. Every analyzer ran in both modes, `scanHistory()` was called
  unconditionally, and grepping `packages/core/src` for a comparison against
  `mode` returned exactly three, all in `report/builder.ts`, all after the
  analysis had finished: one extra recommended task, two extra deployment
  steps, and a sentence in `quick` reports reading "Quick scan skips some of
  the deeper reproducibility heuristics." Nothing was skipped.
  `reproducibility` scored 28.5 in both modes.

  Three documents described the difference, and all three described it wrongly:
  `MARKETPLACE_LISTING.md` promised "the deeper reproducibility and Web3
  analyzers" in English and in Chinese, `builder.ts` carried the false
  sentence, and `screenshots/README.md` labelled the two modes' artefacts "same
  content here, repo is too small to differ" — the right observation with the
  wrong explanation, written months earlier and never checked. Nothing
  compared a claim about `mode` against `mode`.

  There was also a second knob for the same axis. `includeLaunchCopy` was a
  request field that gated `launchCopy`, defaulted to `true`, and appeared in
  the web form, the MCP tool arguments and the cache key — while the marketplace
  listing attributed the launch copy to the `full` tier. Two ways to say "how
  much do I get", disagreeing about which one was authoritative.

- **Decision:** **A tier selects what a report carries, and it must never
  select what the report measures.** Concretely:
  1. **The verdict is identical in every tier.** The five dimension scores,
     the blocker list, the documentation gaps, the security findings, the
     detected stack, the recommended tasks and the launch checklist are
     computed the same way and come out the same. A test pins this field by
     field rather than only on `overall`, because "the score is the same"
     would still hold if a tier quietly dropped the findings the score is
     computed from.
  2. **The tier boundary is declared in one place.** `report/tiers.ts` holds
     `FULL_ONLY_SECTIONS`. Two things are derived from it rather than written
     by hand: the report's `omittedSections`, and the sentence the report uses
     to describe its own omissions. Three scattered `if (mode === 'full')`
     sites could not be compared against each other; a list can be.
  3. **Absent and empty are different claims.** A report names what it does
     not carry in `omittedSections`. `deploymentPlan: []` on a quick report
     means "the tier does not include one", not "this repository has no
     deployment story". A test checks the declaration against the sections in
     **both** directions.
  4. **A flag's scope is declared where the flag is.** `includeLaunchCopy` is
     a refinement inside `full`, not a second way to choose a tier, and that
     sentence lives next to the tier that owns it (D-032).
  5. **A price gap has to describe something the code does.** The full audit
     is 0.05, not 0.10; the 5x multiple priced an analysis difference that was
     never implemented.

- **Consequences:**
  1. **`Report.reportVersion` moved to 1.2.** The schema change is additive and
     a stored 1.1 report still parses — `omittedSections` defaults to `[]`,
     which is the true answer for it — but the *content* of a quick report
     changed, and `reportVersion` is in the report cache key precisely so a
     build does not serve a report written by an older one.
  2. **The derived views stay free, and the ladder is still real.**
     `/fix-plan`, `/diff` and `/quality` read a report and never re-scan
     (`apps/api/src/routes/audit-derived.ts` states this as an invariant), so
     they cannot be the tier boundary. The deployment plan and the launch copy
     are not derivable from the findings, which is what makes them a boundary
     that holds without reversing that invariant.
  3. **Making `quick` skip analyzers was rejected, and the reason generalises.**
     It would have made `overall` a property of the price. Two buyers auditing
     the same commit would get different numbers, and neither could tell which
     one described the repository. For a launch-readiness gate, being the same
     answer for everyone is the product.
  4. **The missing test was the whole story.** R-30 recorded that no test
     pinned the false sentence, which is how it survived. `tiers.test.ts` now
     pins the declaration, the identical-verdict property, the two-directional
     consistency of `omittedSections`, and the absence of any limitation line
     matching `/skip|deeper|thinner/i`. The consistency test immediately found
     that `builder.test.ts` had a test running as `quick` with
     `includeLaunchCopy: true` and asserting the launch copy came out — the one
     test touching the boundary, asserting the wrong side of it.
  5. **`launchCopy` was already being represented the bad way.** A quick report
     emitted `{oneSentencePitch: '', shortDescription: '', xPost: ''}` — three
     empty strings standing in for an absence, with nothing saying which it
     was. That is D-033's defect in a field rather than in a document.

- **Alternatives rejected.**
  - **Collapse to one tier.** Honest and cheaper, and it was a live option.
    Rejected because a deployment plan and a set of launch copy are real
    deliverables that a buyer can want without wanting a second analysis.
  - **Make `quick` genuinely skip analyzers.** See consequence 3.
  - **Delete `includeLaunchCopy` from the request.** It is the cleanest
    expression of "one knob", but it is in the web form, the MCP tool
    arguments, the cache key and the integration scripts, and removing a
    public request field is a breaking change with its own blast radius and
    its own decision. Recorded as a residual in R-30 instead of folded in.
  - **Rewrite the documents and leave the code.** This is what would have
    erased the evidence: the limitation sentence proved that a real tiering
    had been intended, and deleting it alone would have made the code and the
    listing agree on a smaller product than the one someone meant to build.

---

## D-036 — A payload an external party reads is compared, not duplicated

- **Date:** 2026-10-04
- **Status:** Accepted
- **Context:** Two defects found in one session turned out to be one defect.

  The first was the price. `PRICE_FULL_AUDIT` was stated as `0.10` in
  `.env.example` and `0.05` in every other place that stated it. The running
  process charges the `apps/api/src/config.ts` default, which was `0.05` — so
  the number a buyer read on `MARKETPLACE_LISTING.md` and the number their
  client would sign an EIP-3009 authorization for were different. Worse,
  `docs/EXTERNAL_ACTIONS.md` instructed the operator to "set the price exactly
  as documented in `.env.example`", pointing the runbook at the one wrong copy.
  The failure mode is a failed payment on the first real sale.

  The second was the 402 challenge. `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §5.5 is
  the registration authority for `accepts[]`, and nothing compared it to
  `OkxPaymentAdapter.createChallenge()`. It had drifted in **four** independent
  ways: `resource` documented `https://<public-domain>/api/v1/audits` while the
  code hard-coded `https://repopilot/api/v1/audits` — a syntactically valid
  https URL with no TLD, "the kind of value nobody notices"; `description`
  documented `RepoPilot Quick Audit` while the code emitted `RepoPilot quick
  audit`, the internal `mode` value lower-cased; `maxTimeoutSeconds` documented
  `60` while the code emitted `300`; and `asset` was in the emitted challenge
  and absent from the document.

  Both are the same thing: **a value that crosses a boundary — to a buyer, to
  the marketplace, to a client library — exists as a machine-produced value and
  as a hand-written copy, and nothing compares the two.** The hand-written copy
  is not a second opinion; it is a statement that can only ever be wrong, and
  it is read by the party with the least ability to work out which side is
  right.

- **Decision:** **For any payload an external party reads, either it is
  generated from one source, or a check reads both sides and asserts they are
  equal.** Concretely:
  1. **The check reads the producer, not a third statement.** `docs:check`'s
     price check reads the twelve places that state a price and compares them
     to each other; `okx-adapter.test.ts` parses the §5.5 JSON block and
     compares the field set and every environment-independent value against a
     freshly built challenge. A document cannot disagree with a function it is
     never compared to.
  2. **A check that has not been injected has not been shown to work.** Every
     check added here was verified by injecting the exact defect it exists for,
     confirming it goes red, then restoring and sha256-verifying: seven
     injections against the price, seven against the 402 shape, three against
     the payment factory. (An eighth 402-shape injection — the documented
     full-tier atomic amount — never applied, because the harness built its
     search anchor with a shell-quoted backtick. That is a harness bug rather
     than a coverage gap, and the path is covered by the price check's
     membership assertion; recorded here so the count in this paragraph is not
     read as "eight were tried and one was missed".)
  3. **The scope of a check is asserted, not implied.** The price check's count
     guard was `statements.length < 8`, which `required()` can never reach —
     it throws first. Deleting an `add()` call is the one way the check can
     silently cover less, so the count is now `EXPECTED_STATEMENTS = 12` with
     `!==`. This is D-034 applied to a set instead of a document.
  4. **A placeholder must be a property of the string, not knowledge the reader
     has to have.** `resource` defaulted to a hard-coded
     `https://repopilot/api/v1/audits`. It is now `PLACEHOLDER_RESOURCE` =
     `https://repopilot.invalid/api/v1/audits`: RFC 2606 reserves `.invalid`
     and it can never resolve, so "this is a placeholder" is visible in the
     value. `isPublicHttpsUrl()` rejects it along with `.local`, `.internal`,
     `localhost`, bare IPv4, non-https, hostless and empty — so an operator who
     pastes the placeholder by hand does not pass production.
  5. **A fixture must not use the production value.** Measured, not assumed:
     with `factory.test.ts`'s fixture at `0.05`, replacing `priceFor`'s return
     with a literal `0.05` survives the whole suite. The fixture is `0.13` and
     the production price is `1`. This is also why `docs:check` reads the price
     statements and **not** the test files — a fixture that used the production
     value would make the check agree with a hard-coded one. (D-037 reduced the
     statements from twelve to six, and found that a fixture off the production
     price is necessary but not sufficient: a literal equal to the *fixture*
     survived too, and the fix was a test with two differently-priced configs.)

- **Consequences:**
  1. **`pnpm preflight:production` exists because a check that is not run in
     the deployment's own configuration is not a check.** `env:check` reads
     `.env`, so it passes in development for reasons that do not hold in
     production. The script *runs* the existing checks rather than
     re-implementing them (a re-implementation is a copy that can disagree),
     and adds `loadConfig()` under `NODE_ENV=production` plus the two brand
     assets measured off disk.
  2. **`OKX_PAYMENT_RESOURCE_URL` is required in production.** A new env var
     with a new guard, and it had to be added to `docker-compose.yml` for the
     `migrate` and `worker` services too — every process that calls
     `loadConfig()` runs the guards, so `docker compose up` otherwise hangs on
     a migration container that exited 1.
  3. **`CHALLENGE_DESCRIPTION` is the tier names from the listing.** The
     payment prompt now names the tier the same way the thing that sold it
     does.
  4. **One thing is recorded as unconfirmed rather than guessed.** `asset` is
     in the emitted challenge and not in §1.4's field list. Either that list is
     not exhaustive or the field is extra. It is marked **unconfirmed** in the
     snapshot and carried as a residual in `RISKS.md`, because the honest
     version of "we do not know" is worth more than a confident sentence.

- **Alternatives rejected.**
  - **Generate §5.5 from the adapter.** The document is a snapshot of an
    external party's requirements — it is the *input* the adapter must satisfy,
    not a rendering of the adapter. Generating it would have deleted the
    specification and kept the implementation.
  - **Delete the hand-written copies and keep one.** Right answer where it is
    possible, and it is what `report/tiers.ts` did for R-30. It is not possible
    here: `.env.example`, `docker-compose.yml` and the listing are read by
    people and tools that do not run the code, and the registration table is a
    form field on a website.
  - **A third document that states the canonical price.** That is the defect
    with an extra copy. Two statements need a check that compares them, not a
    third statement.
  - **Trust the listing and repricing upward to `0.10`.** The registration is
    the authority for what is sold and re-registering a service is a human-side
    action; a commit cannot do it. Aligned down to `0.05` instead.
    **Corrected by D-037:** this reasoning assumed a registration existed to be
    the authority. None had happened — `docs/EXTERNAL_ACTIONS.md` item 2 was
    `READY_TO_PUBLISH`, not `DONE` — so the price was free to change and the
    "align to the authority" argument had nothing to align to.

---

## D-037 — One price, one product: a difference the buyer cannot see is not a tier

- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** There were two paid tiers. `PRICE_QUICK_SCAN` was `0.02` and
  `PRICE_FULL_AUDIT` was `0.05`, and `priceFor(cfg, mode)` returned a different
  amount per mode. The two modes ran **every analyzer over the same commit** and
  produced the same scores, blockers and findings — D-035 had already
  established that, and `tiers.test.ts` pins it. The only difference was
  `deploymentPlan` and `launchCopy`: report sections, not work.

  The listing stated the difference and stated it against itself. The expensive
  tier's own description read:

  > "Complete launch audit: blockers, task breakdown, deployment plan, and
  > ready-to-paste launch copy. **Runs the same analysis as the quick audit and
  > adds the launch materials.**"

  An agent comparing the two services reads that sentence and picks the cheaper
  one. The tier that was supposed to be the product was documented as a
  superset of a cheaper thing that measured identically. So the price gap did
  not sell a better analysis; it priced report sections, and it priced them
  against a copy that told the buyer not to pay.

  The numbers did not work either. `0.05` USDT is about ¥0.36 per audit; at a
  thousand audits a month that is ¥360/month, which is below the cost of a
  buyer deciding whether to buy. A price that low does not signal cheapness, it
  signals that nobody thought about it.

  And the positioning had a defect the price was hiding. Two different
  quantities were both advertised as "a 0-100 score":

  | | free check | paid audit |
  |---|---|---|
  | what it is | `Math.round(passed / 5 * 100)` | weighted, multi-dimension |
  | possible values | `0`, `20`, `40`, `60`, `80`, `100` | any decimal (`octocat/Hello-World` = 45.2) |

  The product's selling point is that a score is a property of the repository,
  reproducible by anyone. Two quantities under one name, in the same listing,
  is the opposite of that claim.

- **Decisions:**
  1. **One paid tier, `1` USDT.** `DEFAULT_PRICING` is `{ audit: { amount: '1',
     currency: 'USDT' } }`; `PRICE_QUICK_SCAN` and `PRICE_FULL_AUDIT` are
     replaced by `PRICE_AUDIT`.
  2. **`priceFor()` does not take a `mode`.** It used to, and returned a
     different amount per mode. `mode` still selects what the report carries
     (D-035); it no longer selects what it costs. The `quote` the buyer sees
     still carries `mode`, because it still describes the report they will get.
  3. **The product is a release gate.** The ASP description, both languages of
     the listing, the two service descriptions, `accepts[].description` and the
     web UI now sell an answer to "can this ship" rather than a document called
     a launch-readiness report. The paid service is `RepoPilot Release Gate`
     (EN) / `发版门禁` (ZH); the free tier is unchanged and is the triage step
     in front of it.
  4. **The free check stops claiming a score.** It returns five pass/fail
     checks and the detected stack. The 0-100 readiness score belongs to the
     paid gate alone, which is the one that computes a weighted one.
  5. **`CHALLENGE_DESCRIPTION` is one string, not a `mode`-keyed map.** The
     payment prompt used to name a tier; with one price there is one thing to
     name, and naming a `mode` would name something the buyer did not choose.
  6. **The registration copy names `mode=full`.** The server default is
     `quick`, which omits the deployment plan and the launch copy. A buyer who
     pays 1 USDT should not receive less than the description they paid
     against, so the description names the mode rather than relying on a
     default the buyer cannot see. Recorded in §5.4 of the snapshot next to the
     table it applies to.
     **Resolved 2026-10-05 (R-37):** the default is now `full`, so the copy and
     the producer agree instead of the copy compensating for the producer. The
     mode stays named in the description — a caller should be able to see which
     shape is sold without inferring it from a default — but that sentence is no
     longer load-bearing.

- **Consequences:**
  1. **The price check got smaller and stricter at the same time.** It read
     twelve statements across two tiers; it reads six across one, and it is now
     a single agreement check rather than a loop over two keys — a loop over one
     key is only a place for a second key to reappear by accident.
  2. **The count assertion had to be re-derived, not re-typed.** Deleting an
     `add()` call is the one way this check can shrink silently, so
     `EXPECTED_STATEMENTS = 6` is asserted with `!==`. Injected and confirmed:
     removing one `add()` prints `read 5 price statements, expected 6`.
  3. **The §5.5 comparison test now derives its input from the document.** It
     passed a fixture amount and compared the result to the documented atomic
     value; with one price that fixture no longer matched, and the fix was to
     read the decimal off the documented atomic string rather than write a
     second price into the test. Whether the documented price is the one the
     server charges is `docs-facts`' job; whether the adapter scales it
     correctly is the adapter test's. Neither subsumes the other.
  4. **`docs/API.md` no longer states a price in its tiers table.** The
     boundary `readPriceStatements()` draws is now explicit: it reads every
     place the repository *asserts* a price, and not the worked example payloads
     in `docs/API.md` and `docs/MCP_CLIENT_SETUP.md`, whose numbers illustrate
     shape and are kept in step by hand.
  5. **The word "tier" now means report shape.** `packages/core/src/report/`
     still calls them tiers and that is left alone — renaming it would touch
     every test for no safety gain — but `report/tiers.ts` says what the word
     means now and that nothing in the module reads or writes a price.
  6. **A fixture off the production price is necessary but not sufficient.**
     With `factory.test.ts`'s fixture at `0.13`, replacing `priceFor`'s body
     with a literal `0.13` still survived the whole suite — every test in the
     block compared against that same fixture, so the literal satisfied all of
     them. `factory.test.ts` gained a test that passes two configs with
     different prices and asserts each comes back; the mutation now fails one
     test. Found by injecting the defect, not by reading the test.

- **Alternatives rejected.**
  - **Keep two tiers and raise the expensive one.** It would price report
    sections higher, which is what the tier already did. Raising the number does
    not fix a description that tells the buyer to pick the other one.
  - **Keep two tiers and make `full` run more analysis.** That is the honest
    version of the two-tier story and it is the one D-035 forecloses: a score
    that depends on what you paid is not comparable between two people looking
    at the same commit, and comparability is the product.
  - **Remove `mode` entirely.** With one price and one product, the knob has no
    commercial meaning left. But `auditMode` is a field on the public `Report`
    schema and `omittedSections` is derived from it; deleting it is a
    report-format migration, not a repricing. The knob stays as a report-shape
    parameter and is documented as one.
  - **Default `mode` to `full` instead of naming it in the copy.** One line of
    code, and it would make the default match the promise. Rejected for this
    change because it silently changes the report every existing caller gets —
    including the web UI's own default — and that is a behaviour change that
    deserves its own decision rather than riding along with a price change.
    **Taken 2026-10-05 (R-37), on its own.** The decision arrived: the default
    is `full` in `CreateAuditInputSchema` and in both MCP tool schemas, the web
    form starts on `full`, and `quick` is an explicit opt-out.
    `inputs.test.ts` pins the default, because a one-line change that nothing
    observes is a one-line change that comes back.
  - **Leave the free check's "0-100 score" alone.** It is technically a 0-100
    number. It is not the same quantity, and the listing put the two side by
    side under one name in a product sold on reproducibility.

## D-038 — An invariant this service stands in for, this service must perform

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** `OkxPaymentAdapter` verifies a buyer's EIP-3009 authorization
  **offline** and never reads a chain — that boundary is deliberate and
  documented (R-39). On chain, what makes one authorization worth one transfer
  is EIP-3009's `authorizationUsed[from][nonce]` mapping: the nonce is
  single-use. Because this adapter is the *only* thing between a buyer and a
  1 USDT audit, it is standing in for that read. It was not performing it.

  Two consequences, both measured (R-40):

  - The signed message is `(from, to, value, validAfter, validBefore, nonce)`
    and does **not** contain the `paymentId`, which this service chooses and
    which arrives as a plain field in the same JSON envelope. So a signature is
    valid for any challenge quoting the same payee and amount — and since every
    POST mints a fresh `paymentId` (D-011), there is always a new challenge to
    point it at. One signature bought unlimited audits.
  - The signed `validAfter` / `validBefore` window was never compared to a
    clock, so an authorization that expired last year verified as paid.

- **Decision:** **When a component is the substitute for an external
  guarantee, the guarantee is the component's job.** `OkxPaymentAdapter`
  therefore performs the `authorizationUsed` check itself: it records the
  `(from, nonce)` key on first successful verification and rejects a repeat, and
  it enforces the validity window (`validBefore` exclusive, matching
  `block.timestamp < validBefore`).

  The key is `` `${from}:${nonce}` `` — the same key the on-chain mapping uses,
  deliberately, so that a future durable implementation is a persistence change
  and not a semantic one. It is burned **after** the signature verifies, so a
  caller cannot consume a nonce it cannot sign for. The receipt cache is
  consulted **before** the nonce, so the retry the whole design depends on — same
  `X-PAYMENT`, same `paymentId`, D-011 — is not mistaken for a replay.

- **Consequences:** The gate now enforces what it claims. `verifyEip3009`
  returns the nonce key rather than a boolean, so there is one parse and a caller
  cannot forget which nonce it accepted.

  **The gap this decision accepts, stated rather than implied.** The set is
  in-process. A restart, or a second replica, forgets it and replay works again.
  That is why `forgets which nonces it has seen when the process restarts` exists
  as a test that asserts the limitation, and why the wording everywhere is
  "replay works only across a restart", never "replay is impossible". It is
  still the difference between "replay always works" and "replay works across a
  restart". The durable version is in `BACKLOG.md` with its design.

- **Alternatives rejected.**
  - **Treat it as an on-chain concern and leave it.** This is exactly the defect:
    the adapter claims to verify a payment while relying on a read it does not
    perform. A buyer does not need to understand EIP-3009 to rewrite one string
    in a base64 blob they compose.
  - **Persist the nonce now, with a UNIQUE constraint.** The right end state, and
    rejected only for *this* change: it is a schema change (a column or table,
    a hand-written migration, `JobService` plumbing, a route change) landing in
    the same commit as the semantic fix, which makes a failure ambiguous between
    the two. Recorded in `BACKLOG.md` instead of half-done here.
  - **Bind the `paymentId` into the signed message.** It would make each
    signature challenge-specific and remove the need for a nonce table. It is
    not available: the buyer's `onchainos` CLI signs a fixed
    `TransferWithAuthorization` struct defined by EIP-3009, and this service does
    not control what the buyer signs. A gate that depends on the client
    volunteering a new field is not a gate.
  - **Reject a second use of a `paymentId` and call it done.** Already true
    (`jobs.payment_id` is UNIQUE) and it does not help: D-011 makes every POST
    mint a *new* `paymentId`, so the reused thing is the signature, not the id.
  - **Delete `validAfter` / `validBefore` from the checks and document that
    expiry is the seller's problem.** Rejected on the same grounds as leaving the
    nonce out: accepting an expired authorization hands over an audit that can
    never be collected, whatever the seller does later. It is a correctness
    check, not a policy choice — the opposite of what R-39 concluded when it left
    the window unchecked, and that reversal is recorded in R-39.
  - **Add `viem` to `apps/api` to test replay through the route.** The
    end-to-end statement would be nicer. Rejected: it is a dependency added for
    one test, and the composition is already pinned from both sides —
    `refuses a signature that has already bought an audit` (adapter → `failed`)
    and `does not enqueue the audit when the payment is not completed`
    (route → `402`, no job). The reasoning is written into the test file's
    header so the absence reads as a decision and not an oversight.

## D-039 — A queue name belongs to the database, not the process

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** `PgBossAuditQueue` is the production driver
  (`AUDIT_QUEUE_DRIVER=pg-boss`, the split API / worker deployment in
  `PROJECT_STATE.md`), and until 2026-10-06 nothing had ever run it. The
  Postgres integration suite exercised `JobRepository` and stopped there, so
  the queue's behaviour — that `enqueue` reaches a handler, that a failure is
  retried up to `retryLimit` and then stops, that `consume: false` really does
  not consume — was read off pg-boss's type declarations rather than observed.
  `BACKLOG.md` carried it as a release-blocker from rc.2.

  Writing the test ran into a property of the system rather than of the test: a
  pg-boss queue name is global to the **database**. `QUEUE_NAME` was a module
  constant (`repopilot_audit_v1`), so every instance pointed at one Postgres
  polls the same queue — and so would every case in a suite. Each case would
  consume the others' jobs, fail at random, and pass when run alone.

- **Decision:** `PgBossAuditQueueDeps` takes an optional `queueName`, defaulting
  to `repopilot_audit_v1`. Production passes nothing, so a restart reattaches to
  the same queue; the integration suite passes a name derived from the pid and a
  counter, so no two cases can reach each other.

  The default is the value production keeps. This is not a configuration knob
  being opened — it is a constant being given a name, so that the one caller
  which needs a different one can say so.

- **Consequences:** `apps/api/src/tests/pg-boss.integration.test.ts` runs five
  cases in CI's `db: postgres` matrix leg, each with its own queue. It was
  verified locally against a real Postgres (`docker run postgres:17-alpine`)
  before being pushed, not only in CI, and the `consume: false` case was
  mutation-checked: forcing the guard to `true` turns it red and names the value
  that should not be there. The `sqlite` leg is unaffected — the file skips,
  exactly as `postgres.integration.test.ts` does.

- **Alternatives rejected.**
  - **Keep the constant and clean the queue between cases.** It needs a second
    `PgBoss` instance that exists only to call `deleteAllJobs`, and "clean, then
    run" is a race the suite would own: a job left behind by a case that failed
    mid-flight gets picked up by the next one, which then fails for a reason
    that has nothing to do with it.
  - **Give each case its own pg-boss `schema`.** pg-boss supports it and it
    isolates more than a queue name does. Rejected because it isolates *too*
    much for what is being tested: the suite would no longer exercise the
    default `pgboss` schema the deployment actually uses, and
    `PgBossAuditQueue` would have to expose a `schema` option production has no
    use for.
  - **Give each case its own database.** Correct, and slow — a `CREATE
    DATABASE` plus pg-boss's own schema migration per case.
  - **Write one case and share the queue.** The cheapest thing that passes, and
    it would have left the `consume: false` split untested — two consumers on
    one queue is exactly what a shared name cannot express, and that split is
    the behaviour the deployment depends on.

---

## D-040 — A guard that must survive a restart cannot live in the process

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** R-40 closed a critical defect by making an EIP-3009 authorization
  single-use: `verifyPayment` burns the `(from, nonce)` pair on first successful
  verification, standing in for the on-chain `authorizationUsed` read this
  adapter deliberately does not perform. The burn lived in
  `private spentNonces = new Set<string>()`.

  A `Set` is not a place. The guard is only as long-lived as the process holding
  it, so both of the events that happen to a deployed service — a restart, and a
  second replica — restore the original defect, silently and with no code change
  in between. R-40 recorded that as its "durability gap" and `BACKLOG.md`
  carried it with the design already sketched. This is the decision that
  closes it.

- **Decision:** The burn is a call on an injected `NonceStore` — an interface
  declared in `@repopilot/okx-adapter` with one method:

  ```ts
  burn(key: string): Promise<boolean>   // true = this call claimed it
  ```

  `apps/api` injects `NonceRepository`, backed by a new `burned_nonces` table in
  the database the service already runs on (`key TEXT PRIMARY KEY`, `burned_at`).
  The adapter keeps an `InMemoryNonceStore` as its default.

- **Why an interface, and not a database dependency inside the adapter.**
  `@repopilot/okx-adapter` is also loaded by `packages/mcp-server`, which has no
  database. That package calls `verifyPayment` only in `PAYMENT_MODE=mock` —
  where it auto-verifies its own `mock:<id>` header so an agent gets a
  synchronous result — and the mock path never reaches a nonce. Handing it a
  durable store would be wiring a database into a process for a code path it
  cannot take. The split — interface in the package that consumes it,
  implementation in the app that has the database — is the one `PaymentAdapter`
  already uses, for the same reason.

- **Why `burn()` returns a boolean instead of the caller doing a lookup.**
  "Has this nonce been used" and "record that it has" are one operation, or they
  are a race. Written as `SELECT` then `INSERT`, two concurrent requests both
  read "not burned" and both insert; one of them either wins or dies on the
  primary key, and either way two buyers got an audit for one signature. So
  `burn()` is a single statement per driver — `INSERT ... ON CONFLICT (key) DO
  NOTHING` and `INSERT OR IGNORE` — and the answer is the driver's own report
  (`rowCount` / `changes`). The insert *is* the comparison.

- **Why the burn is not in the same transaction as the job it pays for.**
  `BACKLOG.md` proposed one. It is not needed, and the reason is an ordering
  property of the route rather than a preference: a buyer can only learn a
  `paymentId` by receiving a `402`, and `routes/audits.ts` creates the job row
  *before* it mints the challenge (step 3). By the time any `X-PAYMENT` can
  arrive, the job it refers to already exists. There is no window in which a
  burned nonce is not backed by a row, so there is nothing a shared transaction
  would close.

  **The accepted cost, stated.** The burn happens inside `verifyPayment`, which
  the route calls before it enqueues. A transient failure *after* the burn — the
  queue refusing the job, a 503 — costs the buyer that authorization: the retry
  is answered `failed` because the nonce is spent. That is deliberate, and it is
  the conservative direction. The alternative is to burn after enqueue, which
  opens a window in which two concurrent replays of one `X-PAYMENT` both pass
  verification. At-most-once is the property a payment gate has to hold; "the
  buyer signs again" is recoverable and double-serving is not. The authorization
  is quoted with a five-minute window, so re-signing is an ordinary retry.

- **Why a store failure is allowed to throw.** `false` is a replay and is
  permanent. A throw is an outage and is retryable. They must not be collapsed:
  `record('failed')` writes a receipt, and receipts are cached by `paymentId`, so
  catching a store outage would convert a transient database blip into a
  permanent verdict for that payment id — the buyer's retry would be answered
  from the cache without the store ever being asked again. The throw escapes as
  a 500, which is what an unreachable database is.

- **Why the rows are never pruned.** An authorization cannot be replayed after
  its `validBefore` regardless: `verifyEip3009` rejects a closed window before
  the store is consulted, so a retention job would only be deleting rows that are
  already inert. One row per paid audit is tens of bytes. If that stops being
  true, `burned_at` is what a retention rule would read.

- **Consequences:** `apps/api/src/tests/nonce-store.integration.test.ts` runs
  three cases on SQLite and three against a real Postgres, gated on
  `DATABASE_URL` exactly as `postgres.integration.test.ts` is. Both halves are
  mutation-checked, and the Postgres half produced a finding worth keeping:
  **`Promise.all` over a cold `pg.Pool` does not race.** Ten simultaneous burns
  on a cold pool are serialized by connection establishment — a
  `SELECT`-then-`INSERT` implementation passed 3/3 — so the case warms the pool
  with ten distinct keys first. With that, the racy implementation fails 3/3 on
  `duplicate key value violates unique constraint "burned_nonces_pkey"`. The
  test file says so, because "this test proves concurrency" was wrong the first
  time it was written.

  The adapter-level cases are in `packages/okx-adapter/src/okx-adapter.test.ts`:
  the replay-across-a-restart case (which replaces the test that used to assert
  the *limitation*), a case pinning the in-memory default, and a case that a
  store outage is not cached as `failed`.

- **Alternatives rejected.**
  - **Keep the `Set` and document the restart.** This is what R-40 did, and it
    was right for that batch — a schema change and a semantic change in one
    commit make a failure ambiguous between them. It is not a resting place.
  - **Persist to Redis or a TTL cache.** A second dependency, and a second thing
    to lose. The service already has a database, and a nonce row is smaller than
    the job row it pays for.
  - **Store the whole authorization and have the job reference it.** More state,
    no extra answer: the only question this table is ever asked is "has this pair
    been claimed", and a primary key answers it.
  - **Make `NonceStore` required on `OkxPaymentAdapterOptions`.** Then every
    caller must decide, including the ones for which the in-memory answer is
    correct, and a test that wants an adapter has to build a store to get one.
    The default lives on the adapter so that there is exactly one of it.

