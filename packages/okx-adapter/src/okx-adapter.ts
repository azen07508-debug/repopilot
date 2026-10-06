/**
 * OKX payment adapter.
 *
 * === SCOPE BOUNDARY ===================================================
 * This adapter verifies the **EIP-3009 authorization** in a buyer's
 * `X-PAYMENT` header, offline: it re-derives the EIP-712 domain, recovers
 * the signer and checks the `to` / `value` the buyer signed. That is all
 * it does, and it is all it claims to do.
 *
 * (This banner used to read `STUB BOUNDARY`, and two documents cited that
 * phrase as a string the code *throws*. Nothing here throws it; the name
 * was accurate about nothing. Renamed in R-39.)
 *
 * It does **not** read the chain. It never checks the `authorizationUsed`
 * flag, so it cannot tell you whether the money actually moved. Two
 * documents used to say it did (`docs/ARCHITECTURE.md` and the header
 * comment right here); both were wrong, and `rpcUrl` — an option nothing
 * ever passed or read — was the vestige of the read that was never
 * written. Removed in R-39. `ROADMAP.md` lists the on-chain check as
 * still-to-do, and `docs/OKX_LIVE_INTEGRATION.md` §2.1 describes the RPC
 * URL as an *optional* seller-side input: the project's own documents
 * agreed with each other about this, and only these two disagreed.
 *
 * **Settlement is therefore the seller's step, not this service's.** The
 * buyer's signature is an authorization the seller can submit; nothing
 * here submits it. Verifying a signature and settling it are different
 * acts, and this adapter performs only the first.
 *
 * To switch the running service to OKX mode:
 *   1. Apply for the OKX.AI Agent Developer Beta.
 *   2. Set OKX_PAYMENT_ADDRESS (0x EVM public address of the seller)
 *      in the production environment. The x402 seller side does NOT
 *      require any OKX API Key / Secret / Agent Key — the buyer's
 *      wallet signs the EIP-3009 authorization, the seller only
 *      re-derives the EIP-712 digest and recovers the signer.
 *   3. Set PAYMENT_MODE=okx.
 *   4. Restart the API.
 *   5. To perform a real test payment (buyer side), the operator
 *      runs `onchainos payment pay --payment-id <id> --yes` from a
 *      session logged into an OKX Agentic Wallet holding USDT on
 *      the chosen network — see docs/OKX_LIVE_INTEGRATION.md.
 *
 *
 * The full switch-over runbook is in `docs/EXTERNAL_ACTIONS.md` (item 2).
 * See `README_OKX.md` for the protocol details.
 * =======================================================================
 *
 * High-level behaviour, all matching the official reference:
 *
 * 1. The buyer hits POST /api/v1/audits. The server has not yet seen a
 *    payment, so it returns HTTP 402 with an `accepts[]` array (x402 v2)
 *    describing the cheapest viable scheme. The challenge body looks like
 *
 *      {
 *        "x402Version": 2,
 *        "accepts": [{
 *          "scheme": "exact",
 *          "network": "xlayer",
 *          "maxAmountRequired": "<atomic units>",
 *          "resource": "<OKX_PAYMENT_RESOURCE_URL>",
 *          "description": "RepoPilot Release Gate",
 *          "mimeType": "application/json",
 *          "payTo": "<OKX_PAYMENT_ADDRESS>",
 *          "maxTimeoutSeconds": 300,
 *          "asset": "<USDT contract on the network>"
 *        }]
 *      }
 *
 *    The field set and the environment-independent values here are pinned by
 *    `okx-adapter.test.ts` against §5.5 of
 *    `docs/OKX_REQUIREMENTS_SNAPSHOT.md`, so the documented challenge and the
 *    emitted one cannot drift apart without a test going red.
 *
 * 2. The buyer's `onchainos` CLI signs an EIP-3009 `TransferWithAuthorization`
 *    payload and replays the request with the `X-PAYMENT` header.
 *
 * 3. This adapter re-derives the EIP-712 domain, recovers the signer, and
 *    checks the recovered address against the authorization's `from`, plus
 *    `to` == `payTo`, `value` == `maxAmountRequired`, and the clock against
 *    the signed `validAfter` / `validBefore` window. Offline — see the
 *    boundary above. The server NEVER holds the buyer's private key — the
 *    wallet does the signing.
 *
 * 4. **One authorization buys one audit.** The signed message is
 *    `(from, to, value, validAfter, validBefore, nonce)` and does not contain
 *    the `paymentId`, so a signature is valid for any challenge quoting the
 *    same payee and amount. The `(from, nonce)` pair is therefore burned on
 *    first use, standing in for the on-chain `authorizationUsed` read this
 *    adapter does not perform. See `spentNonces`.
 *
 * 5. On success the adapter records a `paymentId → receipt` row. Replays
 *    of the same `paymentId` resolve to the same `completed` receipt.
 *    `paymentId`s are never cached across calls: every `createChallenge`
 *    mints a fresh one, and the route — not the adapter — is what reuses
 *    a job for a replayed id (D-011).
 *
 * 6. The audit endpoint then re-runs the analysis and returns the report.
 *
 * NOTE on Marketplace listing: the OKX on-chain settlement step is
 * reachable for any wallet that has self-registered as an ASP on the
 * OKX.AI Agent Marketplace (GA since 2026-06-30). Until the listing
 * is published, `onchainos` buyers will see the challenge but cannot
 * settle it through a marketplace-mediated flow. Direct x402 settlement
 * (manual replay with `X-PAYMENT` header signed by a buyer wallet) is
 * always available regardless of listing status — and in both cases the
 * settlement itself happens outside this process.
 */
