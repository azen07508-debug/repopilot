import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../server.js';
import type { AuditPipeline, MetadataAnalyzer } from '@repopilot/core';

/**
 * The paid endpoint in `PAYMENT_MODE=okx`.
 *
 * Every other payment test in this repository runs in mock mode, where the
 * `X-PAYMENT` header is the plain string `mock:<id>` and nothing has to be
 * decoded. That is why a defect survived in the OKX path for as long as it did:
 * the route carried its own second parser for the header, it looked for
 * `paymentId` at the top level of the envelope, while the adapter's
 * `ParsedPaymentHeader` declares it under `payload` — so a buyer following the
 * documented flow was answered `400 X-PAYMENT header is malformed` and the
 * adapter was never consulted. The rail could not accept a payment at all.
 *
 * These tests do not need a valid signature to catch that: the question is
 * whether a **well-formed** envelope reaches the adapter. A `402
 * PAYMENT_NOT_SETTLED` means it did (the signature was checked and rejected); a
 * `400` means the header never got that far.
 *
 * A genuinely signed envelope is covered in
 * `packages/okx-adapter/src/okx-adapter.test.ts`, which has `viem` to sign with.
 * Signing here would mean adding `viem` to this package for one test.
 */

const RECIPIENT = '0x1234567890123456789012345678901234567890';

/** The pipeline is never reached in these tests — payment always fails first. */
class UnreachablePipeline {
  async run(): Promise<never> {
    throw new Error('the pipeline must not run without a completed payment');
  }
}

class FakeMetadataAnalyzer {
  async getHeadSha(): Promise<string | null> {
    return 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  }
  async fetch(): Promise<never> {
    throw new Error('unused');
  }
}

/** A well-formed envelope with a signature that cannot verify. */
function unsignedEnvelope(paymentId: string, where: 'payload' | 'top' = 'payload'): string {
  const authorization = {
    from: RECIPIENT,
    to: RECIPIENT,
    value: '1000000',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: `0x${'00'.repeat(32)}`,
  };
  const envelope =
    where === 'payload'
      ? { x402Version: 2, signature: '0xab', payload: { paymentId, authorization } }
      : { x402Version: 2, signature: '0xab', paymentId, payload: { authorization } };
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

const AUDIT_BODY = {
  repoUrl: 'https://github.com/okx/repopilot',
  mode: 'full',
  target: 'production',
  outputLanguage: 'en',
  includeLaunchCopy: true,
};

describe('PAYMENT_MODE=okx — the paid endpoint can be reached', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const deps: AppDeps = {
      payment: {
        mode: 'okx',
        okx: { recipientAddress: RECIPIENT, network: 'xlayer', x402Version: 2 },
        pricing: { audit: { amount: '1', currency: 'USDT' } },
      },
      allowedHosts: ['github.com', 'raw.githubusercontent.com'],
      pipeline: new UnreachablePipeline() as unknown as AuditPipeline,
      metadataAnalyzer: new FakeMetadataAnalyzer() as unknown as MetadataAnalyzer,
      databaseUrl: 'file:./data/test-okx-payment.db',
    };
    app = await buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function challenge(): Promise<{ jobId: string; paymentId: string }> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/audits', payload: AUDIT_BODY });
    expect(res.statusCode).toBe(402);
    const body = res.json() as { jobId: string; payment: { paymentId: string; mode: string } };
    expect(body.payment.mode).toBe('okx');
    expect(body.payment.paymentId).toMatch(/^okx_/);
    return { jobId: body.jobId, paymentId: body.payment.paymentId };
  }

  it('reads the paymentId from payload and answers 402, not 400', async () => {
    const { paymentId } = await challenge();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': unsignedEnvelope(paymentId, 'payload') },
      payload: AUDIT_BODY,
    });
    // 402 = the envelope was parsed, the id was found, the signature was
    // checked and rejected. 400 would mean it was never parsed.
    expect(res.statusCode).toBe(402);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PAYMENT_NOT_SETTLED');
  });

  it('reads the paymentId from the top level too', async () => {
    // The wire shape is not documented in this repository, so the adapter reads
    // both placements. This pins the second one through the whole route.
    const { paymentId } = await challenge();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': unsignedEnvelope(paymentId, 'top') },
      payload: AUDIT_BODY,
    });
    expect(res.statusCode).toBe(402);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PAYMENT_NOT_SETTLED');
  });

  it('still answers 400 for a header it cannot read at all', async () => {
    // The error path has to survive the fix: "unreadable" and "unverified" are
    // different answers and a caller can act on the difference.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': 'not-base64-!!' },
      payload: AUDIT_BODY,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
  });

  it('does not enqueue the audit when the payment is not completed', async () => {
    const { paymentId } = await challenge();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': unsignedEnvelope(paymentId) },
      payload: AUDIT_BODY,
    });
    expect(res.statusCode).toBe(402);
    // `UnreachablePipeline` throws if it is ever called, so reaching here at all
    // is the assertion that no audit ran for an unverified payment.
  });
});
