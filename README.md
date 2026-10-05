# RepoPilot

**One repo in. A ship-or-block verdict out.**

RepoPilot is a release gate for public GitHub repositories. Give it a repo
URL and it returns a ship-or-block verdict with the findings that block the
gate — documentation gaps, reproducibility problems, deployment blockers,
Web3 configuration issues — each carrying file-and-line evidence, plus the
prioritised fixes that clear it.

Ask for `mode: 'full'` and the same report also carries the deployment plan
and the launch copy you ship with. The measurement is identical either way,
and so is the price.

It closes the loop: gate → fix plan → fix → re-gate → compare. The
comparison attributes score movement rule by rule and splits findings
into resolved, new and still-open. Built for Web3 developers, hackathon
contestants, and other AI agents.

📚 **Looking for a specific doc?** Start at
[docs/INDEX.md](docs/INDEX.md) — it lists every document with one-line
descriptions and points you at the right one.

RepoPilot runs **static analysis only**. It does not execute the
audited repository's code. It does not perform a formal security
audit. It does not custody funds or read private keys.

## Why RepoPilot

- **Evidence first.** Every finding has at least one `path:line:reason`
  pointer, and so does every fix step. The score is rule-based and
  reproducible.
- **A plan, not just a report.** Each finding gets a fix plan with
  ordered steps, tests to add, acceptance criteria, estimated effort and
  risks — plus an `agentInstructions` block you can hand straight to
  Codex, Claude Code or OpenCode.
- **Before/after, attributed.** Re-audit after fixing and RepoPilot says
  what moved: the score delta per dimension, the exact scoring rules
  that changed, and which findings were resolved, appeared or persist.
- **Built for AI agents.** The report is a single JSON document with a
  stable schema (`reportVersion: "1.2"`; `"1.1"` and `"1.0"` still parse). The MCP
  server exposes <!-- docs-facts:mcp-tool-count -->14<!-- docs-facts:end -->
  tools and marks which of them are free, so any MCP-compatible client
  can drive the whole loop.
- **No surprise charges, and no tiers.** A read-only triage probe is free
  (`POST /api/v1/free-check`, or `free_check` over MCP), and so is reading a
  fix plan or a comparison — only running a gate costs anything. A gate
  costs one price whatever `mode` you ask for: `mode` selects how much of
  the report you receive, never what is measured or what it costs. The
  number is in [`MARKETPLACE_LISTING.md`](MARKETPLACE_LISTING.md), which
  `pnpm docs:check` keeps in step with the server. A `MockPaymentAdapter` is
  the default, the real `OkxPaymentAdapter` is opt-in. See
  [`docs/EXTERNAL_ACTIONS.md`](docs/EXTERNAL_ACTIONS.md) for the
  Beta gate.
- **No execution, and no LLM in the scoring.** The pipeline reads text
  only. Binary files are skipped, prompt-injection patterns are reported
  as findings, and the LLM boundary is drawn so that even an enabled LLM
  may only rewrite natural language — never a score, a priority or a piece
  of evidence.

## Quick start

```bash
git clone <repo>
cd repopilot
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm build
pnpm --filter @repopilot/api start
# API on http://localhost:4000
# Web on http://localhost:5173 (run pnpm --filter @repopilot/web dev in another shell)
```

Or with Docker — the API image. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) has the
production path (`PAYMENT_MODE=okx`, Postgres, `pg-boss`):

```bash
docker build -t repopilot:0.1.0-rc.3 .
mkdir -p data                                   # the container runs as uid 1000

# 1. Apply the schema. A fresh database has no tables, and `/health` probes one.
docker run --rm \
  -e NODE_ENV=development -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.3 \
  node apps/api/dist/db/migrate.js

# 2. Serve.
docker run --rm -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=development -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.3
```

