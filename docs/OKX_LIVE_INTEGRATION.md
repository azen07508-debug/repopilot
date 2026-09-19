# OKX Live Integration — Re-validated Against Current Skills

> **Live document.** Re-read before any external registration work.
> Last re-validated: 2026-07-19 11:40 UTC
> Source: `okx/onchainos-skills@4.2.6` mirror at `/tmp/onchainos-skills`
> Source-of-truth: `skills/okx-agent-payments-protocol/SKILL.md` +
> `skills/okx-agentic-wallet/references/wallet.md` +
> `skills/okx-ai/references/identity-register.md` +
> `skills/okx-ai/references/task-asp.md`

This document distinguishes four categories so we never conflate an
**official requirement** with a **RepoPilot assumption**:

1. ✅ **Official current requirement** — explicitly documented in the
   Onchain OS Skills at the version above, confirmed by the reference
   docs we just re-read.
2. 🟡 **RepoPilot custom / inferred** — RepoPilot-internal naming, not
   specified by the official Skills. Either historical assumption or
   we made it up; must be re-checked before going live.
3. ⚪ **Deprecated / unconfirmed** — referenced in older docs / chats
   but no longer present in the current Skills.
4. 🟢 **OKX.AI Marketplace is GA (2026-06-30)** — ASPs self-register via
   `onchainos agent register --role asp`. No whitelist / approval needed.

---

## 1. CLI binary status

| | |
|---|---|
| Required | ✅ Yes (for ASP registration, marketplace listing, Agent Identity creation, wallet login) |
| RepoPilot uses | 🟡 None directly — RepoPilot is a server, not a wallet. We need `onchainos` only for: (a) `wallet login` / `wallet verify` to obtain a public EVM address, (b) `agent create` / `agent service-add` for ASP registration, (c) `marketplace` for listing, (d) `payment pay` only when acting as the **buyer** (test payment). |
| Current status | **In progress.** `npx skills add okx/onchainos-skills --yes -g` registered the skills in this OpenClaw session but the global install of the 11.5 MB `onchainos-x86_64-unknown-linux-musl` binary is downloading at ~14 KB/s through the sandbox proxy. Background PID `138368` to `/home/gem/.local/bin/onchainos`. ETA at this rate: 12–15 min. Once it arrives, run `onchainos preflight --skill-version 4.2.6` per `skills/okx-agentic-wallet/_shared/preflight.md` (BLOCKING before any other `onchainos` call). |
| Verdict | ⏳ Wait for download; do not call `onchainos` until preflight returns. |

---

## 2. Seller-side x402 config (the part RepoPilot actually owns)

This is the most important section — it's where prior docs had it wrong.

### 2.1 What the official `okx-agent-payments-protocol` skill says the **seller** needs

Reading `skills/okx-agent-payments-protocol/SKILL.md` + the on-the-wire
spec referenced from `references/accepts-schemes.md` (and the external
spec at `https://x402.org`):

- A **public 0x EVM address** that receives the token.
- The **network** name (e.g. `xlayer`, `base`, `ethereum`, `arbitrum`, `bsc`).
- The **token contract** the seller wants paid in (USDT on each is the
  default in our adapter).
- The **x402 version** they speak (v1 or v2).
- (Optional) An **RPC URL** if the seller wants to verify the
  `authorizationUsed` flag on-chain themselves.
- (Optional) A **service description / resource URL / max timeout** —
  metadata, not secrets.

That is it. The seller does **NOT** need:

- ❌ An OKX API Key / Secret / Passphrase to receive x402 payments.
- ❌ An OKX Agent Key / Agent Secret to receive x402 payments.
- ❌ Any kind of bearer token to validate the X-PAYMENT header.

The buyer's wallet signs the EIP-3009 authorization; the seller just
re-derives the EIP-712 digest, recovers the signer, and verifies the
address and value. No shared secret is involved.

### 2.2 What RepoPilot currently declares in `apps/api/src/config.ts`

```text
PAYMENT_MODE              = mock | okx
OKX_PAYMENT_ADDRESS       = <0x EVM address>           ✅ matches official
OKX_PAYMENT_NETWORK       = xlayer (default)           ✅ matches official
OKX_X402_VERSION          = 2 (default)                ✅ matches official
```

> `OKX_AGENT_KEY` and `OKX_AGENT_SECRET` appear **only in a JSDoc
> comment** in `packages/okx-adapter/src/okx-adapter.ts:46`. They are
> **not** in the Zod schema, **not** read by the runtime, and **not**
> required by the official x402 spec. Treat them as **🟡 RepoPilot
> custom / unconfirmed** and **do not** set them. (Suggested follow-up:
> delete the JSDoc comment, or rewrite it to point at the correct
> onchainos-side credential model.)

