# RISKS.md

Active risks the team is aware of and how they are mitigated.

## Contents

- [R-01](#r-01--sandbox-escape-via-target-repo-content) — Sandbox escape via target repo content
- [R-02](#r-02--mock-payment-silently-used-in-production) — Mock payment silently used in production
- [R-03](#r-03--github-rate-limiting-anonymous-60-reqh) — GitHub rate limiting (anonymous 60 req/h)
- [R-04](#r-04--dependency-drift-zod--mcp-sdk--pino) — Dependency drift (zod / MCP SDK / pino)
- [R-05](#r-05--zod-325--registry-mirror-gap) — zod 3.25 / registry mirror gap
- [R-06](#r-06--sqlite-in-production-by-accident) — SQLite in production by accident
- [R-07](#r-07--cors-misconfiguration-in-production) — CORS misconfiguration in production
- [R-08](#r-08--prompt-injection-in-readme--source) — Prompt injection in README / source
- [R-09](#r-09--database-file-locked--migration-crash) — Database file locked / migration crash
- [R-10](#r-10--log-redaction-bypass) — Log redaction bypass
- [R-11](#r-11--marketplace-hero--branding-not-provided) — Marketplace hero / branding not provided
- [R-12](#r-12--pii-leakage-from-the-audited-repo) — PII leakage from the audited repo
- [R-13](#r-13--long-running-full-audits-time-out) — Long-running `full` audits time out
- [R-14](#r-14--docker-sandbox-not-available-in-dev) — Docker sandbox not available in dev
- [R-15](#r-15--user-shares-real-okx-keys-in-chat) — User shares real OKX keys in chat
- [R-16](#r-16--inline-audit-queue-used-in-production-in-process-no-durability)
  — Inline audit queue used in production (in-process, no durability)
- [R-17](#r-17--tarball-extraction-exhausts-disk--memory) — Tarball extraction exhausts disk / memory
- [R-18](#r-18--ast-parsing-oom-on-a-pathological-file) — AST parsing OOM on a pathological file
- [R-19](#r-19--compare-api-returns-a-truncated-diff) — Compare API returns a truncated diff
- [R-20](#r-20--intelligence-artifacts-inflate-report_json) — Intelligence artifacts inflate `report_json`
- [R-21](#r-21--new-dependency-breaks-the-zod--mcp-sdk-pins) — New dependency breaks the zod / MCP SDK pins
- [R-22](#r-22--a-lockfile-drives-securityhygiene-to-0) — A lockfile drives `securityHygiene` to 0
- [R-23](#r-23--two-hits-of-one-rule-on-one-line-share-a-fingerprint)
  — Two hits of one rule on one line share a fingerprint
- [R-24](#r-24--a-reverse-proxy-that-omits-x-forwarded-for-disables-rate-limiting)
  — A reverse proxy that omits `X-Forwarded-For` disables rate limiting
- [R-25](#r-25--a-healthy-container-can-be-serving-an-unmigrated-database)
  — A healthy container can be serving an unmigrated database
- [R-26](#r-26--a-check-that-never-runs-is-indistinguishable-from-one-that-passes)
  — A check that never runs is indistinguishable from one that passes
- [R-27](#r-27--a-check-that-can-never-pass-is-indistinguishable-from-one-that-found-nothing)
  — A check that can never pass is indistinguishable from one that found nothing
- [R-28](#r-28--a-green-tick-over-a-capability-the-repository-does-not-have)
  — A green tick over a capability the repository does not have
- [R-29](#r-29--the-mnemonic-rule-fires-on-the-dictionary-of-mnemonics)
  — The mnemonic rule fires on the dictionary of mnemonics
- [R-30](#r-30--quick-and-full-are-the-same-analysis-at-two-prices)
  — `quick` and `full` are the same analysis at two prices
- [R-31](#r-31--the-typecheck-gate-does-not-cover-scripts)
  — The typecheck gate does not cover `scripts/`
- [R-32](#r-32--the-injection-rule-reports-the-sentence-that-documents-the-injection-rule)
  — The injection rule reports the sentence that documents the injection rule

---

## R-01 — Sandbox escape via target repo content

**Severity:** Critical
**Likelihood:** Possible (the system reads untrusted code by design)
**Mitigation:** The pipeline never executes target-repo code. Only text
is read. Binary files are skipped. Path traversal, `.git/`, `node_modules/`
and unexpected dotfiles are rejected by `GitFetcher`. The `runMigrations`
helper inside the fetcher is sandboxed to `/tmp/repopilot-*` and cleaned
on completion.

**Detection:** `security/injection.ts` flags prompt-injection style
content as a finding; the finding is reported, not acted on.

## R-02 — Mock payment silently used in production

**Severity:** High
**Likelihood:** Low (with proper guards)
**Status:** Mitigated in 0.1.0-rc.2 (still a release-blocker until
`GET /health` reports `paymentMode=okx` against the production env).

**Mitigation (0.1.0-rc.2):**
- Schema-level guard in `apps/api/src/config.ts`: when
  `NODE_ENV=production` and `PAYMENT_MODE=mock`, the app throws on
  start (not a warning, no silent fallback).
- `OkxPaymentAdapter.isConfigured()` continues to refuse construction
  with an empty `recipientAddress`. The factory does not silently
  fall back to mock.
- The same rule is also encoded in `pnpm env:check` for CI.
- Error messages never include the OKX secret, the GitHub token, or
  any other credential.

**Detection:** `/health` returns the active `paymentMode`. Operators
must verify `paymentMode=okx` immediately after production deploy.

## R-03 — GitHub rate limiting (anonymous 60 req/h)

**Severity:** Medium
**Likelihood:** High for unauthenticated production usage
**Mitigation:** Documented as a known limit. `GITHUB_TOKEN` env var
unlocks 5000 req/h. The `verify:release` script defaults to fixture
mode to avoid hitting GitHub.

**Detection:** Fetcher reports a clear 403/429 with the remaining rate
limit in the error response; user is told to set `GITHUB_TOKEN`.

## R-04 — Dependency drift (zod / MCP SDK / pino)

**Severity:** Medium
**Likelihood:** Medium (registry / SDK changes)
**Mitigation:** All critical pins are documented in `DECISIONS.md`
(D-003, D-004). `pnpm install` uses `--frozen-lockfile` in CI. PRs that
bump these versions must include a test for the version-specific
behavior.

**Detection:** CI runs `pnpm install --frozen-lockfile`; a successful
run is the gate.

## R-05 — zod 3.25 / registry mirror gap

**Severity:** Low
**Likelihood:** Was blocking rc.1
**Mitigation:** Resolved by pinning to zod 3.24.1 + MCP SDK 1.22.0.
If the mirror starts serving 3.25.x, we can lift the pin in a
separate PR after exercising the new tool surface.

## R-06 — SQLite in production by accident

**Severity:** Medium
**Likelihood:** Low
**Mitigation:** `env:check` warns when `DATABASE_URL` starts with
`file:` and `NODE_ENV=production`. Production deployments use
`postgres://`. The Drizzle schema is hand-written and the migration
path runs on both backends.

## R-07 — CORS misconfiguration in production

**Severity:** Medium
**Likelihood:** Medium
**Mitigation:** `CORS_ORIGINS` is required in production; the default
is `http://localhost:5173,http://localhost:3000` which is development
only. `env:check` fails if `*` is present in production.

## R-08 — Prompt injection in README / source

**Severity:** Medium
**Likelihood:** High (the public web is full of these)
**Status:** Mitigated in 0.1.0-rc.2 by scoping. See below for what is still
not covered.
**Mitigation:** `security/injection.ts` reports; it never executes. The
system never takes instructions from target-repo content.

The detector has two scopes, deliberately different, and the difference
is what the 2026-10-01 audit taught it:

- **Instruction phrases** (22 of them) are looked for in prose documents
  only — `.md`, `.rst`, `.txt`, `.adoc`, and extension-less names like
  `README`. They match on word boundaries. Both halves matter: as
  substrings, `act as` read out of `contract as`, and a repository that
  audits smart contracts writes that constantly.
- **Role markers** (`system:`, `assistant:`) must open a line and be
  followed by content. As substrings they are a JSON key, a TypeScript
  type annotation, a log label — the self-audit flagged its own
  `llm/prompts.ts` over `{ system: string; user: string }`.
- **Invisible / bidi characters** are looked for in every file, source
  included. A bidi override in source is Trojan Source, and that is a
  source-level problem, not a prose one.

Before the scoping, the self-audit flagged eleven files and ten were
false. After it, four findings, all in the deliberately planted
`fixtures/prompt-injection/README.md`.

**Still open.** The audit prompt built in `llm/prompts.ts` carries
repository metadata (name, description) and no file content, so the only
text from a repository that can actually reach a model today is its
GitHub description — and that is not scanned. The detector is pointed at
prose, which is where a *reader* of the report looks, not at the surface
that reaches the model. Closing that gap means scanning metadata, which
is a feature rather than a scope correction; it is recorded here so the
next reader does not mistake the current state for full coverage.

## R-09 — Database file locked / migration crash

**Severity:** Low
**Likelihood:** Low (better-sqlite3 is single-writer, fine for one API)
**Mitigation:** Migrations are wrapped in a single `db.transaction`.
The migration script is idempotent (uses `IF NOT EXISTS`).

## R-10 — Log redaction bypass

**Severity:** Medium
**Likelihood:** Low
**Mitigation:** Redact is configured at the Fastify logger level. We
add an integration test that POSTs with a known fake secret and asserts
it does not appear in captured logs. The test is part of the suite.

## R-11 — Marketplace hero / branding not provided

**Severity:** Low
**Likelihood:** Confirmed (no brand asset)
**Mitigation:** Documented in `docs/HERO_IMAGE_BRIEF.md` and marked
`EXTERNAL_BLOCKED` in `docs/EXTERNAL_ACTIONS.md`. Release Candidate
proceeds without it.

## R-12 — PII leakage from the audited repo

**Severity:** Low
**Likelihood:** Low
**Mitigation:** Reports only contain `path:line:reason` for any
evidence pointer. Secret values are masked. We do not surface raw file
content in the report.

## R-13 — Long-running `full` audits time out

**Severity:** Low
**Likelihood:** High for large repos
**Mitigation:** 30 s default timeout in the fetcher. Documented in
`/api/v1/capabilities.limits`. P1 backlog item adds a queue.

## R-14 — Docker sandbox not available in dev

**Severity:** Low
**Likelihood:** Confirmed (this sandbox)
**Mitigation:** `pnpm docker:check` reports "Docker CLI not present"
instead of a cryptic error. CI runs the build on a real Linux runner.

## R-15 — User shares real OKX keys in chat

**Severity:** Critical
**Likelihood:** Low
**Mitigation:** `env:check` never prints secret values. All examples
in docs use `__OKX_AGENT_KEY__` placeholders. `README_OKX.md` and
`docs/SECURITY.md` warn explicitly against pasting keys.

## R-16 — Inline audit queue used in production (in-process, no durability)

**Severity:** High
**Likelihood:** Low (with proper guards)
**Status:** Mitigated in 0.1.0-rc.2.

**Mitigation:** `NODE_ENV=production` with `AUDIT_QUEUE_DRIVER=inline`
fails the application start. The schema-level guard in
`apps/api/src/config.ts` and `pnpm env:check` both enforce the rule.
An explicit `ALLOW_INLINE_QUEUE_IN_PRODUCTION=1` override exists for
disaster-recovery scenarios but is not advertised in `.env.example`.

**Detection:** `/health` reports `queue.driver=pg-boss` in production.
Operators should alert if it reports `inline` instead.

## R-17 — Tarball extraction exhausts disk / memory

**Severity:** Medium
**Likelihood:** Medium (introduced by D-017 in V0.2)

**Mitigation:** The disk half of this risk does not exist as built —
ADR D-024 superseded the `mkdtemp` detail and the archive is
decompressed in memory, so there is no directory to exhaust and nothing
to clean up in a `finally`. What replaces it is a pair of caps in
`git/fetcher.ts`: `MAX_ARCHIVE_BYTES` (64 MiB compressed, checked
before decompression) and `MAX_EXTRACTED_BYTES` (256 MiB, enforced by
zlib's `maxOutputLength`, which is what stops a small archive from
expanding into a gigabyte). The existing `maxTotalBytes` (50 MiB) still
caps the *decoded text*; extraction aborts once it is reached and
reports `truncated` rather than falling back, because what has been
read is still what was asked for. `filterFiles` runs before any file is
read, so noise directories are never materialised, and a file not on
the wanted list is never decoded at all. No `spawn` is performed on
extracted content (D-007). If extraction fails at any point — including
an archive that parses cleanly but holds none of the listed files,
which is how a moved ref would present — we fall back to the per-file
`getContent` path and mark the result `degraded`.

**Detection:** The fetcher logs `fileCount`, `extractedBytes`,
`archiveRoot`, `missing` and `truncated` on every tarball read, and
`degraded` plus the reason whenever it falls back. A tarball read that
yields few files but a non-zero `missing` is the signal that the
archive and the tree disagreed. `/tmp` usage is no longer an operator
signal for this risk; memory on the API host is.

## R-18 — AST parsing OOM on a pathological file

**Severity:** Low
**Likelihood:** Low (introduced by D-018 in V0.2)

**Mitigation:** Every file is checked against `maxFileBytes`
(1 MiB) before parsing. Each parser call is wrapped in try/catch and
degrades to the regex fallback on any error. Parsing is synchronous
per file with no cross-file state, so a single failure cannot poison
the map. `SymbolMapSchema.failures` records every degraded language
with its reason.

**Detection:** `SymbolMapSchema.degraded === true` or a non-empty
`failures[]` in the output. Unit tests assert that a malformed file
produces `degraded: true` rather than a throw.

## R-19 — Compare API returns a truncated diff

**Severity:** Low
**Likelihood:** Medium for very large pull requests (V0.4, D-020)

**Mitigation:** `GitHubCompareSource` checks the Compare API response
for the truncated flag and file-count cap. When truncation is
detected, `ChangeImpactSchema.degraded` is set to `true` and the
reason is appended to `limitations`. The engine never silently
reports a partial diff as complete.

**Detection:** Any `change-impact` response with
`degraded: true` and a `limitations` entry mentioning truncation.

## R-20 — Intelligence artifacts inflate `report_json`

**Severity:** Medium
**Likelihood:** Medium (V0.3+, if artifacts are embedded by default)

**Mitigation:** Per D-021, intelligence artifacts are **not** embedded
in `Report` by default; they live in the `intelligence_cache` table
and are served from dedicated endpoints / MCP query tools. V0.2-d went
further and did not wire the Repository Map into the pipeline at all,
so today nothing embeds it and there is nothing to inflate. The builder
is capped regardless, so an embedding caller cannot blow up
`report_json` by accident: `MAX_MODULES` 200, `MAX_ENTRYPOINTS` 50,
`MAX_LISTED_FILES` 300, `MAX_DEPENDENCIES` 500, `MAX_IMPORTANT_FILES`
60. Every cap that actually bites adds a `limitations` line naming what
was cut and the true total, so a truncated map cannot be mistaken for a
small one. When a caller explicitly requests embedding, the MCP tool
applies token trimming before returning.

**Detection:** Track `jobs.report_json` row size; alert on outliers.
The byte-budget integration test this entry used to describe does not
exist and was removed rather than left standing — it belongs to V0.2-g,
when something actually embeds the map. What exists today is
`fixture.test.ts`, which runs the builder over all six real fixtures
and asserts the caps hold and the truncation notes are emitted.

## R-21 — New dependency breaks the zod / MCP SDK pins

**Severity:** Medium
**Likelihood:** Medium (V0.2+, whenever a dependency is added)

**Mitigation:** D-003 pins zod to `3.24.1` and the MCP SDK to exactly
`1.22.0`; `pnpm-workspace.yaml` enforces both via `overrides`. Any new
dependency must not transitively pull zod >= 3.25 or MCP SDK >= 1.23
(the mirror cannot resolve `zod/v3`, and the newer SDK changes the
`tool()` signature). The `typescript` compiler API promotion in D-018
is safe: it is already present at `^5.7.2`.

**Detection:** CI runs `pnpm install --frozen-lockfile` followed by
`pnpm typecheck`; a resolution or type failure is the gate. Reviewers
must reject PRs that move these two pins without an accompanying ADR.

## R-22 — A lockfile drives `securityHygiene` to 0

**Severity:** High
**Likelihood:** Certain (measured, not theorised)
**Status:** Mitigated in 0.1.0-rc.2 by ADR D-022. The penalty is capped per
`(file, rule)` at 3 findings, so one generated file can no longer zero a
dimension. Breadth is unaffected.

A lockfile is mostly integrity digests — `sha512-<base64>` — which are
high-entropy by construction, which is exactly what the generic secret
heuristic looks for. `security/severity.ts` downgrades those hits rather
than skipping them, so the *quality contract* stops counting them (it
only counts `critical` and `high`). The **score** does not.

`scoring/score.ts` sums `SEVERITY_PENALTY[f.severity]` over
`securityFindings`, and `low` is 1.5, not 0. The findings are never moved
out of `securityFindings`, so they still accumulate there.

Measured on a synthetic repository whose only files were a
`pnpm-lock.yaml` with 400 integrity digests, a one-line `src/index.ts`, a
README and a LICENSE:

```text
securityFindings: 389   (388 low from pnpm-lock.yaml, 1 medium from .gitignore)
fixtureFindings:    0
securityHygiene:    0
overall:         44.9
```

388 × 1.5 = 582 points of penalty against a base of 100, clamped to 0. A
repository whose only sin is having a lockfile scores zero on security
hygiene, and the overall score lands at 44.9. (The delta against a
lockfile-free run of the same tree was not measured — the other
dimensions are not all 100, so 44.9 is the observed value, not the size
of the loss.) This is the same class of defect as the 547-blocker
`.env.example` run that motivated `TEMPLATE_ONLY_KINDS`, one layer
further out: the gate was fixed, the score was not.

Note what does *not* fix it. `fixtureSummary` groups `fixtureFindings`,
which by construction excludes lockfiles and documents, so it does not
touch this. Neither does lowering `SEVERITY_PENALTY.low`: the count is
unbounded, so any non-zero weight still reaches 0 on a large enough
lockfile.

**Fix applied (ADR D-022):** cap the contribution of any one
`(file, ruleId)` pair, rather than removing lockfile findings from
`securityFindings`. The 388th `sha512-` digest carries no information the
first did not, and a cap is principled for every rule rather than a
special case for lockfiles. Moving generated-file findings into
`fixtureFindings` would also work, but it changes what
`securityFindings` means and raises the score for every affected
repository — a bigger semantic change than the cap.

**Detection:** the probe above, now pinned in both directions by
`packages/core/src/scoring/penalty-cap.test.ts`: a lockfile cannot zero
`securityHygiene`, and forty files with one hit each still score 40 — the
second half matters as much as the first, since a cap that also flattened
breadth would trade a false alarm for a false pass. Reverting the cap
fails 7 of the file's 8 tests.

**Fixed:** ADR D-022 caps each `(file, ruleId)` pair at `MAX_PER_GROUP`
(3) findings, worst severity first, keyed on the *resolved* rule id — a
secret finding's `id` embeds its line number, so keying on it would give
every hit its own group and the cap would never apply. Measured after the
fix, same synthetic repository: `securityHygiene: 95.5`, and the overall
score moves 1.1 points instead of 25.

## R-23 — Two hits of one rule on one line share a fingerprint

**Severity:** Medium
**Likelihood:** Low — needs two credential patterns to match one line, and
a contract that tolerates at least one credential
**Status:** Mitigated in 0.1.0-rc.3 for the quality gate by ADR D-023. The
diff still collapses them, deliberately and by schema.

A fingerprint is resolved rule id plus evidence locations, and it is
meant to be coarse so that a finding which only moved does not read as
one fix plus one new problem. The consequence is that two *different*
hits of one rule at one `file:line` are one fingerprint.

That is reachable from the scanner as written. `scanTextForSecrets()`
emits one hit per matching `PATTERNS` entry with no per-line dedupe (the
entropy heuristic is the only one that checks the line, at
`secret-scanner.ts:289`), and `toSecretFindings()` dedupes on
`file::kind::line`, so two *different* kinds survive. Every `secret-`
slug resolves through the registry's `secret-` prefix to the single rule
id `SEC-SECRET-001`. One line carrying an AWS key and a Stripe key is
therefore two findings with two ids and **one** fingerprint:

```text
id=secret-aws_access_key-1-src-config-ts   fingerprint=6537623962375d80
id=secret-stripe_live_key-1-src-config-ts  fingerprint=6537623962375d80
```

`collectFindings()` deduplicated on that fingerprint, and
`securitySection` compares the resulting count against
`security.maxSecrets`. With `maxSecrets: 1` the two credentials were
counted as one, `1 <= 1` held, and the check reported `1 credential
found` with status `pass`. The default contract sets `maxSecrets: 0`, so
one surviving credential still fails it — the false pass needed a
non-default `maxSecrets` or `maxCritical`, which is what keeps this at
Medium rather than High.

**Detection:** the two ids above, built through the real scanner and the
real `enrichFinding`, are pinned in `quality/contract.test.ts` under
`finding collection`. Both tests fail if the key reverts to the
fingerprint alone — the count test reports length 1 instead of 2, and the
contract test reports `pass` where `fail` is required.

**Fixed:** ADR D-023 keys `collectFindings` on `(findingKey, id)`, which
is strictly finer than the fingerprint alone. The gate now counts what
the report lists.

**Still open, by design:** `diffReports` keys on the fingerprint, so two
hits removed from one line read as `resolved: 1`, and a report that added
a second credential to a line already carrying one reads as `persistent`
with no change. This is not an oversight to be fixed the same way:
`AuditDiff.resolved` and `.new` are documented as arrays of fingerprints,
so a finer key is a schema change, and "is this problem still at this
place?" is genuinely answered by the coarse key. A caller that needs the
count should read `Report.securityFindings`, not the diff.


## R-24 — A reverse proxy that omits `X-Forwarded-For` disables rate limiting

**Severity:** High. **Status:** mitigated in the shipped configurations,
undetectable at runtime.

`apps/api/src/middleware/rate-limit.ts` keys the limiter like this:

```ts
keyGenerator: (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.ip;
},
allowList: ['127.0.0.1', '::1'],
```

The `allowList` is matched against the **key**, not against `req.ip`.
`@fastify/rate-limit@10.3.0` does `params.allowList.indexOf(key)`
(`index.js:233`), and its `allowList` docs describe it as an IP list, which is
true only when no custom `keyGenerator` is supplied. Here one is.

The consequence is that the fallback branch is a trap. A proxy that forwards
the request **without** `X-Forwarded-For` leaves `req.ip` equal to the proxy's
own address. When the proxy runs on the same host as the API — the shape both
`docs/deployment/nginx.conf.example` and `Caddyfile.example` describe — that
address is `127.0.0.1`, which is exactly the allowListed entry. Every request
then matches the allowList, and the rate limit is skipped entirely. Nothing
logs a warning; the limiter simply stops limiting.

The same trap has a second door. `apps/api/src/server.ts` sets
`trustProxy: true`, so Fastify believes `X-Forwarded-For` from anyone. An API
that a client can reach directly is therefore an API whose limit any client can
skip by sending `X-Forwarded-For: 127.0.0.1`.

**Why it is High rather than Low.** R-03 is the reason the limiter exists at
all: anonymous GitHub access is 60 requests/hour per IP, and the four free
tools inherit that budget. With the limiter off, one caller can exhaust the
shared budget and take the service down for everyone, and the failure looks
like GitHub rate limiting rather than like a misconfiguration.

**Mitigation, in three places.**

1. `deploy/nginx/repopilot.conf` sets `X-Forwarded-For
   $proxy_add_x_forwarded_for` and carries a comment saying why the line must
   not be removed. Both host templates carry the same warning.
2. `docker-compose.yml` publishes the API on `127.0.0.1:4000:4000`, not
   `4000:4000`, so the direct-reach door is shut in the shipped topology.
3. `scripts/compose-check.ts` fails if any service other than `web` is
   published on every host interface, and fails if the nginx config stops
   forwarding `X-Forwarded-For`. Both checks were falsified: removing the
   header line and re-publishing the API on `0.0.0.0` each make it exit 1.

**Still open, by design.** The `keyGenerator` is not changed. Preferring the
header is the correct behaviour behind a proxy, and dropping the loopback
entries would break local development, where there is no proxy and the client
genuinely is `127.0.0.1`. The fix belongs in deployment configuration, which is
where it now is — but a reviewer reading `rate-limit.ts` alone would not see
it, so the trap is recorded here rather than left to be rediscovered.

## R-25 — A healthy container can be serving an unmigrated database

**Severity:** High
**Likelihood:** Likely — every fresh deployment starts in this state

**What happens.** `/health` answers HTTP 200 in both the good and the bad
state; only the body distinguishes them. `status: 'ok'` requires `dbOk &&
queue.status === 'ok' && queue.acceptingJobs`
(`apps/api/src/routes/health.ts`), and `dbOk` is a real query —
`repo.list(1)`. Against a database with no schema that query throws, the body
says `degraded`, and the response is still `200 OK`.

So a deployment whose database has never been migrated looks healthy to
everything that checks liveness by status code:

- `docker compose ps` — healthy (the API healthcheck is `r.ok ? 0 : 1`).
- A Railway, Render or Kubernetes readiness probe pointed at `/health` — ready.
- A load balancer — in rotation.

…while every audit POST fails at the database layer. The operator sees a
running stack and a product that does not work, and the two facts do not
obviously share a cause.

**Why this is recorded even though compose now enforces it.** D-031 fixed the
compose path by turning the bootstrap into a job that `api` and `worker` wait
on. Three of the four documented deployment shapes are not compose: Railway,
Render and the plain-VPS install all require the operator to run
`node apps/api/dist/db/migrate.js` (or `pnpm db:migrate`) before the API takes
traffic, and nothing in the application says so if they forget. The condition
was also live until 2026-09-29, including in the docs — which presented
`docker compose up -d` as the whole procedure.

**Mitigation.**

1. `docker-compose.yml` runs the bootstrap as a one-shot job and gates `api`
   and `worker` on `service_completed_successfully` (D-031).
2. `scripts/compose-check.ts` fails if that ordering is removed — from either
   service, with the wrong command, or with a server-style restart policy.
   Four mutations, all caught.
3. `docs/DEPLOYMENT.md` names the step in every platform section that needs
   it, and describes what the failure looks like when it is missed.

**Still open.** Nothing in the API distinguishes "I cannot serve" from "a probe
failed", so no status-code-only check can detect this class. Changing that is a
larger decision about what `/health` means; the deliberate 200 is recorded as a
rejected alternative in D-031, so that the next person to meet this does not
have to re-litigate it from first principles.

## R-26 — A check that never runs is indistinguishable from one that passes

**Severity:** High
**Likelihood:** Certain — it has already happened three times in this repository

**What happens.** A green dashboard means "nothing that ran found a problem",
which is not the same claim as "nothing is wrong". When the thing that would
have found the problem never executes, the two are visually identical, and the
gap is invisible precisely because the instrument that would report it is the
one that is missing.

Three instances, each found independently and each having survived review:

1. **`apps/web` had no tests.** Its `test` script printed `no web tests yet`
   and exited 0, so `pnpm -r test` reported success for a workspace with no web
   coverage at all. The bug that made the submit button a silent no-op lived
   there undetected from the first commit (2ea445d).
2. **`.github/workflows/docker.yml` was PR-only.** The repository has had no
   pull requests, so the only workflow that builds an image had never run on
   `main`. The image did not build — `FROM node:20-alpine` against
   `pnpm@11.11.0`, which needs Node 22 — and had not since the initial import.
   Adding `push:` surfaced it in 17 seconds.
3. **`docker:check`'s static half could not fail.** `err` printed a red ✗ and
   the script still exited 0, so every assertion in it, including "the
   Dockerfile is present", was advisory. It was also not wired into CI at all,
   so nothing ran it either way.

**Why this is High rather than Low.** Each instance hid a real defect, and two
of the three had been shipping since the initial import. The failure mode is
self-concealing: the more thorough a check looks in the file, the less likely
anyone is to ask whether it ever executes.

**Mitigation, and the rule that follows from it.**

1. `docker.yml` runs on push as well as PR.
2. `compose:check` and `docker:check` are both steps in `ci.yml`, so they run
   on every push rather than only where someone remembered to look.
3. `docker:check` exits 1 on any ✗, and its build half self-skips *after* the
   static half rather than instead of it.
4. **The rule:** a new check is not done when it passes — it is done when a
   deliberately reintroduced defect makes it fail, and when something runs it
   automatically. Fourteen mutations cover `compose:check` and `docker:check`;
   the web suite has six. Both harnesses live in the audit scratch directory
   rather than the repository (D-029 decision 7), so the mutations are
   documented in `DECISIONS.md` and `CHANGELOG.md` instead of being committed.

**Still open.** `pnpm -r lint` is only as strong as each package's `lint`
script, and every package's is `echo skip-package-lint` — the recursive form
still checks nothing, and the real lint is the root `pnpm lint`, which only
runs because `ci.yml` names it explicitly. The same question should be asked of
every script in `package.json` before the next release: *what runs this, and
what would it take for it to fail?*

## R-27 — A check that can never pass is indistinguishable from one that found nothing

**Severity:** High
**Likelihood:** Certain — two instances in one session, both found by
auditing real repositories rather than by reading the code

**What happens.** R-26 is about a check that never runs. This is its
mirror: the check runs on every audit, and its answer is fixed before it
starts. Both are invisible for the same reason — the instrument is present
and reports something — and this one is worse, because what it reports
reads as a clean bill of health.

**Instance 1 — the screenshot check.** It read:

```ts
hasScreenshots = entries.some((e) => /\.(png|jpe?g|gif|webp|svg)$/i.test(e.path));
```

and `entries` was the output of `filterFiles`, which drops every extension
in `BINARY_EXTENSIONS` — a list containing `.png`, `.jpg`, `.jpeg`, `.gif`
and `.webp`. The question "is there a `.png`" was asked of a list with the
`.png` files already removed. The self-audit reported "no image files in
repo" about a repository with four of them.

The only branch that could ever have succeeded was a `.svg` under 4 KB:
`.svg` is not in the binary list, so it falls through to "unknown
extension, small, treat as text" and survives. A check that passes only on
a rare branch is *harder* to notice than one that never passes at all,
because it produces a yes often enough to look alive.

**Instance 2 — the same predicate, in a test.** `pipeline-fixture.test.ts`
built a thirty-five-line `ScoringInput` by hand, including a copy of the
same `hasScreenshots` line, and never read the result. Fixing the analyzer
did not fix the copy, and the copy would have gone on asserting the old
shape of the bug to anyone who trusted it. Dead code is not inert when it
is a second copy of a rule.

**Why this is High rather than Low.** The failure mode is a *false tick*,
and a false tick is worse than a false alarm. A reader questions an alarm;
nobody questions a green tick. The same class produced `[x] Contracts
covered by tests (Foundry / Hardhat)` on a repository with no contracts
(see R-28) — three green ticks in one report, over capabilities that did
not exist.

**Mitigation.**

1. Existence questions are asked of the whole tree; content questions are
   asked of `fileContents`. `ReportBuilderInput` carries `allPaths` beside
   `entries` for exactly this, and `analyzeDocumentation` /
   `analyzeHackathon` take paths rather than `FileEntry[]` so the wrong
   input is not the convenient one.
2. `documentation.test.ts` runs classify → filter → analyze over the real
   self-audit tree, so the two halves cannot drift apart again: a check
   that asks the filtered list about a binary file fails there.
3. The dead copy in `pipeline-fixture.test.ts` is deleted, and the test
   asserts on the analyzers' own outputs so those calls stay live.

**The rule.** R-26 asked *what runs this, and what would it take for it to
fail?* The question for this class is one step earlier: **what input could
make this check answer "yes", and is that input reachable?** If no reachable
input can produce a yes, the check is not a check. That question is now
the third one in the `mutation-check` skill, alongside the two it already
asked.

**Still open.** Nothing enforces rule 3 mechanically. It is a question a
reviewer has to ask, and the two instances here were both found by running
the tool against real repositories — not by reading it. That is an argument
for keeping the three-repository audit as a repeatable exercise rather than
a one-off.

## R-28 — A green tick over a capability the repository does not have

**Severity:** High
**Likelihood:** Certain — measured on a real self-audit

**What happens.** A checklist row is a claim. When the claim is false in
the *passing* direction, nothing in the report contradicts it: the row is
green, the score is fine, and there is no second signal. An alarm invites
scrutiny; a tick does not. So a false tick survives review, while the same
error in the other direction gets caught within a minute.

**Instance 1 — `[x] Contracts covered by tests (Foundry / Hardhat)`, on a
repository with no contracts.** RepoPilot self-audited as
`Solidity, Foundry`. It is neither. `detectStack` and `analyzeWeb3` were
reading `fixtures/web3-hackathon/`, a fake Solidity project that lives
inside RepoPilot's own test suite, and reporting it as evidence about
RepoPilot. `web3.hasContracts` was therefore true, which emitted the
contract-tests row, and `hasContractTests` was also true, which ticked it.

Two green ticks and a detected stack, all from material that belongs to a
different project.

**Instance 2 — `has-readme: PASS` against `[high] README.md is missing or
empty`.** Here the tick was right and the blocker was wrong, which is the
mirror of the same asymmetry: one fact, two verdicts, and the two entry
points carried their own lists of what a README may be called.
`octocat/Hello-World` has exactly one file, called `README`. The free
check's list accepted it; the audit's did not, so the paid audit led with a
blocker over a file that was present and dropped the documentation score to
5.5.

**Why this is High rather than Low.** Both instances were found only by
auditing real repositories and reading the output closely. Neither is
visible from the code, and both make the product's headline claim —
"grounded in the actual repository contents" — false in the direction that
flatters it.

**Mitigation.**

1. Stack and web3 detection skip stand-in material
   (`fixtures?`, `__fixtures__`, `test-data`, `test-fixtures`) via
   `isSampleMaterialPath` in `utils/paths.ts`. The predicate is
   deliberately narrower than `isFixturePath`: that one includes `test/`,
   and a repository's own `test/Counter.sol` really does mean the project
   is Solidity. `stack.test.ts` pins both directions — the fixture is
   ignored, and `test/Counter.t.sol` is still detected.
2. Both entry points read one set of document-name constants
   (`README_FILENAMES`, `LICENSE_FILENAMES`, `ENV_EXAMPLE_FILENAMES`),
   which are the unions of what the two previously accepted, so unifying
   made neither stricter than it already was.
3. The checklist's evidence now carries counts per (file, rule) rather
   than a list of titles, so the row that says "no committed credentials:
   failed" also says *which file* and *how many* — the information that
   lets a reader check the claim instead of trusting it.

**Still open.** Nothing tests the *whole report* against a repository whose
correct answer is known. The three-repository audit is that test, run by
hand. The self-audit is the hardest case of the three and it is the one
that found all of this; it should be run before every release, and its
score compared against the previous run rather than merely inspected.


## R-29 — The mnemonic rule fires on the dictionary of mnemonics

**Severity:** High
**Likelihood:** Certain — measured on the 2026-10-02 self-audit

**What happens.** The `mnemonic` rule has two halves. The candidate test is
a regex for a run of 12–24 lowercase words; the validator,
`isBip39Phrase`, accepts the candidate when *every word is in the BIP-39
list*. The file that defines that list — `packages/core/src/security/
bip39-english.ts` — satisfies both halves on almost every line, by
construction. A wordlist is a list of words that are all in the wordlist.

So the largest single source of "Possible seed phrase" findings in
RepoPilot's own report is RepoPilot's own copy of the BIP-39 wordlist.

**Measured** (self-audit, `mode: full`, 2026-10-02):

| | before `82a244c` | after |
|---|---|---|
| `securityFindings` | 22 | **190** |
| of which in `bip39-english.ts` | 0 | **166** (87%) |
| `securityHygiene` | 40.5 | **0.0** |
| `blockers` | 0 | **25** (the cap) |

185 of the 190 are `SEC-SECRET-001`. The other five are three injection
and two history findings, unchanged.

**This is a regression the fix caused.** The wordlist was added by
`82a244c` to *remove* a false positive — before it, the rule was a bare
"12+ lowercase words", which flagged ordinary prose. Adding the dictionary
made the rule precise for prose and, at the same time, made it fire on the
dictionary. The 2026-10-02 baseline was captured against `b78d334`, nine
commits before that, so nothing in the record shows the change.

**Why this is High rather than Low.** Web3 repositories are the stated
target market, and a vendored BIP-39 wordlist is common in exactly those
repositories — `@scure/bip39`, `bip39`, `ethers` wordlists and hand-copied
`english.txt` files all have this shape. For any such repository the
security dimension reads 0.0 and the blocker list fills with findings that
are all the same non-finding. A security score that is 0 for a reason the
reader can dismiss teaches the reader to dismiss security scores.

**How it was found.** Not by reading the code and not by the test suite:
by the first live run of `scripts/audit-diff.ts`, which compares four real
audits against a recorded baseline. The self-audit's target is this
repository, so the tool noticed that our own commits had moved our own
score. The baseline being stale is what made the 166 visible.

**Fixed — batch 2, 2026-10-02.** Option 2, the file-level predicate, as
`isWordlistFile()` in `packages/core/src/security/shapes.ts`, consulted
through a new `skipFile` gate on the pattern.

**Why option 2 and not option 1.** A path exclusion (`**/bip39-english.ts`)
would have fixed our copy and nothing else. The class is "a file that is a
dictionary of BIP-39 words", and a path does not name that class — a wordlist
fetched into a temporary directory, renamed, or vendored under a different
name all have the shape and none has the path. Option 3 was not needed: the
rule's per-match validator is correct, and the file-level question is the one
it was missing.

**The threshold was measured, not chosen.** Word tokens (`[a-z]{3,12}`, the
same shape the mnemonic candidate regex uses) were counted for every tracked
file with at least 50 of them — 248 files:

| file | BIP-39 fraction | words |
|---|---|---|
| `packages/core/src/security/bip39-english.ts` | **0.956** | 2181 |
| `packages/core/src/findings/rule-registry.ts` | 0.447 | 944 |
| `screenshots/okx-seller-smoke.html` | 0.419 | 186 |
| `packages/core/src/intelligence/limits.ts` | 0.416 | 77 |

Nothing measured lands between 0.447 and 0.956, so the band is wide and the
exact digit does not carry the decision. `WORDLIST_SHARE = 0.75` is the
midpoint. There is also a floor, `WORDLIST_MIN_WORDS = 50`: without it a
twelve-word test fixture made entirely of BIP-39 words scores 1.0 and would
be read as the dictionary.

**Verified.** `scanForSecrets` on this repository's tracked tree, with the
file set held fixed:

| | old scanner | new scanner |
|---|---|---|
| `mnemonic` | 167 | **2** |
| of which in `bip39-english.ts` | 165 | **0** |
| `generic_high_entropy` | 33 | **4** |
| total findings | **210** | **16** |

The two surviving `mnemonic` findings are the deliberate positive fixtures in
`secret-scanner.test.ts:187` and `:195` — the rule's own "does it detect a
phrase" test. Suppressing those would be suppressing the test that proves the
rule works, so a test now pins that a phrase in a document is still reported.

**The tree scan was the easy half.** The first version of this fix left the
history scan broken, and only the audit showed it: `securityFindings` stayed
at 7, one of them `critical` against `bip39-english.ts` in commit `82a244c`,
and the report's headline read "Top blocker: Secret in commit history:
Possible seed phrase". The history scanner scans a patch one added line at a
time, so the file-level question was being asked of a single line — twelve
words, below the floor `isWordlistFile` needs before it will judge a file at
all, so the answer was always no. `scanTextForSecrets` now takes the text a
file-level judgement should be made against, separately from the text being
scanned, and the history scanner passes the whole patch.

**Two lessons, both about where a check is asked.** A file-level predicate
applied to a fragment is not a weaker version of itself, it is a different
question. And **an acceptance tool that reads a published repository can only
measure what has been pushed** — the first re-run of `audit-diff` after the
tree fix measured the *old* code, because the fix was still uncommitted, and
it reported no movement for a change that had already worked.

**The self-audit's floor is now 6, and 5 of them are documents.** After the
fix, `securityFindings` is 6 and `securityHygiene` is 87.5:

| | |
|---|---|
| `low` | `CHANGELOG.md` ×3 (one entropy, one injection, one history) |
| `low` | `DECISIONS.md`, `RISKS.md` — injection patterns |
| `medium` | `shapes.ts:54` **in commit `b01067b`** — the bare citation this batch fixed in the tree |

The last row is the shape of every history finding: **fixing the file does
not fix the commit.** `b01067b` really did add that line, and the record is
correct. It clears itself when the commit falls out of the 20-commit history
window, which is a property of the scan rather than of the finding.

### The acceptance criterion this risk was written against was wrong

`190 → 0`, later `194 → 0`, cannot be reached and was never the right target.

1. **The floor is not zero.** Of the 16 remaining secret findings on the
   tracked tree, **15 are deliberate fixtures** in `secret-scanner.test.ts`
   and `history-scanner.test.ts` — a scanner's test suite has to hold
   realistic-looking keys to prove it detects them — and the 16th is the
   Telegram example in `CHANGELOG.md:1177`, already recorded as an accepted
   residual of the unknown-format catch-all.
2. **`securityFindings` is not the secret scan.** `report/builder.ts:141`
   builds it as `secretFindings + injectionFindings + historyFindings +
   security-category hygiene findings`, then removes anything in a fixture
   path. So a number read out of that field cannot be compared to a
   secret-scan count, and the criterion compared one to the other. Measured
   now: on the tracked tree the secret scan is 210 → 16, while the tree-side
   non-fixture contribution to `securityFindings` is 1 secret finding plus 4
   injection findings — the injection four being our own `CHANGELOG.md`,
   `DECISIONS.md` and `RISKS.md` quoting the instruction phrase the injection
   rule keys on while explaining why it fires on that phrase. That is this
   same risk, one rule over: the rule reporting the sentence that documents
   the rule.

**The criterion, restated: the wordlist contributes zero.** That is what the
change delivers and what a test pins. A literal total is not a criterion for a
field whose scope is four merged sources and whose target is this repository —
every commit we push moves it. See D-032.


## R-30 — `quick` and `full` are the same analysis at two prices

**Severity:** High
**Likelihood:** Certain — measured on the 2026-10-02 baseline

**What happens.** `mode` is a required field on every audit request, and it
decides the price: `priceFor(deps.payment, input.mode)` resolves to 0.02
USDT for `quick` and 0.10 USDT for `full` (`DEFAULT_PRICING`, in
`packages/core/src/utils/constants.ts`). It does not decide the analysis.
Every analyzer runs in both modes, the archive is read the same way, and
`scanHistory()` is called unconditionally in `pipeline.ts` — `auditMode` is
stamped into `scan.mode` and then read by nothing in the pipeline.

Grepping all of `packages/core/src` for a comparison against `mode` returns
exactly three, all in `report/builder.ts`, all after the analysis is
finished:

| line | what `mode` changes |
|---|---|
| `builder.ts:365` | adds the `task-add-demo-url` recommended task in `full` only |
| `builder.ts:419` | adds the "Configure reverse proxy + TLS" deployment step in `full` only |
| `builder.ts:554` | adds the limitation sentence in `quick` only |

So `full` buys three extra rows of advice. Everything a customer would use
to decide whether the repository is good — the five dimension scores, the
blocker list, the documentation gaps, the security findings, the detected
stack — is computed identically.

**Measured** (one repository, both modes, `GITHUB_TOKEN` set, 2026-10-02;
these are the two `Hello-World` rows of `scripts/audit-baseline.json`):

| | `octocat/Hello-World` quick | `octocat/Hello-World` full |
|---|---|---|
| `overall` | 53.1 | 53.1 |
| `documentation` | 37.5 | 37.5 |
| `reproducibility` | 28.5 | **28.5** |
| `securityHygiene` | 95.0 | 95.0 |
| `deploymentReadiness` | 63.5 | 63.5 |
| `blockers` / `docGaps` | 4 / 8 | 4 / 8 |
| `secFindings` / `fixtureFindings` | 1 / 0 | 1 / 0 |
| `historyScanned` | yes | yes |

Identical on every axis.

**The `quick` limitation sentence is false.** A `quick` report says:

> Quick scan skips some of the deeper reproducibility heuristics.

Nothing is skipped. `reproducibility` is 28.5 in both modes, and no analyzer
consults the mode. This is the same defect class as R-28 one level down:
R-28 was a green tick over a capability the repository did not have; this is
a stated limitation over an analysis that was never thinned. **No test pins
the sentence** — it occurs in `builder.ts:555` and in generated audit
artefacts, nowhere else — so it can be deleted or made true without breaking
a gate, which is itself the finding.

**The marketplace listing sells the difference.** `MARKETPLACE_LISTING.md`
describes the 0.10 USDT tier as including "the deeper reproducibility and
Web3 analyzers", in English (`:37-41`) and in Chinese (`:92-95`). The Web3
analyzer runs in both modes and there is no deeper reproducibility pass. A
buyer who pays 0.10 receives the same numbers as a buyer who pays 0.02, and
nothing in the product stops the 0.02 buyer from getting them.

**A third sighting, already committed.** `screenshots/README.md:34` labels
the `full` artefacts "same content here, repo is too small to differ" — the
same theory I reached first, written down months earlier and never checked.
It is wrong twice: the two reports are not the same content (`full` carries
two extra advice rows), and the repository being small is not why. Three
independent places describe a difference that does not exist, and all three
survived because no check compares a claim about `mode` against `mode`.

**Why this is High rather than Low.** It is not a scoring bug. It is a
statement to a paying customer that the code does not support, made in the
document that exists to be read by a paying customer. The scores are right;
the *tiering* is fictional. And the direction is the bad one: the cheap tier
over-delivers and the expensive tier is mis-described, so the first person
to notice is a customer comparing notes.

**How it was found.** Not by reading the code and not by the test suite.
While hardening `scripts/audit-diff.ts` (adding the `historyScanned` column),
the four baseline audits were re-run and the two `Hello-World` rows came back
identical on every field. The explanation offered first — "the 3-commit
history adds nothing to a one-file repository" — was wrong, and checking it
is what surfaced that the two modes are the same scan.

**Mitigation.** None yet, deliberately. This is a product decision with two
defensible answers and the repair plan did not anticipate it:

1. **Implement the tiering.** Make `quick` actually skip the deeper
   reproducibility heuristics and the Web3 analyzer, and make the limitation
   sentence true. `DEFAULT_LIMITS` grows a per-mode variant, and
   `audit-diff` gains something to compare.
2. **Collapse to one tier.** Delete the mode, keep one price, delete the
   sentence and the marketplace claim. Cheaper and honest; loses the
   0.02/0.10 ladder.

Both are larger than a document edit, and (1) changes what a paying customer
receives, so neither is being chosen unilaterally.

**Still open.** Until it is decided, the marketplace listing overstates the
0.10 tier and the `quick` limitation sentence is false. `docs/API.md` is
*not* wrong — it lists `mode` as a required parameter (`:208`) and never says
what it selects — which is precisely why the doc check cannot see any of
this: there is no derivable number and no cross-reference to disagree with.
Recorded here rather than fixed, because fixing the documents alone would
erase the evidence that a real tiering was intended.



## R-31 — The typecheck gate does not cover `scripts/`

**Severity:** Medium
**Likelihood:** Certain — measured on 2026-10-02

**What happens.** `pnpm lint` step 1 runs `tsc --noEmit` and prints
`Scope: 5 of 6 workspace projects` followed by `✓ tsc clean`. All five
workspace tsconfigs `include` exactly one pattern — `src/**/*` — and no
tsconfig anywhere in the repository includes `scripts/`.

So the first of the six gates says nothing about the directory that holds
`lint.ts` (the gate itself), `docs-facts.ts`, `audit-diff.ts`,
`mcp-audit.ts`, `verify-release.ts`, `compose-check.ts` and the rest. Every
checking mechanism this project has built since the 2026-10-01 review lives
in a directory the typechecker has never been pointed at.

**Measured.** A `tsconfig.scripts.json` extending `tsconfig.base.json` with
`"include": ["scripts/**/*.ts"]` produces **51 errors**:

| count | what |
|---|---|
| 4 | `TS1470` — `import.meta` not allowed, "files which will build into CommonJS output" |
| 1 | `TS2307` — `env-check.ts` cannot resolve `zod` |
| ~30 | `TS18048` / `TS2532` / `TS2345` — possibly-undefined, from `noUncheckedIndexedAccess`, mostly in `lint.ts` (13) and `verify-release.ts` (11) |
| 1 | a real type mismatch in `okx-seller-smoke.ts`: its x402 `accepts[]` literal is missing `resource`, `description` and `mimeType` |

The last row is not a config artefact. It is a genuine disagreement between
the script and the payment schema, sitting in the smoke test that exists to
prove the seller side is wired.

**Part of the cause is a file that is not what it is named.** The root
`tsconfig.json` contains:

```json
{ "name": "@repopilot/root", "version": "0.1.0", "private": true, "type": "module" }
```

That is the root `package.json`'s metadata header, not a tsconfig, and it has
been there since the first commit (`f95ccb5`). Two consequences, both silent:

1. **`"type": "module"` is in the wrong file.** TypeScript never reads it out
   of `tsconfig.json`, and the root `package.json` does not have it — so every
   `scripts/*.ts` is compiled as CommonJS, which is what the four `TS1470`s
   are. At runtime there is no symptom, because `tsx` does not consult the
   field and detects ESM from syntax. The only consumer of the setting is the
   typechecker, and the typechecker never sees these files.
2. **A `tsconfig.json` with no `compilerOptions`** sits at the root, so a bare
   `tsc` in that directory would read it and include every `.ts` file under
   the repository. Nobody runs that, which is why it has never mattered.

**Why this is Medium and not Low.** It is the same defect as D-034, in a
different gate: **the scope of the typecheck is part of the typecheck**, and
its scope silently excludes the code that does the checking. Every script in
that directory was written and reviewed under a green `✓ tsc clean` that was
never about them. It is not High because nothing is *wrong* at runtime —
`tsx` runs them correctly — but the gate is a green tick over an unexamined
directory, which is R-26's shape and R-28's shape.

**How it was found.** While adding the block-scope check in batch 1, the
question "is `scripts/docs-facts.ts` typechecked at all" was asked about a
change to that file. It is not.

**Mitigation.** None yet, deliberately. It is a batch of its own, and doing
half of it is worse than doing none: moving `"type": "module"` into
`package.json` fixes four errors and produces no new coverage, while adding
the tsconfig without moving the field produces four new failures. The batch
is: a real `tsconfig.scripts.json`, `"type": "module"` moved to where it
belongs, the root `tsconfig.json` replaced with something that is a tsconfig,
`zod` declared at the root (or `env-check.ts` excluded with a reason), and
the ~30 `noUncheckedIndexedAccess` sites worked through one at a time —
starting with the `okx-seller-smoke.ts` mismatch, which is a finding in its
own right.

**Still open.** Until then, `scripts/` has no static checking, and the
`✓ tsc clean` line should be read as covering five workspaces and nothing
else.


## R-32 — The injection rule reports the sentence that documents the injection rule

**Severity:** Low
**Likelihood:** Certain — measured on the 2026-10-03 self-audit
**Status:** Accepted residual. Not being fixed, and the reason is the point.

**What happens.** `RISKS.md`, `DECISIONS.md` and `CHANGELOG.md` each carry a
`low` prompt-injection finding, and all three are the same sentence: our own
explanation that the detector matches on word boundaries, because as a bare
substring the two-word instruction phrase is read out of `contract as`. The
explanation quotes the phrase in order to explain it, and the rule then
reports the quotation.

This is R-29's shape one rule over: **the rule fires on the text that defines
it.** Three sightings of the same pattern now — the mnemonic rule on its own
wordlist, the entropy rule on `shapes.ts`'s own citations, and the injection
rule on the paragraph describing the injection rule.

**Why it is not being fixed.** The finding is a *true positive*. A document
really does contain the phrase the detector looks for, and the detector
cannot tell a quotation from an instruction — nor should it try, because
"the payload is in a code span" is a thing an attacker can arrange. The
severity is already right: the rule only looks in prose documents, and
`severityForPath` holds document findings at `low`.

The available fixes are both worse than the finding:

1. **Reword the documents to avoid the phrase.** This works for `RISKS.md`
   and is arguably better writing — the sentence is about *containment*, so
   naming the containing word is enough and the contained one is redundant.
   It does not work for `DECISIONS.md` or `CHANGELOG.md`, which are records
   of what happened. Editing a decision record so that a check stops firing
   is the failure mode this whole exercise exists to prevent.
2. **Suppress a phrase inside a code span or quotation marks.** That turns a
   true positive into a false negative, in the one rule where the
   attacker chooses the markup.

**What to do instead.** Leave it, and read the number correctly: three of the
self-audit's six `securityFindings` are our own security documentation, at
the lowest severity, and they are the *evidence that the rule works*. A
future reader who wants the number to be zero should fix the rule's scope,
not the sentences.

**Related.** R-29 (the same shape, fixed), R-28 (a tick that means something
other than what it looks like).
