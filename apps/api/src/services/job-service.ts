/**
 * JobService — owns the lifecycle of an audit job.
 *
 * The route layer is responsible for input validation and payment
 * verification. Once those have passed, the route creates a `queued`
 * job and hands it to the configured AuditQueue. The queue dispatches
 * to a worker (in-process or pg-boss), which uses the methods on this
 * service to transition the state machine. Running the pipeline itself is
 * the worker's job, not this service's.
 *
 * Lifecycle states (state machine):
 *   queued      -> processing    (a worker claims the job)
 *   processing  -> completed     (pipeline + cache OK)
 *   processing  -> queued        (retryable failure, and an attempt left)
 *   processing  -> failed        (terminal: permanent failure, or out of attempts)
 *
 * `processing -> queued` is the retry edge, and it is spelled out here because
 * its absence was R-43: a retryable failure used to be left in `processing`,
 * which both understated what was happening and blocked the retry — the worker
 * skips a job it finds in `processing`. `processing -> failed (terminal, after
 * retries)` was true of neither driver until the attempt budget moved into the
 * worker.
 */
import { randomUUID } from 'node:crypto';
import {
  AuditJobSchema,
  type AuditJob,
  type CreateAuditInput,
} from '@repopilot/core';
import type {
  JobRepository,
  JobLifecyclePatch,
  JobRepoIdentity,
} from '../repositories/job-repository.js';
import type { PaymentAdapter } from '@repopilot/okx-adapter';

export class JobService {
  constructor(
    private repo: JobRepository,
    private payment: PaymentAdapter,
  ) {}

  /**
   * Create a `queued` job.
   *
   * `identity` carries the already-parsed owner/repo. The route parses
   * the URL once (through `parseRepoUrl`, which enforces the host
   * allow-list) and passes the result down, so URL parsing and
   * allow-listing never get duplicated inside the data layer.
   */
  async create(
    input: CreateAuditInput,
    idempotencyKey?: string | null,
    identity?: JobRepoIdentity,
  ): Promise<AuditJob> {
    const now = new Date().toISOString();
    const job = AuditJobSchema.parse({
      jobId: `job_${randomUUID()}`,
      status: 'queued',
      input,
      createdAt: now,
      updatedAt: now,
      paymentId: null,
      report: null,
      error: null,
    });
    await this.repo.insert(job, identity);
    if (idempotencyKey) {
      await this.repo.update(job.jobId, { idempotencyKey });
    }
    return job;
  }

  async get(jobId: string): Promise<AuditJob | null> {
    return this.repo.findById(jobId);
  }

  async getByPaymentId(paymentId: string): Promise<AuditJob | null> {
    return this.repo.findByPaymentId(paymentId);
  }

  async getByIdempotencyKey(key: string): Promise<AuditJob | null> {
    return this.repo.findByIdempotencyKey(key);
  }

  /**
   * Persist the resolved head SHA on the job row.
   *
   * This is the commit the caller was quoted, and it is what the derived
   * views report: `GET .../fix-plan` returns it as
   * `repository.commitSha`, and `GET .../diff` returns it as
   * `base.commitSha` and `head.commitSha`. The worker resolves its own
   * SHA for the cache key, deliberately — a job re-delivered hours later
   * should be keyed on the commit that is current then, not on the one
   * from when it was queued.
   *
   * `null` means GitHub could not be reached, and is not interchangeable
   * with a sentinel string: the column is nullable and the derived views
   * report it verbatim, so `'unknown'` would read as a real SHA to any
   * client consuming them.
   */
  async setCommitSha(job: AuditJob, commitSha: string | null): Promise<void> {
    await this.repo.update(job.jobId, { commitSha });
  }

  /** Audit history for one repository, newest first. */
  async listHistory(owner: string, repo: string, limit = 20): Promise<AuditJob[]> {
    return this.repo.listByRepo(owner, repo, limit);
  }

  async fail(job: AuditJob, errorCode: string, errorMessage: string): Promise<void> {
    await this.repo.update(job.jobId, {
      status: 'failed',
      error: errorMessage,
      errorCode,
      failedAt: new Date().toISOString(),
    });
  }

  async setStatus(job: AuditJob, status: AuditJob['status']): Promise<void> {
    await this.repo.update(job.jobId, { status });
  }

  async attachPayment(job: AuditJob, paymentId: string): Promise<void> {
    await this.repo.update(job.jobId, { paymentId });
  }

  /** Apply a raw lifecycle patch. Used by the worker. */
  async patch(jobId: string, patch: JobLifecyclePatch, expectedStatus?: AuditJob['status']): Promise<{ updated: boolean }> {
    return this.repo.update(jobId, patch, expectedStatus);
  }

  getPaymentAdapter(): PaymentAdapter {
    return this.payment;
  }
}
