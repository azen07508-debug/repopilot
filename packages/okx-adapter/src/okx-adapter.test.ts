import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OkxPaymentAdapter, PLACEHOLDER_RESOURCE } from './okx-adapter.js';

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

const RECIPIENT = '0x1234567890123456789012345678901234567890';

function adapter(opts: Partial<ConstructorParameters<typeof OkxPaymentAdapter>[0]> = {}) {
  return new OkxPaymentAdapter({
    recipientAddress: RECIPIENT,
    network: 'xlayer',
    x402Version: 2,
    ...opts,
  });
}

async function acceptsOf(a: OkxPaymentAdapter, mode: 'quick' | 'full', amount: string) {
  const c = await a.createChallenge({
    quote: { amount, currency: 'USDT', mode },
    quoteKey: `k-${mode}-${amount}`,
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

  it('names the tier the way the listing names it', async () => {
    // The challenge used to say "RepoPilot quick audit" — the internal `mode`
    // value, lower-cased. A buyer who read "Quick Scan" on the listing then saw
    // a different name on the payment prompt.
    expect((await acceptsOf(adapter(), 'quick', '0.02'))['description']).toBe(
      'RepoPilot Quick Scan'
    );
    expect((await acceptsOf(adapter(), 'full', '0.05'))['description']).toBe(
      'RepoPilot Full Launch Audit'
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
      quoteKey: 'v',
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

  it('agrees on the quick price and description', async () => {
    const documented = documentedAccepts();
    const emitted = await acceptsOf(adapter(), 'quick', '0.02');
    expect(emitted['maxAmountRequired']).toBe(documented['maxAmountRequired']);
    expect(emitted['description']).toBe(documented['description']);
  });

  it('agrees on the full price and description', async () => {
    // §5.5 states the full tier in prose rather than a second JSON block.
    const section = snapshot.slice(snapshot.indexOf('### 5.5'));
    const fullAmount = /`maxAmountRequired: "(\d+)"`/.exec(section)?.[1];
    const fullDescription = /`description: "([^"]+)"`/.exec(section)?.[1];
    expect(fullAmount).toBeDefined();
    expect(fullDescription).toBeDefined();
    const emitted = await acceptsOf(adapter(), 'full', '0.05');
    expect(emitted['maxAmountRequired']).toBe(fullAmount);
    expect(emitted['description']).toBe(fullDescription);
  });
});
