# RepoPilot — External Actions

This is the **only** document that lists steps a human must perform.
Nothing in here is a code TODO; everything is an action that requires
either a real account, real money, a real domain, or human judgement.

If you are looking for a checklist of code work, see
`docs/RELEASE_CHECKLIST.md` and `BACKLOG.md`.

---

## 1. Docker build and smoke (sandbox not present)

**Status:** `EXTERNAL_BLOCKED`
**Why:** The dev sandbox where RepoPilot is built does not have a
Docker CLI. The Dockerfile and compose file are validated statically
by `pnpm docker:check`, but a real build only runs on a host with
Docker.

**Action**

```bash
# On any host with Docker 24+ installed:
cd /path/to/repopilot
docker build -t repopilot:0.1.0-rc.3 .
mkdir -p data                                   # the container runs as uid 1000

# 1. Apply the schema. `/health` probes the database, and a fresh one has no
#    tables, so this has to happen before the API is any use.
docker run --rm \
  -e NODE_ENV=development \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.3 \
  node apps/api/dist/db/migrate.js

# 2. Serve.
docker run --rm -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=development \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.3

curl http://127.0.0.1:4000/health
```

`NODE_ENV=development` here is not a simplification, and it is what makes the
acceptance below reachable. `validateProductionConfig`
(`apps/api/src/config.ts`, R-02) refuses `NODE_ENV=production` together with
`PAYMENT_MODE=mock`, so a container that is told it is in production cannot
also report `paymentMode: "mock"`. The two conditions are mutually exclusive;
before 2026-10-05 this block asked for both, which made the acceptance
unmeetable. For a production topology use `docker-compose.yml`.

**Acceptance**

- `docker build` exits 0
- `/health` returns `{"status":"ok","paymentMode":"mock","database":"ok"}`
- `pnpm docker:check` exits 0 on a host with Docker

**CI mirror:** `.github/workflows/docker.yml` runs the same build on
every PR. If CI is green, you do not need to repeat this manually.

---

## 2. OKX.AI Agent Marketplace listing

**Status:** `READY_TO_PUBLISH` (Marketplace went GA 2026-06-30).
**Why:** No code change is required. The `OkxPaymentAdapter` is fully
wired (EIP-3009 + EIP-712 signature verification on xLayer / Ethereum /
Base / Arbitrum / BSC, USDT settlement). The seller side only needs a
valid `OKX_PAYMENT_ADDRESS`. Publishing the listing is a self-serve
CLI step.

**Action**

1. Self-register as an ASP (Agent Service Provider):
   ```
   onchainos agent pre-check --role asp
   onchainos agent create --role asp --name "RepoPilot" --description "..."
   ```
2. Add a service endpoint that points at this API's `POST /api/v1/audits`:
   ```
   onchainos agent add-service --agent-id <id> --service '{...}'
   ```
3. Activate the listing:
   ```
   onchainos agent activate --agent-id <id>
   ```
