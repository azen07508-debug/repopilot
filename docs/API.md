# RepoPilot — API Reference

Base URL: `http://localhost:4000` (default). All routes are under
`/api/v1` except `/health`.

## `GET /health`

Liveness probe. Always returns 200 if the process is up.

**Response**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "paymentMode": "mock",
  "database": "ok"
}
```

| Field         | Values                | Notes                                  |
|---------------|-----------------------|----------------------------------------|
| `status`      | `"ok"`                | Always `"ok"` when the process is up.  |
| `version`     | semver string         | From `package.json`.                   |
| `paymentMode` | `"mock"` \| `"okx"`   | The active `PaymentAdapter`.           |
| `database`    | `"ok"`                | Always `"ok"` in this build.           |

This endpoint is not rate-limited.

## `GET /api/v1/capabilities`

Service metadata, inputs/outputs, limits, pricing.

**Response**

```json
{
  "name": "RepoPilot",
  "version": "0.1.0",
  "inputs": {
    "repoUrl": "https URL to a public GitHub repository",
    "mode": "quick | full",
    "target": "hackathon | open_source | production",
    "outputLanguage": "en | zh-CN"
  },
  "outputs": {
    "report": "JSON document conforming to the RepoPilot Report schema (1.0)."
  },
  "limits": {
    "maxFiles": 2000,
    "maxFileBytes": 1048576,
    "maxTotalBytes": 52428800,
    "rateLimitPerMinute": 60
  },
  "pricing": {
    "quickScan":  { "amount": "0.02", "currency": "USDT" },
    "fullAudit":  { "amount": "0.10", "currency": "USDT" }
  },
  "paymentMode": "mock"
}
```

## `POST /api/v1/free-check`

Free, no-payment entry point. Returns a slim readiness signal so a
caller can decide whether a paid audit is worth the cost. **Never
executes repository code, never writes to the database, never returns
a `402`.** Rate-limited per IP.

**Request body**

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "outputLanguage": "en"
}
```

| Field            | Type   | Required | Values                            |
|------------------|--------|----------|-----------------------------------|
| `repoUrl`        | string | yes      | `https://<host>/<owner>/<repo>` where `<host>` is in the allowlist |
| `outputLanguage` | string | no       | `"en"` (default) \| `"zh-CN"`     |

### `200 OK` response

```json
{
  "reportVersion": "1.0",
  "kind": "free-check",
  "repository": {
    "url": "https://github.com/owner/repo",
    "host": "github.com",
    "owner": "owner",
    "name": "repo",
    "valid": true
  },
  "metadata": {
    "description": "...",
    "defaultBranch": "main",
    "stars": 1234,
    "language": "TypeScript",
    "topics": []
  },
  "stack": {
    "languages": ["TypeScript", "JavaScript"],
    "frameworks": ["React", "Vite"],
    "runtimes": ["Node.js"]
  },
  "checks": [
    { "id": "has-readme",       "title": "README present",                  "passed": true,  "evidence": "README.md found" },
    { "id": "has-license",     "title": "License file present",            "passed": true,  "evidence": "LICENSE found" },
    { "id": "has-env-example", "title": ".env.example present",            "passed": false, "evidence": "No .env.example (env vars must be documented)" },
    { "id": "has-lockfile",    "title": "Dependency lockfile present",     "passed": true,  "evidence": "pnpm-lock.yaml found" },
    { "id": "has-ci",          "title": "CI configuration present",        "passed": true,  "evidence": ".github/workflows/ci.yml found" }
  ],
  "score": { "value": 80, "passed": 4, "total": 5 },
  "generatedAt": "2026-07-19T08:00:00.000Z"
}
```

`metadata` and `stack` may be `null` if the upstream metadata/tree
fetch failed; the response is still 200 with whatever partial data is
available so the caller can degrade gracefully.

### Errors

| Status | Code                    | Meaning                                            |
|--------|-------------------------|----------------------------------------------------|
| 400    | `INVALID_INPUT`         | Body validation failed (Zod).                      |
| 403    | `HOST_NOT_ALLOWED`      | URL host is not in `ALLOWED_REPO_HOSTS` (SSRF defence). |
| 404    | `REPO_NOT_FOUND`        | The repository does not exist or is not accessible (private). |
| 429    | `UPSTREAM_RATE_LIMITED` | GitHub rate-limited the request (set `GITHUB_TOKEN` to raise the limit). |
| 429    | `RATE_LIMITED`          | Per-IP rate limit hit by RepoPilot itself.         |
| 502    | `UPSTREAM_FAILED`       | Other upstream / network failure.                  |

Example 403:

