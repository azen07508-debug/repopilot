import { describe, it, expect } from 'vitest';
import { buildPaymentAdapter, priceFor, type PaymentConfig } from './factory.js';
import type { PaymentAdapter } from './adapter.js';
import { MockPaymentAdapter } from './mock-adapter.js';
import { OkxPaymentAdapter } from './okx-adapter.js';

/**
 * The pricing block in these fixtures is deliberately NOT the production
 * price. If a fixture used the production amount and the factory hard-coded
 * that amount, every assertion below would still pass and the bug would ship.
 *
 * That is necessary and it is **not** sufficient — worth spelling out, because
 * this comment used to claim it was ("keeping the fixture off the production
 * value is what makes `priceFor` discriminating"). It only stops the function
 * hard-coding the *production* value. It does nothing about a function that
 * hard-codes the *fixture* value, and a fixture cannot see that. Measured, not
 * assumed: with `PRICING` at `0.13`, replacing `priceFor`'s body with
 * `return { amount: '0.13', currency: 'USDT' }` survived all 39 tests in this
 * package. The guard is the test further down that feeds it two differently
 * priced configs; a fixture carrying one price cannot be that guard.
 *
 * The production number is checked by `pnpm docs:check`, which compares every
 * place it is stated — that check owns the count, so this comment deliberately
 * does not repeat it.
 */
const PRICING = {
  audit: { amount: '0.13', currency: 'USDT' } as const,
};

const mockConfig: PaymentConfig = {
  mode: 'mock',
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
  pricing: PRICING,
};

const okxConfig: PaymentConfig = {
  mode: 'okx',
  okx: {
    recipientAddress: '0x1234567890123456789012345678901234567890',
    network: 'xlayer',
    x402Version: 2,
  },
  pricing: PRICING,
};

/** Same config with the recipient replaced. */
function withRecipient(recipientAddress: string): PaymentConfig {
  return { ...okxConfig, okx: { ...okxConfig.okx, recipientAddress } };
}

describe('buildPaymentAdapter — mode selection', () => {
  it('returns a MockPaymentAdapter when mode is mock', () => {
    const a = buildPaymentAdapter(mockConfig);
    expect(a.name()).toBe('mock');
    expect(a).toBeInstanceOf(MockPaymentAdapter);
  });

  it('returns an OkxPaymentAdapter when mode is okx and the address is valid', () => {
    const a = buildPaymentAdapter(okxConfig);
    expect(a.name()).toBe('okx');
    expect(a).toBeInstanceOf(OkxPaymentAdapter);
    expect(a.isConfigured()).toBe(true);
  });

  it('ignores a valid recipient address when the mode is mock', () => {
    // The inverse of the fallback this file guards against: a leftover
    // OKX_PAYMENT_ADDRESS in the environment must not silently move a
    // development run onto the real rail. The mode decides, not the address.
    const a = buildPaymentAdapter({ ...okxConfig, mode: 'mock' });
    expect(a).toBeInstanceOf(MockPaymentAdapter);
  });
});

describe('buildPaymentAdapter — okx mode refuses to degrade to mock', () => {
  /**
   * Every string here is something an operator can realistically paste into
   * `OKX_PAYMENT_ADDRESS`. The failure this guards (R-02) is not "the app
   * crashes": it is the app starting up, answering 402 challenges, and
   * accepting payments it can never settle because there is no recipient.
   * A silent fallback to the mock rail looks identical to a healthy server
   * from the outside — every request succeeds — which is why the factory
   * must fail loudly at construction instead.
   */
  const REJECTED: [label: string, address: string][] = [
    ['empty', ''],
    ['whitespace only', '   '],
    ['the prefix with no body', '0x'],
    ['too short', '0x123456789012345678901234567890123456789'],
    ['too long', '0x12345678901234567890123456789012345678901'],
    ['no 0x prefix', '1234567890123456789012345678901234567890'],
    ['a non-hex digit', '0x123456789012345678901234567890123456789z'],
    ['a placeholder an operator left in', '0xYOUR_WALLET_ADDRESS_HERE'],
    ['an ENS name', 'repopilot.eth'],
    ['a non-EVM chain address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
  ];

  it.each(REJECTED)('throws for %s', (_label, address) => {
    expect(() => buildPaymentAdapter(withRecipient(address))).toThrow();
  });

  it('never returns an adapter for any rejected address', () => {
    // The throw is the contract, but assert the stronger property directly:
    // no adapter comes back at all. A future refactor that logged a warning
    // and returned the mock would keep the `toThrow` tests green only until
    // someone deleted them; this one fails on its own.
    const returned: PaymentAdapter[] = [];
    for (const [, address] of REJECTED) {
      try {
        returned.push(buildPaymentAdapter(withRecipient(address)));
      } catch {
        // expected
      }
    }
    expect(returned).toEqual([]);
  });

  it('names the two things the operator has to change', () => {
    // An error message that says only "invalid address" sends the operator
    // to the source. This one has to carry the way out, because the person
    // reading it is holding a deployment that will not start.
    const err = (() => {
      try {
        buildPaymentAdapter(withRecipient(''));
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('PAYMENT_MODE=mock');
    expect(err?.message).toContain('docs/EXTERNAL_ACTIONS.md');
  });

  it('accepts the same address in upper-case hex digits', () => {
    // `isEvmAddress` is case-sensitive on the `0x` prefix and case-insensitive
    // on the digits, which is what EIP-55 checksummed addresses require.
    const a = buildPaymentAdapter(withRecipient('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'));
    expect(a).toBeInstanceOf(OkxPaymentAdapter);
  });
});

describe('priceFor', () => {
  it('returns the configured audit price', () => {
    expect(priceFor(okxConfig)).toEqual(PRICING.audit);
  });

  it('reads the price off the config, not off a constant', () => {
    // Two configs, two prices — and that is the whole point. Every other test
    // in this block passes a config whose price is `PRICING.audit` and asserts
    // the result equals `PRICING.audit`, which a hard-coded literal also
    // satisfies. Measured, not assumed: replacing the function body with
    // `return { amount: '0.13', currency: 'USDT' }` survived the entire suite
    // (39 of 39 green) until this test existed. Keeping the fixture off the
    // production price is necessary but not sufficient; the function has to be
    // shown reading two different ones.
    const other: PaymentConfig = {
      ...okxConfig,
      pricing: { audit: { amount: '0.29', currency: 'USDT' } },
    };
    expect(priceFor(other)).toEqual({ amount: '0.29', currency: 'USDT' });
    expect(priceFor(okxConfig)).toEqual({ amount: '0.13', currency: 'USDT' });
  });

  it('prices the same on every payment rail', () => {
    // The rail must not change the price. If it ever does, this fails and
    // someone decides deliberately instead of discovering it in a listing.
    //
    // There is no per-mode test any more, and there cannot be: `priceFor` no
    // longer takes a mode. It used to return 0.02 for quick and 0.05 for full,
    // for two modes that run the same analyzers over the same archive. The
    // parameter is gone rather than kept and ignored, so reintroducing a
    // per-mode price is a signature change someone has to argue for.
    expect(priceFor(mockConfig)).toEqual(priceFor(okxConfig));
  });
});
