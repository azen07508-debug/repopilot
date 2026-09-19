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

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/web/dist ./apps/web/dist
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
