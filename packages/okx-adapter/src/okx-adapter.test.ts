import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { OkxPaymentAdapter, PLACEHOLDER_RESOURCE, CHALLENGE_DESCRIPTION } from './okx-adapter.js';
import { InMemoryNonceStore, type NonceStore } from './nonce-store.js';

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

  it('mints a fresh paymentId per call, like the mock adapter', async () => {
    // This test used to read "createChallenge is idempotent on the quoteKey" and
    // asserted the opposite of what it asserts now. That caching is what made a
    // repository's second audit request fail with `SQLITE_CONSTRAINT_UNIQUE` on
    // `jobs.payment_id` — the route creates a job per POST and attaches the
    // paymentId to it. D-011 decided this: each POST gets a fresh paymentId.
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c1 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    const c2 = await a.createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    expect(c1.paymentId).not.toBe(c2.paymentId);
  });

  it('challenge contains the configured recipient and a USDT quote', async () => {
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const c = await a.createChallenge({
      quote: { amount: '0.10', currency: 'USDT', mode: 'full' },
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
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: 'not-base64-!!' });
    expect(r.status).toBe('failed');
  });

  it('verify never throws on an envelope that parses but is not an authorization', async () => {
    // `parsePaymentHeader` only checks that `signature` is a string and that
    // `payload` exists — it does not look inside `payload.authorization`. So
    // each of these decodes and reaches the verifier. They used to escape as a
    // `TypeError` (`a.to.toLowerCase()` on undefined) or a `BigInt` range
    // error, i.e. a 500 from a route that means "unverified payment". A
    // malformed authorization is an unverified authorization: `failed`.
    //
    // A fresh challenge per case on purpose: `verifyPayment` caches its receipt
    // by `paymentId`, so reusing one would return the first `failed` and never
    // reach the verifier for the later envelopes — the test would pass while
    // testing one case five times.
    const a = new OkxPaymentAdapter({
      recipientAddress: '0x1234567890123456789012345678901234567890',
      network: 'xlayer',
      x402Version: 2,
    });
    const payloads: unknown[] = [
      {},
      { authorization: null },
      { authorization: {} },
      {
        authorization: {
          from: '0x00',
          to: '0x00',
          value: 1000000,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x00',
        },
      },
      {
        authorization: {
          from: '0x00',
          to: '0x00',
          value: 'not-a-number',
          validAfter: 'later',
          validBefore: '9999999999',
          nonce: '0x00',
        },
      },
    ];
    for (const payload of payloads) {
      const c = await a.createChallenge({
        quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
      });
      const rawHeader = Buffer.from(JSON.stringify({ x402Version: 2, signature: '0xab', payload }))
        .toString('base64');
      const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader });
      expect(r.status, `payload ${JSON.stringify(payload)}`).toBe('failed');
    }
  });
});

const RECIPIENT = '0x1234567890123456789012345678901234567890';

/**
 * The xlayer USDT contract and chain id, as `USDT_BY_NETWORK` has them.
 *
 * Written out rather than imported because the point of the signing tests below
 * is to build the digest **from the outside** — the same way the buyer's wallet
 * does. Importing the adapter's own table would let a wrong table agree with
 * itself.
 */
const XLAYER_USDT = '0x55d398326f99059fF775485246999027B3197955';
const XLAYER_CHAIN_ID = 196;

/** A throwaway key. Never funded, never used against a real network. */
const BUYER = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);

function adapter(opts: Partial<ConstructorParameters<typeof OkxPaymentAdapter>[0]> = {}) {
  return new OkxPaymentAdapter({
    recipientAddress: RECIPIENT,
    network: 'xlayer',
    x402Version: 2,
    ...opts,
  });
}

/**
 * Build and sign a real EIP-3009 envelope for a challenge.
 *
 * This is the only thing in the suite that produces a signature the adapter has
 * to actually verify; every other test either feeds it no header or feeds it
 * something malformed. Without this, `verifyPayment`'s success path — the one a
 * paying buyer takes — had no coverage at all.
 */
