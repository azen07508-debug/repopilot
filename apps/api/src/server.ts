/**
 * RepoPilot API — entry point.
 *
 * Wires together: config, security, rate-limit, DB, job service,
 * payment adapter, audit pipeline, audit queue + worker, and routes.
 * Exposes a single `buildApp` function so integration tests can mount
 * the same app on an in-memory port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import {
  AuditPipeline,
  CORE_VERSION,
  FreeCheckRunner,
  MetadataAnalyzer,
  OpenAICompatibleProvider,
  type LLMProvider,
} from '@repopilot/core';
import { buildPaymentAdapter, type PaymentConfig } from '@repopilot/okx-adapter';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { openDatabase, closeDatabase, runMigrations } from './db/client.js';
import { JobRepository } from './repositories/job-repository.js';
import { ReportCacheRepository } from './repositories/report-cache-repository.js';
import { JobService } from './services/job-service.js';
import { CacheService } from './services/cache-service.js';
import { buildAuditQueue } from './queue/build-queue.js';
import type { AuditQueue } from './queue/audit-queue.js';
import { registerSecurity } from './middleware/security.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerCapabilitiesRoutes } from './routes/capabilities.js';
import { registerAuditRoutes } from './routes/audits.js';
import { registerFreeCheckRoutes } from './routes/free-check.js';
import { registerAuditDerivedRoutes } from './routes/audit-derived.js';
import { buildOpenApiSpec } from './openapi.js';

export interface AppDeps {
  payment: PaymentConfig;
  githubToken?: string;
  allowedHosts: string[];
  llmProvider?: LLMProvider;
  /** Override the audit pipeline (used by tests). */
  pipeline?: AuditPipeline;
  /** Override the database path (used by tests). */
  databaseUrl?: string;
  /** Override the report cache enabled flag (used by tests). */
  cacheEnabled?: boolean;
  /** Override the report cache TTL (used by tests). */
  cacheTtlSeconds?: number;
  /** Override the audit queue driver. */
  queueDriver?: 'inline' | 'pg-boss';
  /** Override the audit queue concurrency. */
  queueConcurrency?: number;
  /** Override the audit queue retry limit. */
  queueRetryLimit?: number;
  /** Override the audit queue job timeout (ms). */
  queueJobTimeoutMs?: number;
  /** Override the graceful shutdown grace period (ms). */
  shutdownGraceMs?: number;
  /** Skip queue start (tests that exercise the route directly). */
  skipQueueStart?: boolean;
  /**
   * Process mode. Defaults to `'combined'` (HTTP + queue + worker in
   * the same process). Set to `'http'` to run only the HTTP server
   * and enqueue to an external queue. In `'http'` mode the
   * `pg-boss` driver is required for cross-process enqueueing; the
   * inline driver is rejected because it is in-process.
   *
   * Legacy `withQueue: true` is equivalent to `'combined'`. Legacy
   * `withQueue: false` is equivalent to `'http'`.
   */
  mode?: 'http' | 'combined';
  /**
   * When `mode: 'http'`, whether this instance should also poll the
   * queue for jobs. Default `false` in `'http'` mode (the dedicated
   * worker process is the consumer), `true` in `'combined'` mode.
   */
  consumeInHttpMode?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  queue: AuditQueue;
  /** Stop the queue and the Fastify server, gracefully. */
  shutdown: (opts?: { graceMs?: number }) => Promise<void>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance>;
