# RepoPilot — Deployment

This document covers local development, Docker, the supported reverse
proxies, and the production environment variables. The product does
**not** require any cloud provider; a single VPS works fine.

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

## Docker (single image)

```bash
docker build -t repopilot:0.1.0-rc.2 .
docker run --rm -p 4000:4000 \
  -e NODE_ENV=production \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.2

# Verify
curl http://127.0.0.1:4000/health
```

The image is multi-stage, runs as a non-root user, and embeds a
`HEALTHCHECK` that calls `/health`.

## Docker Compose (api + Postgres)

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
docker compose down
```

The compose file:

- Builds the image from `Dockerfile`
- Mounts `./data/postgres` and `./data/api` for persistence
- Wires `DATABASE_URL=postgres://...` to the API container
- Waits for Postgres health before starting the API

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

## Reverse proxy: nginx

`docs/deployment/nginx.conf.example` provides a full template. The
essentials are:

```nginx
# Redirect HTTP -> HTTPS
server {
  listen 80;
  server_name api.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  # Real client IP (Fastify uses req.ip)
  real_ip_header X-Forwarded-For;
  set_real_ip_from <reverse_proxy_internal_subnet>;

  client_max_body_size 5m;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }
}
```

## Reverse proxy: Caddy

`docs/deployment/Caddyfile.example` provides a full template. The
essentials are:

```caddy
api.example.com {
  encode gzip zstd
  reverse_proxy 127.0.0.1:4000 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    transport http {
      read_timeout 120s
      dial_timeout 10s
    }
  }
}
```

Caddy will automatically request a Let's Encrypt certificate.

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

### Railway

- Use the `Dockerfile`; expose port `4000`
- Add a Postgres service and point `DATABASE_URL` at its connection
  string
- Set `NODE_ENV=production` in the service variables

### Render

- Use the `Dockerfile`; set the health check path to `/health`
- Render's managed Postgres works with the default `postgres` URL format

### Plain VPS (Ubuntu 22.04+)

1. `apt install -y nodejs npm` then `corepack enable`
2. `git clone` the repo, `pnpm install`, `pnpm build`
3. `cp .env.example .env` and edit (production values)
4. `pnpm db:migrate`
5. Create a `systemd` unit pointing at `node /opt/repopilot/apps/api/dist/server.js`
6. `cp docs/deployment/nginx.conf.example /etc/nginx/sites-available/api.conf`
7. `certbot --nginx -d api.example.com`
8. `systemctl restart repopilot nginx`
9. `curl https://api.example.com/health` to confirm

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