async function signEnvelope(
  challenge: { paymentId: string; challenge: unknown },
  overrides: {
    value?: string;
    to?: string;
    key?: typeof BUYER;
    validAfter?: string;
    validBefore?: string;
    nonce?: string;
  } = {}
): Promise<string> {
  const accepts = (challenge.challenge as { accepts: { maxAmountRequired: string }[] }).accepts[0]!;
  const value = overrides.value ?? accepts.maxAmountRequired;
  const to = overrides.to ?? RECIPIENT;
  const signer = overrides.key ?? BUYER;
  const validAfter = overrides.validAfter ?? '0';
  const validBefore = overrides.validBefore ?? String(Math.floor(Date.now() / 1000) + 3600);
  const nonce = (overrides.nonce ?? `0x${'11'.repeat(32)}`) as `0x${string}`;

  const authorization = {
    from: signer.address,
    to: to as `0x${string}`,
    value: BigInt(value),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await signer.signTypedData({
    domain: {
      name: 'OKX Agent Payments Protocol',
      version: '1',
      chainId: XLAYER_CHAIN_ID,
      verifyingContract: XLAYER_USDT,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  const envelope = {
    x402Version: 2,
    signature,
    payload: {
      paymentId: challenge.paymentId,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value,
        validAfter,
        validBefore,
        nonce: authorization.nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

/**
 * Take an envelope a buyer already holds and point it at a different challenge.
 *
 * This is the replay in one line: the `paymentId` is **not** part of the signed
 * EIP-712 message, so rewriting it leaves the signature intact and valid. It is
 * also trivial to do — the header is base64 of plain JSON, and the buyer
 * composes it.
 */
function pointAt(header: string, paymentId: string): string {
  const envelope = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
    payload: { paymentId?: string };
  };
  envelope.payload.paymentId = paymentId;
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

describe('a buyer with a real signature is accepted', () => {
  it('completes when the signature, payee and amount all match', async () => {
    const a = adapter();
    const c = await a.createChallenge({
      quote: { amount: '1', currency: 'USDT', mode: 'full' },
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: await signEnvelope(c) });
    expect(r.status).toBe('completed');
  });

  it('fails when the signed amount is not the amount quoted', async () => {
    // The check is `a.value !== expectedAmount`, so this pins that the amount
    // the buyer signed is the amount compared — not a value read back off the
    // challenge after the fact, which would always agree with itself.
    const a = adapter();
    const c = await a.createChallenge({
      quote: { amount: '1', currency: 'USDT', mode: 'full' },
    });
    const header = await signEnvelope(c, { value: '1' }); // 1 atomic unit, not 1 USDT
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header });
    expect(r.status).toBe('failed');
  });

  it('fails when the authorization pays somebody else', async () => {
    const a = adapter();
    const c = await a.createChallenge({
      quote: { amount: '1', currency: 'USDT', mode: 'full' },
    });
    const header = await signEnvelope(c, {
      to: '0x9999999999999999999999999999999999999999',
    });
    const r = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header });
    expect(r.status).toBe('failed');
  });
});

describe('one signed authorization buys one audit', () => {
  /**
   * The EIP-712 message this adapter verifies is
   * `(from, to, value, validAfter, validBefore, nonce)` — it does **not**
   * contain the `paymentId`. Both of the checks that make one signature worth
   * one audit were missing:
   *
   *   - the `nonce` was signed but never recorded, so it was not single-use;
   *   - `validAfter` / `validBefore` were signed but never compared to a clock,
   *     so an authorization that expired last year still passed.
   *
   * On chain, EIP-3009's `authorizationUsed` mapping keyed by `(from, nonce)`
   * is what makes one authorization worth one transfer. This adapter stands in
   * for that check (it is the only thing between a buyer and a 1 USDT audit),
   * and it was not performing it. A buyer could sign once and audit forever by
   * rewriting the envelope's `paymentId` to each new challenge's id — and since
   * every POST mints a fresh `paymentId` (D-011), there is always a new one.
   *
   * The nonce record used to be an in-process `Set`, which a restart or a
   * second replica emptied. That was R-40; the two cases at the bottom of this
   * block are the ones that changed when it became injectable.
   */
  it('refuses a signature that has already bought an audit', async () => {
    const a = adapter();
    const first = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(first);
    expect((await a.verifyPayment({ paymentId: first.paymentId, rawHeader: header })).status).toBe(
      'completed'
    );

    const second = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    // Same signature, same authorization, new challenge — only the envelope's
    // paymentId is rewritten, which leaves the signature valid.
    const replayed = pointAt(header, second.paymentId);
    expect((await a.verifyPayment({ paymentId: second.paymentId, rawHeader: replayed })).status).toBe(
      'failed'
    );
  });

  it('refuses an authorization whose window has already closed', async () => {
    const a = adapter();
    const c = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c, {
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) - 60),
    });
    expect((await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header })).status).toBe(
      'failed'
    );
  });

  it('refuses an authorization that is not valid yet', async () => {
    const a = adapter();
    const c = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c, {
      validAfter: String(Math.floor(Date.now() / 1000) + 3600),
      validBefore: String(Math.floor(Date.now() / 1000) + 7200),
    });
    expect((await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header })).status).toBe(
      'failed'
    );
  });

  it('still accepts a second, independently signed authorization', async () => {
    // The guard must key on the authorization, not on the buyer: a real buyer
    // running two audits signs twice, with two different nonces.
    const a = adapter();
    const first = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const second = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const h1 = await signEnvelope(first, { nonce: `0x${'aa'.repeat(32)}` });
    const h2 = await signEnvelope(second, { nonce: `0x${'bb'.repeat(32)}` });
    expect((await a.verifyPayment({ paymentId: first.paymentId, rawHeader: h1 })).status).toBe(
      'completed'
    );
    expect((await a.verifyPayment({ paymentId: second.paymentId, rawHeader: h2 })).status).toBe(
      'completed'
    );
  });

  it('keeps a retry of the same paymentId idempotent', async () => {
    // The nonce guard must not break the retry the whole design depends on:
    // the route replays the same `X-PAYMENT` to settle a challenge it already
    // issued, and D-011 says a repeated `paymentId` resolves to the same
    // receipt. That path is the receipt cache, which is consulted before the
    // nonce is, so a legitimate retry is not mistaken for a replay.
    const a = adapter();
    const c = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c);
    const first = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header });
    const retry = await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header });
    expect(first.status).toBe('completed');
    expect(retry.status).toBe('completed');
    expect(retry).toEqual(first);
  });

  it('refuses a replay after a restart, when both processes share the store', async () => {
    // This is the R-40 fix, and this test used to assert the opposite. The
    // guard was a `Set` owned by the adapter, so "a restart" was just a new
    // adapter and the same signature bought a second audit. The record now
    // lives in the injected store, so a second adapter over the same store —
    // a second process, or this one after a restart — sees the burn. The
    // durable implementation of that store is
    // `apps/api/src/repositories/nonce-repository.ts`; here an in-memory one
    // is enough, because the property under test is *shared vs not shared*,
    // not where the bytes are.
    const store = new InMemoryNonceStore();
    const before = adapter({ nonceStore: store });
    const c1 = await before.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c1);
    expect((await before.verifyPayment({ paymentId: c1.paymentId, rawHeader: header })).status).toBe(
      'completed'
    );

    const after = adapter({ nonceStore: store });
    const c2 = await after.createChallenge({
      quote: { amount: '1', currency: 'USDT', mode: 'full' },
    });
    expect(
      (await after.verifyPayment({ paymentId: c2.paymentId, rawHeader: pointAt(header, c2.paymentId) }))
        .status
    ).toBe('failed');
  });

  it('still forgets when no store is injected — which is why the API injects one', async () => {
    // Pins the *default*, not a desired behaviour. `InMemoryNonceStore` is
    // correct for `packages/mcp-server`, which never reaches a nonce (it only
    // verifies in mock mode), and wrong for the API, which is why `server.ts`
    // passes `NonceRepository`. If this test goes red, the default changed and
    // that wiring needs a second look.
    const before = adapter();
    const c1 = await before.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c1);
    expect((await before.verifyPayment({ paymentId: c1.paymentId, rawHeader: header })).status).toBe(
      'completed'
    );

    const restarted = adapter();
    const c2 = await restarted.createChallenge({
      quote: { amount: '1', currency: 'USDT', mode: 'full' },
    });
    expect(
      (await restarted.verifyPayment({ paymentId: c2.paymentId, rawHeader: pointAt(header, c2.paymentId) }))
        .status
    ).toBe('completed');
  });

  it('does not turn a store outage into a cached "failed"', async () => {
    // A throw from the store means "I could not answer", not "this
    // authorization is spent". `record('failed')` writes a receipt, and
    // receipts are cached by `paymentId`, so catching the throw would convert
    // a transient database blip into a permanent verdict: the buyer's retry
    // would be answered from the cache without the store ever being asked
    // again. `false` is a replay and is permanent; a throw is an outage and is
    // retryable. Only the first becomes a receipt.
    let outage = true;
    const real = new InMemoryNonceStore();
    const flaky: NonceStore = {
      async burn(key) {
        if (outage) throw new Error('store unavailable');
        return real.burn(key);
      },
    };

    const a = adapter({ nonceStore: flaky });
    const c = await a.createChallenge({ quote: { amount: '1', currency: 'USDT', mode: 'full' } });
    const header = await signEnvelope(c);

    await expect(a.verifyPayment({ paymentId: c.paymentId, rawHeader: header })).rejects.toThrow(
      'store unavailable'
    );

    outage = false;
    expect((await a.verifyPayment({ paymentId: c.paymentId, rawHeader: header })).status).toBe(
      'completed'
    );
  });
});

