/**
 * Postgres integration test.
 *
 * Skipped unless `DATABASE_URL` points at a Postgres instance. The CI
 * workflow `.github/workflows/ci.yml` provides a Postgres 16 service
 * container; locally you can run it with:
 *
 *   docker run -d --name repopilot-pg -p 5432:5432 \
 *     -e POSTGRES_DB=repopilot_test \
 *     -e POSTGRES_USER=repopilot \
 *     -e POSTGRES_PASSWORD=repopilot_test \
 *     postgres:16-alpine
 *
 *   DATABASE_URL=postgres://repopilot:repopilot_test@localhost:5432/repopilot_test \
 *     pnpm --filter @repopilot/api test src/tests/postgres.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDatabase, runMigrations, closeDatabase } from '../db/client.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { AuditJob, Report } from '@repopilot/core';
import { AuditJobSchema } from '@repopilot/core';

const URL = process.env['DATABASE_URL'] ?? '';
const IS_PG = URL.startsWith('postgres://') || URL.startsWith('postgresql://');
const IT = IS_PG ? describe : describe.skip;

IT('Postgres integration (live DB)', () => {
  let repo: JobRepository;

  beforeAll(async () => {
    const db = openDatabase(URL);
    expect(db.mode).toBe('pg');
    await runMigrations(db);
    repo = new JobRepository(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('inserts, fetches by id, and enforces payment_id uniqueness', async () => {
    const job: AuditJob = AuditJobSchema.parse({
      jobId: `job_${Date.now()}_a`,
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
      paymentId: `pay_${Date.now()}_a`,
      report: null,
      error: null,
    });
    await repo.insert(job);

    const got = await repo.findById(job.jobId);
    expect(got).not.toBeNull();
    expect(got?.input.repoUrl).toBe('https://github.com/octocat/Hello-World');

    const byPay = await repo.findByPaymentId(job.paymentId!);
    expect(byPay?.jobId).toBe(job.jobId);

    // Unique index on payment_id: a second row with the same paymentId
    // must be rejected. Use a different jobId so the PK doesn't fire first.
    const dup: AuditJob = AuditJobSchema.parse({
      ...job,
      jobId: `job_${Date.now()}_b`,
    });
    await expect(repo.insert(dup)).rejects.toThrow();
  });

  it('stores and reads a JSONB report', async () => {
    const jobId = `job_${Date.now()}_c`;
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
    const report = {
      reportVersion: '1.0',
      scores: { overall: 77, documentation: 80, reproducibility: 75, securityHygiene: 90, deploymentReadiness: 70, breakdown: {} },
    } as unknown as Report;
    await repo.update(jobId, { status: 'completed', report });
    const got = await repo.findById(jobId);
    expect(got?.report).not.toBeNull();
    expect((got?.report as { scores: { overall: number } } | null)?.scores.overall).toBe(77);
  });
});