import { randomUUID } from 'node:crypto';
import { verifyTypedData, recoverTypedDataAddress, type Hex } from 'viem';
import type {
  PaymentAdapter,
  PaymentChallenge,
  PaymentReceipt,
  PriceQuote,
} from './adapter.js';

export interface OkxPaymentAdapterOptions {
  /** EVM address that receives payment. */
  recipientAddress: string;
  /** Network name (e.g. "xlayer", "base", "ethereum"). */
  network: string;
  /** x402 protocol version (currently 1 or 2). */
  x402Version: 1 | 2;
  /**
   * The URI the buyer is paying for, put in `accepts[].resource`.
   *
   * Set this to the deployment's own public URL, e.g.
   * `https://api.example.com/api/v1/audits`. When it is absent the challenge
   * carries `PLACEHOLDER_RESOURCE` below, which uses the RFC 2606 reserved
   * `.invalid` TLD — a host that can never resolve, so "this is a placeholder"
   * is a property of the string rather than something a reader has to know.
   *
   * `validateProductionConfig()` refuses to start in production with
   * `PAYMENT_MODE=okx` and no resource URL, so the placeholder cannot reach a
   * buyer. It used to be `https://repopilot/api/v1/audits` — a host that looks
   * plausible and does not exist, which is the kind of value nobody notices.
   */
  resourceUrl?: string;
  /** Token contract address (defaults to USDT on the chosen network). */
  tokenAddress?: string;
  /** Token decimals (default 6 for USDT). */
  tokenDecimals?: number;
}

/**
 * What `accepts[].resource` carries when no public URL is configured. `.invalid`
 * is reserved by RFC 2606 and is guaranteed never to resolve, so this string
 * cannot be mistaken for a working endpoint.
 */
export const PLACEHOLDER_RESOURCE = 'https://repopilot.invalid/api/v1/audits';

/**
 * The `accepts[].description` the buyer reads on the payment prompt.
 *
 * It is the paid service name from `MARKETPLACE_LISTING.md` — what the buyer
 * read before paying. The challenge used to say `RepoPilot quick audit`, the
 * internal `mode` value lower-cased, so the prompt named the tier differently
 * from the listing that sold it.
 *
 * It no longer varies by `mode`. There is one paid service at one price, and
 * `mode` selects what the report carries rather than what is bought, so a
 * challenge that named a mode would be naming something the buyer did not
 * choose. `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §5.5 documents this string and
 * `okx-adapter.test.ts` compares the two, so a rename has to happen in both
 * places or the suite fails.
 */
export const CHALLENGE_DESCRIPTION = 'RepoPilot Release Gate';

const USDT_BY_NETWORK: Record<string, { token: string; decimals: number; chainId: number }> = {
  xlayer: { token: '0x55d398326f99059fF775485246999027B3197955', decimals: 6, chainId: 196 },
  ethereum: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, chainId: 1 },
  base: { token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, chainId: 8453 },
  arbitrum: { token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, chainId: 42161 },
  bsc: { token: '0x55d398326f99059fF775485246999027B3197955', decimals: 6, chainId: 56 },
};