describe('readPaymentId — the envelope format has one owner', () => {
  /**
   * Until R-39 the route carried its own parser for this header and looked for
   * `paymentId` at the top level, while `ParsedPaymentHeader` declares it under
   * `payload`. A buyer following the documented flow got `400 X-PAYMENT header
   * is malformed` and the adapter was never reached: in `PAYMENT_MODE=okx` the
   * paid endpoint could not accept a payment.
   *
   * The wire shape is not documented anywhere in this repository, so both
   * placements are read. These cases pin that, and pin that garbage is null.
   */
  const withIdAt = (where: 'payload' | 'top') => {
    const authorization = {
      from: BUYER.address,
      to: RECIPIENT,
      value: '1000000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: `0x${'00'.repeat(32)}`,
    };
    const envelope =
      where === 'payload'
        ? { x402Version: 2, signature: '0xab', payload: { paymentId: 'okx_payload', authorization } }
        : { x402Version: 2, signature: '0xab', paymentId: 'okx_top', payload: { authorization } };
    return Buffer.from(JSON.stringify(envelope)).toString('base64');
  };

  it('reads a paymentId under payload (the declared shape)', () => {
    expect(adapter().readPaymentId(withIdAt('payload'))).toBe('okx_payload');
  });

  it('reads a paymentId at the top level (the shape the route used to assume)', () => {
    expect(adapter().readPaymentId(withIdAt('top'))).toBe('okx_top');
  });

  it('returns null rather than throwing for anything it cannot read', () => {
    // null and '' both mean "no header", and each malformed input is a distinct
    // way for a caller to be told 400 instead of being told 500.
    for (const bad of [null, '', 'not-base64-!!', Buffer.from('{}').toString('base64')]) {
      expect(adapter().readPaymentId(bad)).toBeNull();
    }
  });
});