4. Set the following in your production environment, **never** in a
   commit or chat:
   - `OKX_PAYMENT_ADDRESS=0x...` (your settlement address on xLayer;
     this is your wallet's EVM address, **not** the Onchain OS API key)
   - `OKX_PAYMENT_NETWORK=xlayer`
   - `OKX_X402_VERSION=2`
   - `PAYMENT_MODE=okx`
5. Run `pnpm env:check` and confirm there are no `OKX_PAYMENT_ADDRESS`
   errors.
6. Restart the API. The `/health` endpoint should now report
   `"paymentMode":"okx"`.

**Do not**

- Do not paste the keys into chat, issues, or commits
- Do not commit the `.env` file
- Do not run a real charge against the Beta test wallet during this
  exercise; use the documented test payment flow from the OKX
  documentation

**Documentation:** `README_OKX.md` has the full integration guide.

---

## 3. GitHub token for production

**Status:** `OPTIONAL`
**Why:** Anonymous requests are limited to 60/hour. Production
deployments will hit that limit immediately.

**Action**

1. Create a fine-grained personal access token at
   <https://github.com/settings/tokens> with:
   - Resource owner: your organization
   - Repository access: `Public Repositories (read-only)`
   - Permissions: `Metadata: Read-only` (the default)
2. Set `GITHUB_TOKEN=...` in the production environment.

**Do not**

- Do not grant `Contents: Read & Write` — RepoPilot only reads
- Do not use a classic PAT when a fine-grained one will do
- Do not paste the token into chat, issues, or commits

---

## 4. PostgreSQL for production

**Status:** `OPTIONAL`
**Why:** The default `DATABASE_URL` is SQLite, which is fine for dev
and small deployments. Production traffic benefits from Postgres
concurrency.

**Action**

1. Provision a Postgres 16+ instance (managed: AWS RDS, DigitalOcean,
   Supabase; self-hosted: `docker compose up postgres` is already
   included).
2. Set `DATABASE_URL=postgres://user:CHANGE_ME@host:5432/repopilot`
   in the production environment.
3. Run `pnpm db:migrate` once on the first deploy.
4. `pnpm env:check` will warn that SQLite is in use while the new URL
   is not yet active; the warning is fine during the migration
   window.

**Do not**

- Do not expose port 5432 to the public internet
- Do not use the database user with superuser privileges
- Do not commit the connection string

---

## 5. Domain, DNS, and TLS

**Status:** `REQUIRED before PAYMENT_MODE=okx can run in production`
**Why:** HTTPS is required in production, and the domain is not cosmetic:
it is what `OKX_PAYMENT_RESOURCE_URL` is built from, and that variable is
a boot invariant when `PAYMENT_MODE=okx` (see item 2). Without a real
domain there is no value to put there, so the API refuses to start
rather than emitting a 402 challenge that names a resource the buyer
cannot fetch. The reverse-proxy templates in `docs/deployment/` use
placeholder domains. This item used to say `OPTIONAL`; it stopped being
optional when the resource URL became a guard.

**Action**

1. Choose a domain (e.g. `api.example.com`).
2. Create an A or AAAA record pointing to the host running the API.
3. Either:
   - Use Caddy: `cp docs/deployment/Caddyfile.example Caddyfile`,
     replace `api.example.com`, run `caddy run`.
   - Use nginx: `cp docs/deployment/nginx.conf.example /etc/nginx/sites-available/repopilot.conf`,
     replace `api.example.com`, run `certbot --nginx -d api.example.com`,
     reload nginx.
4. Verify: `curl https://api.example.com/health`.
5. Set `OKX_PAYMENT_RESOURCE_URL=https://api.example.com/api/v1/audits`,
   then run `pnpm preflight:production` and confirm this is no longer one
   of the FAILs.

**Do not**

- Do not skip HTTPS in production
- Do not run with self-signed certs

---

## 6. Marketplace listing submission

**Status:** `BLOCKED on a production deployment` (item 5)
**Why:** This item said `BLOCKED on Beta` until 2026-10-05, and item 2 has
said `READY_TO_PUBLISH` since the marketplace went GA on 2026-06-30. Two
items in the same document disagreed about whether the gate exists, which
is the defect class `docs:check` exists for — except that these two are
prose, so nothing could compare them.

What actually blocks the submission is that an `A2MCP` service needs a
publicly reachable `https://` endpoint, and there is no deployment yet:
the domain (item 5) has to exist before `OKX_PAYMENT_RESOURCE_URL` can be
set, and the API refuses to boot in production without it. Both brand
assets exist — the listing banner is `docs/brand/hero.png` and the 1:1
registration picture is `docs/brand/avatar.png` (item 7 explains why
there are two).

**Action**

1. Deploy (item 5), then run `pnpm preflight:production` and confirm it
   reports no FAILs.
2. Copy the `MARKETPLACE_LISTING.md` English and Chinese sections into
   the marketplace submission form.
3. Upload the listing banner (`docs/brand/hero.png`).
4. Register the prices exactly as `docs/OKX_REQUIREMENTS_SNAPSHOT.md`
   §5.2–§5.4 gives them. Do not read them off `.env.example` by hand —
   that file is one of the twelve places that state the same numbers, and
   `pnpm docs:check` is what keeps every one of them in agreement. If it
   passes, the number you read anywhere is the number the 402 challenge
   will ask for.
5. Verify the listing preview matches the README.

**Do not**

- Do not promise "formal security audit" in the listing copy
- Do not promise returns or upside
- Do not include OKX official logos unless the platform rules allow

---

## 7. Brand assets (two of them, and they are not interchangeable)

**Status:** `DONE`
**Why this item used to say `EXTERNAL_BLOCKED`:** it claimed no brand
asset was bundled. That stopped being true when `docs/brand/hero.png`
was committed — the item was never updated, and it also told the reader
to `git add -f` because `.gitignore` excluded binaries. It does not;
there is no such rule.

**There are two assets, and the marketplace wants different shapes:**

| Asset | File | Shape | Used for |
| --- | --- | --- | --- |
| Listing banner | `docs/brand/hero.png` | 1280 × 640 (2:1) | The listing page and the README front door |
| ASP registration picture | `docs/brand/avatar.png` | 1:1 square | `onchainos agent create --picture` |

The registration picture is **not** the banner. §1.2 of
`docs/OKX_REQUIREMENTS_SNAPSHOT.md` asks for a 1:1 image at
`--picture`; uploading the 2:1 banner there either gets rejected by
`validate-listing` or gets centre-cropped, which cuts the wordmark off
the left edge and the terminal off the right.

**Action (already done — this is the record of what was produced)**

1. `docs/HERO_IMAGE_BRIEF.md` is the spec for the banner.
2. `docs/AVATAR_BRIEF.md` is the spec for the square.
3. Both are committed and tracked. No `git add -f` is needed.

**If you need to replace one**

- Keep the shape. A 2:1 file in `--picture` is the failure this item
  exists to prevent.
- Keep it under 1 MB — the marketplace rejects anything larger.
- `pnpm preflight:production` re-checks both files' dimensions and size
  and fails with the number it measured, so you do not have to eyeball
  it.

---

## What is *not* on this list

- Code work: see `BACKLOG.md` and `docs/RELEASE_CHECKLIST.md`
- **The LLM provider — removed, so there is nothing to configure.** This was
  item 8: set `LLM_PROVIDER=openai-compatible` plus a key, base URL and model,
  restart, and expect a richer `summary` and `launchCopy` on the first gate.
  That never happened. The provider was built from those variables and passed
  into `buildApp`, and no code path read it — `PipelineInput` carried only the
  two provenance strings, and `polishFixPlanSet()` was called by its own test
  and nothing else. Setting the variables changed nothing about a report, while
  `pnpm env:check` refused to pass without them. All of it is gone (R-38): the
  four variables, the provider classes, the prompt builder, `polishFixPlanSet()`
  and the `llmEnhanced` flag it set. There is no LLM configuration left to get
  wrong, which is why this is no longer an item on any list. The measurement is
  in RISKS.md R-38; the design constraint it protects — no LLM may ever write a
  score, a priority or a piece of evidence — is now structural rather than a
  rule about an interface.
- The OKX adapter stub: it is intentional and documented in
  `README_OKX.md`
- The mock payment: it is the default and is part of the product
- The 50 MiB / 2000 file limit: it is a documented product limit
