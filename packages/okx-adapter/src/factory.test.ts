import { describe, it, expect } from 'vitest';
import { buildPaymentAdapter, type PaymentConfig } from './factory.js';
import { MockPaymentAdapter } from './mock-adapter.js';
import { OkxPaymentAdapter } from './okx-adapter.js';

const mockConfig: PaymentConfig = {
  mode: 'mock',
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
  pricing: {
    quickScan: { amount: '0.02', currency: 'USDT' },
    fullAudit: { amount: '0.10', currency: 'USDT' },
  },
};

const okxConfigured: PaymentConfig = {
  mode: 'okx',
  okx: { recipientAddress: '0x1234567890123456789012345678901234567890', network: 'xlayer', x402Version: 2 },
  pricing: {
    quickScan: { amount: '0.02', currency: 'USDT' },
    fullAudit: { amount: '0.10', currency: 'USDT' },
  },
};

const okxUnconfigured: PaymentConfig = {
  ...okxConfigured,
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
};

describe('buildPaymentAdapter', () => {
  it('returns a MockPaymentAdapter when mode is mock', () => {
    const a = buildPaymentAdapter(mockConfig);
    expect(a.name()).toBe('mock');
    expect(a).toBeInstanceOf(MockPaymentAdapter);
  });

  it('returns an OkxPaymentAdapter when mode is okx and configured', () => {
    const a = buildPaymentAdapter(okxConfigured);
    expect(a.name()).toBe('okx');
    expect(a).toBeInstanceOf(OkxPaymentAdapter);
  });

  it('refuses to construct an OkxPaymentAdapter when mode is okx but recipient is empty', () => {
    // Factory must throw rather than silently fall back to mock when
    // the operator is running in okx mode without a valid recipient.
    expect(() => buildPaymentAdapter(okxUnconfigured)).toThrow(
      /OKX_PAYMENT_ADDRESS|recipient/i,
    );
  });
});
