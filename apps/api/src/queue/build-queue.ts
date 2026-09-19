/**
 * buildAuditQueue — factory for the AuditQueue implementation.
 *
 * Both the API process (when run in combined mode) and the standalone
 * worker process (`src/worker.ts`) need the same queue with the same
 * configuration. This function is the single place where the queue
 * driver is selected and wired to the AuditWorker.
 *
 * Why extract this:
 *   - The HTTP route layer should not import queue construction.
 *   - The worker entrypoint should not import HTTP / Fastify.
 *   - Tests should be able to construct a queue without the rest of
 *     the application stack.
 *
 * The factory honors `AUDIT_QUEUE_DRIVER` from config:
 *   - `inline`: in-process scheduler (SQLite / tests / `verify:release`)
 *   - `pg-boss`: pg-boss backed by PostgreSQL (production, multi-replica)
 *
 * Production guards (R-02) live in `config.ts::validateProductionConfig`:
 * the API process refuses to start with `PAYMENT_MODE=mock` in
 * production, and the worker process refuses to start with
 * `AUDIT_QUEUE_DRIVER=inline` in production.
 */
import { loadConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { AuditWorker } from '../services/audit-worker.js';
import { InlineAuditQueue } from './inline-audit-queue.js';
import { PgBossAuditQueue } from './pg-boss-audit-queue.js';
import type { AuditQueue } from './audit-queue.js';
import type { DB } from '../db/client.js';
import type { JobRepository } from '../repositories/job-repository.js';
import type { CacheService } from '../services/cache-service.js';
import type { AuditPipeline, MetadataAnalyzer } from '@repopilot/core';
import type { AppLogger } from '../utils/logger.js';

export interface BuildAuditQueueDeps {
  /** Shared DB instance (already migrated). */
  db: DB;
  /** Database mode: 'sqlite' or 'pg'. Used to fail-fast on driver mismatches. */
  dbMode: 'sqlite' | 'pg';
  /** Job repository (loaded from `db`). */
  repo: JobRepository;
  /** Audit pipeline used by the worker. */
  pipeline: AuditPipeline;
  /** Report cache used by the worker. */
  cache: CacheService;
  /** Whether the report cache is enabled. */
  cacheEnabled: boolean;
  /** Metadata analyzer used to resolve the head SHA for the cache key. */
  metadataAnalyzer: MetadataAnalyzer;
  /** Allowed hosts for repo URL validation. */
  allowedHosts: string[];
  /** Database URL (used by pg-boss). Defaults to the config value. */
  databaseUrl?: string;
  /** Override the queue driver (default: config.AUDIT_QUEUE_DRIVER). */
  driverOverride?: 'inline' | 'pg-boss';
  /** Override queue concurrency. */
  concurrencyOverride?: number;
  /** Override retry limit. */
  retryLimitOverride?: number;
  /** Override job timeout (ms). */
  jobTimeoutMsOverride?: number;
  /** Override shutdown grace period (ms). */
  shutdownGraceMsOverride?: number;
  /**
   * Whether this instance should consume jobs. Default `true`.
   *
   * Pass `false` from the API process when the worker runs in a
   * separate process: the API only needs to enqueue, the worker
   * is the sole consumer. The two share the same Postgres-backed
   * queue.
   *
   * Only meaningful for `pg-boss`. The inline driver is always
   * in-process, so its consumer flag is ignored.
   */
  consumeOverride?: boolean;
  /** Optional logger override. Defaults to a worker-named pino. */
  logOverride?: AppLogger;
}

export function buildAuditQueue(deps: BuildAuditQueueDeps): AuditQueue {
  const cfg = loadConfig();
  const log = deps.logOverride ?? createLogger({ name: 'repopilot-worker' });
  const logShim = {
    info: (...a: unknown[]): void => log.info(a),
    warn: (...a: unknown[]): void => log.warn(a),
    error: (...a: unknown[]): void => log.error(a),
  };

  const driver = deps.driverOverride ?? cfg.AUDIT_QUEUE_DRIVER;
  const concurrency = deps.concurrencyOverride ?? cfg.AUDIT_QUEUE_CONCURRENCY;
  const retryLimit = deps.retryLimitOverride ?? cfg.AUDIT_QUEUE_RETRY_LIMIT;
  const jobTimeoutMs = deps.jobTimeoutMsOverride ?? cfg.AUDIT_QUEUE_JOB_TIMEOUT_MS;
  const shutdownGraceMs = deps.shutdownGraceMsOverride ?? cfg.SHUTDOWN_GRACE_PERIOD_MS;

  const worker = new AuditWorker({
    repo: deps.repo,
    pipeline: deps.pipeline,
    cache: deps.cache,
    cacheEnabled: deps.cacheEnabled,
    metadataAnalyzer: deps.metadataAnalyzer,
    allowedHosts: deps.allowedHosts,
    log: logShim,
  });

  if (driver === 'pg-boss') {
    if (deps.dbMode !== 'pg') {
      throw new Error(
        'AUDIT_QUEUE_DRIVER=pg-boss requires a Postgres DATABASE_URL. ' +
          'Use AUDIT_QUEUE_DRIVER=inline for SQLite local dev / tests.',
      );
    }
    return new PgBossAuditQueue({
      connectionString: deps.databaseUrl ?? cfg.DATABASE_URL,
      runOne: async (jobId) => {
        await worker.runOnce(jobId);
      },
      concurrency,
      retryLimit,
      expireInSeconds: Math.max(60, Math.ceil(jobTimeoutMs / 1000)),
      consume: deps.consumeOverride,
      log: logShim,
    });
  }

  return new InlineAuditQueue({
    runOne: async (jobId) => {
      await worker.runOnce(jobId);
    },
    shutdownGraceMs,
    concurrency,
    log: logShim,
  });
}
