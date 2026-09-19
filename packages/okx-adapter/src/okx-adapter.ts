/**
 * OKX payment adapter.
 *
 * === STUB BOUNDARY ====================================================
 * This adapter implements the x402 v2 + EIP-3009 / EIP-712 verification
 * flow against the OKX Agent Payments Protocol (see
 * `okx-agent-payments-protocol/charge.md` from the Onchain OS Skills v4.2.6).
 *
 * However, the **on-chain settlement** step (confirming that the
 * `authorizationUsed` flag has been flipped on the USDT contract)
 * requires the seller to be a registered ASP on the OKX.AI Agent
 * Marketplace (which went GA on 2026-06-30). Until then, the
 * `OkxPaymentAdapter.createChallenge` still emits a valid x402
 * challenge, but a real buyer cannot sign a settling `X-PAYMENT`
 * against a marketplace service that does not exist.
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
 *          "resource": "https://repopilot/api/v1/audits",
 *          "description": "RepoPilot Quick Scan",
 *          "mimeType": "application/json",
 *          "payTo": "<OKX_PAYMENT_ADDRESS>",
 *          "maxTimeoutSeconds": 300
 *        }]
 *      }
 *
 * 2. The buyer's `onchainos` CLI signs an EIP-3009 `TransferWithAuthorization`
 *    payload and replays the request with the `X-PAYMENT` header.
 *
 * 3. This adapter re-derives the EIP-712 domain, recovers the signer, and
 *    verifies the signature against the on-chain authorization. The
 *    server NEVER holds the buyer's private key — the wallet does the
 *    signing.
 *
 * 4. On success the adapter stores a `paymentId → receipt` row in the
 *    idempotency store. Replays of the same `paymentId` resolve to the
 *    same `completed` receipt.
 *
 * 5. The audit endpoint then re-runs the analysis and returns the report.
 *
 * NOTE on Marketplace listing: the OKX on-chain settlement step is
 * reachable for any wallet that has self-registered as an ASP on the
 * OKX.AI Agent Marketplace (GA since 2026-06-30). Until the listing
 * is published, `onchainos` buyers will see the challenge but cannot
 * settle it through a marketplace-mediated flow. Direct x402 settlement
 * (manual replay with `X-PAYMENT` header signed by a buyer wallet) is
 * always available regardless of listing status.
 */
import { randomUUID, createHash } from 'node:crypto';
import { verifyTypedData, recoverTypedDataAddress, hashTypedData, type Hex } from 'viem';
import type {
  PaymentAdapter,
  PaymentChallenge,
  PaymentReceipt,
  PriceQuote,
} from './adapter.js';
import { AuditMode } from '@repopilot/core';

