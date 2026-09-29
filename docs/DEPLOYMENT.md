# RepoPilot — Deployment

This document covers local development, Docker, the production topology,
the supported reverse proxies, and the production environment variables.
The product does **not** require any cloud provider; a single VPS works fine.

## Contents

- [Local development](#local-development)
- [Process model: API and worker](#process-model-api-and-worker)
- [Single-shot release verification](#single-shot-release-verification)
- [Docker (single image, API only)](#docker-single-image-api-only)
- [Docker Compose (db + migrate + api + worker + web)](#docker-compose-db--migrate--api--worker--web)
- [Production topology](#production-topology)
- [Reverse proxy](#reverse-proxy)
  - [In front of the containers](#in-front-of-the-containers)
  - [nginx or Caddy on the host](#nginx-or-caddy-on-the-host)
- [Database: SQLite vs Postgres](#database-sqlite-vs-postgres)
- [Production env checklist](#production-env-checklist)
- [Platform-specific notes](#platform-specific-notes)
  - [Railway](#railway)
  - [Render](#render)
  - [Plain VPS (Ubuntu 22.04+)](#plain-vps-ubuntu-2204)
- [Operational guardrails](#operational-guardrails)

## Local development

```bash
# 1. Install
pnpm install

# 2. Copy and edit env (the defaults are safe for local)
cp .env.example .env

# 3. Generate + apply Drizzle migrations (SQLite is the default)
pnpm db:generate
pnpm db:migrate

# 4. Run all checks
pnpm env:check
pnpm -r typecheck
pnpm -r test
pnpm build

# 5. Start the API (mock payment)
pnpm --filter @repopilot/api dev          # tsx watch (combined: HTTP + queue)
# or, run API and worker in separate processes:
pnpm --filter @repopilot/api dev:api      # HTTP only
pnpm --filter @repopilot/api dev:worker   # worker only

# 6. Start the web UI in another terminal
pnpm --filter @repopilot/web dev          # http://localhost:5173

# 7. (Optional) Start the MCP server over stdio
pnpm mcp
```

The default port is `4000` for the API and `5173` for the web UI.

## Process model: API and worker

The audit pipeline is async. `POST /api/v1/audits` enqueues a job and
returns `202 Accepted` immediately; a separate worker process is
what actually runs the analysis.

There are two ways to run this:

1. **Combined** (default for `pnpm dev`): one process runs the HTTP
   server and the audit queue. Use this for local development, tests,
   and `verify:release`. Set `REPOPILOT_API_MODE=combined` (or leave
   it unset).
2. **Split** (production): one process is the HTTP server
   (`pnpm start:api`), another is the worker (`pnpm start:worker`).
   The two share the same Postgres-backed queue. The API enqueues,
   the worker consumes. Set `REPOPILOT_API_MODE=http` for the API
   process.

The split mode requires `AUDIT_QUEUE_DRIVER=pg-boss` (production
default). The inline driver is refused at boot when the API is in
`http` mode, because its queue is in-process and the worker process
would not see the enqueued jobs.

Scaling: run as many worker processes as you need. Each one is
independent. The API can also be horizontally scaled; pg-boss handles
distributed enqueueing.

## Single-shot release verification

`scripts/verify-release.ts` boots the API, hits `/health`, runs a
full mock-payment audit cycle, calls the MCP `tools/list`, and shuts
down. Run it before tagging a release:

```bash
pnpm verify:release
# or, with a real public repo at the end:
pnpm verify:release -- --live
```

The script never uses real credentials and never calls OKX.

## Docker (single image, API only)

The default build target is the API. It is multi-stage, runs as a non-root
user, and embeds a `HEALTHCHECK` that calls `/health`.

```bash
docker build -t repopilot:0.1.0-rc.2 .          # → the API image
mkdir -p data                                   # the container runs as uid 1000

# 1. Apply the schema. A fresh database has no tables and `/health` probes one
#    (`repo.list(1)`), so this has to happen before the API is any use.
docker run --rm \
  -e NODE_ENV=development \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.2 \
  node apps/api/dist/db/migrate.js

# 2. Serve.
docker run --rm -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=development \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.2

# Verify
curl http://127.0.0.1:4000/health
```

`NODE_ENV=development` here is deliberate, not a simplification: the API
refuses to start with `NODE_ENV=production` plus `PAYMENT_MODE=mock` or the
default inline queue (`apps/api/src/config.ts` `validateProductionConfig`,
R-02), and a production config also requires a Postgres `DATABASE_URL`. A real
deployment therefore needs `PAYMENT_MODE=okx`, `OKX_PAYMENT_ADDRESS` and
`AUDIT_QUEUE_DRIVER=pg-boss` — which is what the compose file sets, and why it
is the recommended path.

This image serves the API and nothing else. It does **not** serve the UI: the
`apps/web/dist` copy that used to sit inside it was never read by any process,
and it now belongs to the `web` image instead (D-030). To run the whole thing,
use compose.

Bind the published port to loopback as above, not `-p 4000:4000`. See the
warning under *Reverse proxy* — an internet-reachable API is a rate-limit
bypass (R-24).

To build the UI image by hand:

```bash
docker build --target web -t repopilot-web:0.1.0-rc.2 .
```

## Docker Compose (db + migrate + api + worker + web)

```bash
docker compose up -d
docker compose ps                     # `migrate` shows "exited (0)" — that is success
curl http://127.0.0.1:8080/health     # through the edge
curl http://127.0.0.1:8080/           # the UI
docker compose down
```

Five services. **`migrate` runs once and exits; `web` is the only one that
publishes a port.**

| Service   | What it is                                                   | Published          |
|-----------|--------------------------------------------------------------|--------------------|
| `db`      | Postgres 16                                                   | no                 |
| `migrate` | one-shot schema bootstrap, then exits 0                       | no                 |
| `api`     | Fastify HTTP server, enqueue-only (`REPOPILOT_API_MODE=http`)  | `127.0.0.1:4000`   |
| `worker`  | pg-boss consumer                                              | no                 |
| `web`     | nginx: serves `apps/web/dist` at `/`, proxies the API          | `${WEB_PORT:-8080}` |

Notes on the shape:

- The compose file builds **two images from one `Dockerfile`**, selected by
  `target`: `runtime` for `migrate`, `api` and `worker`, `web` for the edge.
- **`migrate` runs before `api` and `worker`**, which wait on
  `service_completed_successfully`. Neither `server.js` nor `worker.js` applies
  migrations, and `/health` probes the database (`repo.list(1)` in `server.ts`),
  so without this step a fresh deployment answers `degraded` forever and every
  audit fails at the database — while every container still reports healthy,
  because `/health` returns HTTP 200 either way. Re-running is safe: every
  statement in `runMigrations` is `IF NOT EXISTS`.
- `db` uses the named volume `repopilot-db`. It does not bind-mount `./data`.
- `api` is published on loopback only. That is a security boundary, not
  tidiness — see the warning under *Reverse proxy* below and R-24.
- `worker` has no port; its healthcheck (`kill -0 1`) only proves the process
  is alive. Worker liveness is visible through the API's queue health.
- The edge's healthcheck fetches `/` and looks for the app shell, so "healthy"
  means "this deployment serves the UI", not merely "nginx started".

Override the edge's port with `WEB_PORT=80 docker compose up -d`.

## Production topology

One public origin. The edge owns `/`; the API is reached only through it.

```text
browser ──► web (nginx)
              ├── /            → apps/web/dist, SPA fallback
              ├── /assets/*    → the same directory, immutable
              ├── /api/*       → api:4000
              ├── /health      → api:4000
              ├── /docs/*      → api:4000
              └── /healthz     → nginx itself
```

Two consequences worth knowing before you deploy:

- **The UI is served from the origin root**, so `apps/web` keeps
  `base: '/'`. A sub-path deployment (`/repopilot/`) would need `base`, the
  router's basename and the proxy's `location` to agree — it is not supported.
- **The API's `GET /` service index is shadowed** by the UI and is only
  reachable from inside the network. That is intentional.

The container config lives at `deploy/nginx/repopilot.conf`; the host-install
templates are in `docs/deployment/`. Both route identically. `pnpm
compose:check` asserts that they do, without needing a Docker CLI.

## Reverse proxy

There are two supported shapes, and they must route the same way.

### In front of the containers

Nothing to do: the `web` service *is* the reverse proxy. Point your DNS at the
host and put TLS in front of it, or terminate TLS in the `web` container by
mounting a certificate and extending `deploy/nginx/repopilot.conf`.

### nginx or Caddy on the host

Use `docs/deployment/nginx.conf.example` or
`docs/deployment/Caddyfile.example`. Both serve the UI at `/` and proxy
`/api/*`, `/health` and `/docs/*` to the API. The essential part is the split,
not the TLS settings:

```nginx
upstream repopilot_api { server 127.0.0.1:4000; keepalive 32; }

server {
  listen 443 ssl;
  server_name example.com;

  root /opt/repopilot/apps/web/dist;
  index index.html;

  # Load-bearing: the API's rate limiter keys on this header, and matches its
  # allowList against that key rather than against req.ip. Without it the API
  # sees 127.0.0.1 — the allowListed address — and rate limiting stops. R-24.
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

  location /api/  { proxy_pass http://repopilot_api; }
  location = /health { proxy_pass http://repopilot_api; }
  location /docs/ { proxy_pass http://repopilot_api; }
  location /      { try_files $uri $uri/ /index.html; }
}
```

> **The API must not be reachable from the internet.** `apps/api/src/server.ts`
> sets `trustProxy: true`, so Fastify believes `X-Forwarded-For` from anyone.
> A directly reachable API is one whose rate limit any client can skip by
> sending `X-Forwarded-For: 127.0.0.1`. Bind it to loopback (`HOST=127.0.0.1`)
> and do not open port 4000 in the firewall. See R-24.

Caddy needs no certificate step: `reverse_proxy` sets `X-Forwarded-For` itself,
appending rather than replacing, which is the behaviour the API needs.

## Database: SQLite vs Postgres

| Concern              | SQLite (dev)              | Postgres (prod)              |
|----------------------|---------------------------|------------------------------|
| Connection string    | `file:./data/repopilot.db` | `postgres://user:pass@host/db` |
| Migrations           | inline `CREATE TABLE IF NOT EXISTS` | same SQL, executed via `client.query` |
| Indexes              | yes                       | yes                          |
| paymentId uniqueness | `UNIQUE` constraint       | `UNIQUE` constraint          |
| Boolean columns      | `INTEGER` (0/1)           | `BOOLEAN`                    |
| JSON columns         | `TEXT`                    | `JSONB`                      |
| Concurrent writers   | one                       | many                         |

The Drizzle schema is hand-written (see `DECISIONS.md` D-005) so the
two paths share the same column names. `pnpm env:check` warns when
`NODE_ENV=production` is paired with a `file:` URL.

To switch from SQLite to Postgres in production:

1. `DATABASE_URL=postgres://...` in the environment
2. Run `pnpm db:migrate` once
3. (Optional) Import jobs with the helper in `scripts/import-sqlite.ts`
   (planned for 0.2.0; until then, do a one-shot job by running the
   pipeline directly)


## Production env checklist

Run `pnpm env:check` with `NODE_ENV=production`. The script fails the
deploy if any of the following is missing or wrong:

- `HOST`, `PORT`, `LOG_LEVEL`
- `DATABASE_URL` (must not start with `file:` in production)
- `CORS_ORIGINS` (must not be `*`)
- `ALLOWED_REPO_HOSTS` (must include at least one host)
- `PAYMENT_MODE` (must be `okx`; `mock` is rejected in production)
- `OKX_PAYMENT_ADDRESS` (if `PAYMENT_MODE=okx`; must be a 0x EVM address)
- `PRICE_QUICK_SCAN` and `PRICE_FULL_AUDIT`

The script never prints the values of any var whose name suggests a
secret.

## Platform-specific notes

The deployable unit is **two images from one Dockerfile**: `runtime` (the API,
and the worker as a separate command) and `web` (nginx + the built UI). A
platform that runs one container per service needs three — the API, the edge,
and the worker — plus a one-shot schema bootstrap that runs before the API
takes traffic. A platform that can only run one container can still host the
API there and the UI somewhere static, but then `CORS_ORIGINS` must name the
UI's origin, because the browser is no longer same-origin (D-030,
consequence 2).

### Railway

- Three services from this repo: the API (default build target, port `4000`),
  the edge (the Dockerfile's `web` target, port `80`), and a background worker
  running `node apps/api/dist/worker.js`. Without the worker the queue is never
  consumed.
- Add a Postgres service and point `DATABASE_URL` at its connection string.
- Apply the schema once before the API takes traffic: a one-shot
  `node apps/api/dist/db/migrate.js` against the same `DATABASE_URL`. A fresh
  database has no tables and `/health` probes one, so the API answers
  `degraded` until this has run.
- Set `NODE_ENV=production`, and `HOST=0.0.0.0` on the API service so the
  platform's router can reach it. That is safe here because the platform's
  router is the only thing that can, and it sets `X-Forwarded-For`.

### Render

- Same three-service split. Set the API service's health check path to
  `/health` and the edge service's to `/`.
- Render's managed Postgres works with the default `postgres://` URL format.
- The worker is a background worker service running
  `node apps/api/dist/worker.js`.
- Run the schema bootstrap once per deploy — a job service running
  `node apps/api/dist/db/migrate.js` — before the API takes traffic.

### Plain VPS (Ubuntu 22.04+)

1. `apt install -y nodejs npm` then `corepack enable`
2. `git clone` the repo, `pnpm install`, `pnpm build` — this also writes
   `apps/web/dist`, which is what the proxy serves
3. `cp .env.example .env` and edit (production values). Keep `HOST=127.0.0.1`
4. `pnpm db:migrate`
5. Create a `systemd` unit pointing at
   `node /opt/repopilot/apps/api/dist/server.js`, and a second one for
   `node /opt/repopilot/apps/api/dist/worker.js`
6. `cp docs/deployment/nginx.conf.example /etc/nginx/sites-available/repopilot.conf`
   and set `root` to the absolute path of `apps/web/dist`
7. `certbot --nginx -d example.com`
8. `systemctl restart repopilot-api repopilot-worker nginx`
9. `curl https://example.com/health` to confirm the proxy reaches the API, and
   open `https://example.com/` for the UI

## Operational guardrails

- **Do not** expose the database port (5432) to the public internet.
  Use a private network (Docker network, VPC, ssh tunnel).
- **Do not** log raw `Authorization` or `X-PAYMENT` headers. The
  default Pino redact list covers both; verify with
  `scripts/redact-check.ts` (planned for 0.2.0).
- **Do not** commit `.env`. The repo's `.gitignore` already excludes it.
- **Do** run `pnpm env:check` as a pre-deploy step in your CI.
- **Do** keep the image's `HEALTHCHECK` enabled; it calls `/health`
  and lets the orchestrator restart the container if it stops
  responding.
