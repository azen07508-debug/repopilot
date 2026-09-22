/**
 * JobService — owns the lifecycle of an audit job.
 *
 * The route layer is responsible for input validation and payment
 * verification. Once those have passed, the route creates a `queued`
 * job and hands it to the configured AuditQueue. The queue dispatches
 * to a worker (in-process or pg-boss), which uses the methods on this
 * service to transition the state machine and (eventually) load the
 * pipeline + cache.
 *
 * Lifecycle states (state machine):
 *   queued     -> processing     (worker takes the job)
 *   processing -> completed      (pipeline + cache OK)
 *   processing -> failed         (terminal, after retries)
 */
import { randomUUID } from 'node:crypto';
import {
  AuditPipeline,
  AuditJobSchema,
  CreateAuditInputSchema,
  type AuditJob,
  type CreateAuditInput,
  type Report,
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
    private pipeline: AuditPipeline,
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
   * with a sentinel string: the column is nullable and `getByCommitSha`
   * looks rows up by this value, so `'unknown'` would read as a real SHA
   * to anything filtering on it.
   */
  async setCommitSha(job: AuditJob, commitSha: string | null): Promise<void> {
    await this.repo.update(job.jobId, { commitSha });
  }

  /** Audit history for one repository, newest first. */
  async listHistory(owner: string, repo: string, limit = 20): Promise<AuditJob[]> {
    return this.repo.listByRepo(owner, repo, limit);
  }

  /**
   * Completed audits that carry a report, newest first.
   *
   * Two entries from this list are enough to build an AuditDiff, so
   * before/after comparison never has to re-scan the repository.
   */
  async listCompletedHistory(owner: string, repo: string, limit = 20): Promise<AuditJob[]> {
    return this.repo.listCompletedByRepo(owner, repo, limit);
  }

  /** The most recent audit recorded against an exact commit. */
  async getByCommitSha(owner: string, repo: string, commitSha: string): Promise<AuditJob | null> {
    return this.repo.findByCommitSha(owner, repo, commitSha);
  }

  /**
   * Legacy fast-path: run the audit pipeline synchronously. The
   * AuditWorker does not call this; it inlines the cache-aware flow
   * via `executeWithCache`. We keep it so unit tests for the
   * pipeline + payment integration continue to work.
   */
  async startPaid(job: AuditJob): Promise<Report> {
    const input = CreateAuditInputSchema.parse(job.input);
    const result = await this.pipeline.run({
      repoUrl: input.repoUrl,
      mode: input.mode,
      target: input.target,
      outputLanguage: input.outputLanguage,
      includeLaunchCopy: input.includeLaunchCopy,
      llmProviderName: 'noop',
      llmProviderConfigured: false,
    });
    await this.repo.update(job.jobId, { status: 'completed', report: result.report, error: null });
    return result.report;
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