export async function buildApp(deps: AppDeps, opts: { withQueue: true }): Promise<BuiltApp>;
export async function buildApp(deps: AppDeps, opts: { mode: 'combined' }): Promise<BuiltApp>;
export async function buildApp(deps: AppDeps, opts: { mode: 'http' }): Promise<FastifyInstance>;
export async function buildApp(
  deps: AppDeps,
  opts: { mode: 'http' | 'combined' },
): Promise<FastifyInstance | BuiltApp>;
export async function buildApp(
  deps: AppDeps,
  opts?: { withQueue?: boolean; mode?: 'http' | 'combined'; consumeInHttpMode?: boolean },
): Promise<FastifyInstance | BuiltApp> {
  const cfg = loadConfig();
  const log = createLogger({ level: cfg.LOG_LEVEL });
  const app: FastifyInstance = Fastify({
    logger: {
      level: cfg.LOG_LEVEL,
      redact: {
        paths: [
          '*.password',
          '*.token',
          '*.apiKey',
          '*.secret',
          '*.privateKey',
          '*.mnemonic',
          'req.headers.authorization',
          'req.headers["x-payment"]',
          'req.headers["x-payment-signature"]',
          'req.headers["x-api-key"]',
        ],
        censor: '[REDACTED]',
      },
    },
    disableRequestLogging: false,
    bodyLimit: 64 * 1024,
    trustProxy: true,
  });

  await registerSecurity(app, {
    corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  });
  await registerRateLimit(app, { perMinute: cfg.RATE_LIMIT_PER_MINUTE });

  const db = openDatabase(deps.databaseUrl ?? cfg.DATABASE_URL);
  await runMigrations(db);
  const repo = new JobRepository(db);
  const cacheRepo = new ReportCacheRepository(db);
  const cacheEnabled = deps.cacheEnabled ?? cfg.REPORT_CACHE_ENABLED;
  const cacheTtlSeconds = deps.cacheTtlSeconds ?? cfg.REPORT_CACHE_TTL_SECONDS;
  const cacheService = new CacheService({
    repo: cacheRepo,
    log,
    enabled: cacheEnabled,
    ttlSeconds: cacheTtlSeconds,
  });

  const pipeline =
    deps.pipeline ??
    new AuditPipeline({
      githubToken: deps.githubToken ?? cfg.GITHUB_TOKEN,
      allowedHosts: deps.allowedHosts,
      maxFiles: cfg.MAX_FILES,
      maxFileBytes: cfg.MAX_FILE_BYTES,
      maxTotalBytes: cfg.MAX_TOTAL_BYTES,
      log,
    });

  const metadataAnalyzer = new MetadataAnalyzer({
    token: deps.githubToken ?? cfg.GITHUB_TOKEN,
    timeoutMs: 15_000,
  });

  const adapter = buildPaymentAdapter(deps.payment);
  const service = new JobService(repo, pipeline, adapter);

  // Resolve the process mode.
  //   - `mode: 'http'`     → HTTP only; no queue constructed; the
  //                          dedicated worker process is the consumer.
  //   - `mode: 'combined'` → HTTP + queue + worker in the same process;
  //                          returns `BuiltApp` so the caller can shut
  //                          both down.
  //   - `mode: undefined`  → Legacy default. Queue is still constructed
  //                          in-process; returns `FastifyInstance`.
  //                          This preserves the original test surface
  //                          (`buildApp(deps)` → FastifyInstance).
  //   - Legacy `withQueue: true` is mapped to `'combined'`.
  //   - Legacy `withQueue: false` is mapped to `undefined` (no change).
  const legacyWithQueue = opts?.withQueue === true;
  const mode: 'http' | 'combined' | undefined = opts?.mode
    ?? (legacyWithQueue ? 'combined' : undefined);
  // Default: in 'http' mode we do NOT poll the queue (the dedicated
  // worker is the consumer). In 'combined' mode we always poll.
  const consumeInHttpMode = mode === 'combined' ? true : (opts?.consumeInHttpMode ?? false);
  const queueDriver = deps.queueDriver ?? cfg.AUDIT_QUEUE_DRIVER;

  // In 'http' mode the API enqueues to a separate worker process.
  // The inline driver is in-process, so it cannot cross process
  // boundaries. Refuse it explicitly so a misconfigured deployment
  // does not silently swallow jobs.
  if (mode === 'http' && queueDriver === 'inline' && consumeInHttpMode === false) {
    throw new Error(
      `mode='http' with AUDIT_QUEUE_DRIVER=inline is not supported: the inline queue is in-process and a dedicated worker process cannot consume it. Use AUDIT_QUEUE_DRIVER=pg-boss for multi-process deployments, or run with mode='combined' for single-process.`,
    );
  }

  // The queue is always constructed: the API process needs to
  // enqueue audit jobs, even in 'http' mode (it enqueues to pg-boss,
  // which the dedicated worker process consumes from).
  // `consumeOverride` controls whether THIS process also runs the
  // worker. In 'http' mode the default is `consume: false` because
  // the dedicated worker is the consumer. In 'combined' mode (and
  // the legacy `undefined` default) this process also consumes.
  const queueShouldConsume = mode === 'http' ? consumeInHttpMode : true;

  // Build the queue adapter via the shared factory.
  const queue = buildAuditQueue({
    db,
    dbMode: db.mode,
    repo,
    pipeline,
    cache: cacheService,
    cacheEnabled,
    metadataAnalyzer,
    allowedHosts: deps.allowedHosts,
    databaseUrl: deps.databaseUrl,
    driverOverride: deps.queueDriver,
    concurrencyOverride: deps.queueConcurrency,
    retryLimitOverride: deps.queueRetryLimit,
    jobTimeoutMsOverride: deps.queueJobTimeoutMs,
    shutdownGraceMsOverride: deps.shutdownGraceMs,
    consumeOverride: queueShouldConsume,
  });

  if (!deps.skipQueueStart) {
    await queue.start();
  }

  registerHealthRoutes(app, {
    paymentMode: deps.payment.mode,
    checkDatabase: async () => {
      try {
        await repo.list(1);
        return true;
      } catch {
        return false;
      }
    },
    getQueueHealth: async () => {
      try {
        return await queue.health();
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'queue health probe failed');
        return { driver: queueDriver, status: 'unavailable', acceptingJobs: false };
      }
    },
  });
  registerCapabilitiesRoutes(app, {
    payment: deps.payment,
    cacheEnabled,
    cacheTtlSeconds,
  });
  registerAuditRoutes(app, {
    service,
    payment: deps.payment,
    cache: cacheService,
    cacheEnabled,
    queue,
    githubToken: deps.githubToken ?? cfg.GITHUB_TOKEN,
    metadataAnalyzer,
    allowedHosts: deps.allowedHosts,
    log,
  });
  const freeCheckRunner = new FreeCheckRunner({
    githubToken: deps.githubToken ?? cfg.GITHUB_TOKEN,
    allowedHosts: deps.allowedHosts,
    maxFiles: Math.min(200, cfg.MAX_FILES),
    maxFileBytes: 262_144,
    maxTotalBytes: 5_242_880,
    networkTimeoutMs: 15_000,
  });
  registerFreeCheckRoutes(app, {
    runner: freeCheckRunner,
    allowedHosts: deps.allowedHosts,
    githubToken: deps.githubToken ?? cfg.GITHUB_TOKEN,
  });
  // Derived, free, read-only views over reports that already exist.
  // They never scan a repository.
  registerAuditDerivedRoutes(app, { service });

  app.setErrorHandler((err: unknown, req, reply) => {
    // Never echo the original error to the client.
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) {
      log.error({ err, path: req.url }, 'request failed');
    }
    reply.status(status).send({
      error: {
        code: e.code ?? 'INTERNAL',
        message: status >= 500 ? 'Internal error' : (e.message ?? 'Unknown error'),
      },
    });
  });

  app.get('/', async () => ({
    name: 'RepoPilot',
    version: CORE_VERSION,
    endpoints: [
      '/health',
      '/api/v1/capabilities',
      '/api/v1/free-check',
      '/api/v1/audits',
      '/docs/openapi.json',
    ],
  }));

  app.get('/docs/openapi.json', async () => buildOpenApiSpec());

  // Wire graceful shutdown.
  const shutdown = async (sopts?: { graceMs?: number }): Promise<void> => {
    const grace = sopts?.graceMs ?? cfg.SHUTDOWN_GRACE_PERIOD_MS;
    log.info({ grace }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'app.close failed');
    }
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

  // Hook into Fastify's onClose so `app.close()` also stops the queue.
  app.addHook('onClose', async () => {
    try {
      await queue.stop();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'onClose queue.stop failed');
    }
  });

  if (mode === 'combined') {
    return { app, queue, shutdown };
  }
  return app;
}

