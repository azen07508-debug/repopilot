# RepoPilot — Security Model

RepoPilot reads untrusted GitHub content. The whole design is shaped
around that fact.

## Threat model

### Assets we want to protect

- The host running RepoPilot (the API process, the database, the
  filesystem, the user's secrets in env vars)
- The integrity of the report we return to the buyer (evidence
  provenance, score rules)
- The buyer's wallet, signing keys, and payment details
- The seller's reputation (if a competitor subverts our scoring)

### Adversaries we consider

1. **A target repository that wants to escape the sandbox.** They can
   put anything in their README, source code, package.json scripts,
   Makefile, Dockerfile, or workflow files. They can also try prompt
   injection in any text field.
2. **A buyer who wants to get a report without paying.** They can
   replay requests, fuzz the payment headers, and try to call the
   audit endpoint directly without going through the payment adapter.
3. **An unauthenticated client that wants to abuse the rate limit.**
   They can hammer `/api/v1/audits` from one IP or from a botnet.
4. **An operator who misconfigures production** by leaving a default
   CORS origin, an empty `OKX_PAYMENT_ADDRESS`, or `PAYMENT_MODE=mock`.

### Out of scope (explicitly)

- The buyer sending a real, large USDT payment to a wrong address
  (this is on the buyer's wallet; we do not custody funds)
- A targeted attack against the host kernel or container runtime
  (we assume the runtime is patched)
- Side-channel attacks against the scoring rules
- A malicious insider with shell on the host

## Mitigations

### Sandbox escape via target repo content

- The pipeline **never executes** the target repo's code. No `npm
  install`, no `node`, no `bash`, no `python`, no `make`, no
  `docker build`. This is enforced at the architecture level: the
  pipeline operates on text only.
- Binary files are sniffed and skipped. The fetcher only reads
  UTF-8 / UTF-16 / ASCII text up to `MAX_FILE_BYTES` per file.
- Path traversal is rejected: the fetcher refuses `..`, `.git/`,
  `node_modules/`, and dotfiles other than a small allowlist
  (`.env.example`, `.gitignore`, `.dockerignore`).
- Prompt injection patterns are detected by `security/injection.ts`
  and reported as findings. The LLM (when enabled) is *never*
  asked to follow instructions from the target repo.

### Payment bypass

- The audit endpoint always goes through the configured
  `PaymentAdapter`. The adapter is wired in `buildPaymentAdapter`
  in `packages/okx-adapter/src/factory.ts`; the route never holds
  the bypass.
- Mock and OKX adapters share the same interface; switching is
  config-only. The factory refuses to construct an
  `OkxPaymentAdapter` whose `isConfigured()` returns false.
- `paymentId` is the idempotency key. A replay with the same
  `paymentId` resolves to the same job, the same report, and the
  same status. There is no way to mint a second `paymentId` for
  the same `quoteKey` through the route.
- The MCP `get_audit_status` tool returns the same `paymentId`
  status that the HTTP API exposes. The two views cannot diverge.

### Rate limiting and abuse

- 60 req/min/IP on `POST /api/v1/audits` by default
  (`RATE_LIMIT_PER_MINUTE`).
- The `MAX_FILES`, `MAX_FILE_BYTES`, `MAX_TOTAL_BYTES` limits are
  enforced at the fetcher, not at the report. The route returns
  413 if any of them is exceeded.
- GitHub anonymous rate limits (60 req/h) are documented. A
  production deploy should set `GITHUB_TOKEN` to lift to 5000 req/h.

### Misconfiguration

- `pnpm env:check` fails the deploy in production if:
  - `CORS_ORIGINS` is `*`
  - `PAYMENT_MODE=mock`
  - `DATABASE_URL` starts with `file:`
  - `OKX_PAYMENT_ADDRESS` is not a 0x EVM address (when OKX mode)
  - Required vars are missing
- The script never prints secret values. The known secret keys are
  listed in `KNOWN_SECRET_KEYS` inside `scripts/env-check.ts`; adding
  a new one is a one-line change.
- `/health` always reports the active `paymentMode`. Operators
  monitor this against the expected value and alert on drift.

### Logging

- Pino redact covers all the obvious secret paths:
  - `*.password`, `*.token`, `*.apiKey`, `*.secret`, `*.privateKey`,
    `*.mnemonic`
  - `req.headers.authorization`
  - `req.headers["x-payment"]`
  - `req.headers["x-payment-signature"]`
  - `req.headers["x-api-key"]`
  - `*.xPayment`
- If a new field or header is added that may carry a secret, the
  redact list must be updated. The integration test in
  `apps/api/src/tests/api.integration.test.ts` posts a request with
  known fake secrets and asserts they do not appear in logs.

### Score integrity

- Scores are produced by `packages/core/src/scoring/score.ts`. The
  file is deterministic and rule-based.
- The LLM is **not** allowed to modify the score. The provider
  interface only exposes `summarize`, `mergeFindings`, and
  `generateLaunchCopy`. Adding a `score()` method to the provider
  interface is forbidden by code review.
- Every finding in the report has at least one `evidence` entry
  with `file`, `line` and `reason`. This is enforced at the type
  level by `FindingSchema`.

### Supply chain

- The lockfile is committed; CI uses `pnpm install --frozen-lockfile`.
- Critical pins (zod 3.24.1, MCP SDK 1.22.0, pino 10) are documented
  in `DECISIONS.md` and are not casually bumped.
- `Dockerfile` is multi-stage and runs as a non-root user.

## Reporting a vulnerability

Please open a private issue or contact the maintainer. Do not disclose
the vulnerability in a public issue until a fix is available.