`NODE_ENV=development` is deliberate, not a simplification: the API refuses to
start with `NODE_ENV=production` and `PAYMENT_MODE=mock`
(`apps/api/src/config.ts`, `validateProductionConfig`). The image itself sets
`NODE_ENV=production`, so a local smoke run has to override it.

A gate takes 5–15 seconds for a typical public repository. The examples below
pass `mode: 'quick'` — the verdict alone — to keep the responses small. The
default is `full`, the shape the paid service is sold as:

```bash
# 1. Submit a repo for audit (returns 402 with a payment challenge)
curl -X POST http://localhost:4000/api/v1/audits \
  -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/octocat/Hello-World",
       "mode":"quick","target":"open_source","outputLanguage":"en"}'

# 2. Replay with the mock X-PAYMENT header (use the paymentId from step 1)
curl -X POST http://localhost:4000/api/v1/audits \
  -H 'content-type: application/json' \
  -H "x-payment: mock:mock_xxx" \
  -d '{"repoUrl":"https://github.com/octocat/Hello-World",
       "mode":"quick","target":"open_source","outputLanguage":"en"}'
```

Then close the loop. These three are free and never re-scan the repo:

```bash
# 3. Get an actionable plan for every finding
curl http://localhost:4000/api/v1/audits/<jobId>/fix-plan

# 4. Fix something, then audit the same repository again
curl -X POST http://localhost:4000/api/v1/repositories/octocat/Hello-World/reaudit

# 5. See what actually changed, attributed rule by rule
curl "http://localhost:4000/api/v1/audits/<newJobId>/diff?base=<jobId>"
```

## Documentation

| Doc                                                  | What's in it                                          |
|------------------------------------------------------|-------------------------------------------------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Layering, data flow, evidence rules                   |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)             | Docker, nginx, Caddy, Railway, Render, VPS            |
| [docs/SECURITY.md](docs/SECURITY.md)                 | Threat model, mitigations, redaction                  |
| [docs/API.md](docs/API.md)                           | Full HTTP API reference                               |
| [docs/MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md) | Claude Code / Codex / OpenClaw / generic              |
| [docs/REPOSITORY_INTELLIGENCE_PLAN.md](docs/REPOSITORY_INTELLIGENCE_PLAN.md) | Repository intelligence roadmap |
| [docs/EXTERNAL_ACTIONS.md](docs/EXTERNAL_ACTIONS.md) | The only place that lists what a human must do        |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Pre-tag checklist                                    |
| [docs/HERO_IMAGE_BRIEF.md](docs/HERO_IMAGE_BRIEF.md) | Marketplace hero spec                                 |
| [README_OKX.md](README_OKX.md)                       | OKX.AI / Agent Payments Protocol integration          |
| [MARKETPLACE_LISTING.md](MARKETPLACE_LISTING.md)     | EN + CN marketplace copy                              |

Project meta:

| File                                       | Purpose                                          |
|--------------------------------------------|--------------------------------------------------|
| [PROJECT_STATE.md](PROJECT_STATE.md)       | What the project is, right now                   |
| [ROADMAP.md](ROADMAP.md)                   | What's next                                      |
| [BACKLOG.md](BACKLOG.md)                   | Prioritised TODO list                            |
| [DECISIONS.md](DECISIONS.md)               | Architecture Decision Records                    |
| [RISKS.md](RISKS.md)                       | Active risks + mitigations                       |
| [CHANGELOG.md](CHANGELOG.md)               | Per-release notes                                |

## Project layout