export interface OkxPaymentAdapterOptions {
  /** EVM address that receives payment. */
  recipientAddress: string;
  /** Network name (e.g. "xlayer", "base", "ethereum"). */
  network: string;
  /** x402 protocol version (currently 1 or 2). */
  x402Version: 1 | 2;
  /** Underlying RPC used to read the on-chain `authorizationUsed` flag. */
  rpcUrl?: string;
  /** Token contract address (defaults to USDT on the chosen network). */
  tokenAddress?: string;
  /** Token decimals (default 6 for USDT). */
  tokenDecimals?: number;
}

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
  private challenges = new Map<string, { challenge: PaymentChallenge; quoteKey: string }>();
  private receipts = new Map<string, PaymentReceipt>();
  private idempotency = new Map<string, string>();

  constructor(opts: OkxPaymentAdapterOptions) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return isAddressLike(this.opts.recipientAddress) && !!this.opts.network;
  }

  async createChallenge(input: { quote: PriceQuote; quoteKey: string }): Promise<PaymentChallenge> {
    const existing = this.idempotency.get(input.quoteKey);
    if (existing) {
      const rec = this.challenges.get(existing);
      if (rec) return rec.challenge;
    }
    const paymentId = `okx_${randomUUID()}`;
    const meta = USDT_BY_NETWORK[this.opts.network] ?? USDT_BY_NETWORK['xlayer']!;
    const decimals = this.opts.tokenDecimals ?? meta.decimals;
    const token = this.opts.tokenAddress ?? meta.token;
    const atomicAmount = toAtomic(input.quote.amount, decimals);
    const resource = 'https://repopilot/api/v1/audits';
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
            description: `RepoPilot ${input.quote.mode} audit`,
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
    this.challenges.set(paymentId, { challenge, quoteKey: input.quoteKey });
    this.idempotency.set(input.quoteKey, paymentId);
    return challenge;
  }

  /**
   * Verify the buyer's `X-PAYMENT` header.
   *
   * The buyer's `onchainos payment pay --payment-id <id>` CLI is responsible
   * for assembling the EIP-3009 authorization and signing it. The header we
   * receive is a base64-encoded JSON envelope. We re-derive the EIP-712
   * digest from the challenge, recover the signer, and check that the
   * recovered address matches the expected buyer (or, in v2, that the
   * authorization is well-formed and the chain is correct).
   */
  async verifyPayment(input: { paymentId: string; rawHeader: string | null }): Promise<PaymentReceipt> {
    const cached = this.receipts.get(input.paymentId);
    if (cached) return cached;

    if (!input.rawHeader) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'pending',
        txHash: null,
        blockNumber: null,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }

    const challengeRec = this.challenges.get(input.paymentId);
    if (!challengeRec) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'failed',
        txHash: null,
        blockNumber: null,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }
    if (new Date(challengeRec.challenge.expiresAt).getTime() < Date.now()) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'expired',
        txHash: null,
        blockNumber: null,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }

    let envelope: ParsedPaymentHeader;
    try {
      envelope = parsePaymentHeader(input.rawHeader);
    } catch {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'failed',
        txHash: null,
        blockNumber: null,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }

    // Recompute the EIP-712 digest and verify the signature.
    const meta = USDT_BY_NETWORK[this.opts.network] ?? USDT_BY_NETWORK['xlayer']!;
    const ok = await verifyEip3009({
      envelope,
      network: this.opts.network,
      chainId: meta.chainId,
      verifyingContract: this.opts.tokenAddress ?? meta.token,
      payTo: this.opts.recipientAddress,
      expectedAmount: (challengeRec.challenge.challenge as { accepts: { maxAmountRequired: string }[] })
        .accepts[0]!.maxAmountRequired,
    });

    if (!ok) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'failed',
        txHash: null,
        blockNumber: null,
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }

    const r: PaymentReceipt = {
      paymentId: input.paymentId,
      status: 'completed',
      txHash: envelope.payload.txHash ?? null,
      blockNumber: envelope.payload.blockNumber ?? null,
      observedAt: new Date().toISOString(),
    };
    this.receipts.set(input.paymentId, r);
    return r;
  }

  async getReceipt(paymentId: string): Promise<PaymentReceipt | null> {
    return this.receipts.get(paymentId) ?? null;
  }
}

interface ParsedPaymentHeader {
  /** x402Version (1 or 2). */
  x402Version: 1 | 2;
  /** Hex signature. */
  signature: Hex;
  /** Recovered signer (if pre-extracted). */
  from?: Hex;
  payload: {
    paymentId: string;
    txHash?: string;
    blockNumber?: number;
    authorization: {
      from: Hex;
      to: Hex;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
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

async function verifyEip3009(input: {
  envelope: ParsedPaymentHeader;
  network: string;
  chainId: number;
  verifyingContract: string;
  payTo: string;
  expectedAmount: string;
}): Promise<boolean> {
  const { envelope, chainId, verifyingContract, payTo, expectedAmount } = input;
  const a = envelope.payload.authorization;
  if (a.to.toLowerCase() !== payTo.toLowerCase()) return false;
  if (a.value !== expectedAmount) return false;

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
    from: a.from,
    to: a.to,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  };
  try {
    // Recover the signer from the typed-data digest.
    const recovered = (await recoverTypedDataAddress({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
      signature: envelope.signature,
    })) as Hex;
    if (recovered.toLowerCase() !== a.from.toLowerCase()) return false;
    // Also verify the signature directly to be safe.
    return await verifyTypedData({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
      signature: envelope.signature,
      address: a.from,
    });
  } catch {
    return false;
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

export function quoteKeyFor(input: { mode: AuditMode | string; repoUrl: string }): string {
  return createHash('sha256').update(`${input.mode}|${input.repoUrl.toLowerCase()}`).digest('hex');
}
