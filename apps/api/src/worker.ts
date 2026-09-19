/**
 * RepoPilot Worker — standalone audit-job executor.
 *
 * This is the worker process that pulls jobs off the queue and runs
 * the audit pipeline. It is intentionally HTTP-free: no Fastify, no
 * routes, no payment logic. It only:
 *   1. Loads config (and refuses to start on R-02 violations).
 *   2. Opens the database, runs migrations if needed.
 *   3. Constructs the queue + worker.
 *   4. Starts the queue.
 *   5. Logs a heartbeat so operators can confirm the process is alive.
 *   6. Handles SIGTERM / SIGINT for graceful shutdown.
 *
 * Why a separate process:
 *   - Horizontal scaling: run N workers, each one is independent.
 *   - Isolation: a slow / crashing worker does not affect the API.
 *   - Independent deploys: scale API and worker separately.
 *
 * Usage:
 *   pnpm --filter @repopilot/api start:worker
 *   node dist/worker.js
 *   tsx src/worker.ts
 */
import { AuditPipeline, MetadataAnalyzer } from '@repopilot/core';
import { loadConfig } from './config.js';
import { createLogger, type AppLogger } from './utils/logger.js';
import { openDatabase, closeDatabase, runMigrations } from './db/client.js';
import { JobRepository } from './repositories/job-repository.js';
import { ReportCacheRepository } from './repositories/report-cache-repository.js';
import { CacheService } from './services/cache-service.js';
import { buildAuditQueue } from './queue/build-queue.js';
import type { AuditQueue } from './queue/audit-queue.js';

export interface WorkerHandle {
  queue: AuditQueue;
  /** Stop the queue and close the database, gracefully. */
  shutdown: (opts?: { graceMs?: number }) => Promise<void>;
}

export async function buildWorker(opts?: {
  driverOverride?: 'inline' | 'pg-boss';
  databaseUrl?: string;
  cacheEnabledOverride?: boolean;
  cacheTtlSecondsOverride?: number;
  concurrencyOverride?: number;
  retryLimitOverride?: number;
  jobTimeoutMsOverride?: number;
  shutdownGraceMsOverride?: number;
  log?: AppLogger;
}): Promise<WorkerHandle> {
  const cfg = loadConfig();
  const log = opts?.log ?? createLogger({ name: 'repopilot-worker' });

  const db = openDatabase(opts?.databaseUrl ?? cfg.DATABASE_URL);
  await runMigrations(db);
  const repo = new JobRepository(db);
  const cacheRepo = new ReportCacheRepository(db);
  const cacheEnabled = opts?.cacheEnabledOverride ?? cfg.REPORT_CACHE_ENABLED;
  const cacheTtlSeconds = opts?.cacheTtlSecondsOverride ?? cfg.REPORT_CACHE_TTL_SECONDS;
  const cacheService = new CacheService({
    repo: cacheRepo,
    log,
    enabled: cacheEnabled,
    ttlSeconds: cacheTtlSeconds,
  });

  const pipeline = new AuditPipeline({
    githubToken: cfg.GITHUB_TOKEN,
    allowedHosts: cfg.ALLOWED_REPO_HOSTS,
    maxFiles: cfg.MAX_FILES,
    maxFileBytes: cfg.MAX_FILE_BYTES,
    maxTotalBytes: cfg.MAX_TOTAL_BYTES,
    log,
  });

  const metadataAnalyzer = new MetadataAnalyzer({
    token: cfg.GITHUB_TOKEN,
    timeoutMs: 15_000,
  });

  const queue = buildAuditQueue({
    db,
    dbMode: db.mode,
    repo,
    pipeline,
    cache: cacheService,
    cacheEnabled,
    metadataAnalyzer,
    allowedHosts: cfg.ALLOWED_REPO_HOSTS,
    databaseUrl: opts?.databaseUrl,
    driverOverride: opts?.driverOverride,
    concurrencyOverride: opts?.concurrencyOverride,
    retryLimitOverride: opts?.retryLimitOverride,
    jobTimeoutMsOverride: opts?.jobTimeoutMsOverride,
    shutdownGraceMsOverride: opts?.shutdownGraceMsOverride,
    logOverride: log,
  });

  await queue.start();
  log.info(
    {
      driver: queue.driver,
      database: db.mode,
      cacheEnabled,
      cacheTtlSeconds,
      concurrency: opts?.concurrencyOverride ?? cfg.AUDIT_QUEUE_CONCURRENCY,
    },
    'RepoPilot worker started',
  );

  const shutdown = async (sopts?: { graceMs?: number }): Promise<void> => {
    const grace = sopts?.graceMs ?? cfg.SHUTDOWN_GRACE_PERIOD_MS;
    log.info({ grace }, 'worker shutting down');
    try {
      await queue.stop();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'queue.stop failed');
    }
    try {
      await closeDatabase();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'closeDatabase failed');
    }
  };

  return { queue, shutdown };
}

async function main(): Promise<void> {
  const log = createLogger({ name: 'repopilot-worker' });
  const handle = await buildWorker({ log });

  // Heartbeat every 30s. Cheap, single-line, log-friendly.
  const heartbeat = setInterval(() => {
    handle.queue
      .health()
      // eslint-disable-next-line no-floating-promise
      .then((h: { driver: string; status: string; acceptingJobs: boolean; pending?: number }) => {
        log.info(
          { driver: h.driver, status: h.status, acceptingJobs: h.acceptingJobs, pending: h.pending ?? 0 },
          'worker heartbeat',
        );
      })
      // eslint-disable-next-line no-floating-promise
      .catch((err: unknown) => {
        log.warn({ err: (err as Error).message }, 'worker heartbeat failed');
      });
  }, 30_000);
  // Do not keep the event loop alive solely for the heartbeat.
  heartbeat.unref();

  let shuttingDown = false;
  const onSignal = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, 'received signal; shutting down');
    clearInterval(heartbeat);
    try {
      await handle.shutdown();
      process.exit(0);
    } catch (err) {
      log.error({ err: (err as Error).message }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('worker.ts') || entry.endsWith('worker.js')) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start worker:', err);
    process.exit(1);
  });
}
