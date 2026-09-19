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
docker build -t repopilot:0.1.0-rc.1 .
docker run --rm -p 4000:4000 \
  -e NODE_ENV=production \
  -e PAYMENT_MODE=mock \
  -e DATABASE_URL=file:/data/repopilot.db \
  -e ALLOWED_REPO_HOSTS=github.com,raw.githubusercontent.com \
  -v $(pwd)/data:/data \
  repopilot:0.1.0-rc.1
curl http://127.0.0.1:4000/health
```

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

**Status:** `OPTIONAL`
**Why:** HTTPS is required in production. The reverse-proxy templates
in `docs/deployment/` use placeholder domains.

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

**Do not**

- Do not skip HTTPS in production
- Do not run with self-signed certs

---

## 6. Marketplace listing submission

**Status:** `BLOCKED on Beta + hero asset`
**Why:** The marketplace requires Beta access (item 2) and a brand
asset (item 7).

**Action**

1. Once Beta is granted, copy the `MARKETPLACE_LISTING.md` English
   and Chinese sections into the marketplace submission form.
2. Upload the hero image (item 7).
3. Set the price exactly as documented in `.env.example` (`PRICE_QUICK_SCAN`,
   `PRICE_FULL_AUDIT`).
4. Verify the listing preview matches the README.

**Do not**

- Do not promise "formal security audit" in the listing copy
- Do not promise returns or upside
- Do not include OKX official logos unless the platform rules allow

---

## 7. Hero image

**Status:** `EXTERNAL_BLOCKED`
**Why:** No brand asset is bundled with the repo. We do not generate
a fake final image.

**Action**

1. Read `docs/HERO_IMAGE_BRIEF.md` for the spec.
2. Create a `1280×640` PNG/JPG matching the brief.
3. Drop it under `docs/brand/hero.png` (the `.gitignore` excludes
   binaries, so commit it explicitly with `git add -f`).
4. Update `MARKETPLACE_LISTING.md` to reference the file.

---

## 8. LLM provider (optional upgrade)

**Status:** `OPTIONAL`
**Why:** The MVP runs with `LLM_PROVIDER=noop` and produces
template-based copy. Upgrading to an OpenAI-compatible endpoint
improves the natural-language quality of the summary and launch copy.

**Action**

1. Get an API key from your provider (OpenAI, Azure OpenAI, Together,
   etc.).
2. Set in `.env`:
   ```
   LLM_PROVIDER=openai-compatible
   LLM_API_KEY=...
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_MODEL=gpt-4o-mini
   ```
3. Restart the API. The first audit should produce a noticeably
   richer `summary` and `launchCopy`.

**Do not**

- Do not give the LLM a role that writes scores or evidence (it is
  not allowed to)

---

## What is *not* on this list

- Code work: see `BACKLOG.md` and `docs/RELEASE_CHECKLIST.md`
- The OKX adapter stub: it is intentional and documented in
  `README_OKX.md`
- The mock payment: it is the default and is part of the product
- The 50 MiB / 2000 file limit: it is a documented product limit
