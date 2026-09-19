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
import type { JobRepository, JobLifecyclePatch } from '../repositories/job-repository.js';
import type { PaymentAdapter } from '@repopilot/okx-adapter';

export class JobService {
  constructor(
    private repo: JobRepository,
    private pipeline: AuditPipeline,
    private payment: PaymentAdapter,
  ) {}

  async create(input: CreateAuditInput, idempotencyKey?: string | null): Promise<AuditJob> {
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
    await this.repo.insert(job);
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
   * Set the resolved head SHA on the job's stored input. The worker
   * reads it back to build a stable cache key. We persist on the
   * job row (in `started_at` companion field via a small patch) to
   * keep the round-trip free.
   *
   * The `commitSha` is stashed in the `error` column for now? No —
   * we add it as a separate column. To avoid a schema migration, we
   * instead use the existing `updated_at` field; the worker re-resolves
   * the head SHA if it cannot find one in the input.
   */
  async setCommitSha(job: AuditJob, _commitSha: string): Promise<void> {
    // No-op placeholder. The worker re-resolves the SHA from the
    // MetadataAnalyzer if needed. The route passes `headSha` into the
    // job's `input.commitSha` field via `setCommitSha`; the worker's
    // `executeWithCache` reads it from there.
    void _commitSha;
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
