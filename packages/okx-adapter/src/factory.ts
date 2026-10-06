/**
 * Payment adapter selection. Reads configuration and returns the right
 * implementation. This is the single place where the application chooses
 * between mock and OKX payment rails.
 *
 * === SCOPE BOUNDARY ===================================================
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
import type { NonceStore } from './nonce-store.js';
import { OkxPaymentAdapter } from './okx-adapter.js';

export interface PaymentConfig {
  mode: PaymentMode;
  okx: {
    recipientAddress: string;
    network: string;
    x402Version: 1 | 2;
    /**
     * Public URL of this deployment's audit endpoint, placed in the 402
     * challenge's `accepts[].resource`. Empty means "not configured" and the
     * adapter emits `PLACEHOLDER_RESOURCE`; production refuses to start
     * without it.
     */
    resourceUrl?: string;
  };
  /**
   * One price for the audit. It used to be one per `mode`; the two modes run
   * the same analysis, so the difference priced report sections (see
   * `DEFAULT_PRICING` in `@repopilot/core`).
   */
  pricing: {
    audit: { amount: string; currency: 'USDT' };
  };
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/**
 * Build the payment adapter for `cfg.mode`.
 *
 * `deps.nonceStore` is where the OKX adapter records burned authorization
 * nonces — the record that makes one signed authorization worth one audit.
 * Omit it and the adapter keeps that record in this process only, which is
 * correct for `packages/mcp-server` (it verifies payments only in mock mode,
 * where no nonce is ever reached) and wrong for anything that restarts or
 * runs more than one replica. `apps/api` passes the durable store from
 * `apps/api/src/repositories/nonce-repository.ts`.
 *
 * The default lives on the adapter, not here, so there is one of it: a direct
 * `new OkxPaymentAdapter({...})` behaves exactly like a factory-built one.
 */
export function buildPaymentAdapter(
  cfg: PaymentConfig,
  deps: { nonceStore?: NonceStore } = {},
): PaymentAdapter {
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
      resourceUrl: cfg.okx.resourceUrl,
      nonceStore: deps.nonceStore,
    });
  }
  return new MockPaymentAdapter();
}

/**
 * The price of an audit. It does not take a `mode`: `quick` and `full` run the
 * same analyzers over the same archive, so the mode selects what the report
 * carries, not what it costs. It used to take one and return a different
 * amount per mode — a 2.5x premium for report sections.
 */
export function priceFor(cfg: PaymentConfig): { amount: string; currency: 'USDT' } {
  return cfg.pricing.audit;
}