async function acceptsOf(a: OkxPaymentAdapter, mode: 'quick' | 'full', amount: string) {
  const c = await a.createChallenge({
    quote: { amount, currency: 'USDT', mode },
  });
  return (c.challenge as { accepts: Record<string, unknown>[] }).accepts[0]!;
}

describe('the 402 challenge names what the buyer is paying for', () => {
  it('uses the configured resource URL', async () => {
    const a = adapter({ resourceUrl: 'https://api.example.com/api/v1/audits' });
    const accepts = await acceptsOf(a, 'quick', '0.02');
    expect(accepts['resource']).toBe('https://api.example.com/api/v1/audits');
  });

  it('falls back to a reserved-host placeholder when unconfigured', async () => {
    // Not a plausible-looking host. `.invalid` is reserved by RFC 2606 and can
    // never resolve, so this value cannot be mistaken for a working endpoint —
    // which is what the previous hard-coded `https://repopilot/api/v1/audits`
    // was. Production refuses to start without a real one.
    const accepts = await acceptsOf(adapter(), 'quick', '0.02');
    expect(accepts['resource']).toBe(PLACEHOLDER_RESOURCE);
    expect(String(accepts['resource'])).toContain('.invalid');
  });

  it('treats a whitespace-only resource URL as unconfigured', async () => {
    const accepts = await acceptsOf(adapter({ resourceUrl: '   ' }), 'quick', '0.02');
    expect(accepts['resource']).toBe(PLACEHOLDER_RESOURCE);
  });

  it('names the service the way the listing names it, whatever the mode', async () => {
    // The challenge used to say "RepoPilot quick audit" — the internal `mode`
    // value, lower-cased. A buyer who read "Quick Scan" on the listing then saw
    // a different name on the payment prompt. There is one paid service now, so
    // the prompt carries one name: `mode` selects what the report carries, not
    // what is bought, and a challenge naming a mode would name something the
    // buyer never chose.
    expect((await acceptsOf(adapter(), 'quick', '0.02'))['description']).toBe(
      CHALLENGE_DESCRIPTION
    );
    expect((await acceptsOf(adapter(), 'full', '0.02'))['description']).toBe(
      CHALLENGE_DESCRIPTION
    );
  });
});