### 2.3 What the onchainos CLI needs (separate concern, only when acting as a wallet)

Per `skills/okx-agentic-wallet/references/wallet-cli-reference.md` §
`wallet login`:

- **Email + OTP** — consumer path. OTP arrives in the user's email
  inbox; verified via `wallet verify <otp>`.
- **OR `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE`** — silent
  API-Key login (read from env when `wallet login` is called with no
  email argument). Created at https://web3.okx.com/onchain-os/dev-portal.

These are the **onchainos-CLI-side** credentials. They are **not** the
same thing as the seller-side x402 config above. A seller does not
need them at runtime; the onchainos-CLI user (the wallet holder) does
need them if they want to skip email-OTP during programmatic operations
like signing test payments.

### 2.4 What the marketplace listing side needs

Per `skills/okx-ai/references/identity-register.md` and
`skills/okx-ai/references/task-asp.md`:

- A logged-in Agent Identity (one of `user` / `asp` / `evaluator`).
- For an **ASP** role: agent name + description + avatar (1:1 image
  upload) + one or more services, each with name / description / type
  (`A2MCP` for API) / fee (string number, USDT) / endpoint (HTTPS,
  publicly reachable, ≤512 chars, no localhost / no RFC-1918).
- For the **endpoint**: must be a real deployed `https://` URL. The
  spec explicitly rejects `http://`, `localhost`, `127.0.0.1`, RFC-1918
  private IPs, and placeholders.

> **RepoPilot current state** (`.env.example`):
> `OKX_ASP_AGENT_ID` and `OKX_ASP_RECIPIENT_ADDRESS` are placeholder
> fields set after registration. They are 🟡 RepoPilot custom names
> (the CLI uses `agentId` / `recipient` internally, but the resulting
> values populate these env vars). Keep the names for our own
> observability; do not change them.

---

## 3. Beta / permission gates (current block)

| Capability | Status | Source |
|---|---|---|
| `npx skills` install | ✅ Works (skills registered in OpenClaw session). | `npx skills add` output. |
| `onchainos` CLI install | ⏳ Downloading (PID 138368, ~14 KB/s). | `/home/gem/.local/bin/onchainos` size growing. |
| `onchainos preflight` | ⏳ Pending CLI install. | skill requirement. |
| `wallet login` (email + OTP) | ⏳ Pending CLI install + user email. | `wallet.md` § Authentication. |
| `wallet login` (API Key) | ⛔ We do not have an OKX API Key. User would need to create one at https://web3.okx.com/onchain-os/dev-portal. | `wallet-cli-reference.md` § `wallet login`. |
| `agent pre-check --role asp` | ✅ Ready (Marketplace GA). | `identity-register.md` § 2. |
| `agent create --role asp` | ✅ Ready (Marketplace GA). | `identity-register.md` § 7. |
| `marketplace publish` | ✅ Ready (Marketplace GA). | `task-asp.md` + `task-user-actions-publish.md`. |
| x402 buyer-side test payment | 🟡 Requires the buyer to be logged into an OKX Agentic Wallet holding USDT on the chosen network. | `agent-payments-protocol` § Path A. |

**Concrete consequence:** A2MCP ASP registration and the Marketplace
listing can now be self-served from this sandbox:

1. Finish the CLI install (`onchainos`).
2. Walk the user through email + OTP login.
3. Use the wallet's public EVM address as `OKX_PAYMENT_ADDRESS`.
4. Run `onchainos agent register --role asp` to publish the listing.

---

## 4. Public-EVM-address question (verified reading, not assumption)

`wallet.md` § Authentication step 5 + `wallet-cli-reference.md`
`wallet balance` confirm: after `wallet verify` succeeds, the wallet
response includes `evmAddress` (always) and `solAddress` (if Solana
is enabled). For x402 USDT settlement on `xlayer` / `base` / etc. we
need the **EVM address**. For Solana settlement (out of scope for
RepoPilot today) we'd need `solAddress`.

The wallet is created server-side in OKX's TEE (see `wallet.md` § Notes
"**TEE signing**"). The Agent (us) cannot export the private key. The
address is the only public identifier. ✅ Safe to record in our public
docs.

---

## 5. Agentic Wallet login — exact flow we will execute

Per `wallet.md` § Authentication, **verbatim** (translated to Chinese
in the chat reply):

1. Run `onchainos wallet status`. If `data.loggedIn === true`, skip to
   step 3.
2. Otherwise, run `onchainos wallet login <user_email> --locale zh_CN`.
   The CLI sends an OTP to that email.
3. User reads the OTP from their email inbox.
4. Run `onchainos wallet verify <otp>`. Returns
   `{ accountId, accountName, isNew }`.