```text
repopilot/
  apps/
    api/      Fastify HTTP API
    web/      React + Vite admin UI
  packages/
    core/        analyzers + scoring + report + security + schemas + llm
                 + fixplan (report -> fix plan) + diff (report -> diff)
    mcp-server/  MCP server (stdio)
    okx-adapter/ PaymentAdapter interface, mock + OKX implementations
  fixtures/      <!-- docs-facts:fixture-count -->6<!-- docs-facts:end --> sample repos for tests
  docs/          one file per topic; see docs/INDEX.md for the list
  scripts/       one check script per gate; see the Scripts table below
  .github/workflows/  ci.yml + docker.yml
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layering
diagram.

## Scripts

| Command                     | What it does                                              |
|-----------------------------|-----------------------------------------------------------|
| `pnpm install`              | Install all workspace deps                                |
| `pnpm -r typecheck`         | `tsc --noEmit` in every package                           |
| `pnpm -r test`              | All unit + integration tests                              |
| `pnpm lint`                 | tsc + custom static rules                                 |
| `pnpm build`                | All packages and apps                                     |
| `pnpm env:check`            | Validate env (no secret values printed)                   |
| `pnpm docker:check`         | Static Docker check (or full build if Docker is present)  |
| `pnpm compose:check`        | Static docker-compose review                              |
| `pnpm docs:check`           | Recompute the facts the docs state, and fail on divergence|
| `pnpm preflight:production` | Pre-registration self-check: production config + assets   |
| `pnpm verify:release`       | End-to-end smoke (env → lint → test → build → API → MCP)  |
| `pnpm db:migrate`           | Apply DB migrations (SQLite + Postgres)                   |
| `pnpm mcp`                  | Start the MCP server over stdio                           |
| `pnpm start`                | Start the API server                                      |
| `make help`                 | See all targets (Makefile mirrors the above)              |

## Tech stack

- Node.js 22 LTS, TypeScript 5.7 strict + NodeNext ESM
- pnpm 11.x workspaces
- Fastify 5, Zod 3.24, Octokit, Drizzle (SQLite + Postgres)
- Vitest, Pino 10, React 18 + Vite 6
- `@modelcontextprotocol/sdk@1.22` (official MCP TS SDK, stdio)
- viem 2.x for EIP-3009 / EIP-712 in the OKX adapter

## Known limitations

- OKX.AI Marketplace went GA on 2026-06-30. The `OkxPaymentAdapter` is
  fully wired (x402 v2 + EIP-3009 + EIP-712) and accepts `PAYMENT_MODE=okx`
  with a valid `OKX_PAYMENT_ADDRESS` and `OKX_PAYMENT_RESOURCE_URL` — the
  second is this deployment's own public https URL, and the 402 challenge
  shows it to the buyer as the resource being paid for. Both are required in
  production; `pnpm preflight:production` reports what is still missing. To
  publish the marketplace listing, run
  `onchainos agent register --role asp` (see
  [docs/EXTERNAL_ACTIONS.md](docs/EXTERNAL_ACTIONS.md) item 2). The product
  still ships with `PAYMENT_MODE=mock` as the default so the whole gate flow
  works without external services.
- **`mode` selects the report, not the measurement.** Both modes run every
  analyzer over the same archive and read the same commit history; `full`
  only *adds* two report sections — the deployment plan and the launch copy
  — and costs the same. The declaration and the consistency test that pins
  it are in
  [`packages/core/src/report/tiers.ts`](packages/core/src/report/tiers.ts).
  What does bound a gate is the repository, not the mode: a very large one
  (> 50 MiB / 2000 files) can exceed the audit timeout. The gate is queued,
  not synchronous — `POST /api/v1/audits` answers **202** and a worker
  process runs the pipeline. In the default combined shape that worker
  lives in the API process; the split production shape runs it as its own
  service (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- **The report is deterministic, and the LLM hook is not wired up.** Every
  score is rule-based, and `summary` / `launchCopy` are generated from
  templates. `@repopilot/core` ships an `OpenAICompatibleProvider` that is
  unit-tested, but no code path in the API or the MCP server consumes it:
  setting `LLM_PROVIDER` today changes nothing about a report. Wiring it is
  code work, tracked in [BACKLOG.md](BACKLOG.md) — not an operator step.

## License

MIT — see [LICENSE](LICENSE).

