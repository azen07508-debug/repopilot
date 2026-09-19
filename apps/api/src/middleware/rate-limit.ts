/**
 * Rate limiting.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export async function registerRateLimit(app: FastifyInstance, opts: { perMinute: number }) {
  await app.register(rateLimit, {
    max: opts.perMinute,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Prefer the X-Forwarded-For header (in front of a proxy); fall back
      // to the socket IP. Never use the X-PAYMENT header as a key.
      const fwd = req.headers['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
      return req.ip;
    },
    allowList: ['127.0.0.1', '::1'],
  });
}
