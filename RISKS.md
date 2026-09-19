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