export function defaultPaymentConfig(): PaymentConfig {
  const cfg = loadConfig();
  return {
    mode: cfg.PAYMENT_MODE,
    okx: {
      recipientAddress: cfg.OKX_PAYMENT_ADDRESS,
      network: cfg.OKX_PAYMENT_NETWORK,
      x402Version: cfg.OKX_X402_VERSION === 1 ? 1 : 2,
    },
    pricing: {
      quickScan: { amount: cfg.PRICE_QUICK_SCAN, currency: 'USDT' },
      fullAudit: { amount: cfg.PRICE_FULL_AUDIT, currency: 'USDT' },
    },
  };
}

export function defaultLlmProvider(): LLMProvider | undefined {
  const cfg = loadConfig();
  if (!cfg.LLM_PROVIDER || !cfg.LLM_API_KEY || !cfg.LLM_MODEL) return undefined;
  if (cfg.LLM_PROVIDER === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      apiKey: cfg.LLM_API_KEY,
      model: cfg.LLM_MODEL,
      baseUrl: cfg.LLM_BASE_URL || undefined,
    });
  }
  return undefined;
}

async function main() {
  const cfg = loadConfig();
  // `REPOPILOT_API_MODE` controls the process role:
  //   - `combined` (default for `pnpm dev`): HTTP + queue in one process.
  //   - `http`     (default for `pnpm start`): HTTP only; a separate
  //                 worker process consumes from the queue.
  // The legacy `withQueue: true` behavior is preserved when this env
  // var is unset (so existing `pnpm dev` flows keep working).
  const modeEnv = process.env['REPOPILOT_API_MODE'];
  const mode: 'http' | 'combined' =
    modeEnv === 'http' || modeEnv === 'combined'
      ? modeEnv
      : 'combined';
  if (mode === 'combined') {
    const built = await buildApp(
      {
        payment: defaultPaymentConfig(),
        githubToken: cfg.GITHUB_TOKEN,
        allowedHosts: cfg.ALLOWED_REPO_HOSTS,
        llmProvider: defaultLlmProvider(),
      },
      { mode: 'combined' },
    );
    await built.app.listen({ host: cfg.HOST, port: cfg.PORT });
    built.app.log.info(
      { mode, port: cfg.PORT },
      `RepoPilot API listening on http://${cfg.HOST}:${cfg.PORT}`,
    );
    const onSignal = async (sig: NodeJS.Signals): Promise<void> => {
      built.app.log.info({ sig }, 'received signal; shutting down');
      try {
        await built.shutdown();
        process.exit(0);
      } catch (err) {
        built.app.log.error({ err: (err as Error).message }, 'shutdown failed');
        process.exit(1);
      }
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    return;
  }
  // mode === 'http': build a FastifyInstance only. The audit route
  // enqueues to the external queue; a dedicated worker process
  // (started via `pnpm start:worker`) consumes from it.
  const app = await buildApp(
    {
      payment: defaultPaymentConfig(),
      githubToken: cfg.GITHUB_TOKEN,
      allowedHosts: cfg.ALLOWED_REPO_HOSTS,
      llmProvider: defaultLlmProvider(),
    },
    { mode: 'http' },
  );
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(
    { mode, port: cfg.PORT },
    `RepoPilot API (http-only) listening on http://${cfg.HOST}:${cfg.PORT}. A separate worker process must be running.`,
  );
  const onSignal = async (sig: NodeJS.Signals): Promise<void> => {
    app.log.info({ sig }, 'received signal; shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err: (err as Error).message }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('server.ts') || entry.endsWith('server.js')) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
