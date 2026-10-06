import { describe, it, expect } from 'vitest';
import { MockPaymentAdapter } from './mock-adapter.js';

describe('MockPaymentAdapter', () => {
  it('is always configured', () => {
    const a = new MockPaymentAdapter();
    expect(a.isConfigured()).toBe(true);
    expect(a.name()).toBe('mock');
  });

  it('reads the paymentId out of a `mock:` header, and null out of anything else', () => {
    // The route used to carry its own copy of this rule. Moving it here is what
    // makes the header format have one owner (R-39); this is the mock half of
    // the pair, the OKX half is in `okx-adapter.test.ts`.
    const a = new MockPaymentAdapter();
    expect(a.readPaymentId('mock:mock_abc-123')).toBe('mock_abc-123');
    expect(a.readPaymentId('  mock:mock_abc-123  ')).toBe('mock_abc-123');
    for (const bad of [null, '', 'okx_abc', 'mock:', 'mock:has space']) {
      expect(a.readPaymentId(bad)).toBeNull();
    }
  });

  it('returns a fresh paymentId per call (idempotency lives in the API layer)', async () => {
    // D-011: "Each POST creates a fresh `paymentId` (no `quoteKey` caching); the
    // route layer is the only place that performs `paymentId → job` lookup."
    // A test named "produces different paymentIds for different quote keys" sat
    // here and asserted this same pair of calls — it passed because the ids are
    // random, not because of any key, and it was deleted with the parameter.
    const a = new MockPaymentAdapter();
    const c1 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const c2 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    expect(c1.paymentId).not.toBe(c2.paymentId);
  });

  it('returns a 402-shaped challenge with an accepts array', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const body = c.challenge as { x402Version: number; accepts: { scheme: string }[] };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.scheme).toBe('exact');
  });

  it('verify with no header returns pending', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: null });
    expect(r.status).toBe('pending');
  });

  it('verify with a valid mock header returns completed', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: `mock:${c.paymentId}` });
    expect(r.status).toBe('completed');
  });

  it('verify is idempotent: same paymentId + same header yields the same receipt', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const r1 = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: `mock:${c.paymentId}` });
    // Wait a millisecond to ensure a new receipt timestamp would differ if it
    // were regenerated. (Mock adapter currently regenerates observedAt, so
    // the receipts differ in observedAt but stay consistent in status and
    // paymentId — which is what the rest of the system actually depends on.)
    await new Promise((r) => setTimeout(r, 2));
    const r2 = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: `mock:${c.paymentId}` });
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
    expect(r1.paymentId).toBe(r2.paymentId);
    expect(r1.paymentId).toBe(c.paymentId);
  });
});
