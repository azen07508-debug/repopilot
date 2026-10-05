# OKX.AI / Onchain OS Requirements Snapshot

> **Live document.** The Agent must re-read this before any new external
> registration work. Last captured from local `onchainos-skills` mirror;
> re-validate against the live tutorial before submitting a real listing.

| Field | Value |
| --- | --- |
| Checked at | 2026-07-19 (UTC) |
| Source | `okx/onchainos-skills` (`onchainos-skills@4.2.6`, mirror at `/tmp/onchainos-skills`) |
| Primary references | `skills/okx-ai/references/identity-register.md`, `identity-discover.md`, `task-asp.md`, `task-user-actions-publish.md`, `cli/src/commands/payment/{http_carrier,payment_flow,state,dispatcher}.rs` |
| Onchain OS version expected | `4.2.x` (current: 4.2.6) |
| Install command | `npx skills add okx/onchainos-skills --yes -g` |

## 1. What the official Onchain OS Skills say right now

### 1.1 Identity model (ERC-8004)

- Three roles, all using a single binary `agent` CLI:
  - `user` — buyer / requester
  - `asp` — service provider (this is the only role RepoPilot needs)
  - `evaluator` — buyer / seller / arbitrator (not used by RepoPilot)
- CLI flag is the strict literal `--role user|asp|evaluator`. Synonyms
  (buyer, provider, 1/2/3) must be mapped client-side before invoking.
- Each wallet can register exactly **one** identity per role. To register
  a second ASP, switch the wallet.

### 1.2 ASP registration (read in full from `identity-register.md`)

Mandatory fields (CLI accepts no aliases; `validate-listing` enforces limits):

| Field | Rule |
| --- | --- |
| `--name` (brand) | CN 2–12 chars / EN 3–25 chars, no test markers, no celebrity names, no personal labels |
| `--description` | ≤500 chars, one-sentence summary of what the agent does |
| `--picture` | required for ASP, must be uploaded file (no URL), ≤1 MB, PNG/JPEG/WebP, 1:1 recommended |
| `--service[]` (repeatable) | see §1.3 |

### 1.3 Service (one of `A2A` or `A2MCP`)

RepoPilot will register **two** services under a single ASP identity — one
free, used to get discovered, and one paid:

| # | Service name | Type | Fee | Endpoint | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `RepoPilot Free Check` | A2MCP | `0` (free) | `https://<public-domain>/api/v1/free-check` | No x402. Get-acquisition. |
| 2 | `RepoPilot Release Gate` | A2MCP | `1` USDT | `https://<public-domain>/api/v1/audits` | x402. One price, one product. |

