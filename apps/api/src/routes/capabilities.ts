/**
 * /api/v1/capabilities — what the service accepts, emits, and charges.
 */
import type { FastifyInstance } from 'fastify';
import {
  CapabilitiesSchema,
  CORE_VERSION,
  REPORT_VERSION,
  type Capabilities,
} from '@repopilot/core';
import type { PaymentConfig } from '@repopilot/okx-adapter';
import { CACHE_KEY_FIELDS, KEY_VERSION } from '../services/cache-service.js';

export interface CapabilitiesDeps {
  payment: PaymentConfig;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  /**
   * The bounds this deployment actually enforces.
   *
   * These used to be read from `DEFAULT_LIMITS` in `@repopilot/core`, which is
   * the library's default and not this process's configuration: an operator who
   * set `MAX_FILES=200` still saw `2000` published here, and an agent that
   * sized a repository against the published number would be wrong about the
   * thing it was buying. `server.ts` and `worker.ts` both build the pipeline
   * from `cfg.MAX_*`, so these are passed from the same place.
   */
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    rateLimitPerMinute: number;
  };
}

export function registerCapabilitiesRoutes(app: FastifyInstance, opts: CapabilitiesDeps) {
  app.get('/api/v1/capabilities', async () => {
    // Annotated, not inferred. `parse()` takes `unknown`, so without this the
    // literal below is checked against nothing and a key the schema does not
    // declare is dropped from the response in silence. `endpoints` and `cache`
    // were both lost that way, from the day this route was written. With the
    // annotation, adding a field here without adding it to
    // `CapabilitiesSchema` is a `tsc` error rather than a missing field.
    const payload: Capabilities = {
      name: 'RepoPilot',
      version: CORE_VERSION,
      inputs: {
        repoUrl: 'https URL to a public GitHub repository',
        mode: 'quick | full',
        target: 'hackathon | open_source | production',
        outputLanguage: 'en | zh-CN',
      },
      outputs: {
        // Derived, not typed out. This said "1.0" for two report versions
        // while `REPORT_VERSION` said 1.1 — the drift was recorded as a
        // known residual because nothing compared them. Nothing compares
        // them now either; the literal is just gone.
        report: `JSON document conforming to the RepoPilot Report schema (${REPORT_VERSION}).`,
      },
      endpoints: {
        freeCheck: {
          method: 'POST',
          path: '/api/v1/free-check',
          description:
            'Free, no-payment, read-only pre-flight. Returns top blockers, score, and recommendation without producing a full report.',
          requiresPayment: false,
        },
        audits: {
          method: 'POST',
          path: '/api/v1/audits',
          description: 'Paid full audit. Requires payment via X-PAYMENT (mock or OKX x402).',
          requiresPayment: true,
        },
        capabilities: {
          method: 'GET',
          path: '/api/v1/capabilities',
          description: 'This endpoint. Public; no auth, no payment.',
          requiresPayment: false,
        },
        health: {
          method: 'GET',
          path: '/health',
          description: 'Liveness probe.',
          requiresPayment: false,
        },
      },
      limits: {
        maxFiles: opts.limits.maxFiles,
        maxFileBytes: opts.limits.maxFileBytes,
        maxTotalBytes: opts.limits.maxTotalBytes,
        rateLimitPerMinute: opts.limits.rateLimitPerMinute,
      },
      pricing: {
        audit: opts.payment.pricing.audit,
      },
      paymentMode: opts.payment.mode,
      cache: {
        enabled: opts.cacheEnabled,
        ttlSeconds: opts.cacheTtlSeconds,
        // Read from `cache-service.ts` rather than typed out. `keyVersion` was
        // a copy of the literal `'v1'`, and `isolation` listed four of the
        // eight fields `buildCacheKey()` hashes — omitting `owner` and `repo`,
        // which reads as "two different repositories share a cache entry".
        keyVersion: KEY_VERSION,
        scope: 'paid audits only',
        isolation: [...CACHE_KEY_FIELDS],
      },
    };
    return CapabilitiesSchema.parse(payload);
  });
}
