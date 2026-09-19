/**
 * /health — used by container orchestrators and the admin UI.
 *
 * The response carries (only):
 *   - `status`: 'ok' if all probes pass, 'degraded' otherwise.
 *   - `version`: semver of the running build.
 *   - `paymentMode`: 'mock' or 'okx'. Always shown so an operator
 *     can confirm the production guard is on.
 *   - `database`: 'ok' if a sample query succeeds, 'degraded' if not.
 *   - `queue`: { driver, status, acceptingJobs, pending? }.
 *     No connection string, no internal worker id, no token.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CORE_VERSION } from '@repopilot/core';
import type { QueueHealth } from '../queue/audit-queue.js';

const QueueSchema = z.object({
  driver: z.enum(['inline', 'pg-boss']),
  status: z.enum(['ok', 'degraded', 'unavailable']),
  acceptingJobs: z.boolean(),
  pending: z.number().int().nonnegative().optional(),
});

const ResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  paymentMode: z.enum(['mock', 'okx']),
  database: z.enum(['ok', 'degraded']),
  queue: QueueSchema,
});

export type HealthDeps = {
  paymentMode: 'mock' | 'okx';
  checkDatabase: () => Promise<boolean>;
  getQueueHealth: () => Promise<QueueHealth>;
};

export function registerHealthRoutes(
  app: FastifyInstance,
  opts: HealthDeps,
) {
  app.get('/health', async () => {
    const [dbOk, qh] = await Promise.all([opts.checkDatabase(), opts.getQueueHealth()]);
    const overall = dbOk && qh.status === 'ok' && qh.acceptingJobs ? 'ok' : 'degraded';
    return ResponseSchema.parse({
      status: overall,
      version: CORE_VERSION,
      paymentMode: opts.paymentMode,
      database: dbOk ? 'ok' : 'degraded',
      queue: qh,
    });
  });
}
