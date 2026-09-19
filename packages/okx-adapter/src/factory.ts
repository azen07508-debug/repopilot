/**
 * Payment adapter selection. Reads configuration and returns the right
 * implementation. This is the single place where the application chooses
 * between mock and OKX payment rails.
 *
 * === STUB BOUNDARY ====================================================
 * When `cfg.mode === 'okx'`, we construct the `OkxPaymentAdapter`.
 * The adapter requires only a syntactically valid
 * `OKX_PAYMENT_ADDRESS` (a 0x-prefixed EVM address). If the address is
 * missing or malformed, we REFUSE to fall back to mock silently — the
 * factory throws and the API startup fails with a clear, single message
 * that points at `docs/EXTERNAL_ACTIONS.md` (item 2).
 *
 * This is the only place that chooses between the two rails; do not
 * add mode-based branching anywhere else.
 * =======================================================================
 */
import type { PaymentAdapter, PaymentMode } from './adapter.js';
import { MockPaymentAdapter } from './mock-adapter.js';
import { OkxPaymentAdapter } from './okx-adapter.js';

export interface PaymentConfig {
  mode: PaymentMode;
  okx: {
    recipientAddress: string;
    network: string;
    x402Version: 1 | 2;
  };
  pricing: {
    quickScan: { amount: string; currency: 'USDT' };
    fullAudit: { amount: string; currency: 'USDT' };
  };
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

export function buildPaymentAdapter(cfg: PaymentConfig): PaymentAdapter {
  if (cfg.mode === 'okx') {
    if (!isEvmAddress(cfg.okx.recipientAddress)) {
      throw new Error(
        'PAYMENT_MODE=okx requires a valid OKX_PAYMENT_ADDRESS (0x-prefixed EVM address). ' +
          'Until OKX.AI Beta is granted, set PAYMENT_MODE=mock. ' +
          'See docs/EXTERNAL_ACTIONS.md (item 2) and README_OKX.md.',
      );
    }
    return new OkxPaymentAdapter({
      recipientAddress: cfg.okx.recipientAddress,
      network: cfg.okx.network,
      x402Version: cfg.okx.x402Version,
    });
  }
  return new MockPaymentAdapter();
}

export function priceFor(
  cfg: PaymentConfig,
  mode: 'quick' | 'full',
): { amount: string; currency: 'USDT' } {
  return mode === 'full' ? cfg.pricing.fullAudit : cfg.pricing.quickScan;
}
