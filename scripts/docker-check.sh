#!/usr/bin/env bash
# docker:check — verify the Dockerfile + compose configuration.
#
# Two halves. The static half (sections 1–4) always runs and **fails the
# script** on any ✗. The build half (sections 6–7) needs a Docker CLI; without
# one it prints a clear message and exits 0, because a missing Docker is an
# environment fact rather than a defect (`--strict` turns that into an error
# too).
#
# The static half used to be advisory — `err` printed a red ✗ and the script
# still exited 0 — which made it unusable as a CI gate. It is one now.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

ERRS=0
log()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; ERRS=$((ERRS + 1)); }

echo "docker:check"
echo "──────────────────────────────────────────────"

# 1. Static config presence
echo "1. Static config"
for f in Dockerfile docker-compose.yml .dockerignore; do
  if [ -f "$f" ]; then ok "$f present"; else err "$f missing"; fi
done

# 2. Required Dockerfile directives
echo "2. Dockerfile sanity"
need_lines=("FROM " "WORKDIR " "COPY " "RUN " "CMD " "HEALTHCHECK " "USER ")
for needle in "${need_lines[@]}"; do
  if grep -q -- "$needle" Dockerfile 2>/dev/null; then
    ok "has '$needle'"
  else
    warn "no '$needle' (acceptable in some setups)"
  fi
done
if grep -q '^USER ' Dockerfile; then
  ok "runs as non-root"
else
  warn "no USER directive — runs as root inside the container"
fi

# 2b. The Node base image must match the toolchain the repo actually runs on.
#
# Two silent traps live here:
#
#   * `packageManager` pins pnpm, and pnpm decides which Node it needs. pnpm 11
#     does not run on Node 20 — it exits with ERR_UNKNOWN_BUILTIN_MODULE partway
#     through `pnpm install`. That is how this check came to exist: the image
#     had never built, and the PR-only Docker workflow meant nobody saw it.
#   * `node_modules` is copied from `builder` into `runtime` and contains a
#     compiled native module (`better-sqlite3`). Two stages on different Node
#     majors are two different ABIs, and the mismatch surfaces at *runtime* as
#     NODE_MODULE_VERSION, not at build time.
#
# `engines.node` is the declaration of record, so the Dockerfile has to agree
# with it rather than with a number someone typed once.
echo "2b. Node base image"
# `|| true` on both: a failed `grep` here is a fact to report, not a reason to
# abort under `set -e`/`pipefail` with a truncated diagnostic.
engines_node="$(node -e "process.stdout.write(require('./package.json').engines.node)" 2>/dev/null || echo '')"
engines_major="$(printf '%s' "$engines_node" | grep -oE '[0-9]+' | head -1 || true)"
docker_majors="$(grep -oE '^FROM node:[0-9]+' Dockerfile 2>/dev/null | grep -oE '[0-9]+$' | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
major_count="$(printf '%s' "$docker_majors" | wc -w | tr -d '[:space:]')"
if [ "$major_count" = "0" ]; then
  warn "no 'FROM node:<major>' stage found in the Dockerfile"
elif [ "$major_count" != "1" ]; then
  err "stages disagree on the Node major ($docker_majors) — node_modules is copied between them, so the native modules' ABI will not match"
elif [ -n "$engines_major" ] && [ "$docker_majors" -lt "$engines_major" ]; then
  err "Dockerfile uses Node $docker_majors but engines.node is '$engines_node'"
else
  ok "Node $docker_majors (engines.node '$engines_node')"
fi

# 3. Compose services
echo "3. docker-compose sanity"
if grep -q '^services:' docker-compose.yml 2>/dev/null; then
  ok "services: block present"
fi
if grep -q 'healthcheck' docker-compose.yml 2>/dev/null; then
  ok "healthcheck configured"
else
  warn "no healthcheck in compose"
fi

# 4. .env not in image
echo "4. .env exclusion"
if [ -f .dockerignore ] && grep -q '^\.env$' .dockerignore; then
  ok ".env excluded"
else
  warn ".env is not in .dockerignore"
fi

# Any ✗ above is a defect, not a note. Exit before the build half so that a
# static failure cannot be masked by a Docker-less environment skipping
# straight to a 0.
if [ "$ERRS" -gt 0 ]; then
  echo
  err "$ERRS static check(s) failed"
  exit 1
fi

# 5. docker CLI presence
echo "5. docker CLI"
if command -v docker >/dev/null 2>&1; then
  ok "docker CLI present"
  echo "6. build (may take a few minutes)"
  if docker build -t repopilot:check . >/tmp/docker-build.log 2>&1; then
    ok "build succeeded"
  else
    err "build failed; see /tmp/docker-build.log"
    tail -30 /tmp/docker-build.log
    exit 1
  fi
  echo "7. smoke (start, /health, stop)"
  # `NODE_ENV=development` and an explicit `AUDIT_QUEUE_DRIVER`, on purpose.
  # `NODE_ENV=production` with `PAYMENT_MODE=mock` — what this used to say — is
  # refused outright by `validateProductionConfig` (R-02), and so is the
  # `inline` default this script never set. The container would have exited
  # before the first request, and the failure would have read as "/health never
  # returned 200".
  #
  # The migrate step is the same ordering `docker-compose.yml` enforces: the
  # server does not apply migrations and `/health` probes the database, so
  # without it the API answers `degraded` forever.
  docker run --rm -d --name repopilot-check -p 4011:4000 \
    -e NODE_ENV=development \
    -e PAYMENT_MODE=mock \
    -e AUDIT_QUEUE_DRIVER=inline \
    -e DATABASE_URL=file:/tmp/repopilot-check.db \
    -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
    repopilot:check \
    sh -c 'node apps/api/dist/db/migrate.js && exec node apps/api/dist/server.js' >/dev/null
  sleep 2
  for i in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -sS -o /tmp/health.json -w '%{http_code}' http://127.0.0.1:4011/health || echo 000)
    if [ "$code" = "200" ]; then
      ok "/health 200 after ${i}s"
      cat /tmp/health.json; echo
      docker stop repopilot-check >/dev/null
      exit 0
    fi
    sleep 1
  done
  err "/health never returned 200"
  docker logs repopilot-check 2>&1 | tail -20 || true
  docker stop repopilot-check >/dev/null
  exit 1
else
  warn "Docker CLI not present in this environment"
  warn "Skipping build and smoke. This is OK on dev sandboxes;"
  warn "CI (.github/workflows/docker.yml) will exercise the full build."
  if [ "$STRICT" = "1" ]; then
    err "strict mode requested and Docker is missing"
    exit 1
  fi
  exit 0
fi
