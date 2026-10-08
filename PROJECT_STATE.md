# PROJECT_STATE.md

**Project:** RepoPilot — GitHub Repository Launch-Readiness Audit
**Repository:** https://github.com/azen07508-debug/repopilot
**Current version:** 0.1.0-rc.3
**Current stage:** Release Candidate preparation
**Last updated:** 2026-10-06 06:18 UTC

> 📚 Single entry point for every document in the repo:
> [docs/INDEX.md](docs/INDEX.md). This file is the **maintainer
> view**; the user / buyer view lives in [README.md](README.md).

## Contents

- [One-line description](#one-line-description)
- [Stack](#stack)
- [Layout](#layout)
- [Service endpoints (local)](#service-endpoints-local)
- [Process model (0.1.0-rc.3)](#process-model-010-rc3)
- [MCP server](#mcp-server)
- [Payment model](#payment-model)
- [Test baseline (2026-10-06 06:18 UTC)](#test-baseline-2026-10-06-0618-utc)
- [Quality gates already passing](#quality-gates-already-passing)
- [Repository Intelligence upgrade](#repository-intelligence-upgrade-planning-phase-0-done)
- [Launch Readiness layer](#launch-readiness-layer--p0-core-done-2026-09-20)
- [Recent shipped changes (0.1.0-rc.2)](#recent-shipped-changes-010-rc2)
- [Known external blockers](#known-external-blockers)

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

<!-- docs-facts:workspace-layout -->
- packages (3): `@repopilot/core`, `@repopilot/mcp-server`, `@repopilot/okx-adapter`
- apps (2): `@repopilot/api`, `@repopilot/web`
<!-- docs-facts:end -->

```text
repopilot/
  apps/
    api/      # Fastify HTTP API
    web/      # React + Vite admin UI
  packages/
    core/        # analyzers + scoring + report + security + schemas + llm
    mcp-server/  # MCP server (stdio)
    okx-adapter/ # PaymentAdapter interface + mock + okx
  fixtures/      # <!-- docs-facts:fixture-count -->6<!-- docs-facts:end --> sample repos
  docs/          # one file per topic; docs/INDEX.md is the list
  deploy/        # nginx edge config + security-header snippet (the real one
                 # the web image ships; the two examples under docs/deployment
                 # are illustrations, not the source of truth)
  .github/workflows/  # ci.yml + docker.yml (new in this RC pass)
```

## Service endpoints (local)

- `GET /health` — liveness + payment mode + db status
- `GET /api/v1/capabilities` — service metadata + input/output schema + pricing
- `POST /api/v1/audits` — start a new audit: 402 + challenge on the first call,
  then **202** + `statusUrl` + `pollAfterMs` after the `X-PAYMENT` replay
  (D-015). Never a report — the report is a separate `GET` on `statusUrl`.
- `GET /api/v1/audits/:jobId` — job status, and the report once it exists.
  Answers **202** while queued or processing, 200 when completed, and 200 with a
  structured `error` when failed (deliberately not a 5xx, so a failed job is
  never confused with an outage).
- `GET /docs/openapi.json` — OpenAPI 3.1 doc. Served for external clients; the
  web UI does not read it (its types come from `@repopilot/core`).
- Web UI: http://localhost:5173 (dev, Vite) — in Docker it is served by the
  `web` service at the origin root, with `/api/*`, `/health` and `/docs/*`
  proxied to the API. See D-030 for the routing table and
  `deploy/nginx/repopilot.conf` for the config that implements it.

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
- **Container topology** (`docker-compose.yml`,
  <!-- docs-facts:compose-service-count -->5<!-- docs-facts:end --> services on one network):
  `db` (Postgres, no published port) → `migrate` (a one-shot job that applies the
  schema and then exits) → `api` and `worker` (both `depends_on: migrate:
  service_completed_successfully`) → `web` (nginx, the only published service
  besides the API's loopback binding). Neither `server.js` nor `worker.js` applies
  migrations, so without that job a fresh stack comes up healthy against an empty
  database and fails every audit (D-031, R-25). The edge owns the public origin:
  `web` serves `apps/web/dist` at `/` and proxies `/api/`, `/health` and `/docs/`
  to `api:4000` (D-030). The API itself is published only on `127.0.0.1:4000`
  because it runs with `trustProxy: true` and its rate-limit allow-list is matched
  against the forwarded key, not `req.ip` (R-24).

  <!-- docs-facts:compose-services -->
| Service | Kind | Published |
| --- | --- | --- |
| `migrate` | one-shot job | — |
| `api` | long-running | `127.0.0.1:4000:4000` |
| `web` | long-running | `${WEB_PORT:-8080}:80` |
| `worker` | long-running | — |
| `db` | long-running | — |
<!-- docs-facts:end -->

## MCP server

- Transport: stdio
- Tools: <!-- docs-facts:mcp-tool-count -->14<!-- docs-facts:end --> registered.
  `get_repopilot_capabilities` returns the same list with a `billing` map, so an
  agent can tell free from paid before it calls anything.
- Bin: `packages/mcp-server/dist/cli.js` (also `repopilot-mcp`)

<!-- docs-facts:mcp-tools -->
| Tool | Cost |
| --- | --- |
| `audit_github_repository` | paid |
| `reaudit_repository` | paid |
| `get_audit_status` | free |
| `quality_status` | free |
| `release_check` | free |
| `get_fix_plan` | free |
| `compare_audits` | free |
| `list_audit_history` | free |
| `free_check` | free |
| `get_repository_context` | free |
| `get_repository_map` | free |
| `get_symbol_map` | free |
| `get_dependency_graph` | free |
| `get_repopilot_capabilities` | free |
<!-- docs-facts:end -->

## Payment model

- `PAYMENT_MODE=mock` (default): in-process mock adapter, end-to-end without external
- `PAYMENT_MODE=okx`: x402 v2 + EIP-3009 `TransferWithAuthorization` signature
  verification on XLayer/Ethereum/Base/Arbitrum/BSC, USDT settlement.
  - Boundary: when `recipientAddress` is empty (Beta not enabled),
    `buildPaymentAdapter()` in `packages/okx-adapter/src/factory.ts` MUST refuse
    to construct an `OkxPaymentAdapter`. It checks the address itself
    (`isEvmAddress`), not `isConfigured()` — that method is on the interface and
    is asserted by tests, but no production path calls it. The factory must
    never silently fall back to mock. `factory.test.ts` pins this with a table
    of ten rejected address shapes. (This bullet used to be labelled **STUB**
    and to say `isConfigured()` was the gate; R-39 corrected both.)
  - `OKX_PAYMENT_RESOURCE_URL` is the deployment's own public https URL and is
    what the 402 challenge puts in `accepts[].resource` — the field the buyer's
    client reads to know what it is paying for. Required in production when
    `PAYMENT_MODE=okx`; the unconfigured value is `PLACEHOLDER_RESOURCE`, an
    RFC 2606 `.invalid` host that can never resolve. `env:check` and
    `validateProductionConfig()` share one predicate (`isPublicHttpsUrl`).
  - **One authorization buys one audit.** The signed EIP-712 message does not
    contain the `paymentId`, so a signature is valid for every challenge
    quoting the same payee and amount, and every POST mints a fresh
    `paymentId`. The adapter burns the `(from, nonce)` pair on first successful
    verification and enforces the signed `validAfter` / `validBefore` window —
    the local stand-in for EIP-3009's on-chain `authorizationUsed` mapping
    (R-40, D-038). The burn goes through an injected `NonceStore`; the API
    injects `NonceRepository`, backed by the `burned_nonces` table, so it
    survives a restart and is shared between replicas. `packages/mcp-server`
    keeps the in-memory default, because it verifies payments only in mock mode
    and never reaches a nonce (R-42, D-040).
  - All gates documented in `docs/EXTERNAL_ACTIONS.md` and `README_OKX.md`.

## Test baseline

The per-package split is prose: it carries annotations ("both Postgres files,
run in CI's `db: postgres` matrix leg") that a generator cannot produce. The
totals are generated and checked — `verify:release` step 4b compares them
against the run it just performed, using that run's own output rather than a
second one, which is the only non-circular place to check a number that is only
knowable by running the suite.

- @repopilot/core: 904/904
- @repopilot/okx-adapter: 57/57
- @repopilot/api: 88/88 + 10 skipped (the Postgres-only cases, run in CI's
  `db: postgres` matrix leg)
- @repopilot/mcp-server: 42/42
- @repopilot/web: 17/17 (2 instrument self-tests + 15 async-contract tests)

<!-- test-baseline:begin -->
<!-- Generated by `scripts/test-baseline.ts --write`. Do not edit by hand. -->
- **sqlite** (no `DATABASE_URL`): 1108 passed + 10 skipped (1118)
- **postgres** (`DATABASE_URL` set): 1118 passed + 0 skipped (1118)
<!-- test-baseline:end -->

> The 1101 → 1108 step is +7 tests and no deletions. `okx-adapter` 53 → 57 is
> R-42's three adapter cases (a replay across two processes sharing one store,
> the in-memory default, and a store outage not being cached as `failed`) minus
> the one it replaced — `forgets which nonces it has seen when the process
> restarts` asserted the *limitation* and is now
> `still forgets when no store is injected` — plus two `factory.test.ts` cases
> pinning that `buildPaymentAdapter` forwards the store it is given. `apps/api`
> 85 → 88 is three SQLite cases for `NonceRepository`, and the skipped count
> 7 → 10 is the same file's three Postgres cases. Re-measured on both legs, not
> incremented: 88 + 10 skipped on SQLite, 98 passed with `DATABASE_URL` set.

> The 1079 → 1101 step is +27 tests and −5 of nothing: `okx-adapter` 40 → 53
> is R-39's `readPaymentId` cases and real EIP-3009 signatures plus R-40's six
> replay cases; `apps/api` 75 → 85 is R-39's first `PAYMENT_MODE=okx` route
> test and R-40's additions; the skipped count 2 → 7 is
> `pg-boss.integration.test.ts`, which is new. Core went 905 → 904 on R-38,
> which deleted the LLM surface along with its test. The numbers here were
> re-measured, not incremented — and that sentence used to end "this file is the
> only place they are written down, and nothing checks them against the code",
> which stopped being true when `scripts/test-baseline.ts` landed: the totals
> are now generated and checked in `verify:release` step 4b. It is still true of
> the per-package bullets above them.

> The 1080 → 1079 step is the repricing (D-037), and it moves in both
> directions. `okx-adapter` went 41 → 40: one test deleted, because
> `okx-adapter.test.ts`'s "the full tier's price and description" case compared
> §5.5's prose line for a second service that no longer exists, and
> `factory.test.ts`'s per-mode `priceFor` case cannot exist when `priceFor`
> takes no mode. It then went 39 → 40 on the way back: injecting the defect
> showed that a hard-coded `0.13` survived every test in the `priceFor` block,
> because they all compared against that one fixture — so the block gained a
> test that passes two differently-priced configs and asserts each comes back.

> The 967 → 1080 step is three separate things, in the order they landed.
> The tier work (D-035) took core from 833 to 905: `tiers.test.ts` pins the
> declared tier boundary, the identical-verdict property, the two-directional
> consistency of `omittedSections`, and the absence of any limitation line
> matching `/skip|deeper|thinner/i`. The payment path took `okx-adapter` from
> 16 to 41: `factory.test.ts` went 3 → 19 with a ten-row table of rejected
> addresses and three `priceFor` cases, and `okx-adapter.test.ts` went 6 → 15
> with the comparison between the emitted 402 challenge and the one §5.5 of
> `docs/OKX_REQUIREMENTS_SNAPSHOT.md` documents. And `apps/api` went 63 → 75,
> which is the `config.test.ts` fixture being made complete: it had been
> asserting a partial `AppConfig` with `as AppConfig` since the schema grew
> past it, so nine fields were missing and nothing said so.

> The 966 → 967 step is one test, and it closes a hole rather than covering
> new code. `BILLING` is the map `get_repopilot_capabilities` returns, so it is
> what an agent reads to decide what it can afford — and nothing asserted it.
> The test named "registers every tool the billing map advertises" checked a
> hand-copied list in the test file instead, so a tool added to `server.tool()`
> and forgotten in `BILLING` would have shipped with every test green. The map
> is exported now and three assertions tie the registrations, the map and the
> frozen public list together (D-033).

> The core count is dominated by the Repository Intelligence work: it was
> 61 at the 0.1.0-rc.2 baseline, 143 after the Launch Readiness layer,
> 550 after the Repository Map (V0.2-d), 628 after the Symbol Map
> (V0.2-e), 740 after the Dependency Graph (V0.2-f), 759 after the
> fixture snapshots (V0.2-g) and 766 after the resolver guard (D-029).
> The MCP server went 4 → 37 in V0.2-g, where the three artifacts finally
> got a surface. None of them is wired into the audit path — they are
> additive, and every pre-existing test still passes unchanged.
>
> The 766 → 833 step is the 2026-10-01 real-repository audit, not a
> feature. All 67 new core tests pin something that audit produced:
> 20 in `security/secret-scanner.test.ts` (now 36) and 14 in
> `security/injection.test.ts` (now 18) pin a false positive that the
> three real repositories generated, 13 in `report/evidence-lines.test.ts`
> pin the checklist evidence fold, 12 in `analyzers/documentation.test.ts`
> cover the existence-vs-content split and the shared document-name lists,
> 6 more (3 in `stack.test.ts`, 3 in `analyzers/web3.test.ts`) cover
> fixture exclusion from stack and web3 detection, and 2 in
> `scoring/score.test.ts` pin the breakdown to the rules that fired. Each
> of the false-positive tests is paired with the true positive of the same
> shape, so a detector tuned into silence fails rather than passes.
>
> `@repopilot/web` reported **0** for the whole life of the project because
> its `test` script was `echo "no web tests yet" && exit 0` — a package that
> was never wired into `pnpm -r test` is indistinguishable from one that
> passes (R-26). It now runs `vitest run` over the async audit contract:
> 402 → replay → 202 → poll → report, plus the four failure paths. Six
> mutations of the product were reintroduced one at a time and all six were
> caught, and the suite found a real defect on its first run — the empty
> state rendered underneath an error (`8cd193e`).

## Quality gates already passing

- `pnpm install` (no errors, only peer-dependency hints)
- `pnpm -r typecheck` (strict, no errors)
- `pnpm -r test` (all workspaces green; the totals live in the generated
  **Test baseline** block above and are checked by `verify:release` step 4b
  against the run it just performed, so they cannot drift unnoticed. The 10
  skipped tests are the Postgres-only cases: `pg-boss.integration.test.ts` and
  `postgres.integration.test.ts` skip whole, and `nonce-store.integration.test.ts`
  skips 3 of its 6. They run in CI's `db: postgres` leg)
- `pnpm build` (every workspace: <!-- docs-facts:workspace-count -->3 packages + 2 apps<!-- docs-facts:end -->)
- `pnpm env:check` (validates dev / production / okx mode; never prints secrets; also covers queue driver rules)
- `pnpm preflight:production` (the pre-registration self-check: `env:check` under
  `NODE_ENV=production`, `loadConfig()` under the same `NODE_ENV`, the two brand
  assets measured off disk, and `docs:check`. It **runs** the other checks
  rather than re-implementing them, because a re-implementation is a copy that
  can disagree. Run in a development checkout it reports two FAILs —
  `PAYMENT_MODE=mock`, `AUDIT_QUEUE_DRIVER=inline` and the production-only
  variables — which is the correct answer there and the list of what a
  deployment must change)
- `pnpm lint` (tsc + project-specific static rules; 0 issues. Since R-33 it
  builds any workspace package whose `dist` is older than its `src` *before* it
  type-checks, because `apps/*` read `@repopilot/core` through `exports` →
  `dist`; and since R-26 it reports any `package.json` script whose body is a
  bare `echo` / `true` / `:` / `exit 0`, because five of them were
  `echo skip-package-lint`)
- `pnpm docker:check` (static review of the Dockerfile and the compose file;
  **exits non-zero** on any finding, so it is a gate rather than advice.
  Covers the Node base image against `engines.node`, builder install/build
  filter agreement, install inputs copied before `pnpm install`, and that every
  package whose `dist` reaches the runtime stage has its `node_modules` copied
  too. The build half is skipped where there is no Docker CLI)
- `pnpm compose:check` (compose + edge topology: build targets, port exposure,
  schema-bootstrap ordering, nginx routing; 0 issues)
- `pnpm docs:check` (**exits non-zero** when a document disagrees with the code.
  Recomputes the generated blocks — MCP tool list and count, compose service
  table, workspace package names and count, fixture count — and asserts five
  invariants that carry no block: the `BILLING` map against the `server.tool()`
  registrations, `docs/INDEX.md` against the `docs/` directory, every
  `pnpm <script>` a document names against the root `package.json`, that
  every markdown file is classified as either generated or deliberately not,
  and that all six statements of an audit price agree with each other and
  with the atomic registration values.
  See D-033, D-034, D-036 and D-037. Verified by mutation: 16 injections, 16
  caught (12 for the block and scope checks, measured 2026-10-04 and untouched
  by the repricing; 4 for the price check, re-measured 2026-10-05 after the
  count changed from twelve to six — a disagreement, a deleted `add()` call
  which is the one way the check can silently cover less, an atomic value that
  is not a price the repository charges, and a reworded anchor that
  `required()` refuses to read past)
- `pnpm audit:diff` (not a gate — runs the four reference audits and prints the
  change against `scripts/audit-baseline.json`. Deliberately excluded from CI:
  three of the four targets are other people's repositories, so a non-zero diff
  is information rather than a failure. Use `--no-run` to compare the outputs
  already in `screenshots/` without hitting GitHub, and `--only <substring>` to
  run one audit)
- `pnpm verify:release` (full end-to-end smoke; covers 202 + Location +
  Retry-After, cache miss/hit, cache disabled, free-check 200. Its lint step now
  runs the real gate rather than `pnpm -r lint`, its build step can fail, and
  step 4b checks the generated test totals against the run step 4 just
  performed. The audit steps need real GitHub access, and **without
  `GITHUB_TOKEN` they share the anonymous limit of 60 requests per hour per
  IP — which one run can spend**, after which the cache case sits in
  `processing` until its budget expires. Set `GITHUB_TOKEN` (5 000/hour) for a
  local run, or read a timeout there as a quota problem before reading it as a
  hang)
- API smoke: `/health`, `/api/v1/capabilities`, free-check, paid audit
  lifecycle, cache miss/hit, cache disabled
- MCP smoke: stdio initialize + tools/list
- **`pnpm verify:release` all green (2026-10-08).** 16 steps pass, including a live
  `octocat/Hello-World` audit, cache miss/hit, cache disabled, free-check and MCP stdio
  `tools/list`. The count is 16, not the 17 this line carried until today: that number came
  from a 2026-07-19 run and nothing recounted it, which is the same defect as the test
  totals — a number written down confidently and never checked.
- **The gate is ~8× slower on this machine than in CI, and it is not the code.** 21 m 48 s
  end to end here (`test` 662 s, `build` 302 s, `lint` 83 s), against 2 m 10 s–2 m 40 s per
  leg on GitHub's runners. The cause is an injected `NODE_OPTIONS` preload, which costs
  every child process ~20 s of startup and which this gate pays dozens of times over:
  `pnpm test:mcp` takes 61 s with it and 13 s without, over the same 42 tests, with the
  `tests` phase unchanged (448 ms against 555 ms) and only `collect` moving (49 s → 10 s).
  Unset `NODE_OPTIONS` before timing the gate locally, or the numbers are about the IDE.
- **A 2026-07-19 run found a real bug and the fix is still in the tree.**
  `AuditWorker.classify()`'s regex `/not found|404/` was case-sensitive; GitHub's
  "Not Found" (capital N/F) did not match, so 404s fell through to `UPSTREAM_FAILED`
  (retryable=true) and stuck the inline queue at `processing` forever. Adding the `/i`
  flag fixed it (retest → 1434 ms).
- **`onchainos 4.2.6` binary** downloaded and preflight-passed (BLOCKING step complete).
  `web3.okx.com` is unreachable from the sandbox (HTTP CONNECT times out) so the actual
  wallet login must run on the user's host. See `docs/OKX_LIVE_INTEGRATION.md`.
- **Live audit smoke** (anecdotal, not in `verify:release`): `octocat/Hello-World` returned
  a full report in ~3s with cache miss → 1st request, no rate-limit issues.
- Docker CI: `.github/workflows/docker.yml` runs **on every push to `main`**, builds both
  stages, runs them together on one docker network, and asserts the edge serves the UI at
  `/`, proxies `/api/*` and `/health`, falls back for deep links, and answers `/healthz`
  itself. **Green as of `5b8d3c5`** — the first time either image had ever been built in
  CI, which is how the four Dockerfile defects below were found.
- **Mutation-verified, not coverage-verified.** `scripts/compose-check.ts` and
  `scripts/docker-check.sh` are themselves tested by reintroducing real defects one at a
  time and confirming the checker reports them: **17 mutations, 17 caught**, plus a
  baseline assertion that the restored tree still passes. See R-26 for why a check that
  never runs is worse than no check at all.

## Repository Intelligence upgrade (planning, Phase 0 done)

RepoPilot is being progressively upgraded from a *launch-readiness audit
tool* into a **Repository Intelligence Layer for AI Coding Agents**
(Codex / Claude Code / OpenCode / OpenClaw). No rewrite — the existing
stack, API, MCP, DB, analyzers, fixtures and tests all stay.

- Full code audit + phased plan:
  [docs/REPOSITORY_INTELLIGENCE_PLAN.md](docs/REPOSITORY_INTELLIGENCE_PLAN.md)
- Phase 0 completed 2026-09-19 against commit `f95ccb5`.
- Three assumptions in the original proposal were corrected by the audit:
  1. `@repopilot/core` has **no AST parser** — Symbol Map needs one
     (ADR D-018 proposes `typescript` compiler API + regex fallback).
  2. There is **no git history / local clone** — Change Impact must use
     the GitHub Compare API, not `git diff` (ADR D-020).
  3. `fetchContents` is **one API request per file** — Repository Map
     would blow the 60 req/h anonymous limit. Switch to tarball
     download first (ADR D-017). **This is the V0.2 blocker.**
- **Done 2026-09-19:** ADRs D-017 ~ D-021 are in `DECISIONS.md`, risks
  R-17 ~ R-21 are in `RISKS.md`, and the intelligence Zod schemas are
  landed in `packages/core/src/schemas/intelligence/` with unit tests
  (V0.2-b). Nothing in the existing API / MCP / report / DB surface
  changed.
- **Done 2026-09-23:** V0.2-c — the per-file `getContent` I/O is
  replaced by the tarball source (D-017). `git/tar.ts` reads the
  archive, `git/tarball.ts` extracts the wanted paths, and
  `GitHubFetcher.fetchRepositoryContents` is the one entry point:
  tarball first, per-file on failure, `degraded` on the result.
  Request count for content drops from O(files) to O(1). Repository
  Map is no longer blocked.
- **Done 2026-09-24:** V0.2-d — the Repository Map builder.
  `packages/core/src/intelligence/repository-map/` (importance →
  entrypoints / manifests → modules → build) turns a snapshot into a
  deterministic map: language mix, package managers, modules with an
  absolute importance score, module edges, dependencies, and the ranked
  important-file list. Exported as the `@repopilot/core/intelligence`
  subpath. **Not wired into the pipeline** — R-20: the map is a large
  JSON artifact and `report_json` is a DB column, so V0.2-g gives it its
  own surface. Zero new dependencies (R-21): the TOML / requirements /
  Cargo / go.mod readers are hand-written, and anything outside the
  supported subset is reported via `notes` → `limitations` rather than
  dropped. ADR D-025. Core tests 427 → 550 (+123 across five files),
  including a test that runs the builder over all six real fixtures.
  Sixteen mutations, sixteen caught — one of which found a real
  order-dependent module-naming bug, and a re-read of the cap reporting
  found a limitation line that claimed a truncation which had not
  happened (D-025 decision 7).
- **Done 2026-09-27:** V0.2-e — the Symbol Map.
  `packages/core/src/intelligence/symbols/` (routing + degradation in
  `index.ts`, shared line scanning in `lines.ts`, then `typescript.ts`,
  `python.ts`, `solidity.ts`, `regex-fallback.ts`) turns a snapshot into
  the repository's declaration surface: name, kind, 1-based line range,
  parent, exported flag, and the parser that produced each one with its
  confidence. Three tiers — the `typescript` compiler API (0.95),
  hand-written regex scanners for Python and Solidity (0.75 / 0.7),
  line-pattern heuristics for nine more languages (0.5). `createSourceFile`
  and never a `Program`: a type checker would resolve imports and walk
  `node_modules`, which is both pointless for a declaration surface and
  exactly what would make R-18's memory bound untrue. A language with no
  extractor is **named in `failures` with its file count** rather than
  guessed at — a wrong line is worse than a named gap. A parser failure
  degrades to the line scanner and never propagates (D-018's hard rule).
  Exported as the same `@repopilot/core/intelligence` subpath.
  **Not wired into the pipeline**, same as the Repository Map: V0.2-g
  exposes it. `typescript` moves `devDependencies` → `dependencies`,
  since it is imported at runtime. ADR D-026. Core tests 550 → 628
  (+78), including a schema-valid map over each of the six real fixtures,
  built twice, asserted identical. Forty mutations: 39 caught, 1
  equivalent (recorded in D-026 rather than pinned), 0 invalid. Three
  defects were found by the check and fixed — Solidity reporting an
  implementation's locals as contract state, a container reached with the
  symbol cap full being dropped silently with `truncated: false`, and a
  dead `default` clause in `isExported`.
- **Done 2026-09-28:** V0.2-f — the Dependency Graph.
  `packages/core/src/intelligence/graph/` (`resolve.ts` maps a specifier
  to a path, `imports.ts` extracts what a file said it depends on,
  `dependency-graph.ts` assembles the artifact) turns a snapshot into
  the graph of what imports what. The unit of an edge is the unit the
  language imports: TypeScript imports a file, Go imports a package
  directory (a `module` node), and a bare specifier that names nothing
  in-tree is an `external-dependency`. A node exists only because an
  edge touches it — the Repository Map already lists files, and absence
  *is* the answer to "what does this import?". An unresolved relative
  import is **not** an edge: it goes to `limitations` with its file and
  line, because an edge to the nearest-looking path would send an agent
  to read a plausible wrong file. `.js` resolves to `.ts` (D-001's own
  NodeNext convention), and a Python submodule guess that misses is not
  evidence of a third-party package. `limitations` moves onto
  `DependencyGraphSchema`, where V0.2-b had declared it only on the
  architecture graph. Exported as the same `@repopilot/core/intelligence`
  subpath. **Not wired into the pipeline**, same as the two maps: V0.2-g
  exposes it, and it is also what fills `Symbol.references`, which is 0
  everywhere until then. ADR D-027. Core tests 628 → 740 (+112),
  including a schema-valid graph over each of the six real fixtures,
  built twice, asserted identical. Seventy-four mutations: **74 caught,
  0 missed, 0 invalid.** Two defects were found by the check and fixed —
  an uncertain Python submodule guess that missed being turned into an
  `external-dependency` edge, and a relative Python import that walked
  past the root being clamped to the root instead of refused — and two
  pieces of dead code were deleted.
- Next: V0.2-h — the docs pass: a per-tool narrative for the four new
  tools and the `docs/INDEX.md` navigation. The CHANGELOG, the state
  table, `docs/MCP_CLIENT_SETUP.md` and `docs/ARCHITECTURE.md` were
  updated *with* V0.2-g, because a tool list missing four tools is wrong
  rather than merely thin.
- After that: Phase 4 — the Architecture Graph, which is what finally
  fills `Symbol.references` (0 everywhere today).
- **Done 2026-09-28 (follow-up to V0.2-g):** the tools were pointed at a
  real repository for the first time, and it found a shipped defect.
  - **`.js` names `.tsx` (ADR D-029).** `SOURCE_REWRITES` held a single
    target per emitted extension, so **all nine** `import './components/
    Header.js'` specifiers naming a `.tsx` file in this repository were
    reported as unresolved relative imports. The table is a fan-out now.
    Measured here: unresolved relative imports 9 → 0, dependency-graph
    limitations 21 → 2, edges 470 → 488, nodes 205 → 206. Nothing in the
    suite could have caught it: all 37 tool tests inject a fake loader,
    and the fixtures hold no `.tsx`/`.jsx` at all.
  - **`scripts/intelligence-smoke.mts`** — the real loader over two
    repositories, 13 checks each. Its central check is written to be
    independent of `resolve.ts`, and was verified to have teeth by
    reverting the fix (red, with the nine imports listed).
  - **The guard is a resolver test, not a snapshot.** A snapshot records
    behaviour, not correctness — it would have recorded the defect as
    expected. This narrows D-028's "snapshots have teeth" claim.
  - **A mutation check over `resolve.ts` (17 mutations, all caught after
    the fixes).** Its first run found six genuine gaps in the rewrite
    table and its neighbours (`.mjs → .mts`, `.cjs → .cts`, Vue, Svelte,
    the `.ts`/`.tsx` tie-break, `isRelativeSpecifier('..')`); four tests
    and one assertion were added. It also exposed **two faults in the
    check itself**, both now recorded in the `mutation-check` skill: a
    killed run leaves the mutation in the source *and* the next run
    snapshots that dirty file as its baseline (corrupting the source
    while reporting "restored"), and a runner that dies is filed as a
    weak test rather than as an error.
  - `symbols.degraded` / `RepositoryContext.degraded` doc comments were
    widened to match the code (four tests pin the wide meaning).
  - **Open, deliberately not fixed here:** `vitest.config.ts` ranks
    0.8650 in `importantFiles`, above every real entrypoint (library
    0.8475, server 0.8300). That is V0.2-d's weighting and needs its own
    record (D-029 decision 8).
- **Done 2026-09-28:** V0.2-g — the artifacts get a surface, and the
  fixtures get snapshots. Two halves.
  - **Snapshots over the six real fixtures**
    (`packages/core/src/intelligence/snapshot.test.ts`, 19 tests,
    1012 lines). It snapshots the *fixture list* first, so a new fixture
    cannot be accepted silently, then the Repository Map, Symbol Map and
    Dependency Graph for each fixture. A snapshot asserts what a
    field-level unit test cannot: changing the evidence `reason` in the
    Dependency Graph from `imports` to `depends on` left all 35
    dependency-graph unit tests **green** and turned the snapshot **red**
    with the exact diff — which is the reason the snapshot exists.
    `test-utils/fixtures.ts` collapses three byte-identical private
    copies of the fixture walk into one, counts the `..` once, and sorts
    `FIXTURE_NAMES` so the snapshot does not depend on readdir order.
  - **Four free MCP tools** — `get_repository_context`,
    `get_repository_map`, `get_symbol_map`, `get_dependency_graph`. The
    header rule "free tools never scan a repository" was the obstacle,
    and it was the wrong rule: **free means no analysis pipeline**, not
    "no network". The four fetch a tree and a tarball (three requests,
    D-017) and derive; nothing scores, judges or scans history.
    `RepositorySnapshots` caches in process, an LRU bounded by count
    *and* bytes (8 snapshots, 64 MiB) and stops at one entry so a
    repository over the bound does not evict itself on every call. The
    ref a caller names back is served from the snapshot already held,
    because `get_repository_context` answers with `repository.ref` and
    the natural next call passes it straight back. A fetch failure is
    `{ error: 'repository_unavailable', message }` with the HTTP status
    kept — 404 / 403 / 502 are three different next moves — because a
    tool that throws gives an agent nothing to retry with. Every capped
    list carries `{ returned, total, omitted, note }` and the note is
    merged into `limitations` too. The context tool reports what the
    manifests *declare* (with version and kind); the graph reports what
    the code *imports*; they are different sets and the descriptions say
    so. `McpServerOptions.snapshotLoader` is the seam a test drives
    instead of the network. ADR D-028. MCP suite 4 → 37. Thirty
    mutations over `intelligence.ts` and the new
    `withSnapshot` / `describeError`: **30 caught, 0 missed, 0 invalid.**
    Two defects were found by the check and fixed, both reached from one
    surviving mutation: `path_prefix` was matched as a *string* prefix,
    so `src/deep` also returned `src/deep-notes.ts` and
    `src/deeper/d.ts`; and `path_prefix: '.'` matched nothing, though
    `"."` is exactly how the Repository Map spells the root module.

## Launch Readiness layer — P0 core (done 2026-09-20)

RepoPilot is gaining a closed loop:
**Audit → Evidence → Findings → Fix Plan → Agent Instructions →
Re-Audit → Compare**. The P0 slice is core-only; API, MCP and Web are
not wired yet.

- `FixPlanSchema` / `AuditDiffSchema` — own `schemaVersion`, versioned
  independently of `Report.reportVersion`.
- `buildFixPlan()` / `buildFixPlanSet()` — pure derivations from an
  existing `Report`. No scan, no analyzer, no network, no
  `AuditPipeline.run()`.
- `diffReports()` — `ruleDeltas` computed from the existing
  `ScoreBreakdown.rules[]`, so score movement is attributed rule by
  rule. Finding classification is a set operation on `finding.id`.
- `renderAgentInstructions()` — Repository / Commit / Finding /
  Evidence / Objective / Steps / Constraints / Acceptance Criteria,
  ready to paste into Codex, Claude Code or OpenCode.
- LLM boundary: there isn't one. `polishFixPlanSet()` — the only function that
  could rewrite anything — was called by its own test and nothing else, and it
  is gone along with the provider interface, the two prompt branches and the
  four `LLM_*` variables (R-38). Priority, effort, evidence, steps, criteria
  and the `why` sentence are all deterministic.
- Analysis + plan: `docs/REPOSITORY_INTELLIGENCE_PLAN.md` (Phase 0) and
  the Launch Readiness analysis in the workspace.
- **Test baseline: core 143/143 passing** (61 new: builder 15,
  templates 11, diff 16, fixtures + schema boundaries 19).
- `apps/web` now imports report types from `@repopilot/core`
  (type-only) instead of a hand-copied duplicate.
- **DB migration done 2026-09-20 (Step 3):** `jobs` gained `owner`,
  `repo`, `commit_sha`, `mode`, `target` plus two indexes, on both
  SQLite and Postgres. Verified against a real SQLite database: fresh
  create, idempotent re-run, in-place upgrade of a pre-migration table,
  and an `EXPLAIN QUERY PLAN` assertion that
  `idx_jobs_owner_repo_created` is actually chosen. Rows written before
  the migration keep NULL by design and are excluded from history
  queries rather than guessed at.
- **History queries done 2026-09-20 (Step 4):** `JobRepository` gained
  `listByRepo()` / `listCompletedByRepo()` / `findByCommitSha()` and an
  optional `identity` on `insert()`; `JobService` gained
  `listHistory()` / `listCompletedHistory()` / `getByCommitSha()`. The
  route now passes its already-parsed owner/repo into `service.create()`
  so URL parsing stays in one place.
- **Bug fixed:** `JobService.setCommitSha()` was a no-op placeholder —
  the route resolved the head SHA and threw it away, forcing the worker
  to re-resolve it on every attempt. It now writes the `commit_sha`
  column.
- **Derived endpoints done 2026-09-20 (Step 5):**
  `GET /api/v1/audits/:jobId/fix-plan`,
  `GET /api/v1/audits/:jobId/diff?base=:jobId` and
  `GET /api/v1/repositories/:owner/:repo/audits`. All three are free,
  read-only derivations of stored reports — no payment challenge, no
  repository access. The route module imports none of `AuditPipeline`,
  fetcher, queue or payment adapter, and a test asserts that.
  `AuditJobSchema` gained `commitSha` so fix-plan instructions can name
  the exact commit. OpenAPI documents all three.
- **Derived endpoints covered 2026-09-22:** those three routes had
  `/quality` tested and nothing else. Twenty tests now pin what each
  returns, which commit each reports, and every error path (`400` /
  `404` / `409`). `AppDeps.metadataAnalyzer` became injectable so a test
  can fix the head SHA without asking GitHub. Two tests assert the
  invariant the module doc claims: reading a fix plan, a diff, a
  verdict and a history list leaves the pipeline's run count unchanged,
  and an unreachable GitHub records no commit. `api.integration`
  suite: 36 passing (was 16).
- **Bug fixed 2026-09-22:** an unreachable GitHub was recorded as the
  commit `'unknown'`. `commit_sha` is nullable and `getByCommitSha`
  filters on it, so the sentinel read as a real SHA. Now `null`, and
  `setCommitSha()` takes `string | null`.
- **Web UI connected 2026-09-20 (Step 8):** the report page now ends
  with a fix-plan section, and a `Report / History / Comparison` tab
  strip appears once an audit completes. Comparison shows rule-level
  attribution of the score change, plus resolved / new / still-open
  findings. Score deltas use the Chinese convention (rise red, fall
  green). All new strings are bilingual.
- **Loop closed 2026-09-20 (Step 9):**
  `POST /api/v1/repositories/:owner/:repo/reaudit` runs a fresh audit
  from path coordinates, sharing one closure with `POST /audits` so
  payment, idempotency and enqueueing cannot drift between them. The
  full cycle — audit → fix plan → fix → re-audit → compare — is now
  reachable end to end.
- **MCP surface done 2026-09-20 (Step 7):** seven tools at that point. The four
  new ones are `get_fix_plan`, `compare_audits` and `list_audit_history`
  (free — pure derivations of stored reports) plus the paid
  `reaudit_repository`. `get_repopilot_capabilities` returns a `billing`
  map so an agent can tell free from paid, which matters on the OKX.AI
  marketplace. Failures are structured payloads, not thrown exceptions.
- The Launch Readiness loop is now reachable from **both** surfaces:
  HTTP (`/audits/:jobId/fix-plan`, `/diff`, `/repositories/:owner/:repo/audits`,
  `/reaudit`) and MCP (the seven tools above).
- Next: no Launch Readiness phase is outstanding. Remaining work is the
  pre-existing V0.2 blocker (tarball fetch instead of per-file
  `getContent`, ADR D-017) and the user-side marketplace step
  `onchainos agent register --role asp`.

## Recent shipped changes (0.1.0-rc.2)

- Fixture findings are readable again: `Report.fixtureSummary` groups
  `fixtureFindings` by `(file, ruleId)` with a capped line list, and the
  web report renders them in a collapsed section instead of a wall.
  MCP `reportSummary()` reports `fixtureFindingCount` /
  `fixtureFileCount` so an agent is not told "3 findings" when there are
  542. `fixtureFindings` stays lossless — the quality contract and the
  diff still read it individually.
- Report versioning is honest: `REPORT_VERSION` is `1.1` with
  `SUPPORTED_REPORT_VERSIONS = ['1.0', '1.1']`. `FreeCheckReportSchema`
  deliberately stays at `1.0` — it is a different document and sharing
  the constant would make it accept versions it never emits.
- `computeMoved` pairs moved findings by nearest neighbour inside a
  `(rule, file)` group with `MAX_MOVE_DISTANCE = 50`, instead of a map
  lookup that collapsed three shifted secrets into one arbitrary pair.
- `GET /api/v1/audits/:jobId/quality` serves the quality contract on
  read, from the same function the MCP `quality_status` tool uses.
- CI pins `ubuntu-24.04` instead of tracking `ubuntu-latest`.
- CI's `actions/*` steps moved to the first major that runs on Node 24:
  `checkout@v5`, `setup-node@v5`, `cache@v5`, `upload-artifact@v6`. The
  `@v4` majors target Node 20 and were being forced onto Node 24 with a
  deprecation warning on every run. `upload-artifact@v5` still declares
  `node20`, so v6 is the first major that actually clears it. Verified
  per tag by reading `runs.using` from each action's own `action.yml`.
  `setup-node` sets `package-manager-cache: false` because the root
  `package.json` declares `packageManager`, which from v5 turns on
  automatic caching that would duplicate the explicit `actions/cache`
  step.
- Production guards: `production + PAYMENT_MODE=mock` and
  `production + AUDIT_QUEUE_DRIVER=inline` now both fail app start
  with a clear, secret-free error (schema-level + env-check).
- Fastify boots without deprecation warnings. `server.ts` no longer sets
  `disableRequestLogging: false` — it is the default, the option warns on
  presence not value, and fastify@6 removes it. Request logging is
  unaffected.
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

1. ~~Docker CLI not present in this sandbox~~ → **corrected 2026-10-06.** Docker
   29.8.2 and Colima 0.10.3 are installed under `/usr/local`; they were simply
   not on `PATH` (`/usr/local/opt/docker/bin`, `/usr/local/opt/colima/bin`), and
   the daemon is running. The claim was true when it was written and outlived
   its cause. `pnpm docker:check` now performs its build half here, and the
   first run found a real defect — **R-14**, a `better-sqlite3` fallback that
   needed a toolchain the `builder` image did not have. Fixed, and the image
   now builds. Postgres for the integration tests also comes from a container
   (`docker run postgres:17-alpine`), which is how the `PgBossAuditQueue` suite
   was verified before it was pushed.
2. OKX.AI Agent Marketplace listing not yet submitted → run
   `onchainos agent register --role asp` (GA since 2026-06-30; this is a
   single CLI call, not a code change). The `OkxPaymentAdapter` is fully
   wired and accepts `PAYMENT_MODE=okx` out of the box once a valid
   `OKX_PAYMENT_ADDRESS` and `OKX_PAYMENT_RESOURCE_URL` are set.
3. Production GitHub Token not provided → anonymous 60 req/h in dev
4. Production PostgreSQL credentials not provided → SQLite in dev
5. Domain / DNS / TLS cert not configured → reverse-proxy templates only.
   `OKX_PAYMENT_RESOURCE_URL` cannot be filled in until this is done, which is
   why `pnpm preflight:production` reports it as the remaining FAIL.
6. ~~Marketplace brand assets not provided~~ → both committed:
   `docs/brand/hero.png` (1280×640, the 2:1 listing banner, see
   `docs/HERO_IMAGE_BRIEF.md`) and `docs/brand/avatar.png` (1024×1024, the 1:1
   `--picture` for ASP registration, see `docs/AVATAR_BRIEF.md`).
   `preflight:production` measures both.

See `docs/EXTERNAL_ACTIONS.md` for the user-side checklist.
