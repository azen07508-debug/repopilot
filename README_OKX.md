# OKX.AI / Agent Payments Protocol integration

This document explains how RepoPilot integrates with the OKX onchain stack.
It is written from the `okx-agent-payments-protocol` and `okx-ai` skills
(versions in `package.json` metadata) and the official `okx/onchainos-skills`
repository, **not from memory**.

> Read this end-to-end before you turn on `PAYMENT_MODE=okx` in production.
> The `MockPaymentAdapter` is the only thing that moves money in dev / CI.

## 1. Install the official skills

```sh
npx skills add okx/onchainos-skills
```

This clones `https://github.com/okx/onchainos-skills` and registers the
following skills with the host agent (Claude Code, OpenClaw, etc.):

| Skill | Used by RepoPilot for |
| --- | --- |
| `okx-agent-payments-protocol` | Reference for x402 / `accepts[]` / a2a-pay flows. |
| `okx-agentic-wallet` | Reference for the buyer-side signing path. |
| `okx-ai` | Reference for the ASP / agent-identity / marketplace listing. |

RepoPilot itself is a server; it does **not** invoke these skills at
runtime. They are documentation references. The integration code lives in
`packages/okx-adapter/src/okx-adapter.ts` and follows the protocol fields
the skills describe.

## 2. Create the Agentic Wallet (buyer side)

RepoPilot does **not** create or hold the Agentic Wallet. The buyer agent's
operator (or a human) does this on the buyer side:

```sh
# One-time per machine / agent identity
onchainos wallet login   # AK login or OTP login
onchainos wallet status  # confirm "logged_in"
```

Funding the wallet with USDT (X Layer is recommended) is also the buyer's
responsibility. RepoPilot never holds the buyer's key.

## 3. Register RepoPilot as an ASP

Once you have OKX.AI Beta access, register RepoPilot as an ASP (Agent
Service Provider):

```sh
# Identity pre-check (one-time)
onchainos agent pre-check --role asp

# Create the ASP identity
onchainos agent create --role asp \
  --name "RepoPilot" \
  --description "Release gate for public GitHub repositories" \
  --avatar ./repopilot-avatar.png

# Add services (the two in MARKETPLACE_LISTING.md — one free, one paid)
onchainos agent add-service --agent-id <agentId> \
  --name "Release Gate" --type fixed-price \
  --amount 1 --symbol USDT --description "Ship-or-block verdict with evidence, fixes, deployment plan and launch copy"
```

Then **activate** the listing:

```sh
onchainos agent activate --agent-id <agentId>
```

The operator receives an `agentId` (e.g. `agent_xxx`). Save it as
`OKX_ASP_AGENT_ID` in the service's environment. The recipient EVM address
for payments is `OKX_PAYMENT_ADDRESS`.

## 4. Configure A2MCP

A2MCP is OKX's "Agent-to-MCP" endpoint. RepoPilot exposes a single MCP
endpoint over stdio (see `packages/mcp-server/src/cli.ts`). When you wire
A2MCP, point the marketplace entry at the operator's stdio launcher
(typically via a reverse shell, `npx`, or a hosted process). The actual
public URL and routing are configured inside the OKX.AI console.

## 5. x402 / Agent Payments Protocol

When `PAYMENT_MODE=okx`, the API:

1. Validates input.
2. Returns **HTTP 402** with a body shaped like:

   ```json
   {
     "x402Version": 2,
     "accepts": [
       {
         "scheme": "exact",
         "network": "xlayer",
        "maxAmountRequired": "1000000",
        "resource": "https://repopilot/api/v1/audits",
        "description": "RepoPilot Release Gate",
         "mimeType": "application/json",
         "payTo": "0xYourRecipientAddress",
         "maxTimeoutSeconds": 300,
         "asset": "0x55d398326f99059fF775485246999027B3197955"
       }
     ]
   }
   ```

3. The buyer's CLI signs an EIP-3009 `TransferWithAuthorization` (TEE-
   signed by the Agentic Wallet) and replays the request with the
   `X-PAYMENT` header (a base64-encoded JSON envelope).

