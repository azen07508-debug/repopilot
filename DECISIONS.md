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

