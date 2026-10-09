/**
 * Mock payment adapter.
 *
 * Used in dev and in CI. The server:
 *   - returns a 402 challenge with a fake quote,
 *   - the buyer (or the test) re-calls with `X-PAYMENT: mock:<paymentId>`,
 *   - the adapter immediately returns a `completed` receipt.
 *
 * No funds move. No external network calls.
 */
import { randomUUID } from 'node:crypto';
import { toAtomic } from './evm.js';
import type {
  PaymentAdapter,
  PaymentChallenge,
  PaymentReceipt,
  PriceQuote,
} from './adapter.js';

interface ChallengeRecord {
  challenge: PaymentChallenge;
}

export class MockPaymentAdapter implements PaymentAdapter {
  name(): 'mock' {
    return 'mock';
  }
  isConfigured(): boolean {
    return true;
  }

  /**
   * Mock headers are `mock:<paymentId>`. See `PaymentAdapter.readPaymentId` for
   * why the adapter owns this rather than the route.
   */
  readPaymentId(rawHeader: string | null): string | null {
    if (!rawHeader) return null;
    const m = /^mock:([A-Za-z0-9_-]+)$/.exec(rawHeader.trim());
    return m?.[1] ?? null;
  }

  private challenges = new Map<string, ChallengeRecord>();
  private receipts = new Map<string, PaymentReceipt>();

  async createChallenge(input: { quote: PriceQuote }): Promise<PaymentChallenge> {
    // Each call returns a fresh paymentId. The API layer is responsible
    // for short-circuiting retries on the same paymentId.
    const paymentId = `mock_${randomUUID()}`;
    const challenge: PaymentChallenge = {
      paymentId,
      quote: input.quote,
      challenge: {
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'xlayer',
            maxAmountRequired: toAtomic(input.quote.amount, 6),
            resource: 'repopilot:audit',
            description: `RepoPilot ${input.quote.mode} audit`,
            mimeType: 'application/json',
            payTo: '0xMOCK0000000000000000000000000000000000000',
            maxTimeoutSeconds: 300,
            extra: { mock: true, mode: input.quote.mode },
          },
        ],
      },
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    this.challenges.set(paymentId, { challenge });
    return challenge;
  }

  async verifyPayment(input: { paymentId: string; rawHeader: string | null }): Promise<PaymentReceipt> {
    if (!input.rawHeader) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'pending',
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }
    // Format: "mock:<paymentId>" or any non-empty header is treated as proof
    // (mock adapter; this is intentionally permissive).
    const expected = `mock:${input.paymentId}`;
    const isValid =
      input.rawHeader === expected ||
      input.rawHeader === input.paymentId ||
      input.rawHeader.length > 0; // mock acceptance for any non-empty value
    if (!isValid) {
      const r: PaymentReceipt = {
        paymentId: input.paymentId,
        status: 'failed',
        observedAt: new Date().toISOString(),
      };
      this.receipts.set(input.paymentId, r);
      return r;
    }
    const r: PaymentReceipt = {
      paymentId: input.paymentId,
      status: 'completed',
      observedAt: new Date().toISOString(),
    };
    this.receipts.set(input.paymentId, r);
    return r;
  }
}