export class OkxPaymentAdapter implements PaymentAdapter {
  name(): 'okx' {
    return 'okx';
  }

  private opts: OkxPaymentAdapterOptions;
  private challenges = new Map<string, PaymentChallenge>();
  private receipts = new Map<string, PaymentReceipt>();
  /**
   * Authorization nonces this process has already accepted, keyed
   * `from:nonce` — the same key EIP-3009's on-chain `authorizationUsed`
   * mapping uses.
   *
   * The signed EIP-712 message is
   * `(from, to, value, validAfter, validBefore, nonce)` and does **not**
   * contain the `paymentId`, so a signature is valid for *any* challenge that
   * quotes the same payee and amount. Every POST mints a fresh `paymentId`
   * (D-011), so without this set a buyer could sign once and audit forever by
   * rewriting the envelope's `paymentId`. See `verifyPayment`.
   *
   * In-process. A restart (or a second replica) forgets it, and replay becomes
   * possible again — recorded in `RISKS.md` R-40 and `BACKLOG.md` rather than
   * implied away. It is still the difference between "replay always works" and
   * "replay works only across a restart".
   */
  private spentNonces = new Set<string>();

  constructor(opts: OkxPaymentAdapterOptions) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return isAddressLike(this.opts.recipientAddress) && !!this.opts.network;
  }

  /**
   * Read the `paymentId` out of an `X-PAYMENT` envelope.
   *
   * **Why this lives on the adapter.** The route needs the paymentId before it
   * can do anything else — it is the key it looks the challenge up by — but the
   * envelope is *this* adapter's wire format. Until R-39 the route carried its
   * own second parser for it (`extractPaymentId` in `routes/audits.ts`), and the
   * two had drifted apart: the route looked for `paymentId` at the top level of
   * the envelope, while `ParsedPaymentHeader` below declares it at
   * `payload.paymentId`. A buyer following the documented flow was answered
   * `400 X-PAYMENT header is malformed` and the adapter was never consulted —
   * in `PAYMENT_MODE=okx` the paid endpoint could not accept a payment at all.
   * No test caught it because every payment test runs in mock mode.
   *
   * **The wire shape is not documented in this repository.** Neither
   * `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §1.4 ("the base64-encoded receipt") nor
   * `README_OKX.md` ("a base64-encoded JSON envelope") says where `paymentId`
   * sits, and the two in-repo parsers above disagreed about it. So this reads
   * both placements rather than betting the payment path on one of them, and
   * `okx-adapter.test.ts` pins both. When the real `onchainos` envelope is
   * observed, delete the branch that is wrong — this is the only place that has
   * to change.
   */
  readPaymentId(rawHeader: string | null): string | null {
    if (!rawHeader) return null;
    try {
      const envelope = parsePaymentHeader(rawHeader);
      return envelope.payload.paymentId || envelope.paymentId || null;
    } catch {
      return null;
    }
  }

  /**
   * Create a challenge. **Every call mints a fresh `paymentId`.**
   *
   * This used to cache on `quoteKey`, so a second POST for the same repository
   * and mode returned the *same* paymentId. That collided with the schema: the
   * route creates a new job row per POST and then attaches the paymentId to it,
   * and `jobs.payment_id` is `UNIQUE` — so the second request for a repository
   * failed with `SQLITE_CONSTRAINT_UNIQUE` and the caller got a `500`. Measured
   * 2026-10-06 by the first test ever to run this route in `PAYMENT_MODE=okx`.
   *
   * D-011 already decided this, and the mock adapter already did it: "Each POST
   * creates a fresh `paymentId` (no `quoteKey` caching); the route layer is the
   * only place that performs `paymentId → job` lookup and reuses the existing
   * job." The OKX adapter was the one implementation that ignored the decision,
   * and the `quoteKey` parameter is gone from the interface so it cannot be
   * re-made by accident.
   */
  async createChallenge(input: { quote: PriceQuote }): Promise<PaymentChallenge> {
    const paymentId = `okx_${randomUUID()}`;
    const meta = USDT_BY_NETWORK[this.opts.network] ?? USDT_BY_NETWORK['xlayer']!;
    const decimals = this.opts.tokenDecimals ?? meta.decimals;
    const token = this.opts.tokenAddress ?? meta.token;
    const atomicAmount = toAtomic(input.quote.amount, decimals);
    const resource = this.opts.resourceUrl?.trim() || PLACEHOLDER_RESOURCE;
    const challenge: PaymentChallenge = {
      paymentId,
      quote: input.quote,
      challenge: {
        x402Version: this.opts.x402Version,
        accepts: [
          {
            scheme: 'exact',
            network: this.opts.network,
            maxAmountRequired: atomicAmount,
            resource,
            description: CHALLENGE_DESCRIPTION,
            mimeType: 'application/json',
            payTo: this.opts.recipientAddress,
            maxTimeoutSeconds: 300,
            asset: token,
            extra: { name: 'RepoPilot', version: '0.1.0' },
          },
        ],
      },
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    this.challenges.set(paymentId, challenge);
    return challenge;
  }

  /**
   * Verify the buyer's `X-PAYMENT` header.
   *
   * The buyer's `onchainos payment pay --payment-id <id>` CLI is responsible
   * for assembling the EIP-3009 authorization and signing it. The header we
   * receive is a base64-encoded JSON envelope. We re-derive the EIP-712
   * digest, recover the signer, and check it against the authorization's
   * `from`, plus `to` == `payTo`, `value` == `maxAmountRequired`, and that the
   * clock is inside the signed `validAfter` / `validBefore` window.
   *
   * `completed` here means **"the authorization is valid and unused"**, not
   * "the money moved" — this adapter never reads a block. See the boundary at
   * the top of the file.
   */
  async verifyPayment(input: { paymentId: string; rawHeader: string | null }): Promise<PaymentReceipt> {
    const cached = this.receipts.get(input.paymentId);
    if (cached) return cached;

    /** Record and return a receipt. One place, so the shapes cannot drift. */
    const record = (status: PaymentReceipt['status']): PaymentReceipt => {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    };

    if (!input.rawHeader) return record('pending');

    const challenge = this.challenges.get(input.paymentId);
    if (!challenge) return record('failed');
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      return record('expired');
    }

    let envelope: ParsedPaymentHeader;
    try {
      envelope = parsePaymentHeader(input.rawHeader);
    } catch {
      return record('failed');
    }

    // Recompute the EIP-712 digest and verify the signature. The return value
    // is the key the nonce must be burned under, or null when the
    // authorization is not usable.
    const meta = USDT_BY_NETWORK[this.opts.network] ?? USDT_BY_NETWORK['xlayer']!;
    const nonceKey = await verifyEip3009({
      envelope,
      chainId: meta.chainId,
      verifyingContract: this.opts.tokenAddress ?? meta.token,
      payTo: this.opts.recipientAddress,
      expectedAmount: (challenge.challenge as { accepts: { maxAmountRequired: string }[] }).accepts[0]!
        .maxAmountRequired,
    });
    if (!nonceKey) return record('failed');

    // One authorization, one audit.
    //
    // The signature covers `(from, to, value, validAfter, validBefore, nonce)`
    // and NOT the paymentId, so the same signature verifies against every
    // challenge that quotes the same payee and amount — and every POST mints a
    // fresh paymentId (D-011). Nothing else in this service compares two
    // authorizations, so without this check the buyer signs once and audits
    // forever. On chain the guard is EIP-3009's `authorizationUsed[from][nonce]`;
    // this adapter is standing in for that read, so it has to perform it.
    //
    // Burned only after the signature verifies, so a caller cannot consume a
    // nonce it cannot sign for.
    if (this.spentNonces.has(nonceKey)) return record('failed');
    this.spentNonces.add(nonceKey);

    return record('completed');
  }
}