It used to register three: a free check plus a `0.02` "Quick" and a `0.05`
"Full". The second paid tier is gone because it did not add analysis — the
registration copy said so itself ("runs the same analysis as the quick audit
and adds the launch materials"), so an agent comparing the two picked the
cheaper one, and the price difference priced report sections rather than work.
See `DEFAULT_PRICING` in `@repopilot/core` and D-037 in `DECISIONS.md`.

The fee column is shown in decimal here because it is the price a buyer reads.
The value the CLI is given is the atomic-unit string in §5.2–§5.3 (`1000000`).
`pnpm docs:check` compares both forms against the rest of the repository.

Service field rules (from §3 Step 2 of `identity-register.md`):

- **Name**: 5–30 chars noun phrase; not the same as the agent name; no
  price in the name. (e.g. `Repository Audit` is fine, `1 USDT Audit`
  is not.)
- **Description**: 2-part structure on two separate lines:
  1. Core capability summary (what it does + who it's for). ≤200 CJK
     chars.
  2. What the user must provide. ≤200 CJK chars.
  - Total ≤400 CJK chars.
  - No example prompts, no GitHub/wallet links, no tech-stack details,
    no disclaimers.
- **Type**: literal `A2A` or `A2MCP` (API service → `A2MCP`; agent ↔
  agent → `A2A`).
- **Fee**: plain number sent as a string. **Currency is always USDT** —
  the CLI does not accept `USDT`/`USDG`/symbol/unit in the value; the
  UI re-displays `N USDT` on confirmation. ≤6 decimals. Repository price
  values are configured server-side; we mirror them at registration
  time.
- **Endpoint**: only required for `A2MCP`. Must be
  - `https://`
  - publicly reachable from the open Internet
  - ≤512 chars
  - not `localhost` / `127.0.0.1` / RFC-1918 / `*.local` / `*.internal`
  - not a placeholder

### 1.4 x402 protocol (from `cli/src/commands/payment/{http_carrier,state,payment_flow,dispatcher}.rs`)

- RepoPilot **does not** re-implement x402 from scratch. We already use
  the official `MockPaymentAdapter` (`packages/okx-adapter/src/mock-adapter.ts`).
  The live `OKXAdapter` is left as a **STUB BOUNDARY** (`STUB BOUNDARY:
  do not edit until OKX Beta is granted`) until the wallet-side SDK is
  provided. The 402 challenge shape is implemented and verified locally.
- The 402 response body must contain an `accepts[]` array. Each element
  carries: `scheme`, `network`, `maxAmountRequired` (atomic units — for
  USDT 6 decimals), `resource`, `description`, `mimeType`,
  `maxTimeoutSeconds`, `payTo`, `extra`. RepoPilot currently emits
  `x402Version: 2`, `scheme: 'exact'`, `network: 'xlayer'`.
- Payment verification header: `X-PAYMENT: <receipt>`. The header value
  is the base64-encoded receipt OR, in mock mode, `mock:<paymentId>`.
  The official `onchainos payment pay --payment-id --yes` flow signs the
  EIP-3009 authorization and emits that exact header.
- The replay request must include the same `X-PAYMENT` header. The
  merchant side must enforce idempotency on `paymentId` and on the
  request fingerprint.

### 1.5 Networks, assets, and decimals (current as of 2026-07-19)

| Network | Asset | Decimals | Notes |
| --- | --- | --- | --- |
| `xlayer` | USDT | 6 | Primary; default in our 402 challenge |
| `xlayer` | USDC | 6 | Future option |
| `base` | USDC | 6 | Future option |

**The 402 challenge amounts in our code are stored as strings of
atomic units** (`"1000000"` for 1 USDT). The
  agent never multiplies decimals client-side; it reads the configured
  price and converts through `parseUnits(amount, decimals)`. The current
  implementation lives in `packages/okx-adapter/src/mock-adapter.ts`
  and `apps/api/src/services/job-service.ts`.

### 1.6 ASP listing checklist (from `identity-register.md`)

1. **Pre-check** (consent + uniqueness, single command):
   `onchainos agent pre-check --role asp` → returns `canCreate: bool,
   consent?, existingSameRole?`.
2. **Field collection** (one batched numbered list, not separate turns).
3. **QA via `validate-listing`** (single batch pass; never per service).
   Findings use dot-notation (`service[0].fee`, etc.).
4. **Apply user-chosen fixes** (or have the user rewrite the value).
5. **Render the confirmation card** (TWO cards for ASP: identity + service).
6. **Run `agent create`** (single invocation carrying every collected
   service). Output is `newAgentId` (string) or `null` on WS timeout.
7. **Post-success** — save `agentId`, all `serviceId`s, the
   `consentReceipt`, the on-chain transaction hash, and the public
   page URL. Never print the wallet private key, secret key, or
   `consentKey`.

### 1.7 What triggers an EXTERNAL_BLOCKED

The following steps are blocked on a real human (per brief §18 and the
local `docs/EXTERNAL_ACTIONS.md`):

- Real GitHub token with `repo:read` scope for the production environment.
- Public HTTPS domain + DNS — owner must purchase the domain and point
  it at the deployment target.
- A live public host (Fly.io / Render / Railway / VPS) — owner must
  provision or grant access.
- Real `OKX_AGENT_KEY` / `OKX_AGENT_SECRET` / Agentic Wallet — owner
  must run the email-OTP login flow and hand the agent a non-secret
  **public** EVM address.
- Real `OKX_PAYMENT_RECIPIENT` for the production wallet — owner must
  confirm the on-chain address.
- `onchainos agent create --role asp ...` and the subsequent listing
  submission — owner must reply `1` to the two confirmation cards
  (`identity-register.md` §7).

Until all of the above are in place, RepoPilot runs on the
`MockPaymentAdapter` and the A2MCP shell of the registration.

## 2. Implementation status

| Surface | Status | Notes |
| --- | --- | --- |
| 402 challenge shape | DONE | matches `x402Version:2` `accepts[]` schema, verified end-to-end with mock adapter (`scripts/verify-release.ts`) |
| `MockPaymentAdapter` | DONE | `packages/okx-adapter/src/mock-adapter.ts`; replay/headers/idempotency all implemented |
| `OKXAdapter` (real) | **STUB BOUNDARY** | `packages/okx-adapter/src/okx-adapter.ts` raises with `STUB BOUNDARY: real payment integration pending OKX Beta access` until a real `OKX_AGENT_KEY` + wallet address are wired in |
| Free check endpoint | DONE | `POST /api/v1/free-check` → HTTP 200, no x402, validated by `verify-release.ts` step 8b |
| Paid endpoint | DONE | `POST /api/v1/audits` → HTTP 402 with `accepts[]`; replay returns HTTP 200 with idempotency on `paymentId` |
| Agentic Wallet login | **EXTERNAL_BLOCKED** | requires email + OTP |
| `onchainos agent pre-check --role asp` | **EXTERNAL_BLOCKED** | requires Agentic Wallet login |
| `onchainos agent create` | **EXTERNAL_BLOCKED** | requires ASP QA pass + user reply 1 |
| Marketplace listing | **EXTERNAL_BLOCKED** | requires successful ASP registration + Hero image upload |

## 3. Differences from the existing implementation

| Item | Old (assumed) | Current (verified) |
| --- | --- | --- |
| x402 `scheme` value | mixed (`transfer` / `exact`) | `exact` (the only scheme `accepts[]` currently supports) |
| Network | not pinned | `xlayer` (configurable via `OKX_PAYMENT_NETWORK`) |
| Decimals | 18 (in old spec) | 6 for USDT on `xlayer` |
| Fee on ASP service | numeric | **string of digits** (CLI rejects bare numbers and any unit symbol) |
| Service description | free text | strict 2-part ≤400 CJK chars, no tech stack / no disclaimers |
| Endpoint | optional | required, `https://`, publicly reachable, ≤512 chars |
| `validate-listing` | n/a | single batch pass; re-running it after fix is forbidden |

## 4. References

- `skills/okx-ai/SKILL.md`
- `skills/okx-ai/references/identity-register.md`
- `skills/okx-ai/references/identity-update.md`
- `skills/okx-ai/references/identity-discover.md`
- `skills/okx-ai/references/identity-errors.md`
- `skills/okx-ai/references/identity-invariants.md`
- `skills/okx-ai/references/task-asp.md`
- `skills/okx-ai/references/task-user-actions-publish.md`
- `cli/src/commands/payment/http_carrier.rs`
- `cli/src/commands/payment/payment_flow.rs`
- `cli/src/commands/payment/state.rs`
- `cli/src/commands/payment/dispatcher.rs`
- `openclaw_template/manifest.json`

## 5. A2MCP service registration — ready-to-paste values

These are the exact values the agent will pass to
`onchainos agent create --role asp ...` once the Beta wallet is wired.
Mirror them when filling the marketplace submission form by hand. The
field rules (length limits, network, scheme) come from
`identity-register.md` §3 and `cli/src/commands/payment/{http_carrier,
state}.rs`.

### 5.1 Identity (single ASP, two services)

| Field | Value | Rule check |
| --- | --- | --- |
| `--role` | `asp` | literal |
| `--name` | `RepoPilot` | EN 3–25 chars; no test markers |
| `--description` | `Gates public GitHub repositories for release, returning a ship-or-block verdict with the blocking findings behind it — each carrying file-and-line evidence — plus the fixes that clear the gate, scored deterministically so the same commit reads the same for every caller, using static analysis only and never executing repository code.` | ≤500 chars, one sentence |
| `--picture` | `docs/brand/avatar.png` (uploaded file) | ≤1 MB, PNG/JPEG/WebP, 1:1 |

`--picture` is the **1:1** registration picture, not the 2:1 listing banner
(`docs/brand/hero.png`). Both are committed; `docs/AVATAR_BRIEF.md` and
`docs/HERO_IMAGE_BRIEF.md` describe them. Uploading the banner here gets it
rejected or centre-cropped, which removes the wordmark and the terminal.

### 5.2 Service #0 — `RepoPilot Free Check` (A2MCP, free, get-acquisition)

| Field | Value | Rule check |
| --- | --- | --- |
| `service[0].name` | `RepoPilot Free Check` | 5–30 chars noun phrase, not equal to the agent name, no price |
| `service[0].type` | `A2MCP` | literal `A2A` or `A2MCP` |
| `service[0].fee` | `0` | string of digits; currency is USDT |
| `service[0].endpoint` | `https://<public-domain>/api/v1/free-check` | `https://`, publicly reachable, ≤512 chars |
| `service[0].description` (line 1) | `Read-only triage probe for a public GitHub repository: five presence checks (README, LICENSE, .env.example, lockfile, CI) reported as pass/fail, plus the stack detected. Lets an AI agent decide whether a repository is worth gating before paying.` | ≤200 CJK chars, what it does + who it is for |
| `service[0].description` (line 2) | `Provide one public GitHub repository URL via POST. No payment header and no account required. Returns 200 in under three seconds.` | ≤200 CJK chars, what the user must provide |

Line 1 used to promise "plus a 0-100 score". It is not one: the free check
reports `Math.round(passed / 5 * 100)`, so the only values it can take are
`0 / 20 / 40 / 60 / 80 / 100` — a five-item pass count, not the weighted
multi-dimension score the paid gate computes (measured: `octocat/Hello-World`
scores 45.2 there). Two different quantities under one name, both advertised
as "a 0-100 score", in a product whose selling point is that the score is
reproducible. The free check now describes what it actually returns.

### 5.3 Service #1 — `RepoPilot Release Gate` (A2MCP, paid)

| Field | Value | Rule check |
| --- | --- | --- |
| `service[1].name` | `RepoPilot Release Gate` | 5–30 chars noun phrase, no price in the name |
| `service[1].type` | `A2MCP` | literal |
| `service[1].fee` | `1000000` | string of atomic units, USDT, 6 decimals; `1000000` = 1 USDT |
| `service[1].endpoint` | `https://<public-domain>/api/v1/audits` | `https://`, publicly reachable, ≤512 chars |
| `service[1].description` (line 1) | `Ship-or-block verdict for a public GitHub repository: a reproducible 0-100 readiness score, every blocking finding with file-and-line evidence, and the fixes that clear the gate.` | ≤200 CJK chars |
| `service[1].description` (line 2) | `POST the repository URL with mode=full — the report carries the deployment plan and launch copy. Returns 402 with a payment challenge; sign it with the onchainos wallet, then replay with X-PAYMENT.` | ≤200 CJK chars |

### 5.4 What `mode` changes — which is not the price

`mode` is a report-shape parameter, not a second product. Both modes run every
analyzer over the same commit and return the same scores, blockers and
findings; `full` adds the deployment plan and the launch copy, and both cost
the same. `packages/core/src/report/tiers.ts` is the single place that answers
what each mode carries; `omittedSections` on the report states which sections a
given report does not have, so a reader never has to infer it from `auditMode`.

| Request | Deployment plan | Launch copy |
| --- | --- | --- |
| `mode=quick` | omitted | omitted |
| `mode=full` | included | included (`includeLaunchCopy=false` drops it) |

**The server default is `full`.** `CreateAuditInputSchema` in
`packages/core/src/schemas/inputs.ts` supplies it, so a caller that omits the
field receives the shape §5.3 line 2 sells. It defaulted to `quick` until
2026-10-05, which meant a buyer who paid 1 USDT and omitted the field received
less than the description they paid against — the deployment plan and the
launch copy are named in that description (R-37). Naming the mode in the
registration copy is no longer load-bearing for that, but it stays: a caller
reading the description should be able to see which shape is sold without
inferring it from a default. `quick` remains available as an explicit opt-out.

### 5.5 402 challenge shape (matches the live `accepts[]` schema)

This block is compared against the challenge the adapter actually builds, by
`packages/okx-adapter/src/okx-adapter.test.ts`. The field set and the
environment-independent values must match, so a rename in one place and not the
other fails the suite rather than reaching a buyer.

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "xlayer",
      "maxAmountRequired": "1000000",
      "resource": "https://<public-domain>/api/v1/audits",
      "description": "RepoPilot Release Gate",
      "mimeType": "application/json",
      "payTo": "<OKX_PAYMENT_ADDRESS>",
      "maxTimeoutSeconds": 300,
      "asset": "<USDT contract address on the network>",
      "extra": { "name": "RepoPilot", "version": "0.1.0" }
    }
  ]
}
```

The same challenge is emitted whatever `mode` the caller sent — one service,
one price, one `description`. The free-check endpoint never emits a 402.

Three things this block used to get wrong, all fixed 2026-10-04:

- `resource` said `https://<public-domain>/api/v1/audits` while the code
  hard-coded `https://repopilot/api/v1/audits` — a plausible-looking host that
  does not exist. It is now `OKX_PAYMENT_RESOURCE_URL`, required in production.
