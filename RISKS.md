# RISKS.md

Active risks the team is aware of and how they are mitigated.

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
**Mitigation:** `injection.ts` detector has 11 patterns. Findings are
reported, not executed. The system never takes instructions from
target-repo content.

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

```
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

```
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

