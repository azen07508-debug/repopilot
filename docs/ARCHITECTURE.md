# RepoPilot — Architecture

RepoPilot is a static-analysis service that turns a public GitHub repository
URL into a structured, evidence-backed launch-readiness report. It is
designed to be consumed by other AI agents and by humans.

## One-paragraph summary

A request hits the Fastify API, gets a job id back, then a payment proof
header is verified by the configured `PaymentAdapter` (mock by default,
OKX x402 v2 in production). The core pipeline fetches repository content
through an allowlisted `GitFetcher` (URL allowlist, binary skip, path
traversal blocked, no execution), hands the file map to a set of
analyzers, scores the result with rule-based logic, and emits a
schema-valid `Report`. The same pipeline is exposed to MCP clients as
the `audit_github_repository` tool.

## High-level diagram

```
                   ┌──────────────────────────────────────────────┐
                   │  Clients                                     │
                   │  - Web UI (apps/web)                         │
                   │  - MCP clients (Claude Code, Codex, OpenClaw)│
                   │  - Other AI agents (HTTP)                    │
                   └────────────────┬─────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────────────────────┐
                   │  apps/api (Fastify)                          │
                   │  ┌────────────┐  ┌─────────────┐             │
                   │  │  /health   │  │  /audits    │             │
                   │  └────────────┘  └─────────────┘             │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  PaymentAdapter                      │    │
                   │  │   ├─ MockPaymentAdapter (default)   │    │
                   │  │   └─ OkxPaymentAdapter (x402 v2)    │    │
                   │  └──────────────────────────────────────┘    │
                   │  ┌────────────┐  ┌─────────────────────┐     │
                   │  │  Drizzle   │  │  AuditPipeline      │     │
                   │  │  (SQLite/  │  │   └─ packages/core  │     │
                   │  │   Postgres)│  │                     │     │
                   │  └────────────┘  └─────────────────────┘     │
                   └────────────────┬─────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────────────────────┐
                   │  packages/core (pure TS)                     │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  GitFetcher (allowlist, no exec)     │    │
                   │  └──────────────────────────────────────┘    │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  Analyzers                           │    │
                   │  │   - metadata  - stack                │    │
                   │  │   - documentation                    │    │
                   │  │   - reproducibility                   │    │
                   │  │   - secrets (redacted)                │    │
                   │  │   - web3                              │    │
                   │  │   - hackathon                         │    │
                   │  └──────────────────────────────────────┘    │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  Scoring (rule-based, configurable)  │    │
                   │  └──────────────────────────────────────┘    │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  ReportBuilder (evidence required)   │    │
                   │  └──────────────────────────────────────┘    │
                   │  ┌──────────────────────────────────────┐    │
                   │  │  LLM (optional, noop default)        │    │
                   │  └──────────────────────────────────────┘    │
                   └──────────────────────────────────────────────┘

                   ┌──────────────────────────────────────────────┐
                   │  packages/mcp-server (stdio)                │
                   │  - audit_github_repository                   │
                   │  - get_audit_status                          │
                   │  - get_repopilot_capabilities                │
                   └──────────────────────────────────────────────┘
```

## Layering rules

1. The API server (`apps/api`) is the only process that holds database
   credentials and the GitHub token. The MCP server and the web UI are
   pure clients.
2. The core package (`packages/core`) is pure TypeScript: it has no
   network, no filesystem, no environment. It can be embedded into any
   other program (CLI, worker, edge function).
3. The OKX adapter (`packages/okx-adapter`) is the only package that
   knows about payment rails. The rest of the system only sees the
   `PaymentAdapter` interface (`createChallenge`, `verifyPayment`,
   `refund`, `getReceipt`).
4. LLM is the outermost optional layer. With `LLM_PROVIDER=noop`, the
   system runs with zero LLM cost.

## Data flow for a single audit

1. **Request validation** — `apps/api/src/routes/audits.ts` validates the
   input through `AuditInputsSchema` (Zod).
2. **Payment** — If `X-PAYMENT` is present, the route asks the
   `PaymentAdapter` to verify it. Otherwise the route returns 402 with
   a fresh `PaymentChallenge`.
3. **Job creation** — A row in `jobs` is created with `status: queued`.
   `paymentId` is stored on the row (idempotency key).
4. **Idempotency check** — If the same `paymentId` is seen again, the
   existing job is reused. This is enforced in the route, not in the
   adapter, so the mock and OKX paths share the same rule.
5. **Pipeline** — `AuditPipeline.run()` (in `packages/core`):
   - `GitFetcher.fetch(repoUrl)` returns `{ entries, contents, totalBytes }`
   - All seven analyzers run in parallel
   - `Scoring.scoreAll()` produces the 5-dimension score
   - `ReportBuilder.build()` assembles the `Report` and validates it
     against `ReportSchema` (Zod)
6. **Persistence** — The `Report` is stored on the job row; status
   becomes `completed`. On any error, the job becomes `failed` with the
   reason stored.
7. **Response** — The route returns `{ jobId, status, report }`. A
   client can also poll `GET /api/v1/audits/:jobId` later.

## Why static analysis only

Target repos are untrusted. The system never executes their npm
scripts, Makefile, Dockerfile or shell. The pipeline operates on text
only; binary files are sniffed and skipped. Even running a target
repo's tests in a sandbox is out of scope for the MVP — see `DECISIONS.md`
D-007.

## Evidence-first scoring

Every finding in the report has at least one `evidence` entry with
`file`, `line` and `reason`. This is enforced at the type level by
`FindingSchema` and at the runtime level by `ReportBuilder`. The
scoring rules in `packages/core/src/scoring/score.ts` derive the
5-dimension score from the same set of evidence-backed findings; the
score is never generated by the LLM.

## Payment flow

- Mock (default): the adapter returns a synthetic `PaymentChallenge`
  with a UUID-based `paymentId`. Any `X-PAYMENT: mock:<paymentId>`
  header is accepted as a paid receipt.
- OKX: the adapter builds a real x402 v2 `accepts[]` payload pointing
  at the configured recipient. The buyer's `onchainos` CLI signs an
  EIP-3009 `TransferWithAuthorization` and replays the request with the
  base64-encoded envelope in `X-PAYMENT`. The adapter re-derives the
  EIP-712 domain, recovers the signer, and verifies the signature
  against the on-chain `authorizationUsed` flag. The server never holds
  the buyer's private key.

See `docs/SECURITY.md` for the threat model around payments.

## Observability

- All logs go through Pino with the same redact list across packages.
- `/health` returns the active payment mode and the database status.
- `/api/v1/capabilities` returns the active limits and pricing.
- The MCP `get_audit_status` tool returns the same `jobId` → status
  mapping that the HTTP API exposes.

## Deployment topology

A typical production deploy is two long-running services and one
optional worker:

- `apps/api` (Fastify) — the HTTP / MCP frontend
- `postgres:16` (Docker) — the audit job table
- (Future) `apps/api` worker mode — runs the pipeline outside the
  request thread for `mode: full`

A reverse proxy (nginx or Caddy) terminates HTTPS in front. See
`docs/DEPLOYMENT.md` for the templates.
