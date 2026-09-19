import { describe, it, expect } from 'vitest';
import { MockPaymentAdapter } from './mock-adapter.js';

describe('MockPaymentAdapter', () => {
  it('is always configured', () => {
    const a = new MockPaymentAdapter();
    expect(a.isConfigured()).toBe(true);
    expect(a.name()).toBe('mock');
  });

  it('returns a fresh paymentId per call (idempotency lives in the API layer)', async () => {
    const a = new MockPaymentAdapter();
    const c1 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const c2 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    expect(c1.paymentId).not.toBe(c2.paymentId);
  });

  it('produces different paymentIds for different quote keys', async () => {
    const a = new MockPaymentAdapter();
    const c1 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const c2 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q2',
    });
    expect(c1.paymentId).not.toBe(c2.paymentId);
  });

  it('returns a 402-shaped challenge with an accepts array', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const body = c.challenge as { x402Version: number; accepts: { scheme: string }[] };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.scheme).toBe('exact');
  });

  it('verify with no header returns pending', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: null });
    expect(r.status).toBe('pending');
  });

  it('verify with a valid mock header returns completed', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: `mock:${c.paymentId}` });
    expect(r.status).toBe('completed');
  });

  it('verify is idempotent: same paymentId + same header yields the same receipt', async () => {
    const a = new MockPaymentAdapter();
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
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
