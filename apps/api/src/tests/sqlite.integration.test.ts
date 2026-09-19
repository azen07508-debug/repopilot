/**
 * SQLite repository integration test.
 *
 * Verifies the SQLite path: schema creation, CRUD, payment_id unique
 * index. Runs by default in `pnpm --filter @repopilot/api test`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openIsolatedSqlite, runMigrations } from '../db/client.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { AuditJob, Report } from '@repopilot/core';
import { AuditJobSchema } from '@repopilot/core';

describe('SQLite repository (in-memory)', () => {
  let repo: JobRepository;

  beforeAll(async () => {
    const db = openIsolatedSqlite('file:./data/test-sqlite-repo.db');
    expect(db.mode).toBe('sqlite');
    await runMigrations(db);
    repo = new JobRepository(db);
  });

  afterAll(async () => {
    // close handled implicitly
  });

  it('inserts and reads back a job', async () => {
    const job: AuditJob = AuditJobSchema.parse({
      jobId: `job_test_a_${Date.now()}`,
      status: 'queued',
      input: {
        repoUrl: 'https://github.com/octocat/Hello-World',
        mode: 'quick',
        target: 'open_source',
        outputLanguage: 'en',
        includeLaunchCopy: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentId: `pay_test_a_${Date.now()}`,
      report: null,
      error: null,
    });
    await repo.insert(job);
    const got = await repo.findById(job.jobId);
    expect(got?.jobId).toBe(job.jobId);
    expect(got?.input.mode).toBe('quick');
  });

  it('enforces payment_id uniqueness', async () => {
    const paymentId = `pay_dup_${Date.now()}`;
    const a: AuditJob = AuditJobSchema.parse({
      jobId: `job_dup_a_${Date.now()}`,
      status: 'queued',
      input: {
        repoUrl: 'https://github.com/octocat/Hello-World',
        mode: 'quick',
        target: 'open_source',
        outputLanguage: 'en',
        includeLaunchCopy: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentId,
      report: null,
      error: null,
    });
    await repo.insert(a);

    const b: AuditJob = AuditJobSchema.parse({
      ...a,
      jobId: `job_dup_b_${Date.now()}`,
    });
    await expect(repo.insert(b)).rejects.toThrow();
  });

  it('updates a job to completed and stores the report as JSON', async () => {
    const jobId = `job_test_c_${Date.now()}`;
    const job: AuditJob = AuditJobSchema.parse({
      jobId,
      status: 'queued',
      input: {
        repoUrl: 'https://github.com/octocat/Hello-World',
        mode: 'quick',
        target: 'open_source',
        outputLanguage: 'en',
        includeLaunchCopy: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentId: null,
      report: null,
      error: null,
    });
    await repo.insert(job);
    const report = { reportVersion: '1.0', scores: { overall: 42 } } as unknown as Report;
    await repo.update(jobId, { status: 'completed', report });
    const got = await repo.findById(jobId);
    expect(got?.status).toBe('completed');
    expect((got?.report as { scores: { overall: number } } | null)?.scores.overall).toBe(42);
  });
});
