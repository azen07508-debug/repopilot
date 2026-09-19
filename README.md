# RepoPilot

**One repo in. A launch-ready plan out.**

RepoPilot audits public GitHub repositories and returns a structured
launch-readiness report. The report has evidence-backed findings,
explainable scoring, and ready-to-paste launch copy. It is built for
Web3 developers, hackathon contestants, and other AI agents.

📚 **Looking for a specific doc?** Start at
[docs/INDEX.md](docs/INDEX.md) — it lists every document with one-line
descriptions and points you at the right one.

RepoPilot runs **static analysis only**. It does not execute the
audited repository's code. It does not perform a formal security
audit. It does not custody funds or read private keys.

## Why RepoPilot

- **Evidence first.** Every finding has at least one `path:line:reason`
  pointer. The score is rule-based and reproducible.
- **Built for AI agents.** The report is a single JSON document with
  a stable schema (`reportVersion: "1.0"`). The MCP server exposes
  three tools so any MCP-compatible client can drive it.
- **No surprise charges.** A `MockPaymentAdapter` is the default;
  the real `OkxPaymentAdapter` is opt-in. See
  [`docs/EXTERNAL_ACTIONS.md`](docs/EXTERNAL_ACTIONS.md) for the
  Beta gate.
- **No execution.** The pipeline reads text only. Binary files are
  skipped, prompts-injection patterns are reported as findings, and
  the LLM (when enabled) is restricted to natural-language copy.

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

Or with Docker:

```bash
docker build -t repopilot:0.1.0-rc.1 .
docker run --rm -p 4000:4000 \
  -e NODE_ENV=production -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.1
```

A first audit takes 5–15 seconds for a typical `mode: 'quick'`:

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

## Documentation

| Doc                                                  | What's in it                                          |
|------------------------------------------------------|-------------------------------------------------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Layering, data flow, evidence rules                   |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)             | Docker, nginx, Caddy, Railway, Render, VPS            |
| [docs/SECURITY.md](docs/SECURITY.md)                 | Threat model, mitigations, redaction                  |
| [docs/API.md](docs/API.md)                           | Full HTTP API reference                               |
| [docs/MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md) | Claude Code / Codex / OpenClaw / generic              |
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

```
repopilot/
  apps/
    api/      Fastify HTTP API
    web/      React + Vite admin UI
  packages/
    core/        analyzers + scoring + report + security + schemas + llm
    mcp-server/  MCP server (stdio)
    okx-adapter/ PaymentAdapter interface, mock + OKX implementations
  fixtures/      5 sample repos for tests
  docs/          ARCHITECTURE / DEPLOYMENT / SECURITY / API / MCP / EXTERNAL
  scripts/       env-check, verify-release, docker-check, lint
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
  with a valid `OKX_PAYMENT_ADDRESS`. To publish the marketplace listing,
  run `onchainos agent register --role asp` (see
  [docs/EXTERNAL_ACTIONS.md](docs/EXTERNAL_ACTIONS.md) item 2). The product
  still ships with `PAYMENT_MODE=mock` as the default so the full audit
  flow works without external services.
- `mode: 'full'` runs synchronously inside the HTTP request. Very
  large repos (> 50 MiB / 2000 files) may time out. A background
  worker is on the P1 backlog.
- The LLM is optional. With `LLM_PROVIDER=noop` the `summary` and
  `launchCopy` are template-generated; scores are always
  rule-based.

## License

MIT — see [LICENSE](LICENSE).

