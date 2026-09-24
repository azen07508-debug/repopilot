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

