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
- [R-13](#r-13--a-gate-on-a-large-repository-times-out) — A gate on a large repository times out
- [R-14](#r-14--a-docker-build-that-needs-github-releases-to-be-reachable)
  — A Docker build that needs GitHub Releases to be reachable
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
- [R-33](#r-33--the-local-lint-gate-checks-downstream-packages-against-a-stale-dist)
  — The local lint gate checks downstream packages against a stale `dist`
- [R-34](#r-34--the-mcp-server-cannot-be-installed-outside-its-own-checkout)
  — The MCP server cannot be installed outside its own checkout
- [R-35](#r-35--a-test-that-re-implements-the-code-under-test-asserts-nothing-about-it)
  — A test that re-implements the code under test asserts nothing about it
- [R-36](#r-36--a-document-cannot-disagree-with-a-function-it-is-never-compared-to)
  — A document cannot disagree with a function it is never compared to
- [R-37](#r-37--the-paid-service-is-sold-as-modefull-and-the-server-defaulted-to-quick)
  — The paid service is sold as `mode=full` and the server defaulted to `quick`
- [R-38](#r-38--the-llm-provider-was-wired-from-config-and-never-read)
  — The LLM provider was wired from config and never read
- [R-39](#r-39--the-okx-paid-endpoint-answered-400-to-every-buyer-before-verifying-anything)
  — The OKX paid endpoint answered 400 to every buyer before verifying anything
- [R-40](#r-40--one-signed-authorization-bought-unlimited-audits)
  — One signed authorization bought unlimited audits
- [R-42](#r-42--the-burned-nonce-record-lived-in-the-process-so-a-restart-re-opened-the-rail)
  — The burned-nonce record lived in the process, so a restart re-opened the rail
  (`R-41` is unused)

---

## How to read this file

Forty-one entries (`R-41` is unused; the numbering jumps). The convention for
writing down *what state an entry is in* is younger than most of the file, so
the state is either on a `**Status:**` line or in the entry's own prose. Four
values, and they mean different things:

- **Fixed `<date>`** — the mitigation is in the tree, and the entry says what
  would have to break for it to come back.
- **Accepted residual** — a decision, not a deferral. The entry says why the
  cost is worth paying and what would change the decision.
- **Open** — work not done, with the reason it is not in this batch and the
  trigger that would move it up.
- **Mitigated in `<version>`** — the older spelling of *Fixed*, used by the
  entries written during the `0.1.0-rc.*` work.

Twenty of the forty-one carry a `**Status:**` line as of 2026-10-08, after the
batch that closed R-26 and R-33. The other twenty-one predate the convention
and were not touched by that batch; their state is in the prose ("Still open",
"Mitigated by…"), or in the fact that nothing has been heard from them. Giving
all of them a Status line is a documentation cleanup listed in `BACKLOG.md`, not
a risk.

The reason this section exists: "which of these are still open?" was, until
now, only answerable by reading every entry end to end. Twenty-one of them say
nothing greppable about their state, so a reader who searched for "open" got a
partial answer that looked like a complete one.

One more reading rule, learned the hard way in this batch: **a reference to an
entry that does not exist is a defect, not a shorthand.** Fourteen references to
`R-42` lived across four documents while no such entry existed, so every reader
following one of them arrived at nothing. If you cite a risk, write it down in
the same change.

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
- `buildPaymentAdapter()` continues to refuse construction with an
  empty or malformed `recipientAddress` — it validates the address
  itself, not via `isConfigured()` (which no production path calls;
  corrected in R-39). The factory does not silently fall back to mock.
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
  `llm/prompts.ts` over `{ system: string; user: string }`. That file was
  deleted in R-38; the rule and the test case stay, because they are about
  the shape of a line rather than about a file.
- **Invisible / bidi characters** are looked for in every file, source
  included. A bidi override in source is Trojan Source, and that is a
  source-level problem, not a prose one.

Before the scoping, the self-audit flagged eleven files and ten were
false. After it, four findings, all in the deliberately planted
`fixtures/prompt-injection/README.md`.

**Closed 2026-10-06 (R-38).** This used to read: "the audit prompt built in
`llm/prompts.ts` carries repository metadata (name, description) and no file
content, so the only text from a repository that can actually reach a model
today is its GitHub description — and that is not scanned." There is no audit
prompt and no model: R-38 deleted the provider, the prompt builder and every
call site, so no repository text reaches a model at all. The one remaining
path is `get_repository_context`, which returns a repository's description to
an *MCP client* — that client's model, not ours, and outside this detector by
construction rather than by omission.

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

## R-13 — A gate on a large repository times out

**Severity:** Low
**Likelihood:** High for large repos
**Mitigation:** 30 s per-request timeout in the fetcher
(`packages/core/src/git/fetcher.ts`). The size limits that bound a gate are
published in `/api/v1/capabilities.limits`, which reports what this
deployment is configured with (`MAX_FILES`, `MAX_FILE_BYTES`,
`MAX_TOTAL_BYTES`, `RATE_LIMIT_PER_MINUTE`; the library defaults are 2000
files, 1 MiB per file, 50 MiB total). The gate is queued rather than
synchronous — see R-16
for the durability caveat. This entry used to be titled "Long-running `full`
audits time out", which named a mode dependence that does not exist: both
modes read the same archive and the same commit history, so the repository's
size is what bounds a gate, not the mode (R-30, D-035).

## R-14 — A Docker build that needs GitHub Releases to be reachable

**Severity:** Low
**Likelihood:** Confirmed on a network with no route to GitHub Releases
**Status:** Fixed 2026-10-06.

**What it was.** `better-sqlite3` ships a prebuilt binary and `pnpm install`
uses it when it can. `prebuild-install` looks for that binary on GitHub
Releases; when the download fails the package falls back to `node-gyp`, which
needs a toolchain. The `builder` stage is `node:22-alpine`, which ships no
compiler and no Python, so the fallback could not run and the build died:

    gyp ERR! find Python You need to install the latest version of Python.
    gyp ERR! stack Error: Could not find any Python installation to use

The message names the tool that is missing, not the download that failed, so
it reads as "this image lacks a build dependency" when the image was fine and
the network was not. Nothing had ever caught it: CI's runners reach GitHub
Releases at internal-network speed, so the fast path was the only path that
had ever run — and the deployment this is aimed at is a mainland-China VPS,
which is the network where it fails.

**Mitigation:** the `builder` stage installs the toolchain
(`apk add --no-cache python3 make g++`, ~300 MiB in a stage that is not part
of the final image). The fast path is unchanged; the slow path now succeeds
instead of dying. Verified by building the image on an x86_64 host with no
route to GitHub Releases: `prebuild-install` failed, `node-gyp rebuild` ran,
and the build completed.

**Also corrected here.** This entry used to read "Docker sandbox not available
in dev", and that was true when it was written. Docker 29.8.2 and Colima
0.10.3 are installed under `/usr/local` — just not on `PATH` — and the daemon
runs, so `pnpm docker:check` now performs its build half here instead of
skipping it. That is how this defect was found. `PROJECT_STATE.md` carries the
same correction.

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

**Accepted residual, by design:** `diffReports` keys on the fingerprint, so two
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

**Accepted residual, by design.** The `keyGenerator` is not changed. Preferring the
header is the correct behaviour behind a proxy, and dropping the loopback
entries would break local development, where there is no proxy and the client
genuinely is `127.0.0.1`. The fix belongs in deployment configuration, which is
where it now is — but a reviewer reading `rate-limit.ts` alone would not see
it, so the trap is recorded here rather than left to be rediscovered.

## R-25 — A healthy container can be serving an unmigrated database

**Severity:** High
**Likelihood:** Likely — every fresh deployment starts in this state
**Status:** Accepted residual — decided, not deferred. See below.

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

**Why it is accepted, and what would change it.** Mitigated on the compose
path by D-031 and documented in every platform section of
`docs/DEPLOYMENT.md`; the deliberate 200 is recorded as a rejected alternative
in D-031, so this is not a piece of unfinished work — it is a decision with a
known cost.

Nothing in the API distinguishes "I cannot serve" from "a probe failed", so no
status-code-only check can detect this class. Changing that is a larger
decision about what `/health` means, and it is a decision about the *product's*
public contract, not about this gate: a readiness endpoint that answers 503
until the schema is migrated is a different product promise from one that
always answers 200 and puts the truth in the body. **The trigger to revisit it
is the first non-compose deployment** — the first Railway, Render or plain-VPS
install that someone other than us operates. Until there is one, the operator
is the mitigation.

## R-26 — A check that never runs is indistinguishable from one that passes

**Severity:** High
**Likelihood:** Certain — it has already happened five times in this repository

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

**Status:** **Fixed 2026-10-08 for the `lint` instance; the rule now has a
mechanical tripwire.** Two more instances were found while closing this out,
both inside the release verifier, and both are the same shape:

1. **`verify:release` step 2 ran `pnpm -r lint`.** That is not the gate. Every
   package's `lint` script was `echo skip-package-lint`, so the recursive form
   exited 0 having inspected nothing — and the step was wrapped in
   `allowFail: true` inside a `try`/`catch` that printed
   `SKIPPED (no lint configured)`, so it could not fail either way. The
   release verifier reported OK for a lint it never ran. It now runs
   `pnpm lint`, unwrapped.
2. **`verify:release` step 5 ran `pnpm build` with `allowFail: true`.** A
   failed build printed OK and surfaced two steps later as "the api did not
   answer `/health`" — or not at all, when a `dist` from an earlier run was
   still on disk. The `allowFail` is gone.

The five `echo skip-package-lint` stubs are deleted, so `pnpm -r lint` now
fails loudly instead of succeeding silently. Deleting them alone would leave
the pattern available to the next person, so `scripts/lint.ts` gained a fourth
step, `no-noop-script`, which fails on **any** `package.json` script whose body
is a bare `echo`, `true`, `:` or `exit 0` — the rule is about the body, not the
name, because the name is what made `pnpm -r lint` look like the gate. It
carries the same `inspected === 0` guard as the other rules.

**Still open, and it is the general form.** The tripwire catches scripts that
are obviously empty. It cannot catch a script that runs something which
inspects nothing — `pnpm -r test` over a workspace whose `test` script is
`vitest run --passWithNoTests`, or a check whose glob matches no files. For
those the question remains a human one: *what runs this, and what would it take
for it to fail?* Five instances now, and the last two were in the release
verifier itself.

## R-27 — A check that can never pass is indistinguishable from one that found nothing

**Severity:** High
**Likelihood:** Certain — two instances in one session, both found by
auditing real repositories rather than by reading the code
**Status:** Accepted residual — the mitigation is a question, not a check.

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

**Accepted residual.** Nothing enforces rule 3 mechanically. It is a question a
reviewer has to ask, and the two instances here were both found by running
the tool against real repositories — not by reading it. That is an argument
for keeping the three-repository audit as a repeatable exercise rather than
a one-off.

## R-28 — A green tick over a capability the repository does not have

**Severity:** High
**Likelihood:** Certain — measured on a real self-audit
**Status:** Accepted residual — the test is the three-repository audit, run by
hand. See below.

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

**Accepted residual.** Nothing tests the *whole report* against a repository whose
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
**Status:** **Fixed — 2026-10-03.** The tiers are now separated by what the
report delivers. The prices in the body below are the ones measured when this
was found (0.02 / 0.10); the full audit is now 0.05. See the fix at the end.

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

**Fixed — 2026-10-03, on the owner's decision.** The decision was neither of
the two options written above in their original form. The tiering is now real,
but it is a *deliverable* boundary rather than an analysis boundary: **`full`
carries a deployment plan and a set of launch copy; `quick` carries neither.**
Everything used to judge the repository — the five dimension scores, the
blocker list, the documentation gaps, the security findings, the detected
stack, the recommended tasks, the launch checklist — is identical in both
tiers, and a test now pins that field by field.

**Why not option 1 as written.** Making `quick` skip analyzers would have made
the score a property of the price. Two buyers auditing the same commit would
get different `overall` values, and neither could tell which one described the
repository. For a launch-readiness gate that is worse than the over-delivery
it fixes: the product's one job is to be the same answer for everyone.
Measured consequence of the chosen design — `scores` is byte-identical across
the two tiers, which `tiers.test.ts` asserts.

**Why not option 2.** The owner wants a ladder, and the deployment plan and
launch copy are genuinely not derivable from the findings, so they cannot leak
through the free derived views (`/fix-plan`, `/diff`, `/quality` all read a
report and never re-scan; see `apps/api/src/routes/audit-derived.ts`). The
ladder is therefore real without reversing that invariant.

**The price is 0.05, not 0.10.** The 5x gap priced the analysis difference the
listing claimed. Once the difference is a deployment plan and a set of launch
copy, the honest multiple is 2.5x. Changed in `DEFAULT_PRICING`, the API
config default, `docker-compose.yml`, `env-check.ts`, `docs/API.md`,
`docs/MCP_CLIENT_SETUP.md`, `README_OKX.md` and the OKX registration
checklist — the registration is an operator action and the live listing still
says 0.10 until it is re-registered.

**How it was implemented.** `packages/core/src/report/tiers.ts` is the single
declaration: `FULL_ONLY_SECTIONS = ['deploymentPlan', 'launchCopy']`. Two
things are derived from it rather than written by hand — the report's new
`omittedSections` field, and the limitation sentence the report uses to
describe itself. Adding a section to the list updates both, which is what the
three scattered `if (mode === 'full')` sites could not do.

`Report.omittedSections` exists because **absent and empty are different
claims.** `deploymentPlan: []` on a quick report does not mean "this
repository has no deployment story"; it means the tier does not include one.
Before this field the two were indistinguishable, and `launchCopy` was already
being represented the bad way — a quick report emitted
`{oneSentencePitch: '', shortDescription: '', xPost: ''}`, three empty strings
standing in for an absence. The field defaults to `[]`, which is the true
answer for a report written before it existed.

`Report.reportVersion` moved to **1.2** as part of this change. The schema
change is additive and a stored 1.1 report still parses, but the *content* of a
quick report changed, and `reportVersion` is in the report cache key precisely
so a build does not serve a report written by an older one. (It is `1.3` today;
R-38 moved it again for its own reason, which that entry records.)

**The test that was missing.** R-30 noted that no test pinned the false
sentence. `tiers.test.ts` now pins four things: the declaration's four
combinations; that both tiers produce identical scores and identical finding
lists; that the report's declared omissions and its actually-empty sections
agree **in both directions** — the reverse direction is what catches a section
quietly emptied without being declared, which is how `launchCopy` was
represented; and that no limitation line matches `/skip|deeper|thinner/i`.

The second direction immediately found something. `builder.test.ts` had a test
named "produces a complete report even with no LLM configured" running as
`quick` with `includeLaunchCopy: true` and asserting the launch copy came out.
It was asserting exactly the behaviour this fix removes — the only test that
touched the tier boundary, and it asserted the wrong side of it.

**One thing this did not fix.** `includeLaunchCopy` remains a request field
whose scope is the `full` tier. It is a refinement, not a second tier knob —
a quick audit omits the launch copy whatever it says — and that scope is now
declared in `tiers.ts` next to the tier that owns it rather than left to be
inferred. It was not removed from the request because it is in the web form,
the MCP tool arguments, the cache key and the integration scripts, and a
breaking request-schema change is a separate decision with its own blast
radius. Recorded rather than folded in.



## R-31 — The typecheck gate does not cover `scripts/`

**Severity:** Medium
**Likelihood:** Certain — measured on 2026-10-02, re-measured 2026-10-08 (56,
then 55, then 56, then 52 — the number tracks how many scripts exist and how
carefully they are written, not progress)

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

**Mitigation, in part.** One of the fifty-six errors was not a config
artefact and is now fixed: the x402 `accepts[]` literal in
`okx-seller-smoke.ts` was missing `resource`, `description` and `mimeType`, and
the file declared the 402 body shape **twice** — once at the call site, once as
`renderMarkdown`'s parameter — so the two copies could and did disagree. It is
one `Audit402Body` interface now. The remaining errors are config and
`noUncheckedIndexedAccess` noise, and they are still a batch of their own: doing
half of it is worse than doing none, because moving `"type": "module"` into
`package.json` fixes ten errors and produces no new coverage, while adding the
tsconfig without moving the field produces ten new failures. The batch is: a
real `tsconfig.scripts.json`, `"type": "module"` moved to where it belongs, the
root `tsconfig.json` replaced with something that is a tsconfig, `zod`
resolvable from the root (or `env-check.ts` excluded with a reason), and the
`noUncheckedIndexedAccess` sites worked through one at a time.

**Re-measured 2026-10-08, and the number moves with the code.** A
`tsconfig.scripts.json` extending `tsconfig.base.json` with
`"include": ["scripts/**/*.ts", "scripts/**/*.mts"]` produced **56** errors, up
from the 51 measured on 2026-10-02 — five batches of new script code, none of it
type-checked. It has since been 55 (fixing the one real error below), 56 again
(this batch added `scripts/test-baseline.ts`, one more `import.meta`), and
**52**, because refactoring `verify-release.ts` into a single `spawnChild`
helper with optional chaining removed four `possibly null` sites. It is 52 now:

| count | what |
|---|---|
| 10 | `TS1470` — one per file, `import.meta` not allowed, "files which will build into CommonJS output". Fixed by `"type": "module"` in the root `package.json`; there are no `.js` files at the root or in `scripts/`, so nothing else changes. |
| 1 | `TS2307` — `env-check.ts` cannot resolve `zod`. It resolves at runtime (`pnpm env:check` runs in `verify:release` step 1), so this is a type-resolution difference, not a missing dependency — but it has to be understood before the gate can be added. |
| 1 | `TS2454` + 3 × `TS2322` in `compose-check.ts` — `parsed` used before being assigned, and `process.exit` used where a `void` callback is expected. Real, and in the compose gate. |
| 2 | `TS18047` — `proc.stdout` / `proc.stderr` possibly null, both in `okx-seller-smoke.ts`. Real. `verify-release.ts` used to contribute four; the `spawnChild` refactor removed them. |
| 30 | The `noUncheckedIndexedAccess` family: 15 × `TS2345` ("argument of type `string \| undefined`"), 11 × `TS18048`, 4 × `TS2532`. Two thirds are in `docs-facts.ts` (23) and `lint.ts` (13), and they are mostly `lines[i]` reads whose bounds the enclosing loop already guarantees. This is the only group where the honest answer might be to narrow the flag for `scripts/` in the new tsconfig, with the reason written down. |

Per file: `docs-facts.ts` 23, `lint.ts` 13, `compose-check.ts` 5,
`okx-seller-smoke.ts` 3, `audit-diff.ts` 2, `env-check.ts` 2, and one each in
`mcp-audit.ts`, `preflight-production.ts`, `test-baseline.ts`,
`verify-release.ts`.

**Status:** Open — deferred, with the batch above defined and the cost now
measured twice. It is deferred because it is *tooling*: the product does not
behave differently with the gate on, and the same week's budget bought the
payment-path work in R-42 and the two gate fixes in R-26 and R-33, both of
which changed what a green tick means. **The trigger to do it is the next time
a real error is found in `scripts/` by hand** — which is now twice: the
`api.kill` type error during R-42, and the `okx-seller-smoke.ts` mismatch
above.

Until then, `scripts/` has no static checking, and the `✓ tsc clean` line
should be read as covering five workspaces and nothing else.


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


## R-33 — The local lint gate checks downstream packages against a stale `dist`

**Severity:** Medium
**Likelihood:** Certain — measured on 2026-10-03

**What happens.** `apps/web` and `apps/api` import `@repopilot/core` through
its `exports` field, which points at `./dist`. So when their `tsc --noEmit`
runs, it reads `packages/core/dist/*.d.ts` **from disk** — not
`packages/core/src`. `scripts/lint.ts` runs `pnpm -r typecheck` as its first
step and never builds. Therefore, whenever core's source changes and its dist
is not rebuilt, the downstream typecheck validates the apps against the
**previous** contract and reports a clean tick.

**Measured.** Adding the required `Report.omittedSections` field to core made
`pnpm lint` print `✓ tsc clean` locally, while CI failed with

```
apps/web typecheck: src/test/fixtures.ts(31,9): error TS2741:
Property 'omittedSections' is missing
```

After running `pnpm --filter "./packages/*" build` first, the *same* local
command failed — and failed in **two** files. The second,
`apps/api/src/tests/api.integration.test.ts`, had been hidden by the same
staleness: fixing only the one CI reported would have produced a second red
run. One stale artefact masked two independent contract violations.

**Why CI and the local gate disagree.** CI builds before linting, and its
comment says why (`.github/workflows/ci.yml:118-127`):

> It has to run before lint, because the root lint also type-checks every package.

The order is load-bearing and documented in one place and enforced in only
that one. Nothing in `scripts/lint.ts` states the same requirement, so the
local gate is the weaker of the two and does not say so.

**Why this is Medium and not Low.** It is D-034 again, in the gate the team
runs most: **the scope of the check is part of the check.** The `✓ tsc clean`
line silently means "the source of five workspaces, plus the last build of
their dependencies", and no reader can tell which build that was.

It is worse than R-31 in one specific way. R-31 is a directory nothing looks
at — a green tick over an unexamined area. This is a green tick that is
**actively wrong about files it does read**, and it fails precisely when a
cross-package contract changes, which is the change most likely to break a
consumer. The gate is at its weakest exactly where it matters most.

**How it was found.** Not by a check. By pushing R-30 and reading a red CI run
that the local gate had already approved. This is the second time a CI-only
failure has been traced to a local gate that was not the gate the reader
thought it was.

**Status:** **Fixed 2026-10-08.** `scripts/lint.ts` step 1 is now "packages +
`tsc --noEmit`" rather than "`tsc --noEmit`": before it type-checks, it
compares each workspace package's newest `src` mtime against its newest `dist`
mtime, and builds the ones whose `dist` is older — in the same step, in the
same process, printing which packages it rebuilt. CI's order (`build` then
`lint`, `.github/workflows/ci.yml:127`) is unaffected: when the dists are
current the comparison costs one `stat` per file and prints a tick.

**The build is conditional, and that is deliberate.** A `lint` command that
rewrites `dist` on every run is a `lint` command that surprises people, and an
unconditional build would also have hidden the defect: the gate would have
been *silently* correct instead of *visibly* doing something about a stale
tree.

**How the fix was verified.** Not by reading it. A core public type was
changed without rebuilding, and `pnpm lint` was run in both states:

| state | before the fix | after the fix |
|---|---|---|
| `packages/core/dist` stale, one contract violation | `✓ tsc clean` | `! dist is older than src in packages/core — building before the typecheck` → `✓ rebuilt 1 package(s)` → **the real error, from `apps/api`** |

The fix is also the reason the second violation is no longer hidden: the
typecheck now runs against the source it was written against, so it reports
every consumer that disagrees instead of only the ones whose `dist` happened
to be rebuilt.

**What is still true.** `pnpm typecheck` — the standalone script, which
`ci.yml:137` runs after `lint` — does not build first, and neither does a bare
`tsc -p apps/api/tsconfig.json`. Both are still capable of reading a stale
`dist`; the difference is that they are no longer the gate, and the gate is
what a reader trusts. Anyone running them by hand after a change to core's
public types should build first:

```
pnpm --filter "./packages/*" build && pnpm -r typecheck
```

**Related.** R-31 (a gate whose scope is narrower than it looks), D-034 (the
scope of a check is part of the check), R-26 (a check that never runs).

## R-34 — The MCP server cannot be installed outside its own checkout

**Severity:** Medium
**Likelihood:** Certain — measured on 2026-10-04

**What happens.** `packages/mcp-server/package.json` advertises a binary
(`repopilot-mcp`) and is `private: true`, and two of its dependencies are
declared as `workspace:*`. So there are exactly two ways to obtain it, and
one of them lies:

- `npm i -g ./packages/mcp-server` — **reports success and does not
  install anything**. npm links a local directory instead of copying it, so
  `lib/node_modules/@repopilot/mcp-server` is a symlink back into this
  checkout and every import resolves through the checkout's own
  `node_modules`. It exits 0 and prints `added 1 package in 4s`.
- `npm pack` then install that tarball — **fails**, because npm rejects the
  protocol outside a workspace: `EUNSUPPORTEDPROTOCOL: Unsupported URL Type
  "workspace:": workspace:*`.

**Measured.** `registry.npmjs.org/@repopilot%2Fmcp-server` answers 404. A
root `workspaces` field is not a fix: a throwaway workspace with one proved
npm leaves `workspace:*` untouched on `pack`, and pnpm prints
`The "workspaces" field in package.json is not supported by pnpm` for the
same field. The tarball also carried **114 files** — `src/`, `tsconfig.json`
and 76 `vitest.config.ts.timestamp-*.mjs` scratch files — because no package
declared `files`. That part is now fixed: `files: ["dist", "!dist/**/*.test.*"]`
takes it to 21 files, 29.2 kB.

**Why this is Medium and not Low.** The failure is **silent**. Both the
installer's exit code and its output say the install worked, and the
`repopilot-mcp` command it produces really does run — on this machine, for
as long as the checkout stays put. A reader has no signal that they have
taken a dependency on a directory rather than installed a package, and the
first symptom is a broken command on someone else's machine.

**How it was found.** By running the generated shim rather than reading the
manifest. The manifest was read too, but reading it is what produced the
*false* conclusion "private, so it cannot be published, but a global
install of the local path is fine".

**Mitigation.** The tarball is clean (`files` on all three library
packages). `docs/MCP_CLIENT_SETUP.md` now states that the package is not on
npm, that `npm i -g` links rather than installs, and what publishing would
require. Whether to publish — and therefore whether to ship the three
packages together under a scope or bundle the two workspace packages into
this one's `dist` — is a distribution decision, not a defect, and is
deliberately left open.


## R-35 — A test that re-implements the code under test asserts nothing about it

**Severity:** Medium
**Likelihood:** Certain — measured on 2026-10-04

**What happens.** `free-check.test.ts` opened with a `describe('FreeCheck
heuristics')` block whose cases built their own `README_NAMES` set, their own
`LICENSE_NAMES` and `ENV_EXAMPLE_NAMES` sets, their own `LOCKFILE_PATTERNS`
array, their own CI regexes, and their own `entries.find(...)` — inside the
test body — and then asserted on those. Every assertion was about code
written in the test file. The module they were named after was not involved.

The file did contain two cases that reached the real `FreeCheckRunner`, and
they are the reason the block looked like coverage: `rejects a non-https URL`
and `rejects an off-allowlist host`. Both are answered by `parseRepoUrl`,
which runs before the runner touches anything, so they exercised the URL
parser and nothing else. Five green tests, four of them about a copy.

**Measured.** With `LOCKFILE_PATTERNS` emptied in `packages/core/src/
free-check.ts`, the old file passed **5 of 5** — the same 5 it passed before.
The rules that decide whether a repository has a lockfile could have been
deleted outright and the suite would have said the entry point was fine.

**Why it mattered here more than elsewhere.** This was not an obscure module.
It is `POST /api/v1/free-check` — the no-payment tier the marketplace listing
describes as *"the entry point used by other AI agents to triage a repo before
deciding to pay for a full audit"*. It is the first thing a prospective buyer
runs, it is the cheapest thing to break, and it was the least verified part of
the product. A funnel entry that reports `has-readme: FAIL` on a repository
that has a README costs a sale before the paid tier is ever reached.

**How it was found.** Not by a check, and not by reading the test file —
reading it produces the impression of a well-covered module, because the
constants being rebuilt look like fixtures. It was found by trying to *use*
the runner from a second caller: adding `free_check` to the MCP server needed
a way to drive the runner without the network, and there was none. The
runner built `GitHubFetcher` and `MetadataAnalyzer` inline, so no test could
substitute them. The absent seam is what led back to the tests that had been
written to route around it.

**The rule.** A test asserts something about the product only if it reaches
product code. Re-declaring a constant inside a test body converts a real
assertion into a tautology, and the failure is invisible in review because the
test reads as thorough — it names the right things and covers the right
cases, just against the wrong code. The question to ask of any test is the
one R-26 asks of any check: **what would have to change in the product for
this to go red?** If the answer is "nothing in the product", it is not a test.

**Mitigation.** `FreeCheckRunner` takes a `source` (`FreeCheckSource`:
`metadata` + `tree`), defaulted to the real GitHub source, and
`free-check.test.ts` drives the shipped runner through it — 26 cases over the
five checks, the score arithmetic, the evidence strings, the branch-resolution
order, the metadata-failure fallback and the stack detection. Each new
assertion was mutation-tested before landing: emptying `LOCKFILE_PATTERNS`
fails 8 cases, reading a fixed `main` instead of the branch the metadata
reports fails 1, returning the first match instead of the shortest path fails
1. That last mutation **survived the first version of the test** — the fixture
listed `README.md` before `docs/README.md`, so first-match and shortest-match
gave the same answer and the case was green for a reason it did not state.
The fixture order was changed until the mutation died, which is the only
evidence that a case discriminates between the two rules.

**Residual risk.** Only this module was re-examined. The same shape — a test
that rebuilds the logic it means to check — is invisible to every existing
gate, and nothing in CI looks for it. `pnpm -r test` counts cases, not
whether they can fail.

**Related.** R-26 (a check that never runs is indistinguishable from one that
passes), R-27 (a check that can never pass), D-034 (the scope of a check is
part of the check).

---

## R-36 — A document cannot disagree with a function it is never compared to

**Severity:** High **Likelihood:** High (it had already happened)

**The defect.** `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §5.5 is the registration
authority: it is the 402 challenge the ASP is registered with, and the shape a
marketplace reviewer compares the live service against. It had drifted from
`OkxPaymentAdapter.createChallenge` in four independent ways:

| Field | §5.5 said | The adapter emitted |
| --- | --- | --- |
| `resource` | `https://<public-domain>/api/v1/audits` | `https://repopilot/api/v1/audits` — hard-coded, and not a host that exists |
| `description` | `RepoPilot Quick Audit` | `RepoPilot quick audit` — the internal `mode` value, lower-cased |
| `maxTimeoutSeconds` | `60` | `300`, matching the challenge's own 5-minute `expiresAt` |
| `asset` | absent | present — the USDT contract address |

**Why it matters more than a stale table.** Three of the four are read by the
buyer. `resource` is the field an x402 client shows as *the thing being paid
for*; `description` is the tier name on the payment prompt, and it named the
tier differently from the listing that sold it; `maxTimeoutSeconds` is the
window the buyer's wallet is told it has to sign in. The `resource` value was
the worst of the four because it looked plausible — `https://repopilot/…` is a
syntactically valid https URL with no TLD, so nothing rejects it and nobody
reads it twice.

**How it was found.** Not by a check. It was found by writing one. The same
week, the same question asked of the *price* had already found a worse instance
of the same defect: `PRICE_FULL_AUDIT` was stated as `0.10` in `.env.example`
and `0.05` in every other place that stated it, and
`docs/EXTERNAL_ACTIONS.md` told the operator to set the price from
`.env.example` — so the runbook pointed at the one wrong copy. In `okx` mode
the 402 amount comes from that variable, so a buyer reading `0.05` on the
listing would sign an EIP-3009 authorization for `0.05` and be challenged for
`0.10`: the first real sale fails at the payment step. That one now has a
check that compares every statement of the price (`readPriceStatements()` in
`scripts/docs-facts.ts`) — twelve of them while there were two tiers, six now
that there is one (D-037). The 402 shape was the
next question, and its answer was "nothing compares them".

**The rule.** For any payload an external party reads — a price, a challenge, a
listing — the document and the producer must be *compared*, not both maintained.
A second hand-written copy of a machine-generated value is a copy that can only
be wrong.

**Mitigation.** `okx-adapter.test.ts` reads §5.5 out of the snapshot, extracts
the `accepts[0]` object, and asserts the field set and every
environment-independent value against the challenge the adapter actually
builds. Injections were run against it and all are caught: changing
`maxTimeoutSeconds` to `60`, rewording the `description`, deleting `asset`,
renaming `mimeType`, and changing `maxAmountRequired`. Two
code-side injections (hard-coding the `description`, hard-coding the network)
are caught as well, so the check is not one-directional. D-037 removed the
second service, so the two injections that targeted a `full`-tier description
no longer exist — there is one description, and the test asserts it for both
modes.

`resource` became `OKX_PAYMENT_RESOURCE_URL`, and the unconfigured value became
`https://repopilot.invalid/api/v1/audits`. `.invalid` is reserved by RFC 2606 and
can never resolve, so "this is a placeholder" is a property of the string rather
than something a reader has to know. `validateProductionConfig` refuses to boot
in production with `PAYMENT_MODE=okx` and no resource URL, so the placeholder
cannot reach a buyer.

**Residual risk.** Whether `asset` belongs in `accepts[]` is **not confirmed**.
§1.4's field list omits it and the adapter emits it; the `exact` scheme needs the
token contract, so either the snapshot's list is incomplete or the field is
extra. `validate-listing` is the only thing that can settle it and it needs a
registered ASP. Until then the test pins the two together, which means the
question cannot be answered by accident — someone has to decide and change both.

**Related.** R-26 (a check that never runs), R-27 (a check that can never pass),
R-28 (a green tick over a capability the repository does not have), D-033 (a
document states no fact it can derive), D-034 (the scope of a check is part of
the check).

---

## R-37 — The paid service is sold as `mode=full` and the server defaulted to `quick`

**Severity:** Medium **Likelihood:** Medium
**Status:** **Fixed 2026-10-05.** The default is `full`; `quick` is an explicit
opt-out. Pinned by `packages/core/src/schemas/inputs.test.ts`.

**The defect.** With one price (D-037), the registration copy names `mode=full`
because the service description promises the deployment plan and the launch
copy. `CreateAuditInputSchema` in `packages/core/src/schemas/inputs.ts` defaulted
`mode` to `quick`, which omits both. The promise therefore held only if the
caller read the description and sent the field; a caller that omitted it paid
the same 1 USDT and received less.

**Why it was deferred rather than fixed with the price change.** Defaulting to
`full` is one line, but it silently changes the report every existing caller
gets — including `apps/web`'s form default and both MCP tools' declared default
— and a behaviour change of that shape deserved its own decision rather than
riding along with a price change. D-037 declined to smuggle it in; the decision
was taken separately on 2026-10-05.

**Why it was recorded rather than left implicit.** It has the same shape as
R-36: a promise on one side and a producer on the other, with nothing comparing
them. The difference is that these two *can* be reconciled by a sentence,
because the caller is an AI agent reading the description rather than a buyer
reading a listing.

**What the fix touched.** Four declarations of the default, and nothing else:
`CreateAuditInputSchema`, the two MCP tool schemas (`audit_github_repository`,
`reaudit_repository`), and `apps/web`'s form state. §5.4 of
`docs/OKX_REQUIREMENTS_SNAPSHOT.md`, `docs/API.md`'s request table and `README`
now state `full` as the default.

**The check, and why it is not optional.** Nothing else in the suite read the
default, so reverting the line would have been silent — which is the whole
failure mode. `inputs.test.ts` asserts the default is `full` and that an
explicit `quick` still parses. A one-line change that nothing observes is a
one-line change that comes back.

**Related.** R-36 (a document cannot disagree with a function it is never
compared to), D-035 (a tier changes what a report carries), D-037 (one price,
one product).

---

## R-38 — The LLM provider was wired from config and never read

**Severity:** Low **Likelihood:** Confirmed **Status:** Fixed 2026-10-06

**The defect.** `apps/api/src/server.ts` built a provider from `LLM_PROVIDER`
/ `LLM_API_KEY` / `LLM_MODEL` (`defaultLlmProvider()`) and passed it into
`buildApp` as `AppDeps.llmProvider` at both call sites. Nothing read it.
Measured 2026-10-05: searching the whole repository for the identifier outside
the declaration and those two call sites returned no hits, and the only
LLM-shaped values that reached the pipeline were the literals
`llmProviderName` / `llmProviderConfigured` written in three places —
`audit-worker.ts`, `job-service.ts` and the MCP server, which disagreed with
each other (`'noop'` in two, `'none'` in the third). `PipelineInput` carried
those two strings and no provider object, so the pipeline had no way to call
one.

**Why it matters.** The failure mode is an operator spending money and
believing it worked. `docs/EXTERNAL_ACTIONS.md` §8 told them to set four env
vars, restart, and expect "a noticeably richer `summary` and `launchCopy`" on
the first gate. None of that happened: `ReportBuilder.build()` fills both
fields from `templateSummary()` / `templateLaunchCopy()`. It was worse than a
no-op — `scripts/env-check.ts` *errored* when `LLM_PROVIDER=openai-compatible`
and the key, base URL or model was missing, so `preflight:production` refused
to pass without a credential for a capability that did nothing.

**What the fix touched.** The whole surface, deleted rather than annotated:

- `packages/core/src/llm/` — `provider.ts`, `noop-provider.ts`,
  `openai-compatible-provider.ts`, `prompts.ts`, and the `./llm` subpath export
  in `packages/core/package.json`. `templates.ts` moved to
  `packages/core/src/report/templates.ts`, which is what it always was: the
  report builder's deterministic copy.
- `polishFixPlanSet()`, `PolishOptions` and the `llmEnhanced` field. The
  function had one caller — its own `describe` block — and the field's only
  possible value was `false`, so `docs/API.md` documented a boolean that could
  never be true.
- `ReportBuilderInput.llm`, which the builder never read. Its presence is what
  made `provider.ts`'s header ("the report builder falls back to deterministic
  templates") false.
- `defaultLlmProvider()`, `AppDeps.llmProvider`, the four `LLM_*` config
  variables, their `.env.example` block, and the three blocks in
  `scripts/env-check.ts`.
- `PipelineInput.llmProviderName` / `llmProviderConfigured` and the three
  literal producers.
- `'analyzers.llm': 'optional; disabled by default'` from
  `buildProvenance()`, which put a claim about a component into a map whose
  every other key names an analyzer that runs, in every report every buyer
  receives. A key left a map consumers read, so `REPORT_VERSION` moved
  1.2 → 1.3; 1.2 reports still parse (`SUPPORTED_REPORT_VERSIONS`).

**Why deleted rather than wired.** Wiring it changes the content of every
report, the `analyzerProvenance` a buyer can read, the cache key, and the cost
of every gate — while the product is sold at one USDT with "no LLM in the
scoring" as part of its pitch. That is a product decision, and the answer this
repository already gave was "no LLM": the report has never contained one. What
was left was a documented *option* to add one that could not be exercised,
`@repopilot/core` is `private: true` and not independently installable, so
there was no library consumer to justify keeping it either. The upgrade path is
below and in the git history.

**The check.** Two, and both were verified by mutation rather than assumed:

- `packages/core/src/schemas/report-version.test.ts` writes 1.3, parses 1.3,
  still parses 1.2 and 1.1, and refuses a version it does not know.
- `packages/core/src/fixplan/builder.test.ts` lost four cases with the function
  they tested. That is the honest outcome: they were the reason
  `polishFixPlanSet()` looked alive.

`scripts/env-check.ts` keeps `LLM_API_KEY` in `KNOWN_SECRET_KEYS` even though
it is no longer a RepoPilot variable. That list is redaction, not
configuration: an operator who set the key months ago still has it in their
shell, and removing the entry would print it.

**Upgrade path.** Thread a provider into `PipelineInput`, call it for
`'summary'` and `'launch_copy'` in the builder, record the provider name in
`analyzerProvenance` from the actual provider rather than from a literal, and
add a test that a configured provider changes the report and a failing one
falls back to the template. Do it as a product change with a `REPORT_VERSION`
bump, not as an env var.

**Related.** R-26 (a check that never runs), R-28 (a green tick over a
capability the repository does not have), R-31 (a gate that does not cover
what it claims), R-35 (a test that re-implements the code under test asserts
nothing about it — `polishFixPlanSet`'s four cases were the closest thing this
repository had to a green light on the LLM surface), and D-009.

---

## R-39 — The OKX paid endpoint answered 400 to every buyer before verifying anything

**Severity:** Critical **Likelihood:** Confirmed **Status:** Fixed 2026-10-06

**The defect.** `apps/api/src/routes/audits.ts` carried its own parser for the
`X-PAYMENT` header (`extractPaymentId`) and looked for `paymentId` at the **top
level** of the envelope. `packages/okx-adapter/src/okx-adapter.ts` carried a
second parser (`parsePaymentHeader`) whose declared shape
(`ParsedPaymentHeader`) puts it at **`payload.paymentId`**. The route ran first,
found nothing, and answered

```
400 { "error": { "code": "INVALID_INPUT", "message": "X-PAYMENT header is malformed" } }
```

before `verifyPayment` was ever called. In `PAYMENT_MODE=okx` the paid endpoint
could not accept a payment from any buyer following the documented flow.

**Measured, not inferred.** `extractPaymentId` copied verbatim out of the route
and run against an envelope in the adapter's declared shape:

```
envelope paymentId is at payload.paymentId = okx_11111111-2222-3333-4444-555555555555
extractPaymentId(adapterShaped, "okx") = null
extractPaymentId(topLevelShaped,  "okx") = "okx_11111111-2222-3333-4444-555555555555"
```

`null` is the 400. The signature is irrelevant to this defect — it never got
that far — which is why the check above needs no signing key.

**Why no test caught it.** Every payment test in the repository runs in
`PAYMENT_MODE=mock`, where the header is the plain string `mock:<paymentId>` and
both parsers agree because there is nothing to parse. `okx-adapter.test.ts`
called `verifyPayment` only with `null` and with `'not-base64-!!'` — no test ever
built an envelope, so the success path a paying buyer takes had **zero**
coverage. The 402-challenge shape was well covered (pinned against
`docs/OKX_REQUIREMENTS_SNAPSHOT.md` §5.5); the step after it was not covered at
all. Coverage of the first half of a handshake is what made the second half look
tested.

**Why it matters.** This is the only rail that takes real money, and it was
unshippable. The mock rail is what CI exercises and what `README.md`'s quickstart
uses, so nothing in the repository's own loop could have surfaced it.

**Root cause, and why the fix is where it is.** The `X-PAYMENT` envelope is this
adapter's wire format, and the route held a **second copy of that knowledge**.
The copy is gone: `PaymentAdapter.readPaymentId(rawHeader)` is now the single
owner, the route calls it, and `extractPaymentId` is deleted. `verifyPayment`
takes the id as an argument, so before this the route had to parse the header to
produce it — two readers of one format, in two packages, with nothing comparing
them. R-36 is the same shape one level up (a document and a function, never
compared); this is two functions.

**The part that is still unknown, stated rather than papered over.** Where
`paymentId` sits in the real `onchainos` envelope is **not documented anywhere
in this repository**: `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §1.4 says only "the
base64-encoded receipt" and `README_OKX.md` says only "a base64-encoded JSON
envelope". The two in-repo parsers disagreed and neither had evidence behind it.
So `readPaymentId` reads **both** placements, `okx-adapter.test.ts` pins both,
and the comment there says which line to delete once the real envelope is
observed. Accepting both is not speculative flexibility — it is the honest
response to a format with no in-repo authority, and it is confined to the one
component that owns the format.

**Also deleted in the same pass** (same class — declared, never true):

- `OkxPaymentAdapterOptions.rpcUrl`. Nothing constructed it with a value and
  nothing read it; its comment claimed it was "used to read the on-chain
  `authorizationUsed` flag". `docs/OKX_LIVE_INTEGRATION.md` §2.1 describes that
  RPC URL as an *optional seller-side* input and `ROADMAP.md` lists the on-chain
  check as still-to-do, so the code and two of its documents agreed that it was
  never implemented — and `okx-adapter.ts`'s own header plus
  `docs/ARCHITECTURE.md` both said it was. The two that were wrong are fixed.
- `PaymentReceipt.txHash` / `.blockNumber`. Written by both adapters, read by
  nothing, and untrue in both: on the OKX path they were **unverified values the
  buyer put in the envelope**, echoed back in the same field shape as an
  observation; on the mock path `blockNumber` was `Math.floor(Date.now()/1000)`
  — a Unix timestamp in a field named after a block. They surfaced only in an
  undocumented `payment` object on the 402 body.
- `PaymentReceipt.status`'s `'settling'` and `'cancelled'`. No adapter produced
  either. `'settling'` named a step this service does not perform.
- `PaymentAdapter.getReceipt()`. Two implementations, zero callers.
- `verifyEip3009`'s `network` parameter. Passed at the one call site,
  never destructured.
- `docs/ARCHITECTURE.md`'s interface list named `refund` and `getReceipt`;
  `refund` **never existed in any adapter**.
- `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §1.4 and §2 described `OKXAdapter` as
  *raising* `STUB BOUNDARY: …`, in two different wordings. **Neither string
  exists anywhere in the codebase**; `createChallenge` and `verifyPayment` are
  fully implemented and neither throws.
- `docs/OKX_LIVE_INTEGRATION.md` §2.2 said `OKX_AGENT_KEY` /
  `OKX_AGENT_SECRET` "appear only in a JSDoc comment in
  `packages/okx-adapter/src/okx-adapter.ts:46`" and proposed deleting it. **No
  such comment exists in any revision of that file** (checked with
  `git show HEAD:…`). They appear only in `scripts/env-check.ts`'s
  `KNOWN_SECRET_KEYS`, whose job is redaction, not configuration.
- `README_OKX.md` §5 step 5 said the success response body "is the full `Report`
  JSON". The endpoint answers `202` with `statusUrl` / `pollAfterMs`.
- `scripts/env-check.ts` range-checked `ANALYSIS_TIMEOUT_MS`, a variable no
  module reads and that `.env.example` does not list. It gave operators a green
  tick over a setting the service ignores.

**What now pins it.** `apps/api/src/tests/okx-payment.test.ts` — the first test
in the repository to run the paid route in `PAYMENT_MODE=okx` at all. A
well-formed envelope must answer `402 PAYMENT_NOT_SETTLED` (the envelope was
parsed and the signature rejected) and specifically **not** `400`; a malformed
one must still answer `400`, because "unreadable" and "unverified" are different
answers. It needs no signing key, because the defect was upstream of the
signature. `okx-adapter.test.ts` covers the other half with real signatures:
`privateKeyToAccount().signTypedData()` against the xlayer USDT domain, asserting
`completed` for a correct authorization and `failed` for a wrong amount and for
a wrong payee. `mock-adapter.test.ts` covers the mock half of `readPaymentId`.

**Recorded, not fixed here — the expiry gap.** `verifyEip3009` checks `to`,
`value` and the signature. It does **not** compare the signed `validAfter` /
`validBefore` against the clock, so an authorization that has already expired
still verifies and still yields `completed`. Left open in this batch on purpose:
what the service should *do* with an expired-but-valid authorization looked like
a product question, because nothing settles an authorization here. **That
judgement was wrong, and it is corrected in R-40** — the answer does not depend
on settlement at all. Accepting an expired authorization hands over an audit that
can never be collected, whatever the seller does later, so the window is a
correctness check and not a policy choice. Fixed in R-40, together with the
larger hole it was hiding behind.

**Related.** R-36 (a document and a function, never compared — this is the same
defect with two functions), R-38 (a declared capability with no consumer, the
same class as `rpcUrl` / `txHash` / `'settling'` / `getReceipt`), R-28 (a green
tick over a capability the repository does not have — `env-check.ts` range-
checking `ANALYSIS_TIMEOUT_MS` is exactly that), R-35 (a test that asserts
nothing about the code under test — `verifyPayment`'s success path had no test at
all, which is the limiting case), and R-40 (the same signed message verified
against every future challenge, because the two checks that make one
authorization worth one payment were both missing).

---

## R-40 — One signed authorization bought unlimited audits

**Severity:** Critical
**Likelihood:** Certain for anyone who tries (the buyer composes the header)
**Status:** Fixed 2026-10-06 (R-40), durability gap closed the same day (R-42)

**What it was.** `OkxPaymentAdapter.verifyPayment` verified the buyer's EIP-3009
authorization and returned `completed` — but the EIP-712 message it verifies is
`(from, to, value, validAfter, validBefore, nonce)`, which **does not contain the
`paymentId`**. The `paymentId` is chosen by this service and arrives in the same
JSON envelope as a plain field, so a buyer can take a signature they already hold
and point it at a different challenge by rewriting one string.

Every POST mints a fresh `paymentId` (D-011), so there is always a new challenge
to point at. The two checks that would each have stopped this were both missing:

- the signed `nonce` was never recorded, so it was not single-use;
- the signed `validAfter` / `validBefore` window was never compared to a clock,
  so an authorization that expired last year verified as paid.

**Measured, not inferred.** Four new tests were run against the pre-fix source
before the fix was written; four failed:

```
FAIL  OkxPaymentAdapter > verify never throws on an envelope that parses but is not an authorization
FAIL  one signed authorization buys one audit > refuses a signature that has already bought an audit
FAIL  one signed authorization buys one audit > refuses an authorization whose window has already closed
FAIL  one signed authorization buys one audit > refuses an authorization that is not valid yet
      Tests  4 failed | 23 passed (27)
```

The replay case is the one that matters: `createChallenge` → sign → `completed`,
then a **second** `createChallenge` and the **same signature** with only
`payload.paymentId` rewritten → `completed` again. The helper that does the
rewrite is three lines in the test file, because the header is base64 of plain
JSON.

**Why it matters.** This is the paid gate. It is the only thing between a buyer
and a 1 USDT audit, and it was handing out the audit for one signature. The
previous batch (R-39) made this rail *reachable*; this one makes it *paid*. R-39
could not have found it: a defect that only shows up on the **second** use of a
credential needs a test that uses it twice, and the first test that ever ran this
route ran it once.

**Why it is not "an on-chain problem".** This adapter deliberately does not read
the chain (see the boundary at the top of `okx-adapter.ts`), so it cannot consult
EIP-3009's `authorizationUsed[from][nonce]` mapping. That read is precisely what
makes one authorization worth one transfer on chain, and **this adapter is
standing in for it** — so it has to perform the equivalent check itself rather
than assume a layer that is not there. The whole class is the same as R-38's: a
capability that is *declared* (the code says the authorization is verified) with
no consumer of the invariant it implies.

**The fix, and why it is in the adapter.**

- `spentNonces: Set<string>`, keyed `` `${from}:${nonce}` `` — the same key the
  on-chain mapping uses. Burned **after** the signature verifies, so a caller
  cannot consume a nonce it cannot sign for.
- `verifyEip3009` now also checks `validAfter <= now < validBefore`
  (`validBefore` exclusive, matching EIP-3009's `block.timestamp < validBefore`)
  and returns the nonce key instead of a boolean — one parse, and a caller
  cannot forget which nonce it just accepted.
- `verifyEip3009` is now **total**: its whole body is inside the `try`. It used
  to do `a.to.toLowerCase()` and `BigInt(a.value)` *outside* the `try`, on a
  buyer-supplied object that `parsePaymentHeader` only checks at the top level
  (`signature` is a string, `payload` exists). An envelope with
  `payload: {}` — valid base64, valid JSON, no `authorization` — produced a
  `TypeError` and a **500** from a route whose contract is "unverified payment".
  `payload.authorization` is now typed as `unknown`-per-field
  (`RawAuthorization`) rather than `Hex`/`string`, so the `typeof` narrowing is
  real to the compiler instead of being a guard it believes cannot fire.
- `verifyPayment` consults the receipt cache **before** the nonce, so the
  legitimate retry the design depends on — same `X-PAYMENT`, same `paymentId`,
  D-011 — is not mistaken for a replay. Pinned by
  `keeps a retry of the same paymentId idempotent`.

**The durability gap, and how it closed.** The burn was an in-process `Set`, so
a restart or a second replica forgot it and replay worked again. That was
recorded here rather than implied away — which is why the wording above was
"replay works only across a restart" and not "replay is impossible", and why
`forgets which nonces it has seen when the process restarts` existed as a **test
that asserted the limitation** rather than a comment hoping nobody checked.

R-42 closed it. The burn is now a call on an injected `NonceStore`, and
`apps/api` injects `NonceRepository` — a `burned_nonces` table whose primary key
is the `(from, nonce)` pair, so the insert *is* the single-use check.
`DECISIONS.md` D-040 records the reasoning, including why the burn does not need
to share a transaction with the job it pays for, and what the buyer gives up in
exchange for at-most-once. That test was replaced by
`refuses a replay after a restart, when both processes share the store`, which
asserts the property instead of the limitation; the old behaviour survives as
`still forgets when no store is injected`, which pins the default that
`packages/mcp-server` relies on.

**One finding from closing it, worth more than the fix.** `Promise.all` over a
cold `pg.Pool` does not race. The first version of the Postgres concurrency case
issued ten simultaneous burns and passed against a deliberately racy
`SELECT`-then-`INSERT` implementation, 3/3 — the pool establishes connections as
the event loop reaches them, and each new connection's queued work finishes
before the next connection is ready, so the ten calls run in sequence. Warming
the pool first makes it a real race, and the racy implementation then fails 3/3
on `duplicate key value violates unique constraint "burned_nonces_pkey"`. A
concurrency test that has never been shown to fail is not evidence of anything.

**What now pins it.** `packages/okx-adapter/src/okx-adapter.test.ts`:
`refuses a signature that has already bought an audit`,
`refuses an authorization whose window has already closed`,
`refuses an authorization that is not valid yet`,
`still accepts a second, independently signed authorization` (the guard keys on
the authorization, not the buyer),
`keeps a retry of the same paymentId idempotent`,
`refuses a replay after a restart, when both processes share the store` (R-42),
`still forgets when no store is injected — which is why the API injects one`
(R-42, pinning the default), and
`does not turn a store outage into a cached "failed"` (R-42).

**Mutation-checked.** Removing the `spentNonces` guard fails exactly
`refuses a signature that has already bought an audit`; removing the two window
comparisons fails exactly the two window tests. Both mutations restored
byte-identical (`sha256 0ba6757…`). A third mutation — deleting the `typeof`
guard — **survived**, and that is worth recording rather than hiding: the
`typeof` guard is not what makes the verifier total, the `try` is. It is
load-bearing for the *compiler* (without it, `a.from` is `unknown` and the
message construction does not type-check), and the runtime totality is pinned by
the pre-fix run above, not by that mutation.

**Related.** R-39 (the same rail, one layer up: the route could not accept a
payment at all), R-38 (a declared capability with no consumer), D-011 (each POST
mints a fresh `paymentId` — which is *why* there is always a new challenge to
point a stale signature at).

## R-42 — The burned-nonce record lived in the process, so a restart re-opened the rail

**Severity:** High
**Likelihood:** Certain — it happened on every restart and on every second
replica, which is the normal state of a deployed service
**Status:** **Fixed 2026-10-08 (R-40's follow-up).** See below.

**What happens.** R-40 made an EIP-3009 authorization single-use: the first
successful verification burns the `(from, nonce)` pair so a replayed signature
is refused. The record of what had been burned was a `Set` inside
`OkxPaymentAdapter` — which means it was a record of what *that process* had
burned. Two consequences, both silent:

1. **A restart forgets everything.** `docker compose restart api` re-opens every
   authorization that was already spent, and nothing in the logs says so: the
   replay verifies, the nonce is absent from the fresh `Set`, and the audit runs
   a second time for a payment that was already made.
2. **A second replica has its own memory.** `docker-compose.yml` runs one `api`
   service, but nothing stops a deployment from scaling it, and behind a load
   balancer a replay only has to land on a different instance to be accepted.

The guard was correct about *what* to remember and wrong about *where* to keep
it. This is the same shape as R-16 (an in-process queue) one layer down: state
that has to outlive the process, kept in the process.

**Why this entry is written now, and what it fixes.** Fourteen references to
`R-42` existed across `RISKS.md`, `BACKLOG.md`, `PROJECT_STATE.md` and
`CHANGELOG.md` — including R-40's own `Status` line — and no entry by that name
was ever written. The references were added with the fix and the entry was not,
so the file pointed at itself from four directions and a reader following any of
them arrived at nothing. Writing it down is the last piece of the fix, not
paperwork about it. (`R-41` is unused; the numbering jumps.)

**What the fix is.** The burn is a call on an injected `NonceStore`
(`packages/okx-adapter/src/nonce-store.ts`) with one method,
`burn(key): Promise<boolean>`, where `true` means "this call claimed it". The
adapter's default is still `InMemoryNonceStore`, so nothing changes for a
single-process deployment; `apps/api` injects a store that survives a restart
and is shared between replicas. `packages/mcp-server` deliberately keeps the
in-memory default, because it verifies payments only in mock mode and never
reaches a nonce. The interface is declared rather than concrete because the
question "does this survive a restart" is answered by the *caller*, which is the
only place that knows whether there is a second replica.

**What is still true.** `InMemoryNonceStore` is the adapter's default, so a
caller that forgets to inject one gets the old behaviour. That is deliberate —
the default has to be usable by the tests and by `mcp-server` — and it is
recorded here rather than left as a trap, together with the pinning test
(`refuses a replay after a restart, when both processes share the store`) that
makes the injected path the one with evidence behind it.

**Related.** R-40 (the single-use rule this makes durable), D-040 (a guard that
must survive a restart cannot live in the process), R-16 (the same mistake in
the queue), D-039 (a queue name belongs to the database, not the process).