- `maxTimeoutSeconds` said `60`; the adapter emits `300`, matching the
  challenge's own 5-minute `expiresAt`.
- `description` said `RepoPilot Quick Audit`; the adapter emitted
  `RepoPilot quick audit` — the internal `mode` value, lower-cased. It now
  carries the paid service name from `MARKETPLACE_LISTING.md`, so the payment
  prompt names the service the same way the listing sold it.

`asset` is present in the emitted challenge but is not in §1.4's field list.
The `exact` scheme needs the token contract, so either §1.4's list is not
exhaustive or the field is extra. Not yet confirmed against a live
`validate-listing`; recorded in `RISKS.md` rather than guessed at here.

### 5.6 Pre-registration checklist (human-side, see also `EXTERNAL_ACTIONS.md`)

1. Replace every `<public-domain>` and `<OKX_PAYMENT_ADDRESS>` with the
   production values.
2. Run `pnpm env:check` in production mode; confirm no findings.
3. Run `pnpm verify:release` against the staging URL and confirm every step is
   green. The count is not written down here on purpose — it changes when a step
   is added, and a hand-written total is how this document drifted before.
   `pnpm preflight:production` runs the whole pre-registration set and prints
   what is still missing.
4. Both brand assets are committed: `docs/brand/avatar.png` (1:1, the
   `--picture`) and `docs/brand/hero.png` (2:1, the listing banner).
5. Run `onchainos agent pre-check --role asp`; if `canCreate=false`,
   stop and switch wallets.
6. Submit the values above to `onchainos agent create --role asp ...`.
7. Save `agentId`, both `serviceId`s, the `consentReceipt`, the
   on-chain transaction hash, and the public page URL.

## 6. Update procedure

When Onchain OS or the OKX.AI marketplace changes its requirements:

1. Re-run `npx skills add okx/onchainos-skills --yes -g` (or pull
   `main` directly if the skills repo is local).
2. Re-read the references in §4 and update the rules in §1.
3. Update the implementation table in §2 to reflect the new status.
4. If a new field appears in `validate-listing`, update the registration
   pre-flight in `scripts/preflight-production.ts` and the ready-to-paste
   values in §5. (This used to name `scripts/okx-register-prepare.ts`, which
   does not exist and never did — the pre-registration set is
   `preflight:production`.)
5. Bump the "Checked at" date at the top of this file.
