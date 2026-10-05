/**
 * `/api/v1/capabilities` must publish what the route declares.
 *
 * This endpoint is what an agent reads before deciding to pay, and it is
 * machine-readable, so a field that is missing or wrong here is acted on rather
 * than skimmed. Two of its fields were missing entirely and three were wrong:
 *
 *   - `endpoints` and `cache` were written in the route from the day it
 *     existed and reached no client at all. `CapabilitiesSchema.parse()` takes
 *     `unknown`, so a key the schema does not declare is dropped without an
 *     error — and without a type error either, because an object literal passed
 *     to `parse()` is not checked against the schema's type. Both are declared
 *     in the schema now, and the route annotates its payload as
 *     `Capabilities`, which turns the next omission into a compile error. That
 *     annotation is the guard for this half; no test can replace it, because a
 *     test can only observe what a response does contain.
 *   - `limits` reported `DEFAULT_LIMITS` from `@repopilot/core` — the library
 *     default — while `server.ts` and `worker.ts` build the pipeline from
 *     `cfg.MAX_*`. An operator who set `MAX_FILES=200` still published `2000`,
 *     to an agent sizing a repository against the published number.
 *   - `cache.keyVersion` was a literal copy of `'v1'`, and `cache.isolation`
 *     listed four of the eight fields `buildCacheKey()` hashes, omitting
 *     `owner` and `repo`.
 *
 * Nothing asserted any of it, which is why all of it survived.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { DEFAULT_LIMITS } from '@repopilot/core';
import type { PaymentConfig } from '@repopilot/okx-adapter';
import { registerCapabilitiesRoutes } from '../routes/capabilities.js';
import { CACHE_KEY_FIELDS, KEY_VERSION } from '../services/cache-service.js';

const PAYMENT: PaymentConfig = {
  mode: 'mock',
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2, resourceUrl: '' },
  pricing: { audit: { amount: '1', currency: 'USDT' } },
};

const ANY_LIMITS = {
  maxFiles: 1,
  maxFileBytes: 1,
  maxTotalBytes: 1,
  rateLimitPerMinute: 1,
};

interface CapabilitiesBody {
  limits: Record<string, number>;
  endpoints: Record<string, { method: string; path: string; requiresPayment: boolean }>;
  cache: { keyVersion: string; isolation: string[] };
}

async function readCapabilities(limits: typeof ANY_LIMITS): Promise<CapabilitiesBody> {
  const app = Fastify();
  registerCapabilitiesRoutes(app, {
    payment: PAYMENT,
    cacheEnabled: true,
    cacheTtlSeconds: 900,
    limits,
  });
  const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
  expect(res.statusCode).toBe(200);
  await app.close();
  return res.json() as CapabilitiesBody;
}

describe('/api/v1/capabilities', () => {
  it('publishes the endpoints the route declares', async () => {
    const { endpoints } = await readCapabilities(ANY_LIMITS);
    // The whole block used to be dropped by `parse()`. Naming the routes and
    // the payment requirement is the point of the block: it is how an agent
    // learns that one of the four is the one it has to pay for.
    expect(Object.keys(endpoints).sort()).toEqual(['audits', 'capabilities', 'freeCheck', 'health']);
    expect(endpoints['audits']?.requiresPayment).toBe(true);
    expect(endpoints['freeCheck']?.requiresPayment).toBe(false);
  });

  it('reports the limits it was given, not the library defaults', async () => {
    const limits = { maxFiles: 7, maxFileBytes: 8, maxTotalBytes: 9, rateLimitPerMinute: 10 };
    // Guard against the fixture quietly becoming the default: if these ever
    // coincide, the assertion below would pass against the very constant it
    // exists to catch.
    expect(limits.maxFiles).not.toBe(DEFAULT_LIMITS.maxFiles);

    expect((await readCapabilities(limits)).limits).toEqual(limits);
  });

  it('reports the cache key version from cache-service', async () => {
    // Be honest about what this can see. While the route and `cache-service.ts`
    // agree on the string, this cannot tell a hardcoded `'v1'` from
    // `KEY_VERSION` — they are the same value. What it catches is the case that
    // matters: `KEY_VERSION` is bumped in one file and the published one does
    // not follow, which is exactly how the two came to disagree before.
    expect((await readCapabilities(ANY_LIMITS)).cache.keyVersion).toBe(KEY_VERSION);
  });

  it('publishes every field the cache key is built from', async () => {
    const { cache } = await readCapabilities(ANY_LIMITS);
    // Same caveat as above: a second hand-written copy of the eight names would
    // pass while they match. The regression this catches is a field added to
    // `CACHE_KEY_FIELDS` — and so to the key — that the published scope does not
    // mention, which is how `owner` and `repo` went missing.
    expect(cache.isolation).toEqual([...CACHE_KEY_FIELDS]);
    // Named individually as well: these are the two the published list used
    // to omit, and they are the ones whose absence misleads.
    expect(cache.isolation).toContain('owner');
    expect(cache.isolation).toContain('repo');
  });
});
