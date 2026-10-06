import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { OkxPaymentAdapter, PLACEHOLDER_RESOURCE, CHALLENGE_DESCRIPTION } from './okx-adapter.js';

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
  overrides: { value?: string; to?: string; key?: typeof BUYER } = {}
): Promise<string> {
  const accepts = (challenge.challenge as { accepts: { maxAmountRequired: string }[] }).accepts[0]!;
  const value = overrides.value ?? accepts.maxAmountRequired;
  const to = overrides.to ?? RECIPIENT;
  const signer = overrides.key ?? BUYER;

  const authorization = {
    from: signer.address,
    to: to as `0x${string}`,
    value: BigInt(value),
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: `0x${'11'.repeat(32)}` as `0x${string}`,
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
        validAfter: '0',
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  };
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
