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
  "report": { "reportVersion": "1.0", "scores": { "overall": 82 }, "...": "..." }
}
```

There is no persistent cache for paid audits in `v0.1.0-rc.1`; every
paid call re-runs the full pipeline. A persistent report cache is
on the `BACKLOG.md` P1 list.

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
    "reportVersion": "1.0",
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

Fetch the current state of a job. Always returns 200 once the job
exists. The `status` field can be `queued`, `processing`,
`completed`, or `failed`. The `report` is included only when
`status === "completed"`.

**Response**

```json
{
  "jobId": "job_8a3b9d...",
  "status": "completed",
  "report": { ... }
}
```

Or on failure:

```json
{
  "jobId": "job_8a3b9d...",
  "status": "failed",
  "error": { "code": "AUDIT_FAILED", "message": "..." }
}
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

- Paid audits do not cache; every call re-runs the full pipeline.
  (A persistent report cache is on `BACKLOG.md` P1.)
