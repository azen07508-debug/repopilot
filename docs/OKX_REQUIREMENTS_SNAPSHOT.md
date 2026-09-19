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

RepoPilot will register **two** services under a single ASP identity:

| # | Service name | Type | Fee | Endpoint | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `RepoPilot Free Check` | A2MCP | `0` (free) | `https://<public-domain>/api/v1/free-check` | No x402. Get-acquisition. |
| 2 | `RepoPilot Repository Audit (Quick)` | A2MCP | `0.02` USDT | `https://<public-domain>/api/v1/audits` | x402, `mode=quick` |
| 3 | `RepoPilot Repository Audit (Full)` | A2MCP | `0.10` USDT | `https://<public-domain>/api/v1/audits` | x402, `mode=full` |

Service field rules (from §3 Step 2 of `identity-register.md`):

- **Name**: 5–30 chars noun phrase; not the same as the agent name; no
  price in the name. (e.g. `Repository Audit` is fine, `0.02 USDT Audit`
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
atomic units** (`"20000"` for 0.02 USDT, `"100000"` for 0.10 USDT). The
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

### 5.1 Identity (single ASP, three services)

| Field | Value | Rule check |
| --- | --- | --- |
| `--role` | `asp` | literal |
| `--name` | `RepoPilot` | EN 3–25 chars; no test markers |
| `--description` | `Audits public GitHub repositories and returns a launch-readiness report with evidence-backed findings, reproducible scoring, and ready-to-paste launch copy. Static analysis only; never executes repository code.` | ≤500 chars, one sentence |
| `--picture` | `docs/brand/hero.png` (uploaded file) | ≤1 MB, PNG/JPEG/WebP, 1:1 |

### 5.2 Service #0 — `RepoPilot Free Check` (A2MCP, free, get-acquisition)

| Field | Value | Rule check |
| --- | --- | --- |
| `service[0].name` | `RepoPilot Free Check` | 5–30 chars noun phrase, not equal to the agent name, no price |
| `service[0].type` | `A2MCP` | literal `A2A` or `A2MCP` |
| `service[0].fee` | `0` | string of digits; currency is USDT |
| `service[0].endpoint` | `https://<public-domain>/api/v1/free-check` | `https://`, publicly reachable, ≤512 chars |
| `service[0].description` (line 1) | `Read-only repository health probe: README, LICENSE, .env.example, lockfile, and CI checks plus a 0-100 score. Used by AI agents to triage a repo before paying for a deeper audit.` | ≤200 CJK chars, what it does + who it is for |
| `service[0].description` (line 2) | `Provide one public GitHub repository URL via POST. No payment header. No account. Returns 200 in under three seconds.` | ≤200 CJK chars, what the user must provide |

### 5.3 Service #1 — `RepoPilot Repository Audit (Quick)` (A2MCP, paid)

| Field | Value | Rule check |
| --- | --- | --- |
| `service[1].name` | `RepoPilot Repository Audit (Quick)` | 5–30 chars noun phrase, no price in the name |
| `service[1].type` | `A2MCP` | literal |
| `service[1].fee` | `20000` | string of atomic units, USDT, 6 decimals; `20000` = 0.02 USDT |
| `service[1].endpoint` | `https://<public-domain>/api/v1/audits` | `https://`, publicly reachable, ≤512 chars |
| `service[1].description` (line 1) | `Launch-readiness audit for a public GitHub repository: stack detection, evidence-backed findings across documentation, reproducibility, security hygiene, and deployment readiness, plus a 0-100 score.` | ≤200 CJK chars |
| `service[1].description` (line 2) | `POST the repository URL with mode=quick. The server returns 402 with a payment challenge; sign with the onchainos wallet, then replay with the X-PAYMENT header.` | ≤200 CJK chars |

### 5.4 Service #2 — `RepoPilot Repository Audit (Full)` (A2MCP, paid)

| Field | Value | Rule check |
| --- | --- | --- |
| `service[2].name` | `RepoPilot Repository Audit (Full)` | 5–30 chars noun phrase, no price in the name |
| `service[2].type` | `A2MCP` | literal |
| `service[2].fee` | `100000` | string of atomic units, USDT, 6 decimals; `100000` = 0.10 USDT |
| `service[2].endpoint` | `https://<public-domain>/api/v1/audits` | same endpoint; the mode is in the request body |
| `service[2].description` (line 1) | `Complete launch audit: blockers, task breakdown, deployment plan, and ready-to-paste launch copy. Adds reproducibility and Web3 analyzers (contract directories, deploy scripts, network consistency, hackathon artefacts).` | ≤200 CJK chars |
| `service[2].description` (line 2) | `POST the repository URL with mode=full. The server returns 402 with a payment challenge; sign with the onchainos wallet, then replay with the X-PAYMENT header.` | ≤200 CJK chars |

### 5.5 402 challenge shape (matches the live `accepts[]` schema)

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "xlayer",
      "maxAmountRequired": "20000",
      "resource": "https://<public-domain>/api/v1/audits",
      "description": "RepoPilot Quick Audit",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 60,
      "payTo": "<OKX_PAYMENT_ADDRESS>",
      "extra": { "name": "RepoPilot", "version": "0.1.0" }
    }
  ]
}
```

For `mode=full` the same challenge is emitted with
`maxAmountRequired: "100000"` and `description: "RepoPilot Full Audit"`.
The free-check endpoint never emits a 402.

### 5.6 Pre-registration checklist (human-side, see also `EXTERNAL_ACTIONS.md`)

1. Replace every `<public-domain>` and `<OKX_PAYMENT_ADDRESS>` with the
   production values.
2. Run `pnpm env:check` in production mode; confirm no findings.
3. Run `pnpm verify:release` against the staging URL; confirm 15/15 green.
4. Place `docs/brand/hero.png` (1 MB cap, 1:1) before the
   `onchainos agent create` call.
5. Run `onchainos agent pre-check --role asp`; if `canCreate=false`,
   stop and switch wallets.
6. Submit the values above to `onchainos agent create --role asp ...`.
7. Save `agentId`, all three `serviceId`s, the `consentReceipt`, the
   on-chain transaction hash, and the public page URL.

## 6. Update procedure

When Onchain OS or the OKX.AI marketplace changes its requirements:

1. Re-run `npx skills add okx/onchainos-skills --yes -g` (or pull
   `main` directly if the skills repo is local).
2. Re-read the references in §4 and update the rules in §1.
3. Update the implementation table in §2 to reflect the new status.
4. If a new field appears in `validate-listing`, update the registration
   pre-flight in `scripts/okx-register-prepare.ts` (or its successor).
5. Bump the "Checked at" date at the top of this file.
