/**
 * PgBossAuditQueue — production-grade audit job scheduler backed by
 * pg-boss (PostgreSQL).
 *
 * Used for:
 *   - production (PostgreSQL)
 *   - multi-replica API deployments
 *   - persistent retry
 *
 * Important semantics:
 *   - The pg-boss queue is created with `retryLimit` matching the
 *     configured value (default 1). pg-boss's built-in retry handles
 *     transient errors; the worker classifies errors so the queue
 *     does NOT retry permanent ones (e.g. invalid URL, repo not found).
 *   - The worker is idempotent: it uses the job-state-machine
 *     (queued -> processing -> completed | failed) in the `jobs` table
 *     to make sure a redelivery cannot create a duplicate report or
 *     charge payment twice.
 *   - Payment is verified BEFORE the job is enqueued, so the worker
 *     never sees a payment header.
 *   - The job payload is intentionally minimal: only `{ jobId }`.
 *     The worker loads the full job from the DB.
 *   - pg-boss manages its own internal schema; we do NOT modify
 *     pgboss's tables.
 *
 * NOTE: This adapter requires `AUDIT_QUEUE_DRIVER=pg-boss` and a
 * PostgreSQL `DATABASE_URL`. The config validator refuses to start
 * the API with this driver against a SQLite URL or in environments
 * that cannot install pg-boss.
 */
import { PgBoss } from 'pg-boss';
import type {
  AuditQueue,
  AuditQueueJob,
  EnqueueResult,
  QueueHealth,
  AuditQueueDriver,
} from './audit-queue.js';

const QUEUE_NAME = 'repopilot_audit_v1';

export interface PgBossAuditQueueDeps {
  connectionString: string;
  /** The audit worker. Invoked for each job pulled from pg-boss. */
  runOne: (jobId: string) => Promise<void>;
  /** How many pg-boss worker instances to run. */
  concurrency: number;
  /** pg-boss retryLimit (matches our internal attempts). */
  retryLimit: number;
  /** pg-boss expireInSeconds. Should be slightly above the per-job
   *  timeout. */
  expireInSeconds: number;
  /**
   * Whether this instance should consume jobs. Default `true`.
   *
   * In a multi-process deployment, the API process sets this to `false`
   * so it can enqueue jobs but does not poll pg-boss itself. The
   * dedicated worker process is the only consumer.
   */
  consume?: boolean;
  /** Optional logger. */
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export class PgBossAuditQueue implements AuditQueue {
  readonly driver: AuditQueueDriver = 'pg-boss';

  private boss: PgBoss;
  private started = false;
  private accepting = true;
  private readonly deps: PgBossAuditQueueDeps;
  private readonly log: NonNullable<PgBossAuditQueueDeps['log']>;

  constructor(deps: PgBossAuditQueueDeps) {
    this.deps = deps;
    this.log = deps.log ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
    // pg-boss manages its own connection pool. We pass the connection
    // string and let pg-boss own it. Sharing the application pool via
    // the `db` option would require building an IDatabase adapter
    // (the `db.pool` shortcut does not exist in pg-boss v12 types).
    // Keeping pg-boss on its own pool also isolates queue traffic
    // from request-time DB queries.
    //
    // application_name: a stable string DBAs can grep in
    // pg_stat_activity.
    //
    // supervise: false — do not block startup if pg-boss is down.
    // Health endpoint surfaces the issue; enqueue() will throw.
    this.boss = new PgBoss({
      connectionString: deps.connectionString,
      application_name: 'repopilot-audit-worker',
      supervise: false,
    });
    this.boss.on('error', (err: unknown) => {
      this.log.error({ err: (err as Error)?.message ?? 'unknown' }, 'pg-boss error');
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    await this.boss.createQueue(QUEUE_NAME, {
      retryLimit: this.deps.retryLimit,
      retryDelay: 5,
      expireInSeconds: this.deps.expireInSeconds,
    });
    // Only attach a worker when this instance is configured to consume.
    // In a multi-process deployment, the API process constructs the
    // queue (so it can enqueue) but does NOT call `boss.work()` —
    // the dedicated worker process is the sole consumer.
    if (this.deps.consume !== false) {
      await this.boss.work<{ jobId: string }>(
        QUEUE_NAME,
        { batchSize: 1 },
        async (jobs: Array<{ id: string; data?: { jobId?: string } }>) => {
          for (const job of jobs) {
            const jobId = job.data?.jobId;
            if (!jobId) {
              this.log.warn({ jobId: job.id }, 'pg-boss job missing jobId payload; failing');
              throw new Error('pg-boss job missing jobId');
            }
            await this.deps.runOne(jobId);
          }
        },
      );
    }
    this.started = true;
    this.accepting = true;
    this.log.info(
      { driver: this.driver, queue: QUEUE_NAME, consume: this.deps.consume !== false },
      'audit queue started',
    );
  }

  async enqueue(input: AuditQueueJob): Promise<EnqueueResult> {
    if (!this.started) {
      throw new Error('PgBossAuditQueue.enqueue called before start()');
    }
    if (!this.accepting) {
      throw new Error('PgBossAuditQueue is shutting down; not accepting new jobs');
    }
    // pg-boss dedup is keyed on the data payload via the singleton
    // policy. We use a plain `send` and let the worker be idempotent
    // at the jobId level (the queue-level dedup would over-constrain
    // retries). Storing a separate column in pgboss's job table is
    // not necessary; our jobs table is the source of truth.
    const pgJobId = await this.boss.send(QUEUE_NAME, { jobId: input.jobId });
    return {
      jobId: input.jobId,
      acceptedAt: new Date().toISOString(),
      accepted: pgJobId !== null,
    };
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.accepting = false;
    // offWork stops the worker polling. Then `stop()` closes pg-boss.
    try {
      await this.boss.offWork(QUEUE_NAME);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, 'pg-boss offWork failed');
    }
    await this.boss.stop({ graceful: true, timeout: 30 });
    this.started = false;
    this.log.info({ driver: this.driver }, 'audit queue stopped');
  }

  async health(): Promise<QueueHealth> {
    if (!this.started) {
      return { driver: this.driver, status: 'unavailable', acceptingJobs: false };
    }
    let status: QueueHealth['status'] = 'ok';
    let pending: number | undefined;
    try {
      const stats = await this.boss.getQueueStats(QUEUE_NAME);
      const total = stats.reduce((acc, s) => acc + s.queuedCount + s.activeCount, 0);
      pending = total;
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, 'pg-boss health probe failed');
      status = 'degraded';
    }
    return { driver: this.driver, status, acceptingJobs: this.accepting, pending };
  }
}
