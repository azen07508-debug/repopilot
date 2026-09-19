/**
 * Payment adapter interface — the boundary between the audit service and
 * any payment rail (mock, OKX x402, OKX a2a-pay, Stripe, …).
 *
 * The audit service MUST NOT import a concrete adapter directly. It only
 * knows about this interface, so swapping in production is a config change.
 */
import type { AuditMode } from '@repopilot/core';

export type PaymentMode = 'mock' | 'okx';
export type Currency = 'USDT';

export interface PriceQuote {
  amount: string; // decimal, e.g. "0.02"
  currency: Currency;
  mode: AuditMode;
}

export interface PaymentChallenge {
  /** Stable per-attempt ID. Server uses it for idempotency. */
  paymentId: string;
  /** What the buyer sees (e.g. amount, recipient, network). */
  quote: PriceQuote;
  /** Full 402 challenge payload. */
  challenge: unknown;
  /** When the quote expires. */
  expiresAt: string;
}

export interface PaymentReceipt {
  paymentId: string;
  status: 'pending' | 'settling' | 'completed' | 'failed' | 'expired' | 'cancelled';
  txHash: string | null;
  blockNumber: number | null;
  /** When the receipt was issued. */
  observedAt: string;
}

export interface PaymentAdapter {
  /** Human-readable adapter name. */
  name(): PaymentMode;
  /** Whether this adapter is ready to be used right now. */
  isConfigured(): boolean;
  /** Create a payment challenge. Idempotent on `quoteKey`. */
  createChallenge(input: { quote: PriceQuote; quoteKey: string }): Promise<PaymentChallenge>;
  /** Verify a buyer-submitted payment (e.g. X-PAYMENT header). Returns a receipt. */
  verifyPayment(input: { paymentId: string; rawHeader: string | null }): Promise<PaymentReceipt>;
  /** Lookup a previously created challenge/receipt. */
  getReceipt(paymentId: string): Promise<PaymentReceipt | null>;
}