5. If `isNew === true`: walk the user through the Policy Settings
   template + Wallet Export template (we render the template, link to
   the OKX web portal, and **do not** touch the secrets).
6. Run `onchainos wallet addresses` to capture the public EVM
   address(es). Save the EVM address into `.env` as
   `OKX_PAYMENT_ADDRESS=<0x...>` (and `OKX_ASP_RECIPIENT_ADDRESS` to
   the same value).

> **Security rules in flight** (from the user's launch brief):
> - Never ask for, log, or write the OTP. It lives only in the
>   user's reply this turn, then in the onchainos process memory.
> - Never request the private key or the mnemonic.
> - The wallet's TEE keeps the key; we cannot export it even if asked.

---

## 6. RepoPilot config fields — final mapping

| Field | Where read | Official? | Action |
|---|---|---|---|
| `PAYMENT_MODE=okx` | `apps/api/src/config.ts` | 🟡 RepoPilot switch | Keep; required to enable `OkxPaymentAdapter`. |
| `OKX_PAYMENT_ADDRESS` | `apps/api/src/config.ts` + `packages/okx-adapter/src/factory.ts` | ✅ Official (recipient address) | **Required** for x402 seller side. |
| `OKX_PAYMENT_NETWORK` | `apps/api/src/config.ts` | ✅ Official | Defaults to `xlayer`; can be `base` / `ethereum` / `arbitrum` / `bsc`. |
| `OKX_X402_VERSION` | `apps/api/src/config.ts` | ✅ Official | Defaults to 2. |
| `OKX_ASP_AGENT_ID` | `.env.example` (post-registration) | 🟡 RepoPilot bookkeeping | Populated after `agent create --role asp` returns `newAgentId`. |
| `OKX_ASP_RECIPIENT_ADDRESS` | `.env.example` (post-registration) | 🟡 RepoPilot bookkeeping | Same value as `OKX_PAYMENT_ADDRESS`. |
| `OKX_AGENT_KEY` (mentioned in JSDoc) | not in code | ⚪ Deprecated / unconfirmed | **Remove** the JSDoc reference, or rewrite it. |
| `OKX_AGENT_SECRET` (mentioned in JSDoc) | not in code | ⚪ Deprecated / unconfirmed | Same. |
| `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` | n/a (consumed by `onchainos` CLI) | ✅ Official, CLI-side only | Only set if user wants to skip email-OTP at the onchainos CLI level. **Not** a RepoPilot config field. |

---

## 7. Next executable steps (in order)

1. **Wait for `onchainos` CLI binary** to finish downloading
   (background PID 138368). Verify with
   `onchainos --version` once present.
2. **Run `onchainos preflight --skill-version 4.2.6`** per the
   blocking pre-flight rule. Surface `data.action` to the user if it
   is non-null.
3. **Ask the user for the email** to log into Agentic Wallet
   (the only thing we can't do ourselves).
4. **Run `wallet login <email> --locale zh_CN`**.
5. **Ask the user for the OTP** that arrived in their inbox.
6. **Run `wallet verify <otp>`**, capture `evmAddress`.
7. **Write `OKX_PAYMENT_ADDRESS=<evmAddress>` and
   `OKX_ASP_RECIPIENT_ADDRESS=<evmAddress>`** into the local `.env`
   (not yet into Git). Set `PAYMENT_MODE=okx`.
8. **Run `onchainos agent pre-check --role asp`** to check Beta
   status. Surface any `EXTERNAL_BLOCKED` to the user.
9. If Beta is open: run `agent create --role asp` with the
   `MARKETPLACE_LISTING.md` values, then `marketplace publish`.
10. If Beta is not open: stop. Tell the user the official application
    URL and what to do next. Do **not** retry the call.

---

## 8. Source references re-read this session

- `skills/okx-agent-payments-protocol/SKILL.md` (triggers, Path A/B,
  `x402Version` + `PAYMENT-REQUIRED` + `WWW-Authenticate: Payment`
  protocol literals).
- `skills/okx-agentic-wallet/references/wallet.md` § Authentication
  (email + OTP flow, TEE signing, address format).
- `skills/okx-agentic-wallet/references/wallet-cli-reference.md`
  (exact `wallet login` / `wallet verify` / `wallet status` /
  `wallet addresses` syntax and return fields).
- `skills/okx-agentic-wallet/_shared/preflight.md` (BLOCKING preflight
  rule + version-drift check).
- `skills/okx-ai/references/identity-register.md` (ASP role flow,
  pre-check gate, field checklists, QA via `validate-listing`,
  avatar + endpoint rules).
- `skills/okx-ai/SKILL.md` Inbound envelope activation table + Language
  Lock + Routing (envelope shape wins over free-text; reply in the
  user's locked language).
