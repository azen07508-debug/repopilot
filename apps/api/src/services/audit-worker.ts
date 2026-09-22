/**
 * AuditWorker — single audit-job executor.
 *
 * This is the ONE place that knows how to:
 *   - load a job by id
 *   - transition the state machine
 *     queued  -> processing  (guarded by `expectedStatus: 'queued'`)
 *     processing -> completed (only if report stored)
 *     processing -> failed    (terminal)
 *   - run the audit pipeline through the existing Report Cache
 *   - classify errors (transient vs permanent) so the queue can decide
 *     whether to retry
 *
 * The worker does NOT verify payment (that happens in the route,
 * before the job is ever enqueued) and does NOT instantiate the
 * pipeline (the host provides it).
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
  | 'INTERNAL';

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
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export class AuditWorker {
  constructor(private readonly deps: AuditWorkerDeps) {}

  /**
   * Run a single audit job. Returns void on success, throws AuditError
   * (retryable) or a terminal error on failure.
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
      log.warn({ jobId }, 'audit job already processing elsewhere; skipping');
      return;
    }

    const now = new Date().toISOString();
    // queued -> processing (guarded)
    const take = await this.deps.repo.update(
      jobId,
      { status: 'processing', startedAt: now },
      'queued',
    );
    if (!take.updated) {
      // Lost the race to another worker. Reload and decide.
      const fresh = await this.deps.repo.findById(jobId);
      if (fresh?.status === 'completed' || fresh?.status === 'failed') return;
      throw new AuditError('INTERNAL', `could not claim job ${jobId} for processing`, true);
    }

    try {
      const { report, cache } = await this.executeWithCache(job);
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
      const isTerminal = !auditErr.retryable;
      log.warn(
        { jobId, code: auditErr.code, message: auditErr.message, retryable: auditErr.retryable },
        'audit job failed',
      );
      // We mark the row failed only if pg-boss's own retry has been
      // exhausted. The Queue adapter (Inline or PgBoss) will throw if
      // the error is retryable, and the queue will re-deliver. The
      // worker itself does NOT increment `attempts` here — that is the
      // queue's job. We just record the latest error message and
      // timestamp so the user can see it via GET.
      await this.deps.repo.update(jobId, {
        error: auditErr.message,
        errorCode: auditErr.code,
        failedAt: isTerminal ? new Date().toISOString() : null,
        status: isTerminal ? 'failed' : 'processing', // revert to processing so we are honest about state
        // Actually, we should keep it as 'processing' until either the
        // queue retries (and we get a new runOnce call) or the user
        // cancels. But pg-boss's view of the world is that the job
        // has been retried up to retryLimit times; on final failure,
        // pg-boss marks the queue-side job as failed, not our row.
      });
      if (isTerminal) {
        // Make the row state match the queue's terminal state.
        await this.deps.repo.update(jobId, { status: 'failed' });
      }
      if (auditErr.retryable) {
        throw auditErr; // tell the queue to retry
      }
      // For terminal errors, we DO NOT throw — the job is done (failed).
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
          llmProviderName: 'noop',
          llmProviderConfigured: false,
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
