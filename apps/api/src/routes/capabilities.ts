/**
 * /api/v1/capabilities — what the service accepts, emits, and charges.
 */
import type { FastifyInstance } from 'fastify';
import { CapabilitiesSchema, CORE_VERSION, DEFAULT_LIMITS } from '@repopilot/core';
import type { PaymentConfig } from '@repopilot/okx-adapter';

export interface CapabilitiesDeps {
  payment: PaymentConfig;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
}

export function registerCapabilitiesRoutes(app: FastifyInstance, opts: CapabilitiesDeps) {
  app.get('/api/v1/capabilities', async () => {
    return CapabilitiesSchema.parse({
      name: 'RepoPilot',
      version: CORE_VERSION,
      inputs: {
        repoUrl: 'https URL to a public GitHub repository',
        mode: 'quick | full',
        target: 'hackathon | open_source | production',
        outputLanguage: 'en | zh-CN',
      },
      outputs: {
        report: 'JSON document conforming to the RepoPilot Report schema (1.0).',
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
        maxFiles: DEFAULT_LIMITS.maxFiles,
        maxFileBytes: DEFAULT_LIMITS.maxFileBytes,
        maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes,
        rateLimitPerMinute: DEFAULT_LIMITS.rateLimitPerMinute,
      },
      pricing: {
        quickScan: opts.payment.pricing.quickScan,
        fullAudit: opts.payment.pricing.fullAudit,
      },
      paymentMode: opts.payment.mode,
      cache: {
        enabled: opts.cacheEnabled,
        ttlSeconds: opts.cacheTtlSeconds,
        keyVersion: 'v1',
        scope: 'paid audits only',
        isolation: ['mode', 'target', 'outputLanguage', 'commitSha'],
      },
    });
  });
}
