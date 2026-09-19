import { describe, it, expect } from 'vitest';
import { OkxPaymentAdapter } from './okx-adapter.js';

describe('OkxPaymentAdapter', () => {
  it('is not configured when recipient is missing', () => {
    const a = new OkxPaymentAdapter({ recipientAddress: '', network: 'xlayer', x402Version: 2 });
    expect(a.isConfigured()).toBe(false);
  });

  it('is configured with a valid 0x address', () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    expect(a.isConfigured()).toBe(true);
  });

  it('createChallenge is idempotent on the quoteKey', async () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c1 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const c2 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    expect(c1.paymentId).toBe(c2.paymentId);
  });

  it('challenge contains the configured recipient and a USDT quote', async () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c = await a.createChallenge({
      quote: { amount: '0.10', currency: 'USDT', mode: 'full' },
      quoteKey: 'q1',
    });
    const body = c.challenge as {
      x402Version: number;
      accepts: { scheme: string; payTo: string; network: string; maxAmountRequired: string }[];
    };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.scheme).toBe('exact');
    expect(body.accepts[0]?.payTo.toLowerCase()).toBe('0x1234567890123456789012345678901234567890');
    expect(body.accepts[0]?.network).toBe('xlayer');
    // 0.10 USDT with 6 decimals → "100000"
    expect(body.accepts[0]?.maxAmountRequired).toBe('100000');
  });

  it('verify with no header returns pending', async () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: null });
    expect(r.status).toBe('pending');
  });

  it('verify with a malformed header returns failed', async () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      quoteKey: 'q1',
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: 'not-base64-!!' });
    expect(r.status).toBe('failed');
  });
});
