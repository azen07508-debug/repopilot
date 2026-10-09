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
} from '@repopilot/core';
import { buildPaymentAdapter, type PaymentConfig } from '@repopilot/okx-adapter';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { openDatabase, closeDatabase, runMigrations } from './db/client.js';
import { JobRepository } from './repositories/job-repository.js';
import { ReportCacheRepository } from './repositories/report-cache-repository.js';
import { NonceRepository } from './repositories/nonce-repository.js';
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
  /**
   * Override the metadata analyzer.
   *
   * Used by tests to fix the head SHA. Without it a test run has to
   * reach the real GitHub API to learn a SHA, which makes the value
   * non-deterministic and the endpoint that reports it untestable.
   */
  metadataAnalyzer?: MetadataAnalyzer;
  /**
   * Process mode. Defaults to `'combined'` (HTTP + queue + worker in
   * the same process). Set to `'http'` to run only the HTTP server
   * and enqueue to an external queue. In `'http'` mode the
   * `pg-boss` driver is required for cross-process enqueueing; the
   * inline driver is rejected because it is in-process.
   */
  mode?: 'http' | 'combined';
}

export interface BuiltApp {
  app: FastifyInstance;
  queue: AuditQueue;
  /** Stop the queue and the Fastify server, gracefully. */
  shutdown: (opts?: { graceMs?: number }) => Promise<void>;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance>;
export async function buildApp(deps: AppDeps, opts: { mode: 'combined' }): Promise<BuiltApp>;
export async function buildApp(deps: AppDeps, opts: { mode: 'http' }): Promise<FastifyInstance>;
export async function buildApp(
  deps: AppDeps,
  opts: { mode: 'http' | 'combined' },
): Promise<FastifyInstance | BuiltApp>;
export async function buildApp(
  deps: AppDeps,
  opts?: { mode?: 'http' | 'combined' },
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
    // Request logging is on by default. This used to spell that out with
    // `disableRequestLogging: false`, but the option is deprecated in
    // fastify@5 and will be removed in fastify@6 — and it warns on
    // *presence*, not on value (`fastify.js`: `if (options
    // .disableRequestLogging !== undefined) FSTDEP023()`), because
    // `false` is already the default (`config-validator.js` fills it in
    // when undefined). Omitting it says exactly the same thing, without
    // the FSTDEP023 warning on every boot.
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

  const metadataAnalyzer =
    deps.metadataAnalyzer ??
    new MetadataAnalyzer({
      token: deps.githubToken ?? cfg.GITHUB_TOKEN,
      timeoutMs: 15_000,
    });

  // The OKX adapter burns a buyer's `(from, nonce)` pair on first use so one
  // signed authorization buys one audit. It gets the durable store, not its
  // in-memory default: this process restarts, and more than one of it can run
  // behind the same database (R-40).
  const adapter = buildPaymentAdapter(deps.payment, { nonceStore: new NonceRepository(db) });
  const service = new JobService(repo, adapter);

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
  const mode: 'http' | 'combined' | undefined = opts?.mode;
  const queueDriver = deps.queueDriver ?? cfg.AUDIT_QUEUE_DRIVER;

  // In 'http' mode the API enqueues to a separate worker process.
  // The inline driver is in-process, so it cannot cross process
  // boundaries. Refuse it explicitly so a misconfigured deployment
  // does not silently swallow jobs.
  if (mode === 'http' && queueDriver === 'inline') {
    throw new Error(
      `mode='http' with AUDIT_QUEUE_DRIVER=inline is not supported: the inline queue is in-process and a dedicated worker process cannot consume it. Use AUDIT_QUEUE_DRIVER=pg-boss for multi-process deployments, or run with mode='combined' for single-process.`,
    );
  }

  // The queue is always constructed: the API process needs to
  // enqueue audit jobs, even in 'http' mode (it enqueues to pg-boss,
  // which the dedicated worker process consumes from).
  // `consumeOverride` controls whether THIS process also runs the
  // worker. In 'http' mode it is `false` because the dedicated worker
  // is the consumer. In 'combined' mode (and the legacy `undefined`
  // default) this process also consumes.
  const queueShouldConsume = mode !== 'http';

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
    consumeOverride: queueShouldConsume,
  });

  await queue.start();

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
    limits: {
      maxFiles: cfg.MAX_FILES,
      maxFileBytes: cfg.MAX_FILE_BYTES,
      maxTotalBytes: cfg.MAX_TOTAL_BYTES,
      rateLimitPerMinute: cfg.RATE_LIMIT_PER_MINUTE,
    },
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
  // No `maxFiles` / `maxFileBytes` / `maxTotalBytes` here. They used to be
  // passed — `maxFiles` as `Math.min(200, cfg.MAX_FILES)` — and the runner
  // stored them without ever reading them, so `MAX_FILES` did nothing on this
  // route while looking like it did. The runner reads a tree listing and never
  // downloads a file, so there is no byte bound to set either.
  const freeCheckRunner = new FreeCheckRunner({
    githubToken: deps.githubToken ?? cfg.GITHUB_TOKEN,
    allowedHosts: deps.allowedHosts,
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
      resourceUrl: cfg.OKX_PAYMENT_RESOURCE_URL,
    },
    pricing: {
      audit: { amount: cfg.PRICE_AUDIT, currency: 'USDT' },
    },
  };
}

/**
 * There was a `defaultLlmProvider()` here, and it was the whole of the
 * `LLM_PROVIDER` story: it built an `OpenAICompatibleProvider` from
 * `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL`, `main()`
 * passed the result into `buildApp` as `AppDeps.llmProvider` at both call
 * sites, and no code path ever read it. A configured provider changed nothing
 * about a report — the copy comes from `templateSummary()` /
 * `templateLaunchCopy()` — while `scripts/env-check.ts` *refused to pass* when
 * `LLM_PROVIDER=openai-compatible` and the credentials were missing. The gate
 * demanded a credential for a capability that did nothing. Removed in R-38,
 * with the four variables it read.
 */

async function main() {
  const cfg = loadConfig();
  // `REPOPILOT_API_MODE` controls the process role:
  //   - `combined`: HTTP + queue in one process.
  //   - `http`:     HTTP only; a separate worker process consumes from the
  //                 queue.
  // Both `pnpm dev` and `pnpm start` set `combined` in their own script
  // (`apps/api/package.json`); `pnpm dev:api` and `pnpm start:api` set `http`.
  // An unset variable falls back to `combined`, which is what this comment
  // used to get wrong — it said `pnpm start` defaults to `http`, while the
  // script pins `combined` explicitly.
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
