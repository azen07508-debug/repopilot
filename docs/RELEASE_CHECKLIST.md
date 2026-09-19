# RepoPilot — Release Checklist (0.1.0-rc.1)

Use this checklist before tagging a release. Each item has a command
or a file you can point at.

## Code health

- [ ] **Lint clean** — `pnpm lint` (0 issues)
- [ ] **Typecheck clean** — `pnpm -r typecheck`
- [ ] **Unit + integration tests pass** — `pnpm -r test` (104/104 in dev;
      106/106 in CI once the Postgres service container is up; includes
      12 cache-service unit tests, 11 API integration tests, 3 SQLite
      repository tests, plus 61 core + 16 okx-adapter + 1 mcp-server)
- [ ] **End-to-end smoke pass** — `pnpm verify:release`
- [ ] **Build succeeds** — `pnpm build` (all 5 packages + 2 apps)

## Environment and config

- [ ] **`.env.example` is current** — every var in `apps/api/src/config.ts`
      has an entry, and vice versa
- [ ] **`pnpm env:check` passes** — both in `development` and
      `production` mode (the latter is exercised by the CI matrix)
- [ ] **No real secrets in the repo** — `pnpm lint` flags
      `no-hardcoded-secret`; verify with `git log -p | grep -E "TOKEN|KEY|SECRET"`
- [ ] **CORS is not `*` in production** — `pnpm env:check` enforces it
- [ ] **Payment mode is `okx` in production** — `pnpm env:check`
      enforces it

## Containers

- [ ] **Dockerfile builds** — `pnpm docker:check` (or CI)
- [ ] **Container `/health` is 200** — CI does this in
      `.github/workflows/docker.yml`
- [ ] **Docker compose stacks up** — `docker compose up -d` and
      `docker compose ps` is healthy

## Database

- [ ] **SQLite migrations run** — `pnpm db:migrate` on dev
- [ ] **Postgres migrations run** — exercised by CI service container
- [ ] **`paymentId` is unique** — schema check (both backends)

## Payment

- [ ] **Mock payment end-to-end works** — covered by
      `pnpm verify:release`
- [ ] **paymentId is idempotent** — covered by
      `apps/api/src/tests/api.integration.test.ts`
- [ ] **OKX adapter refuses to start when unconfigured** — covered
      by `packages/okx-adapter/src/okx-adapter.test.ts`
- [ ] **OKX adapter is documented as STUB** — see
      `docs/EXTERNAL_ACTIONS.md` item 2 and `README_OKX.md`

## MCP

- [ ] **stdio initialize + tools/list works** — covered by
      `pnpm verify:release`
- [ ] **Inputs are Zod-validated** — see
      `packages/mcp-server/src/index.ts`
- [ ] **Errors are structured** — same file
- [ ] **No internal stack traces in tool output** — same file

## Web UI

- [ ] **`pnpm --filter @repopilot/web build` succeeds** — vite build
      outputs to `apps/web/dist`
- [ ] **No console errors when loading the form** — manual check
- [ ] **Mobile breakpoint works** — manual check

## Documentation

- [ ] **`README.md` is the public face** — no internal jargon, no
      TODO references
- [ ] **`README_OKX.md` is current** — last update note matches
      DECISIONS D-003
- [ ] **`MARKETPLACE_LISTING.md` EN and CN sections are present**
- [ ] **`docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
      `docs/SECURITY.md`, `docs/API.md`, `docs/MCP_CLIENT_SETUP.md`**
      all link from the README
- [ ] **`docs/EXTERNAL_ACTIONS.md`** lists every real-world action
      that the user must perform
- [ ] **`docs/RELEASE_CHECKLIST.md`** (this file) is up to date
- [ ] **`CHANGELOG.md`** has a section for the new tag
- [ ] **`PROJECT_STATE.md`** describes the released version
- [ ] **`DECISIONS.md`** captures every architectural change in this
      release

## Legal / compliance

- [ ] **`LICENSE` exists** (MIT)
- [ ] **No third-party brand logos** in the repo unless licence allows
- [ ] **Marketplace listing does not claim "formal security audit"**
- [ ] **Marketplace listing does not promise returns**

## Release mechanics

When everything above is green:

1. `git tag -a v0.1.0-rc.1 -m "Release candidate 1"`
2. `git push origin v0.1.0-rc.1` (only if the user has authorized
   the push)
3. `git push origin sprint/default` (or the current branch)
4. Create a GitHub Release from the tag with the CHANGELOG excerpt

**Do not**

- Do not delete existing tags
- Do not rewrite published history
- Do not push without explicit user consent

## Post-release

- [ ] **Watch for issues** in the next 14 days before tagging v0.1.0
- [ ] **Update `PROJECT_STATE.md`** to point at the released tag
