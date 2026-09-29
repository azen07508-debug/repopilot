# Multi-stage build for RepoPilot API + MCP server
#
# Node 22, not 20, and both stages agree on it. Two reasons, neither of which
# fails at build time when it is wrong:
#
#   * `packageManager` pins `pnpm@11.11.0`, which does not run on Node 20. It
#     dies partway through `pnpm install` with `ERR_UNKNOWN_BUILTIN_MODULE`,
#     so the image has never built.
#   * `node_modules` is copied from `builder` into `runtime` and it contains a
#     compiled native module (`better-sqlite3`). Different Node majors are
#     different ABIs, so a mismatch there fails at *runtime* with
#     `NODE_MODULE_VERSION`, not here.
#
# `engines.node` declares the requirement; `docker:check` asserts the two agree.
FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable
# `.npmrc` is not optional here. It carries `shamefully-hoist=true`, which
# decides whether `better-sqlite3` and the `@repopilot/*` workspace links land
# in the root `node_modules` or only in each package's own. The `runtime` stage
# copies the root `node_modules` and nothing else, so without this file the
# install produces a different layout than every other install in this repo and
# the container dies at startup with
#
#     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3'
#     imported from /app/apps/api/dist/db/client.js
#
# `COPY . .` does bring `.npmrc` in — one stage too late to matter.
# `docker:check` asserts that every file which changes how `pnpm install`
# resolves dependencies is copied before it runs.
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/okx-adapter/package.json packages/okx-adapter/package.json
# `--filter ...` decides what exists in `node_modules`; the build list below
# decides what gets compiled. `@repopilot/web` used to be in the second and not
# the first, so `tsc && vite build` ran against a missing `node_modules` and
# died with `TS2688: Cannot find type definition file for 'vite/client'` — one
# stage after the install had succeeded, which is why it read as a web problem
# rather than an install problem. `docker:check` now asserts the two lists
# agree, because they are two hand-maintained lists in one file.
RUN pnpm install --filter @repopilot/core... --filter @repopilot/okx-adapter... --filter @repopilot/mcp-server... --filter @repopilot/api... --filter @repopilot/web... --frozen-lockfile=false
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
#
# Each workspace package needs **two** things copied, not one: its `dist` and
# its own `node_modules`. pnpm does not hoist a sub-package's dependencies to
# the workspace root — `shamefully-hoist` only affects the root project's own
# dependencies. `apps/api/node_modules/better-sqlite3` is a symlink into the
# root `node_modules/.pnpm/...`, and `apps/api/node_modules/@repopilot/core` is
# a relative link to `../../../../packages/core`. Copying the root tree alone
# therefore produces an image that builds cleanly and then dies on its first
# import:
#
#     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3'
#     imported from /app/apps/api/dist/db/client.js
#
# The per-package directories are symlink farms — tens of kilobytes each — so
# copying them costs nothing. The relative link targets resolve because the
# root `.pnpm` store is copied alongside them.
#
# `docker:check` asserts that every package whose `dist` is copied here also
# has its `node_modules` copied.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
# `apps/web/dist` used to be copied in here as well, and nothing in this image
# ever read it: there is no static plugin in `apps/api`, no `sendFile`, and no
# catch-all route, so the API has never served the UI. It now lives in the
# `web` image, which is the only thing that serves it.
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/packages/core/package.json ./packages/core/package.json
COPY --from=builder /repo/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /repo/packages/okx-adapter/dist ./packages/okx-adapter/dist
COPY --from=builder /repo/packages/okx-adapter/package.json ./packages/okx-adapter/package.json
COPY --from=builder /repo/packages/okx-adapter/node_modules ./packages/okx-adapter/node_modules
COPY --from=builder /repo/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /repo/packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY --from=builder /repo/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
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
