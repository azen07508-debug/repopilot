/**
 * In-memory job store. Sufficient for the MCP stdio server and as a
 * template for a SQL-backed implementation in the API.
 */
import { randomUUID } from 'node:crypto';
import type {
  CreateAuditInput,
  Report,
  JobStatus,
} from '@repopilot/core';
import { AuditJobSchema, type AuditJob } from '@repopilot/core';

export type { AuditJob };

export class JobStore {
  private jobs = new Map<string, AuditJob>();

  create(input: CreateAuditInput): AuditJob {
    const now = new Date().toISOString();
    const job: AuditJob = AuditJobSchema.parse({
      jobId: `job_${randomUUID()}`,
      status: 'queued',
      input,
      createdAt: now,
      updatedAt: now,
      paymentId: null,
      report: null,
      error: null,
    });
    this.jobs.set(job.jobId, job);
    return job;
  }

  attachPayment(jobId: string, paymentId: string): void {
    const j = this.jobs.get(jobId);
    if (!j) return;
    this.jobs.set(jobId, { ...j, paymentId, updatedAt: new Date().toISOString() });
  }

  setStatus(jobId: string, status: JobStatus, error?: string): void {
    const j = this.jobs.get(jobId);
    if (!j) return;
    this.jobs.set(jobId, {
      ...j,
      status,
      updatedAt: new Date().toISOString(),
      error: error ?? null,
    });
  }

  complete(jobId: string, report: Report): void {
    const j = this.jobs.get(jobId);
    if (!j) return;
    this.jobs.set(jobId, {
      ...j,
      status: 'completed',
      report,
      updatedAt: new Date().toISOString(),
    });
  }

  fail(jobId: string, error: string): void {
    this.setStatus(jobId, 'failed', error);
  }

  get(jobId: string): AuditJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  list(): AuditJob[] {
    return [...this.jobs.values()];
  }

  /**
   * Audits for one repository, newest first.
   *
   * The MCP server keeps jobs in memory, so "history" means "this
   * session". The API has the durable equivalent backed by the jobs
   * table's owner/repo columns.
   */
  listByRepo(repoUrl: string, limit = 20): AuditJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.input.repoUrl === repoUrl)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }
}
