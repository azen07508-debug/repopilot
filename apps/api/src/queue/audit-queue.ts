/**
 * Audit queue interface and shared types.
 *
 * The audit pipeline is async; this interface lets us swap the
 * transport (in-process for dev/test, pg-boss for production) without
 * touching the route layer or the worker itself.
 *
 * Lifecycle:
 *   1. The HTTP route creates a `queued` job in the DB and calls
 *      `enqueue({ jobId })`. The route returns 202 immediately.
 *   2. The driver (Inline or PgBoss) eventually invokes the registered
 *      `AuditWorker.runOnce({ jobId })` for each job.
 *   3. The worker transitions the job: queued -> processing -> completed
 *      or failed, using the conditional update on `expectedStatus` to
 *      keep the state machine honest.
 *   4. On shutdown, `stop()` stops accepting new jobs, waits for the
 *      in-flight tasks to drain (up to the configured grace period),
 *      and releases its resources.
 *
 * NOTE: `enqueue` MUST be safe to call from inside a DB transaction
 * boundary. Implementations should NOT perform side-effects on the
 * HTTP response (no awaits of arbitrary network calls) — the route
 * returns 202 as soon as `enqueue` resolves.
 */
export type AuditQueueDriver = 'inline' | 'pg-boss';

export interface AuditQueueJob {
  jobId: string;
}

export interface EnqueueResult {
  jobId: string;
  /** When the driver accepted the job (ISO timestamp). */
  acceptedAt: string;
  /** True if the driver is currently scheduling this job. False if a
   *  duplicate enqueue was rejected (idempotency at the queue level). */
  accepted: boolean;
}

export type QueueHealthStatus = 'ok' | 'degraded' | 'unavailable';

export interface QueueHealth {
  driver: AuditQueueDriver;
  status: QueueHealthStatus;
  /** True if the queue will accept new jobs right now. False while
   *  shutting down. */
  acceptingJobs: boolean;
  /** Number of jobs known to the driver (best-effort). */
  pending?: number;
}

export interface AuditQueue {
  /** Which driver this queue is using. Surfaced for logs and health. */
  readonly driver: AuditQueueDriver;
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(input: AuditQueueJob): Promise<EnqueueResult>;
  health(): Promise<QueueHealth>;
}
