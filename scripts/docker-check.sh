#!/usr/bin/env bash
# docker:check — verify the Dockerfile + compose configuration.
#
# Without Docker, this script reports a clear message and exits 0
# (use --strict to exit 1 instead). With Docker, it builds the image
# and runs a /health smoke check.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

log()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

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
  docker run --rm -d --name repopilot-check -p 4011:4000 \
    -e NODE_ENV=production \
    -e PAYMENT_MODE=mock \
    -e DATABASE_URL=file:/tmp/repopilot-check.db \
    -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
    repopilot:check >/dev/null
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
