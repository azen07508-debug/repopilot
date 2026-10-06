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
  /**
   * What this service knows about the payment.
   *
   * There are four, not six. `'settling'` and `'cancelled'` were removed in
   * R-39: no adapter ever produced either, so a consumer switching on this
   * union had two branches that could not run. `'settling'` described a step
   * this service does not perform (see below); `'cancelled'` described a state
   * nothing can enter.
   */
  status: 'pending' | 'completed' | 'failed' | 'expired';
  /**
   * When the receipt was issued. The only field here that this service
   * observed for itself.
   */
  observedAt: string;
}

/**
 * The boundary between the audit service and a payment rail.
 *
 * **What `verifyPayment` does and does not establish.** It answers "is this
 * buyer's claim well-formed and signed by the address that made it" — nothing
 * more. It does **not** read the chain, so it cannot tell you the money moved.
 * There is no `txHash`/`blockNumber` on a receipt because the service never
 * observes a block: the two that used to sit here were unverified buyer input
 * on the OKX path and fabricated values on the mock path (`blockNumber` was
 * `Math.floor(Date.now() / 1000)` — a Unix timestamp in a field named after a
 * block). Nothing read them either. Settlement is the seller's step and is not
 * modelled by this interface.
 *
 * There is also no `refund`: it was named in `docs/ARCHITECTURE.md` and never
 * existed here (R-39).
 */
export interface PaymentAdapter {
  /** Human-readable adapter name. */
  name(): PaymentMode;
  /** Whether this adapter is ready to be used right now. */
  isConfigured(): boolean;
  /**
   * Read the `paymentId` out of a raw `X-PAYMENT` header, or null.
   *
   * The route needs the id before it can verify anything — it is the key the
   * challenge is looked up by — and the header is this adapter's wire format.
   * This method exists so that format has **one** owner: until R-39 the route
   * carried its own second parser and the two disagreed about where the id
   * lives, which made the OKX paid path answer `400` before the adapter ran.
   */
  readPaymentId(rawHeader: string | null): string | null;
  /**
   * Create a payment challenge. **Every call mints a fresh `paymentId`.**
   *
   * There is no `quoteKey` parameter. There used to be, and this line used to
   * read "Idempotent on `quoteKey`" — which is what made the OKX adapter's
   * caching look correct. D-011 says the opposite: "Each POST creates a fresh
   * `paymentId` (no `quoteKey` caching); the route layer is the only place that
   * performs `paymentId → job` lookup and reuses the existing job." Caching on
   * it collided with `jobs.payment_id` being `UNIQUE` and turned a repository's
   * second audit request into a `500`. The parameter is gone so the decision
   * cannot be un-made by accident.
   */
  createChallenge(input: { quote: PriceQuote }): Promise<PaymentChallenge>;
  /** Verify a buyer-submitted payment (e.g. X-PAYMENT header). Returns a receipt. */
  verifyPayment(input: { paymentId: string; rawHeader: string | null }): Promise<PaymentReceipt>;
}