describe('the emitted challenge matches the documented one', () => {
  /**
   * `docs/OKX_REQUIREMENTS_SNAPSHOT.md` §5.5 is the registration authority: it
   * is the shape the ASP is registered with, and the shape a reviewer compares
   * the live service against. It had drifted from the code in four ways at once
   * (a fake `resource` host, `maxTimeoutSeconds: 60` vs `300`, a lower-cased
   * `description`, and a missing `asset`) and nothing noticed, because a
   * document cannot disagree with a function it is never compared to.
   *
   * This test is that comparison. It reads the JSON block out of the snapshot
   * and asserts the field set and the environment-independent values are the
   * ones the adapter emits.
   */
  const snapshot = readFileSync(
    new URL('../../../docs/OKX_REQUIREMENTS_SNAPSHOT.md', import.meta.url),
    'utf8'
  );

  /** The `accepts[0]` object from the §5.5 JSON block, as documented. */
  function documentedAccepts(): Record<string, unknown> {
    const section = snapshot.slice(snapshot.indexOf('### 5.5'));
    const block = /```json\n([\s\S]*?)\n```/.exec(section);
    if (!block) throw new Error('docs-facts: §5.5 has no ```json block to compare against');
    const parsed = JSON.parse(block[1]!) as { accepts: Record<string, unknown>[] };
    return parsed.accepts[0]!;
  }

  /** The `x402Version` from the §5.5 JSON block — a sibling of `accepts`. */
  function documentedVersion(): number {
    const section = snapshot.slice(snapshot.indexOf('### 5.5'));
    const block = /```json\n([\s\S]*?)\n```/.exec(section);
    if (!block) throw new Error('docs-facts: §5.5 has no ```json block to compare against');
    return (JSON.parse(block[1]!) as { x402Version: number }).x402Version;
  }

  it('has the same field set, in both places', async () => {
    const documented = Object.keys(documentedAccepts()).sort();
    const emitted = Object.keys(await acceptsOf(adapter(), 'quick', '0.02')).sort();
    expect(emitted).toEqual(documented);
  });

  it('agrees on the envelope version', async () => {
    const c = await adapter().createChallenge({
      quote: { amount: '0.02', currency: 'USDT', mode: 'quick' },
    });
    expect((c.challenge as { x402Version: number }).x402Version).toBe(documentedVersion());
  });

  it('agrees on every value the environment does not supply', async () => {
    const documented = documentedAccepts();
    const emitted = await acceptsOf(adapter(), 'quick', '0.02');
    for (const key of ['scheme', 'network', 'mimeType', 'maxTimeoutSeconds', 'extra']) {
      expect(`${key}=${JSON.stringify(emitted[key])}`).toBe(
        `${key}=${JSON.stringify(documented[key])}`
      );
    }
  });

  it('agrees on the price and description', async () => {
    // The documented amount is a string of atomic units and the quote is
    // decimal, so the decimal is *derived from the document* rather than
    // written here — a hand-copied price in a test is the thing this whole
    // check exists to avoid, and a fixture that happened to equal the real
    // price could not see a hard-coded real price.
    //
    // So this pins the *scaling*: the adapter turns the documented price into
    // the documented atomic string. Whether the documented price is the one the
    // server actually charges is `docs-facts`' job — `checkPrices()` compares
    // it against the compiled default in `apps/api/src/config.ts` and against
    // the listing. Neither check subsumes the other: this one would stay green
    // if the doc and the config moved together, and that one would stay green
    // if the adapter stopped scaling.
    const documented = documentedAccepts();
    const documentedAtomic = String(documented['maxAmountRequired']);
    const documentedDecimal = String(Number(documentedAtomic) / 10 ** 6);
    const emitted = await acceptsOf(adapter(), 'quick', documentedDecimal);
    expect(emitted['maxAmountRequired']).toBe(documentedAtomic);
    expect(emitted['description']).toBe(documented['description']);
  });
});