```json
{
  "error": {
    "code": "HOST_NOT_ALLOWED",
    "message": "Host \"gitlab.com\" is not in the allowlist. Allowed: github.com, raw.githubusercontent.com"
  }
}
```

Example 404:

```json
{
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Repository not found or not accessible: octocat/missing"
  }
}
```

### Notes

- `metadata.stars`, `metadata.language`, `metadata.description` and
  `metadata.defaultBranch` may be `null` if the metadata fetch failed.
  The presence checks and stack detection are best-effort; missing
  signals are reported with a `passed: false` and a human-readable
  `evidence` string.
- The free check **does not** run the seven paid analyzers
  (documentation, security, web3, etc.). For a full audit use
  `POST /api/v1/audits`.
- The response is a valid `FreeCheckReport`; the same schema is
  declared in `components.schemas.FreeCheckReport` in the OpenAPI
  document.

## `POST /api/v1/audits`

Start a new audit. Idempotent on `X-PAYMENT`.

**Request body**

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "mode": "quick",
  "target": "open_source",
  "outputLanguage": "en",
  "includeLaunchCopy": true
}
```

| Field             | Type    | Required | Values                                  |
|-------------------|---------|----------|-----------------------------------------|
| `repoUrl`         | string  | yes      | must be a `https://github.com/...` URL or another allowlisted host |
| `mode`            | string  | yes      | `"quick"` \| `"full"`                   |
| `target`          | string  | yes      | `"hackathon"` \| `"open_source"` \| `"production"` |
| `outputLanguage`  | string  | yes      | `"en"` \| `"zh-CN"`                     |
| `includeLaunchCopy` | bool  | no       | default `false`                         |

The `200 OK` response is the **same shape** as the Free Check
envelope plus the full `Report`:

```json
{
  "jobId": "job_8a3b9d...",
  "status": "completed",
  "report": { "reportVersion": "1.1", "scores": { "overall": 82 }, "...": "..." }
}
```

