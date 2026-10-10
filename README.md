# RepoPilot

[![CI](https://github.com/azen07508-debug/repopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/azen07508-debug/repopilot/actions/workflows/ci.yml)
[![Docker](https://github.com/azen07508-debug/repopilot/actions/workflows/docker.yml/badge.svg)](https://github.com/azen07508-debug/repopilot/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

## Contents

- [Why RepoPilot](#why-repopilot)
- [What a verdict contains](#what-a-verdict-contains)
- [Quick start](#quick-start)
- [Use it from an MCP client](#use-it-from-an-mcp-client)
- [Documentation](#documentation)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Tech stack](#tech-stack)
- [Known limitations](#known-limitations)
- [License](#license)

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
  stable schema (`reportVersion: "1.3"`; `"1.2"`, `"1.1"` and `"1.0"` still parse). The MCP
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
- **No execution, and no LLM anywhere.** The pipeline reads text only.
  Binary files are skipped and prompt-injection patterns are reported as
  findings. Scores, priorities, evidence, the summary and the launch copy
  are all produced by deterministic rules and templates — there is no
  model in the path and no LLM configuration to set. The provider
  interface that used to exist was removed in R-38, because nothing
  consumed it.

## What a verdict contains

A gate returns one JSON document. The parts that decide the verdict:

- **`scores`** — `overall` from 0 to 100, plus one score per dimension
  (`documentation`, `reproducibility`, `securityHygiene`,
  `deploymentReadiness`). Each dimension carries a `breakdown` naming the
  rules that fired and the delta each one applied, so a score movement can
  be attributed rule by rule rather than guessed at.
- **Findings**, split by what they mean rather than by which analyzer
  found them: `blockers`, `documentationGaps`, `securityFindings`,
  `qualityFindings` (code hygiene — deliberately outside the score, because
  a leftover TODO does not change launch readiness) and `fixtureFindings`
  (real findings under test and fixture paths, kept separate because their
  blast radius is smaller). Every one carries `path:line:reason`.
- **The forward-looking sections** — `deploymentPlan`, `recommendedTasks`
  and `launchChecklist`, plus `launchCopy` on `mode: 'full'`.
- **`omittedSections`** — how you tell "this report has no deployment plan"
  from "this tier does not include one". Absent and empty are different
  claims; read this field, never `auditMode`.

The verdict itself is the quality contract: `pass`, `pass_with_warnings` or
`blocked`, with the fingerprint of each finding that blocks a release. Over
MCP that is `quality_status`; over HTTP it is
`GET /api/v1/audits/:jobId/quality`. Field-by-field reference:
[docs/API.md](docs/API.md).

## Quick start

**Requirements:** Node.js 22 LTS and pnpm 11.x. No database server — SQLite
is the default, and Postgres is opt-in.

```bash
git clone https://github.com/azen07508-debug/repopilot.git
cd repopilot
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm build
pnpm --filter @repopilot/api start
# API on http://localhost:4000
# Web on http://localhost:5173 (run pnpm --filter @repopilot/web dev in another shell)
```

Or run both apps at once with `pnpm dev`.

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

## Use it from an MCP client

The MCP server runs the analysis **in-process** — it does not call the HTTP
API, and the API does not need to be running. Point a client at the built
CLI, and give it a GitHub token: anonymous access is capped at 60
requests/hour, which is not enough for a gate.

```json
{
  "mcpServers": {
    "repopilot": {
      "command": "node",
      "args": [
        "/absolute/path/to/repopilot/packages/mcp-server/dist/cli.js"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_...",
        "PAYMENT_MODE": "mock"
      }
    }
  }
}
```

`PAYMENT_MODE=mock` auto-settles so an agent gets a result without a
settlement step; `okx` returns a challenge the caller settles. Per-client
recipes (Claude Code, Codex, OpenClaw, generic stdio), the full environment
list and the tool reference are in
[docs/MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md).

## Documentation

| Doc                                                  | What's in it                                          |
|------------------------------------------------------|-------------------------------------------------------|
| [docs/INDEX.md](docs/INDEX.md)                       | Every document, grouped by role — start here          |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Layering, data flow, evidence rules                   |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)             | Docker, nginx, Caddy, Railway, Render, VPS            |
| [docs/SECURITY.md](docs/SECURITY.md)                 | Threat model, mitigations, redaction                  |
| [docs/API.md](docs/API.md)                           | Full HTTP API reference                               |
| [docs/MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md) | Claude Code / Codex / OpenClaw / generic              |
| [docs/REPOSITORY_INTELLIGENCE_PLAN.md](docs/REPOSITORY_INTELLIGENCE_PLAN.md) | Repository intelligence roadmap |
| [docs/EXTERNAL_ACTIONS.md](docs/EXTERNAL_ACTIONS.md) | The only place that lists what a human must do        |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Pre-tag checklist                                    |
| [docs/OKX_LIVE_INTEGRATION.md](docs/OKX_LIVE_INTEGRATION.md) | Which OKX CLI steps are ready, which need you |
| [docs/OKX_REQUIREMENTS_SNAPSHOT.md](docs/OKX_REQUIREMENTS_SNAPSHOT.md) | The OKX.AI requirements, captured before GA |
| [docs/HERO_IMAGE_BRIEF.md](docs/HERO_IMAGE_BRIEF.md) | Marketplace hero spec                                 |
| [docs/AVATAR_BRIEF.md](docs/AVATAR_BRIEF.md)         | Marketplace avatar spec                               |
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
    core/        analyzers + scoring + report + security + schemas
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

The gates are the point of this repository, so the list is worth reading
rather than skimming. `package.json` is the source of truth; the Makefile
covers the common ones for people who prefer `make`.

| Command                     | What it does                                              |
|-----------------------------|-----------------------------------------------------------|
| `pnpm install`              | Install all workspace deps                                |
| `pnpm dev`                  | Run the API and the web app together                      |
| `pnpm dev:worker`           | Run the worker on its own (the split production shape)    |
| `pnpm build`                | All packages and apps                                     |
| `pnpm typecheck`            | `tsc --noEmit` in every workspace, plus `scripts/`        |
| `pnpm test`                 | All unit + integration tests                              |
| `pnpm lint`                 | tsc + custom static rules                                 |
| `pnpm start`                | Start the API server                                      |
| `pnpm mcp`                  | Start the MCP server over stdio                           |
| `pnpm db:migrate`           | Apply DB migrations (SQLite + Postgres)                   |
| `pnpm db:seed`              | Seed one example audit job, for the admin UI              |
| `pnpm env:check`            | Validate env (no secret values printed)                   |
| `pnpm docs:check`           | Recompute the facts the docs state, and fail on divergence|
| `pnpm docs:facts`           | Rewrite the generated doc blocks in place                 |
| `pnpm docker:check`         | Static Docker check (or full build if Docker is present)  |
| `pnpm compose:check`        | Static docker-compose review                              |
| `pnpm test:baseline`        | Check the documented test totals against a real run       |
| `pnpm preflight:production` | Pre-registration self-check: production config + assets   |
| `pnpm verify:release`       | End-to-end smoke (env → lint → test → build → API → MCP)  |
| `pnpm audit:diff`           | Re-run the four reference audits and diff against baseline|
| `pnpm intelligence:smoke`   | Exercise the four repository-intelligence tools for real  |
| `pnpm probe:child-wait`     | Probe the shared child-process wait's failure branches    |
| `pnpm clean`                | Remove `dist`, `node_modules` and `.turbo`                |
| `make help`                 | `make` aliases for the common targets above               |

`pnpm docs:check` is the one that most often fails a change: it recomputes
the counts the documentation states — workspaces, fixtures, MCP tools,
compose services, prices, citations — and exits non-zero when a document
and the code disagree. When it fails, run `pnpm docs:facts` and read the
diff rather than editing the number by hand.

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
- **The report is deterministic, and there is no LLM hook.** Every score is
  rule-based, and `summary` / `launchCopy` are generated from templates in
  `packages/core/src/report/templates.ts`. `@repopilot/core` used to ship an
  `OpenAICompatibleProvider` and read `LLM_PROVIDER`; both were removed,
  because no code path in the API or the MCP server ever consumed them —
  setting the variable changed nothing about a report, while `pnpm env:check`
  refused to pass without credentials for it. There is no LLM configuration
  left to set. See [RISKS.md](RISKS.md) R-38.

## License

MIT — see [LICENSE](LICENSE).