interface ParsedPaymentHeader {
  /** x402Version (1 or 2). */
  x402Version: 1 | 2;
  /** Hex signature. */
  signature: Hex;
  /** Recovered signer (if pre-extracted). */
  from?: Hex;
  /**
   * The payment id, at the top level of the envelope.
   *
   * Optional because the two in-repo parsers disagreed about where this lives
   * and neither document says — see `readPaymentId()`. Exactly one of this and
   * `payload.paymentId` is expected to be present.
   */
  paymentId?: string;
  payload: {
    /** See `paymentId` above. */
    paymentId?: string;
    authorization: RawAuthorization;
  };
}

/**
 * The authorization **as it arrives**: unvalidated JSON.
 *
 * Every field is `unknown` on purpose. `parsePaymentHeader` only checks that
 * `signature` is a string and that `payload` exists — it does not look inside
 * `authorization` at all. Declaring these as `string`/`Hex` would be the same
 * class of lie this batch is about: a type that asserts something nothing has
 * checked, and that turns the validating `typeof` guards into dead code the
 * compiler believes can never fire. They are narrowed in `verifyEip3009`.
 */
interface RawAuthorization {
  from?: unknown;
  to?: unknown;
  value?: unknown;
  validAfter?: unknown;
  validBefore?: unknown;
  nonce?: unknown;
}