4. `OkxPaymentAdapter.verifyPayment` — **offline, no chain read**:
   - Re-derives the EIP-712 digest from the challenge.
   - Recovers the signer via `viem.recoverTypedDataAddress`.
   - Compares the recovered address to the authorization `from` field.
   - Verifies the signature with `viem.verifyTypedData`.
   - Re-checks `to` (== `payTo`) and `value` (== `maxAmountRequired`).
   - Re-checks that the clock is inside the signed `validAfter` /
     `validBefore` window.
   - Rejects an authorization whose `(from, nonce)` pair has already been
     used. The signed message does **not** contain the `paymentId`, so one
     signature would otherwise be valid for every future challenge — and
     every POST mints a new `paymentId`. This is the local stand-in for
     EIP-3009's on-chain `authorizationUsed` mapping. It is in-process, so
     a restart forgets it (R-40).

   It does **not** check the on-chain `authorizationUsed` flag, so a
   `completed` receipt means "the authorization is valid and unused", not
   "the money moved". Confirming settlement is the seller's step and is a
   `ROADMAP.md` item. (`rpcUrl` was the option for it; nothing ever passed
   or read it, and it was removed in R-39.)

5. On success the adapter returns a `completed` receipt and the audit is
   **enqueued**: the response is `202` with `statusUrl` and `pollAfterMs`,
   not the report. Poll the `statusUrl` until `status` is `completed`.
   (This step used to say "the response body is the full `Report` JSON" —
   that was the pre-async contract, and it stopped being true when the
   endpoint moved to `202`.)

> Server-side replay protection, two different things with two different keys.
> The same `paymentId` always resolves to the same `PaymentReceipt`
> (idempotency), so the buyer can retry the signed request without paying
> twice. And an `(from, nonce)` pair is accepted **once**, so one signature
> cannot settle a second, different challenge — the buyer who wants a second
> audit signs a second authorization. The second rule is enforced in-process;
> see R-40 for what that does and does not survive.

## 6. Prices

Prices are set via environment variables, **not** hard-coded:

```sh
PRICE_AUDIT=1   # USDT
```

The adapter converts these to atomic units using the per-network USDT
decimals (default 6).

## 7. Submit the Agent listing

After activation, submit the listing in the OKX.AI console:

- **Name:** RepoPilot
- **Tagline:** One repo in. A ship-or-block verdict out.
- **Description:** see `MARKETPLACE_LISTING.md`
- **Pricing:** Release Gate (1 USDT), plus a free triage check
- **Endpoint:** A2MCP URL pointing at the operator's stdio launcher
  (operator-specific)
- **Agent ID:** `<agentId>` from `agent activate`

The marketplace listing copy (English + Simplified Chinese) is in
`MARKETPLACE_LISTING.md`.

## 8. Test the payment flow (no real money)

In dev / CI, set:

```sh
PAYMENT_MODE=mock
```

The `MockPaymentAdapter` is wired into the same code paths. It accepts
`X-PAYMENT: mock:<paymentId>` and immediately returns `completed`. The
buyer can test the entire HTTP/MCP flow without moving any funds.

The integration test in `apps/api/src/tests/api.integration.test.ts`
exercises this end-to-end.

## 9. Switch to production

1. Receive OKX.AI Beta access.
2. Set `OKX_PAYMENT_ADDRESS` to your ASP recipient EVM address.
3. Set `PAYMENT_MODE=okx`.
4. (Optional) Set `OKX_PAYMENT_NETWORK` to the chain you want to accept
   (X Layer is the default; Base and Arbitrum are also supported).
5. Restart the API.
6. From the buyer's CLI, run a real `onchainos payment pay --payment-id
   <id> --yes` and confirm the report arrives.

If anything fails, set `PAYMENT_MODE=mock` again to keep the service
running while you debug. The audit pipeline itself does not depend on the
payment rail.

## 10. OKX.AI Marketplace status

> **Status (2026-07-20):** OKX.AI Marketplace went **GA on 2026-06-30**.
> ASPs self-register via `onchainos agent register --role asp` and add
> service endpoints with `onchainos agent add-service --agent-id <id>`.
> No whitelist / approval needed.
>
> The `OkxPaymentAdapter` is fully implemented and unit-tested against the
> x402 v2 challenge shape and EIP-3009 / EIP-712 verification. With
> `PAYMENT_MODE=okx` and a valid `OKX_PAYMENT_ADDRESS`, the API returns
> real x402 challenges whose `payTo` is the seller wallet and `asset` is
> the USDT contract on the chosen network.
>
> To go from MVP to live:
> 1. Self-register as an ASP via `onchainos agent register --role asp`.
> 2. Add a service endpoint that points at this API's `POST /api/v1/audits`.
> 3. Activate the listing via `onchainos agent activate --agent-id <id>`.
> 4. Real `onchainos payment pay --payment-id <id> --yes` from a buyer
>    wallet holding USDT on X Layer settles the audit and triggers the
>    report.
