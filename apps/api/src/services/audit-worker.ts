/**
 * AuditWorker — single audit-job executor.
 *
 * This is the ONE place that knows how to:
 *   - load a job by id
 *   - transition the state machine
 *     queued     -> processing  (guarded by `expectedStatus: 'queued'`)
 *     processing -> completed   (only if report stored)
 *     processing -> queued      (retryable failure, and an attempt left to spend)
 *     processing -> failed      (terminal: permanent, or out of attempts)
 *   - run the audit pipeline through the existing Report Cache
 *   - classify errors (transient vs permanent) and decide whether another
 *     attempt is worth asking the queue for
 *
 * The worker does NOT verify payment (that happens in the route,
 * before the job is ever enqueued) and does NOT instantiate the
 * pipeline (the host provides it).
 *
 * === THE CONTRACT WITH THE QUEUE =======================================
 * A single call to `runOnce` is a single attempt. It reports "another attempt
 * is warranted" the only way a queue can hear it — by throwing — and it stops
 * asking once the configured budget is spent, writing the terminal state
 * itself instead. Two consequences the drivers depend on:
 *
 *   - A retryable failure must leave the row in a state a retry can *claim*,
 *     which is `queued` and not `processing`: `runOnce` skips a job it finds in
 *     `processing`, so a row parked there silently swallows the redelivery that
 *     was supposed to follow. (R-43 — both drivers had this.)
 *   - The terminal decision lives here rather than in the drivers, because only
 *     the row knows how many attempts it has had, and pg-boss cannot tell the
 *     handler anything the row does not already say.
 */
import {
  AuditPipeline,
  MetadataAnalyzer,
  REPORT_VERSION,
  ReportSchema,
  parseRepoUrl,
  type AuditJob,
  type Report,
} from '@repopilot/core';
import type { CacheService } from './cache-service.js';
import type { JobRepository } from '../repositories/job-repository.js';

export type AuditErrorCode =
  | 'INVALID_INPUT'
  | 'HOST_NOT_ALLOWED'
  | 'REPO_NOT_FOUND'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_FAILED'
  | 'JOB_TIMEOUT'
  | 'INTERNAL';

/**
 * Raised when an attempt outlives `AUDIT_QUEUE_JOB_TIMEOUT_MS`.
 *
 * Retryable, because a slow network is not a permanent failure — but a code of
 * its own rather than `UPSTREAM_FAILED`, because the two point at different
 * things. `UPSTREAM_FAILED` is a report about the upstream; this is a report
 * about us giving up on waiting for it. Collapsing them would make a hung
 * request indistinguishable from a rejected one in the job row, and those want
 * different responses.
 *
 * Safe to add: a job's `errorCode` is a free string on the wire
 * (`JobStatusSchema`/`AuditJobSchema` type it as `z.string()`), unlike the
 * HTTP error envelope in `docs/API.md`, which is a closed enum.
 */
export const JOB_TIMEOUT = 'JOB_TIMEOUT' as const;