function parsePaymentHeader(raw: string): ParsedPaymentHeader {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    throw new Error('X-PAYMENT must be base64');
  }
  const obj = JSON.parse(decoded) as Partial<ParsedPaymentHeader>;
  if (typeof obj.signature !== 'string' || !obj.payload) {
    throw new Error('X-PAYMENT envelope missing fields');
  }
  return obj as ParsedPaymentHeader;
}

/**
 * Verify the buyer's EIP-3009 authorization.
 *
 * Returns the key the nonce must be recorded under (`from:nonce`) when the
 * authorization is valid and usable, or `null` when it is not. Returning the
 * key rather than a boolean keeps the "is it valid" and "what do I burn" halves
 * from drifting: there is one parse of the authorization, and a caller cannot
 * forget which nonce it just accepted.
 *
 * **Never throws.** The envelope is buyer-supplied JSON: `parsePaymentHeader`
 * checks only that `signature` is a string and `payload` exists, so
 * `payload.authorization` can be missing, a field can be a number, and
 * `value` can be `"abc"`. Every one of those used to escape as a `TypeError`
 * or a `BigInt` range error and become a `500`; a malformed authorization is
 * an unverified authorization, which is `failed`.
 *
 * Two things are checked beyond the signature itself:
 *   - `to` is the configured payee, and `value` is the amount quoted;
 *   - the clock is inside `[validAfter, validBefore)`. Both fields are signed
 *     and neither was compared to anything, so an authorization that expired
 *     last year — or that does not start until next year — verified as paid.
 *     `validBefore` is exclusive, matching EIP-3009's `block.timestamp <
 *     validBefore`.
 *
 * The nonce is *not* checked here. Whether it has been used is state the caller
 * owns, and this function is the only thing that parses the authorization — so
 * it returns the key and `verifyPayment` does the bookkeeping.
 */
async function verifyEip3009(input: {
  envelope: ParsedPaymentHeader;
  chainId: number;
  verifyingContract: string;
  payTo: string;
  expectedAmount: string;
}): Promise<string | null> {
  const { envelope, chainId, verifyingContract, payTo, expectedAmount } = input;
  try {
    const a = envelope.payload.authorization;
    if (
      !a ||
      typeof a.from !== 'string' ||
      typeof a.to !== 'string' ||
      typeof a.value !== 'string' ||
      typeof a.validAfter !== 'string' ||
      typeof a.validBefore !== 'string' ||
      typeof a.nonce !== 'string'
    ) {
      return null;
    }
    if (a.to.toLowerCase() !== payTo.toLowerCase()) return null;
    if (a.value !== expectedAmount) return null;

    const now = Math.floor(Date.now() / 1000);
    if (BigInt(a.validAfter) > BigInt(now)) return null;
    if (BigInt(a.validBefore) <= BigInt(now)) return null;

    const domain = {
      name: 'OKX Agent Payments Protocol',
      version: '1',
      chainId,
      verifyingContract: verifyingContract as Hex,
    };
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    } as const;
    const message = {
      from: a.from as Hex,
      to: a.to as Hex,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce as Hex,
    };

    // Recover the signer from the typed-data digest.
    const recovered = (await recoverTypedDataAddress({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
      signature: envelope.signature,
    })) as Hex;
    if (recovered.toLowerCase() !== a.from.toLowerCase()) return null;
    // Also verify the signature directly to be safe.
    const ok = await verifyTypedData({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
      signature: envelope.signature,
      address: a.from as Hex,
    });
    if (!ok) return null;

    return `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;
  } catch {
    return null;
  }
}

function isAddressLike(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function toAtomic(amount: string, decimals: number): string {
  const [intPart, fracPart = ''] = amount.split('.');
  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return `${intPart ?? '0'}${padded}`.replace(/^0+(?=\d)/, '') || '0';
}
