# RepoPilot — Makefile
#
# For users who prefer make to pnpm. The targets mirror the package.json
# scripts exactly; this file is a thin convenience layer, not a replacement.
#
# Usage:
#   make help
#   make install
#   make verify

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

.PHONY: help install lint typecheck test build clean \
        env:check docker:check compose:check verify:release \
        db:migrate db:seed dev:api dev:web mcp

help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_.-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## pnpm install
	pnpm install

lint: ## pnpm lint (tsc + project static rules)
	pnpm lint

typecheck: ## pnpm -r typecheck
	pnpm -r typecheck

test: ## pnpm -r test
	pnpm -r test

build: ## pnpm build
	pnpm build

env:check: ## pnpm env:check
	pnpm env:check

docker:check: ## pnpm docker:check
	pnpm docker:check

compose:check: ## pnpm compose:check
	pnpm compose:check

verify: verify:release ## alias for verify:release

verify:release: ## Full end-to-end smoke
	pnpm verify:release

db:migrate: ## pnpm db:migrate
	pnpm db:migrate

db:seed: ## pnpm db:seed
	pnpm db:seed

dev:api: ## pnpm dev:api
	pnpm dev:api

dev:web: ## pnpm dev:web
	pnpm dev:web

mcp: ## pnpm mcp
	pnpm mcp

clean: ## pnpm clean (remove dist, node_modules, .turbo)
	pnpm clean