Reports are cached by `(owner, repo, commitSha, mode, target,
outputLanguage, reportVersion, includeLaunchCopy)`. A repeat audit of
the same commit with the same options is served from the cache, and the
response carries a `cache` object saying whether it was a hit. See
[Caching](#caching) for the config keys.

### First call (no payment)

Returns **402 Payment Required** with a `PaymentChallenge`:

```json
{
  "jobId": "job_8a3b9d...",
  "status": "queued",
  "payment": {
    "paymentId": "mock_xxx",
    "amount": "0.02",
    "currency": "USDT",
    "accepts": [
      {
        "scheme": "mock",
        "maxAmountRequired": "0.02",
        "resource": "https://repopilot/api/v1/audits",
        "description": "RepoPilot Quick Scan"
      }
    ]
  }
}
```

The exact shape of the `accepts[]` array depends on the active
`PaymentAdapter`. In mock mode it's the simple object above. In OKX
mode it's the full x402 v2 envelope with `network`, `payTo`,
`maxTimeoutSeconds`, etc.

### Second call (with `X-PAYMENT`)

Replays the same body with the `X-PAYMENT` header set:

```
X-PAYMENT: mock:<paymentId>     (mock mode)
X-PAYMENT: <base64 envelope>    (OKX mode)
```

If the payment verifies, the route runs the pipeline and returns
**200 OK** with the completed `Report`:

```json
{
  "jobId": "job_8a3b9d...",
  "status": "completed",
  "report": {
    "reportVersion": "1.1",
    "repository": { "url": "...", "owner": "...", "name": "..." },
    "summary": "...",
    "detectedStack": ["TypeScript", "Node.js"],
    "scores": {
      "overall": 82,
      "documentation": 90,
      "reproducibility": 78,
      "securityHygiene": 85,
      "deploymentReadiness": 70,
      "breakdown": { ... }
    },
    "blockers": [],
    "documentationGaps": [],
    "securityFindings": [],
    "deploymentPlan": [],
    "recommendedTasks": [],
    "launchChecklist": [],
    "launchCopy": {
      "oneSentencePitch": "...",
      "shortDescription": "...",
      "xPost": "..."
    },
    "limitations": [],
    "generatedAt": "2026-07-19T07:30:00Z"
  }
}
```

If the payment is not yet settled, the route returns **402** again
with the same job and a `receipt` object:

```json
{
  "error": { "code": "PAYMENT_NOT_SETTLED", "message": "..." },
  "jobId": "job_8a3b9d...",
  "paymentId": "mock_xxx"
}
```

### Errors

| Status | Code                  | Meaning                                       |
|--------|-----------------------|-----------------------------------------------|
| 400    | `INVALID_INPUT`       | Body validation failed (Zod).                 |
| 402    | `PAYMENT_NOT_SETTLED` | First call or replay before settlement.       |
| 404    | `JOB_NOT_FOUND`       | `GET /api/v1/audits/:jobId` with unknown id.  |
| 413    | `REPO_TOO_LARGE`      | Repo exceeds `maxFiles` / `maxFileBytes` / `maxTotalBytes`. |
| 429    | `RATE_LIMITED`        | Per-IP rate limit hit.                        |
| 500    | `AUDIT_FAILED`        | The pipeline threw. The job is in `failed`.   |
| 500    | `INTERNAL`            | Anything else.                                |

## `GET /api/v1/audits/:jobId`

Fetch the current state of a job.

- `queued` / `processing` → **202** with `Location` and `Retry-After: 1`
- `completed` → **200** with the report
- `failed` → **200** with a structured `error`. Deliberately not 5xx, so a
  failed job is observable without looking like a server outage. Clients
  that prefer a 5xx can switch on `status === "failed"`.

**Response `200` (completed)**

```json
{
  "jobId": "job_8a3b9d...",
  "status": "completed",
  "report": { "reportVersion": "1.1", "...": "..." },
  "createdAt": "2026-09-20T10:30:00.000Z",
  "completedAt": "2026-09-20T10:30:09.000Z",
  "cache": { "hit": false, "keyVersion": "v1", "expiresAt": "2026-09-21T10:30:09.000Z" }
}
```

**Response `200` (failed)**

```json
{
  "jobId": "job_8a3b9d...",
  "status": "failed",
  "error": { "code": "AUDIT_FAILED", "message": "..." },
  "createdAt": "2026-09-20T10:30:00.000Z",
  "failedAt": "2026-09-20T10:30:04.000Z"
}
```

## Derived, read-only endpoints

These five answer questions about audits that **already happened**. The
four `GET`s are free and never scan a repository — they are pure
functions of reports already stored (`buildFixPlanSet`, `diffReports`,
`evaluateQualityContract`). The `POST` runs the pipeline again and is
paid.

## `GET /api/v1/audits/:jobId/fix-plan`

Every fix plan for a completed audit, derived from the stored report.

**Free.** No payment challenge. **Never scans the repository.**

**Response `200`**

```json
{
  "schemaVersion": "1.0",
  "repository": {
    "owner": "octocat",
    "name": "Hello-World",
    "url": "https://github.com/octocat/Hello-World",
    "commitSha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
  },
  "generatedAt": "2026-09-20T10:30:00.000Z",
  "reportVersion": "1.1",
  "plans": [
    {
      "schemaVersion": "1.0",
      "planId": "fixplan:doc-license",
      "findingId": "doc-license",
      "priority": "P0",
      "status": "open",
      "title": "LICENSE is missing",
      "why": "LICENSE is missing. A published repository without a license ...",
      "evidence": [
        { "file": "README.md", "line": null, "reason": "no LICENSE file in the repository root" }
      ],
      "steps": [
        { "order": 1, "action": "Add a LICENSE file matching the declared license.", "target": "LICENSE" },
        { "order": 2, "action": "LICENSE exists and matches the declared license.", "target": "LICENSE" }
      ],
      "testsToAdd": ["tests/docs/readme.test.ts"],
      "acceptanceCriteria": ["LICENSE exists and matches the declared license."],
      "estimatedEffort": "S",
      "risks": ["Documentation-only change; verify that referenced paths still exist after the edit."],
      "agentInstructions": "Repository:\n  octocat/Hello-World\n  https://github.com/octocat/Hello-World\n\nCommit:\n  a1b2c3d...\n\n...",
      "llmEnhanced": false
    }
  ]
}
```

| Field               | Values                          | Notes                                                                 |
|---------------------|---------------------------------|-----------------------------------------------------------------------|
| `priority`          | `P0` \| `P1` \| `P2`            | From severity: critical/high → `P0`, medium → `P1`, low → `P2`. Deterministic, never LLM-derived. |
| `status`            | `open` \| `resolved` \| `ignored` | Newly generated plans are always `open`.                            |
| `estimatedEffort`   | `S` \| `M` \| `L`               | critical → `L`, high → `M`, otherwise `S`. Deterministic.             |
| `evidence`          | non-empty array                 | Same `path:line:reason` shape as findings (D-008 extended to plans).  |
| `testsToAdd`        | array                           | May be empty.                                                         |
| `risks`             | array                           | Category-specific wording.                                            |
| `agentInstructions` | string                          | Ready to paste into Codex / Claude Code / OpenCode. Fixed sections: Repository, Commit, Finding, Evidence, Objective, Steps, Constraints, Acceptance Criteria. |
| `llmEnhanced`       | boolean                         | `true` only when an LLM rewrote the `why` sentence. With the default `NoopLLMProvider` it is always `false`. |

Plans are **not persisted**. They are regenerated on read, so they can
never drift from the report they came from.

**Errors**

| Status | Code               | Meaning                                      |
|--------|--------------------|----------------------------------------------|
| 404    | `JOB_NOT_FOUND`    | Unknown job id.                              |
| 409    | `REPORT_NOT_READY` | The job is still `queued` or `processing`.   |

## `GET /api/v1/audits/:jobId/diff?base=<jobId>`

Before/after comparison of two completed audits of the **same**
repository. **Free**, derived from the two stored reports.

`base` is the **jobId** of the earlier audit, not a commit sha. Find
candidates with the history endpoint below.

**Response `200`**

```json
{
  "schemaVersion": "1.0",
  "base": { "jobId": "job_base_001", "commitSha": "a1b2...", "generatedAt": "...", "overall": 45.2 },
  "head": { "jobId": "job_head_002", "commitSha": "e5f6...", "generatedAt": "...", "overall": 62.8 },
  "scoreDelta": 17.6,
  "dimensionDeltas": {
    "documentation": 68.5,
    "reproducibility": 28,
    "securityHygiene": 40,
    "deploymentReadiness": 15
  },
  "ruleDeltas": [
    {
      "rule": "no-readme",
      "dimension": "documentation",
      "before": -25,
      "after": 0,
      "delta": 25,
      "reason": "README.md is missing"
    }
  ],
  "resolved": ["doc-license", "doc-readme"],
  "new": ["doc-codeowners"],
  "persistent": ["repro-no-lockfile"],
  "verdict": "improved"
}
```

`ruleDeltas` lists **only the rules whose delta changed**. A rule that
applied identically in both audits is omitted, so the table stays
readable and "why did the score move" has a direct answer. It is
computed from the `ScoreBreakdown.rules[]` already present in each
report — no LLM is involved.

| Field        | Values                                          |
|--------------|-------------------------------------------------|
| `verdict`    | `improved` \| `regressed` \| `unchanged`        |
| `resolved`   | finding ids present in base but not in head     |
| `new`        | finding ids present in head but not in base     |
| `persistent` | finding ids present in both                     |

**Errors**

| Status | Code               | Meaning                                                  |
|--------|--------------------|----------------------------------------------------------|
| 400    | `INVALID_INPUT`    | `base` is missing, or a job was compared with itself.    |
| 400    | `REPO_MISMATCH`    | The two audits are for different repository URLs.        |
| 404    | `JOB_NOT_FOUND`    | Unknown head or base job.                                |
| 409    | `REPORT_NOT_READY` | One of the jobs has no completed report.                 |

## `GET /api/v1/repositories/:owner/:repo/audits?limit=`

Audit history for one repository, newest first. **Free.** Summaries
only; fetch a full report with `GET /api/v1/audits/:jobId`.

`limit` defaults to `20` and is clamped to `1..100`.

**Response `200`**

```json
{
  "owner": "octocat",
  "repo": "Hello-World",
  "limit": 20,
  "count": 2,
  "audits": [
    {
      "jobId": "job_head_002",
      "status": "completed",
      "commitSha": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1b2c3d4",
      "mode": "full",
      "target": "open_source",
      "createdAt": "2026-09-20T10:30:00.000Z",
      "completedAt": "2026-09-20T10:30:09.000Z",
      "failedAt": null,
      "overall": 62.8,
      "findingCount": 10
    }
  ]
}
```

Audits recorded before the repository-identity columns existed carry
`NULL` owner/repo and are **excluded** from history rather than being
guessed at. `overall` and `findingCount` are `null` for jobs that have
not completed.

## `GET /api/v1/audits/:jobId/quality`

The quality contract for a completed audit: **may this ship?**

**Free.** No payment challenge. **Never scans the repository.**

A score answers "how good is this?". This answers "may we ship?", which
is the question a team actually acts on. The verdict is deterministic —
no LLM is involved at any point — and it is re-evaluated on every read,
so tightening the contract applies to audits that already exist instead
of leaving yesterday's verdict frozen on the job row.

`status` is one of:

| status | meaning |
|---|---|
| `pass` | every check passed |
| `pass_with_warnings` | nothing blocking, but something could not be evaluated |
| `blocked` | at least one check failed — `ship` is `false` |

**Response `200`**

```json
{
  "schemaVersion": "1.0",
  "status": "blocked",
  "ship": false,
  "blockerCount": 2,
  "warningCount": 0,
  "sections": [
    {
      "id": "security",
      "status": "fail",
      "checks": [
        {
          "id": "security.no-secrets",
          "section": "security",
          "requirement": "at most 0 credentials in the working tree",
          "observed": "1 credential found",
          "status": "fail",
          "ruleIds": ["SEC-SECRET-001"]
        }
      ]
    }
  ],
  "blockingFingerprints": ["3f9c1a0b7d2e4f81"],
  "evaluatedAt": "2026-09-20T10:31:00.000Z"
}
```

`blockingFingerprints` is the list a re-audit compares against to answer
"did the blockers go away?" — the same fingerprints `GET
/api/v1/audits/:jobId/diff` reports on.

Findings under fixture paths (test files, fixtures, sample apps,
documents) do **not** count by default, because a scanner's own test
suite has to hold fake keys in order to prove it detects them. A real
credential in source still blocks.

**Errors** — `404 JOB_NOT_FOUND` for an unknown job, `409
REPORT_NOT_READY` when the audit has not completed.

## `POST /api/v1/repositories/:owner/:repo/reaudit`

Run a fresh audit using coordinates the caller already has. **Paid** —
it runs the pipeline again.

This is the same code path as `POST /api/v1/audits`: same payment
challenge, same idempotency keys, same queue. The repository URL is
built from the path and still passes the host allow-list, so SSRF
protection applies here exactly as it does on the normal route.

**Request body** — every field is optional

```json
{
  "mode": "quick",
  "target": "open_source",
  "outputLanguage": "en",
  "includeLaunchCopy": false
}
```

Defaults: `mode: "quick"`, `target: "open_source"`,
`outputLanguage: "en"`, `includeLaunchCopy: false`.

**Responses** are identical to `POST /api/v1/audits`: `402` with a
payment challenge on the first call, then `202` with `Location` and
`Retry-After: 1` once the payment settles.

**Errors**

| Status | Code               | Meaning                                                                 |
|--------|--------------------|-------------------------------------------------------------------------|
| 400    | `INVALID_INPUT`    | `owner`/`repo` is not a plain path segment (`/^[A-Za-z0-9._-]+$/`), or the body failed validation. |
| 400    | `HOST_NOT_ALLOWED` | The constructed URL is outside `ALLOWED_REPO_HOSTS`.                     |
| 402    | `PAYMENT_NOT_SETTLED` | First call, or a replay before settlement.                            |
| 503    | `ENQUEUE_FAILED`   | The queue is not accepting jobs; retry.                                  |

### Closing the loop

```bash
# 1. Audit (paid) -> jobId
# 2. GET /api/v1/audits/<jobId>/quality          (free)  may this ship?
# 3. GET /api/v1/audits/<jobId>/fix-plan         (free)
# 4. Fix the code
# 5. POST /api/v1/repositories/<owner>/<repo>/reaudit  (paid) -> newJobId
# 6. GET /api/v1/audits/<newJobId>/quality       (free)  did the blockers go?
# 7. GET /api/v1/audits/<newJobId>/diff?base=<jobId>   (free)
```

## `GET /docs/openapi.json`

The OpenAPI 3.1 document. Hand-written; served from
`apps/api/src/openapi.ts`. Used by the web UI for type generation
and by external clients. Includes `FreeCheckRequest`,
`FreeCheckReport`, `CreateAuditRequest`, `AuditCompletedResponse`,
`AuditStatusResponse`, `CapabilitiesResponse`, `ErrorResponse`,
and the `HealthResponse` schemas under `components.schemas`.

## Rate limits

- 60 requests per minute per IP on `POST /api/v1/audits` and
  `POST /api/v1/free-check` (configurable via
  `RATE_LIMIT_PER_MINUTE`).
- The `GET` endpoints are not rate-limited.
- A 429 response carries a `Retry-After` header.

## Caching

- Reports are cached per `(owner, repo, commitSha, mode, target,
  outputLanguage, reportVersion, includeLaunchCopy)`. Concurrent
  requests for the same key are coalesced onto a single pipeline run, so
  N callers cause one GitHub fetch, not N.
- `GET /api/v1/audits/:jobId` returns a `cache` object with `hit`,
  `keyVersion` and `expiresAt`.
- The derived endpoints (`fix-plan`, `diff`, `quality`, `history`) do not
  consult the cache: they read the report stored on the job row.
- Config: `REPORT_CACHE_ENABLED`, `REPORT_CACHE_TTL_SECONDS`.