export class AuditError extends Error {
  readonly code: AuditErrorCode;
  readonly retryable: boolean;
  constructor(code: AuditErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'AuditError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AuditWorkerDeps {
  repo: JobRepository;
  pipeline: AuditPipeline;
  cache: CacheService;
  cacheEnabled: boolean;
  /** Metadata analyzer used to resolve the head SHA for the cache key. */
  metadataAnalyzer: MetadataAnalyzer;
  /** Allowed hosts for the repoUrl (SSRF defense). */
  allowedHosts: string[];
  /**
   * How many times a failed attempt may be re-attempted, after the first one.
   * `AUDIT_QUEUE_RETRY_LIMIT`; pg-boss is configured with the same number, so
   * both drivers make the same number of attempts.
   */
  retryLimit: number;
  /**
   * How long one attempt may take before it is abandoned and reported as
   * `JOB_TIMEOUT`. `AUDIT_QUEUE_JOB_TIMEOUT_MS`.
   */
  jobTimeoutMs: number;
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export class AuditWorker {
  constructor(private readonly deps: AuditWorkerDeps) {}

  /**
   * Run a single attempt at an audit job.
   *
   * Returns void when the job reached a terminal state — `completed` or
   * `failed` alike, so a caller must not read "did not throw" as "succeeded".
   * Throws `AuditError` only to ask for another attempt, which it does solely
   * while `attempts` is still under `retryLimit + 1`; a permanent failure, or
   * one that has run out of attempts, is written as `failed` and returns.
   *
   * Idempotency: if the job is already `completed` or `failed`, we
   * return without re-running. If a second worker somehow transitions
   * the same job to `processing`, the conditional update returns
   * `updated: false` and we treat the job as already taken.
   */
  async runOnce(jobId: string): Promise<void> {
    const log = this.deps.log ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
    const job = await this.deps.repo.findById(jobId);
    if (!job) {
      log.warn({ jobId }, 'audit job not found; skipping');
      return;
    }
    if (job.status === 'completed') {
      log.info({ jobId }, 'audit job already completed; idempotent skip');
      return;
    }
    if (job.status === 'failed') {
      log.info({ jobId }, 'audit job already failed; not re-running');
      return;
    }
    if (job.status === 'processing') {
      // Another worker is already running this. Don't double-run.
      //
      // This is only a safe reading because a *retryable* failure no longer
      // parks the row here: a redelivery that arrived to find its own previous
      // attempt's leftovers was treated as someone else's work and dropped
      // (R-43). `processing` now means what it says. A worker that dies
      // mid-attempt still leaves the row here for good — there is no sweep —
      // which is R-42's territory, not this guard's.
      log.warn({ jobId }, 'audit job already processing elsewhere; skipping');
      return;
    }

    const now = new Date().toISOString();
    // The attempt count is incremented on the take rather than after the
    // failure, so it is already correct for any reader that observes the row
    // while this attempt is in flight.
    const attempts = (job.attempts ?? 0) + 1;
    const maxAttempts = this.deps.retryLimit + 1;
    // queued -> processing (guarded)
    const take = await this.deps.repo.update(
      jobId,
      { status: 'processing', startedAt: now, attempts },
      'queued',
    );
    if (!take.updated) {
      // Lost the race to another worker. Reload and decide.
      const fresh = await this.deps.repo.findById(jobId);
      if (fresh?.status === 'completed' || fresh?.status === 'failed') return;
      throw new AuditError('INTERNAL', `could not claim job ${jobId} for processing`, true);
    }

    try {
      const { report, cache } = await withDeadline(
        this.executeWithCache(job),
        this.deps.jobTimeoutMs,
        `the audit of ${job.input.repoUrl}`,
      );
      await this.deps.repo.update(jobId, {
        status: 'completed',
        report,
        completedAt: new Date().toISOString(),
        error: null,
        errorCode: null,
        cacheJson: JSON.stringify(cache),
      });
      log.info({ jobId, hit: cache.hit, keyVersion: cache.keyVersion }, 'audit job completed');
    } catch (err) {
      const auditErr = this.classify(err);
      // A retryable failure is only retryable while there is an attempt left to
      // spend on it. Past that it is terminal, and the row has to say so:
      // nothing else in the system moves a job out of a non-terminal state, so
      // leaving one there is a job a client polls forever.
      const terminal = !auditErr.retryable || attempts >= maxAttempts;
      log.warn(
        {
          jobId,
          code: auditErr.code,
          message: auditErr.message,
          retryable: auditErr.retryable,
          attempts,
          maxAttempts,
        },
        terminal ? 'audit job failed' : 'audit job failed; another attempt will be made',
      );
      // Guarded on `processing`, which is what we hold: a write that arrives
      // after someone else has settled the row must not clobber it.
      await this.deps.repo.update(
        jobId,
        {
          error: auditErr.message,
          errorCode: auditErr.code,
          attempts,
          failedAt: terminal ? new Date().toISOString() : null,
          // `queued` and not `processing` while an attempt remains. `processing`
          // was both untrue — nothing is processing it — and self-defeating: a
          // redelivered job finds the row in `processing`, and the guard at the
          // top of this method treats that as "someone else has it" and returns
          // without running anything. So the retry arrived, cost nothing, and
          // changed nothing, on both drivers. `queued` is true and the guarded
          // take above can claim it again.
          status: terminal ? 'failed' : 'queued',
        },
        'processing',
      );
      if (!terminal) {
        throw auditErr; // tell the queue to re-deliver
      }
      // Terminal: we do NOT throw. The job is done (failed), and a throw would
      // ask the queue for a retry it must not perform.
    }
  }

  // --------------------------------------------------------------------------

  private async executeWithCache(
    job: AuditJob,
  ): Promise<{ report: Report; cache: { hit: boolean; keyVersion: string; expiresAt: string | null } }> {
    const input = job.input;
    // Build a cache key that includes everything that affects the
    // analysis output. The audit route is responsible for payment
    // verification; by the time we are here, payment is confirmed.
    // We re-use the existing buildCacheKey shape: owner/repo/sha/mode/
    // target/lang/includeLaunchCopy/reportVersion.
    //
    // The report version has to come from the constant, not a literal.
    // It is in the key precisely so a format change does not serve a
    // report written by an older build — which is what a stale literal
    // here would have done the moment the version moved to 1.1.
    const keyVersion = 'v1';
    // Resolve the head SHA. We re-resolve here (instead of trusting
    // the route) so the worker is self-contained: an enqueued job can
    // be re-delivered hours later and the SHA is still current.
    let owner = 'unknown';
    let repo = 'unknown';
    try {
      const parsed = parseRepoUrl(input.repoUrl, this.deps.allowedHosts);
      owner = parsed.owner;
      repo = parsed.repo;
    } catch {
      // Invalid repoUrl: let the pipeline throw.
    }
    const commitSha =
      (await this.deps.metadataAnalyzer.getHeadSha(owner, repo, 'main').catch(() => null)) ??
      (await this.deps.metadataAnalyzer.getHeadSha(owner, repo, 'master').catch(() => null)) ??
      'unknown';

    const { buildCacheKey } = await import('./cache-service.js');
    const cacheKey = buildCacheKey({
      owner,
      repo,
      commitSha,
      mode: input.mode,
      target: input.target,
      outputLanguage: input.outputLanguage,
      reportVersion: REPORT_VERSION,
      includeLaunchCopy: input.includeLaunchCopy ?? false,
    });

    const result = await this.deps.cache.getOrCompute(
      cacheKey,
      keyVersion,
      commitSha,
      async () => {
        const r = await this.deps.pipeline.run({
          repoUrl: input.repoUrl,
          mode: input.mode,
          target: input.target,
          outputLanguage: input.outputLanguage,
          includeLaunchCopy: input.includeLaunchCopy,
        });
        return { report: r.report };
      },
    );
    return {
      report: ReportSchema.parse(result.report),
      cache: {
        hit: result.hit,
        keyVersion: result.keyVersion,
        expiresAt: result.expiresAt,
      },
    };
  }

  private classify(err: unknown): AuditError {
    if (err instanceof AuditError) return err;
    const msg = (err as Error)?.message ?? String(err);
    // Heuristic classification. The pipeline currently throws plain
    // errors; the route layer knows the source. In the future, the
    // pipeline can throw a richer error type and we can read it here.
    if (/rate limit|429|403/.test(msg)) {
      return new AuditError('UPSTREAM_RATE_LIMITED', msg, true);
    }
    if (/not found|404/i.test(msg)) {
      return new AuditError('REPO_NOT_FOUND', msg, false);
    }
    if (/invalid input|validation/i.test(msg)) {
      return new AuditError('INVALID_INPUT', msg, false);
    }
    if (/host not allowed/i.test(msg)) {
      return new AuditError('HOST_NOT_ALLOWED', msg, false);
    }
    return new AuditError('UPSTREAM_FAILED', msg, true);
  }
}

/**
 * Await `work`, rejecting with a retryable `JOB_TIMEOUT` if it has not settled
 * within `timeoutMs`.
 *
 * The abandoned promise is not cancelled — it cannot be — but nothing awaits it
 * and it is not a writer of the job row, so a result that arrives late is
 * discarded rather than applied. That is the same bargain pg-boss's
 * `expireInSeconds` makes, and this deadline is deliberately the *inner* of the
 * two: `build-queue.ts` gives pg-boss headroom, because pg-boss's expiry kills
 * the job without letting us write the row's terminal state.
 *
 * Without this, a hang is the one failure that no amount of retry logic
 * reaches: `catch` never runs, so the row never leaves `processing`.
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AuditError(JOB_TIMEOUT, `${what} did not finish within ${timeoutMs}ms`, true));
        }, timeoutMs);
        // Do not hold the process open for a job we are about to give up on.
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
