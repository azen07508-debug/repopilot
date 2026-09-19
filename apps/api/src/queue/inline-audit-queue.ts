/**
 * InlineAuditQueue — in-process audit job scheduler.
 *
 * Used for:
 *   - SQLite local dev (`pnpm dev`)
 *   - unit / integration tests
 *   - environments without PostgreSQL
 *   - `verify:release` (smoke test)
 *
 * Semantics:
 *   - `enqueue()` schedules the job on a small, bounded worker pool and
 *     returns immediately. The HTTP request never waits for the analysis.
 *   - Concurrency is configurable via `AUDIT_QUEUE_CONCURRENCY`
 *     (default 1). Concurrency > 1 is safe because the worker is
 *     idempotent at the jobId level (the conditional `expectedStatus`
 *     update prevents two workers from running the same job).
 *   - Duplicate enqueues (same jobId) coalesce: a second `enqueue()` for
 *     an already-scheduled job returns `accepted: false` and does NOT
 *     schedule a second run.
 *   - `stop()` is a graceful drain: it refuses new enqueues, then waits
 *     up to `SHUTDOWN_GRACE_PERIOD_MS` for in-flight tasks.
 *   - The queue can never be silently selected in production: the
 *     config validator refuses `NODE_ENV=production + AUDIT_QUEUE_DRIVER=inline`.
 */
import type {
  AuditQueue,
  AuditQueueJob,
  EnqueueResult,
  QueueHealth,
  AuditQueueDriver,
} from './audit-queue.js';

export interface InlineAuditQueueDeps {
  /** Invokes the actual audit logic for one jobId. */
  runOne: (jobId: string) => Promise<void>;
  /** How long `stop()` waits for in-flight jobs to drain. */
  shutdownGraceMs: number;
  /** Max parallel jobs. Default 1. */
  concurrency: number;
  /** Optional logger (e.g. pino). Defaults to a no-op. */
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

interface NoopLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const NOOP_LOG: NoopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export class InlineAuditQueue implements AuditQueue {
  readonly driver: AuditQueueDriver = 'inline';

  private readonly runOne: InlineAuditQueueDeps['runOne'];
  private readonly shutdownGraceMs: number;
  private readonly concurrency: number;
  private readonly log: NoopLogger;

  private readonly inFlight = new Set<string>();
  private readonly inflightPromises = new Set<Promise<void>>();
  private accepting = true;
  private started = false;
  /** Pending jobs waiting for a free worker slot. */
  private readonly pending: string[] = [];
  private activeWorkers = 0;

  constructor(deps: InlineAuditQueueDeps) {
    this.runOne = deps.runOne;
    this.shutdownGraceMs = deps.shutdownGraceMs;
    this.concurrency = Math.max(1, deps.concurrency);
    this.log = deps.log ?? NOOP_LOG;
  }

  async start(): Promise<void> {
    this.started = true;
    this.accepting = true;
    this.log.info({ driver: this.driver, concurrency: this.concurrency }, 'audit queue started');
  }

  async enqueue(input: AuditQueueJob): Promise<EnqueueResult> {
    if (!this.started) {
      throw new Error('InlineAuditQueue.enqueue called before start()');
    }
    if (!this.accepting) {
      throw new Error('InlineAuditQueue is shutting down; not accepting new jobs');
    }
    if (this.inFlight.has(input.jobId) || this.pending.includes(input.jobId)) {
      return { jobId: input.jobId, acceptedAt: new Date().toISOString(), accepted: false };
    }
    this.inFlight.add(input.jobId);
    this.pending.push(input.jobId);
    void this.dispatch();
    return { jobId: input.jobId, acceptedAt: new Date().toISOString(), accepted: true };
  }

  /**
   * Graceful shutdown. We:
   *   1. Stop accepting new enqueues (`accepting = false`).
   *   2. Wait for the in-flight tasks to finish, up to `shutdownGraceMs`.
   *   3. Force-resolve: any tasks still running get a chance to finish
   *      (we cannot kill them — that's the caller's responsibility), but
   *      we no longer wait.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.accepting = false;
    const deadline = Date.now() + this.shutdownGraceMs;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      // Build a settled Promise that we can await. We swallow errors
      // here because `stop()` is best-effort: we will continue
      // waiting until either the in-flight tasks finish or the
      // grace deadline elapses.
      const inflightSettled: Promise<unknown> = Promise
        .all(Array.from(this.inflightPromises))
        // eslint-disable-next-line no-floating-promise
        .catch(() => undefined);
      const tick: Promise<void> = new Promise((r) =>
        setTimeout(() => r(undefined), 200),
      );
      await Promise.race([inflightSettled, tick]);
    }
    if (this.inFlight.size > 0) {
      this.log.warn(
        { pending: this.inFlight.size },
        'InlineAuditQueue shutdown grace period elapsed with jobs still running; forcing close',
      );
    }
    this.started = false;
    this.log.info({ driver: this.driver }, 'audit queue stopped');
  }

  async health(): Promise<QueueHealth> {
    return {
      driver: this.driver,
      status: this.accepting ? 'ok' : 'unavailable',
      acceptingJobs: this.accepting,
      pending: this.inFlight.size,
    };
  }

  // --------------------------------------------------------------------------

  private dispatch(): void {
    while (this.activeWorkers < this.concurrency && this.pending.length > 0) {
      const jobId = this.pending.shift();
      if (jobId === undefined) break;
      this.activeWorkers += 1;
      const p = this.runJob(jobId)
        // eslint-disable-next-line no-floating-promise
        .catch((err: unknown) => {
          this.log.warn(
            { jobId, err: (err as Error)?.message ?? 'unknown' },
            'audit job failed in InlineAuditQueue',
          );
        })
        // eslint-disable-next-line no-floating-promise
        .finally(() => {
          this.activeWorkers -= 1;
          // Continue draining the pending queue.
          if (this.pending.length > 0 && this.accepting) {
            void this.dispatch();
          }
        });
      this.inflightPromises.add(p);
      const tracked = p.finally(() => this.inflightPromises.delete(p));
      // Intentional fire-and-forget: the chain ends in `p` (the work
      // itself) which is observed by `inflightPromises` so `stop()`
      // can wait for it. We do not await here.
      void tracked;
    }
  }

  private async runJob(jobId: string): Promise<void> {
    try {
      await this.runOne(jobId);
    } finally {
      this.inFlight.delete(jobId);
    }
  }
}
