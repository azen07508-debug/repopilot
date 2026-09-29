# Multi-stage build for RepoPilot API + MCP server
FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/okx-adapter/package.json packages/okx-adapter/package.json
RUN pnpm install --filter @repopilot/core... --filter @repopilot/okx-adapter... --filter @repopilot/mcp-server... --filter @repopilot/api... --frozen-lockfile=false
COPY . .
RUN pnpm --filter @repopilot/core build && \
    pnpm --filter @repopilot/okx-adapter build && \
    pnpm --filter @repopilot/mcp-server build && \
    pnpm --filter @repopilot/api build && \
    pnpm --filter @repopilot/web build

# -----------------------------------------------------------------------------
# Web / edge image: nginx serving the built UI and proxying the API.
#
# This stage sits *before* `runtime` on purpose. Docker's default build target
# is the last stage in the file, and `docker:check` and `.github/workflows/
# docker.yml` both build the file without `--target` expecting the API image.
# Appending this stage at the end would have silently changed what `docker
# build .` produces.
#
# It is a separate image rather than a second process in the API container
# because the two have nothing to say to each other: nginx needs a filesystem
# of static files, the API needs a database and a GitHub token. Splitting them
# also means the edge can be rebuilt and restarted without touching a queue
# worker mid-job.
# -----------------------------------------------------------------------------
FROM nginx:1.30-alpine AS web

# The stock image ships a welcome page at this path. Removing it first means a
# failed `COPY` below cannot leave nginx serving "Welcome to nginx!" while the
# healthcheck happily passes.
RUN rm -rf /usr/share/nginx/html/*

# The edge config, plus the shared header snippet it `include`s. The snippet
# lives in its own file because nginx's `add_header` inheritance is
# all-or-nothing per block — see the comment at the top of the snippet.
COPY deploy/nginx/repopilot.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/snippets/ /etc/nginx/snippets/

COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

# Liveness of the edge itself, deliberately not proxied to the API: if the API
# is down, the edge can still serve the UI's static shell, and restart-looping
# it would turn a partial outage into a total one. The stronger check — "does
# `/` actually serve the app?" — is the compose healthcheck, because that is a
# question about a deployment rather than about this image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

# -----------------------------------------------------------------------------
# API runtime image.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
# `apps/web/dist` used to be copied in here as well, and nothing in this image
# ever read it: there is no static plugin in `apps/api`, no `sendFile`, and no
# catch-all route, so the API has never served the UI. It now lives in the
# `web` image, which is the only thing that serves it.
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/packages/core/package.json ./packages/core/package.json
COPY --from=builder /repo/packages/okx-adapter/dist ./packages/okx-adapter/dist
COPY --from=builder /repo/packages/okx-adapter/package.json ./packages/okx-adapter/package.json
COPY --from=builder /repo/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /repo/packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health | grep -q '"status":"ok"' || exit 1
# The CMD is overridden by docker-compose for the worker service.
# `worker` runs the audit queue consumer only; `api` runs the HTTP
# server in enqueue-only mode. Both share the same image and the
# same Postgres-backed pg-boss queue.
CMD ["node", "apps/api/dist/server.js"]
