/**
 * AuditWorker's failure contract, exercised on the driver that has no retry of
 * its own.
 *
 * === WHAT THIS FILE IS FOR =============================================
 * R-43. `runOnce` classifies a failure and, when the classification is
 * *retryable*, deliberately leaves the row for the queue to re-deliver. Both
 * drivers failed to honour that, in different ways, and neither failure was
 * visible from the worker alone:
 *
 *   - `InlineAuditQueue.dispatch()` caught the throw and logged it. No retry,
 *     no terminal transition, so the row stayed `processing` and nothing in the
 *     process would ever move it.
 *   - pg-boss *did* redeliver, but the row was still `processing` when the
 *     redelivery arrived, and `runOnce` skips a job it finds in `processing` —
 *     so the retry was silently dropped. `retryLimit` was set, read, and
 *     meaningless on both drivers.
 *
 * Both end the same way: a job a client polls forever. `verify:release` step
 * 11b is the witness — it polls a job for a deliberately non-existent
 * repository to a terminal state and carries the comment "The queue retries
 * once, then the job ends in `failed` state", which was true of neither driver
 * until this batch.
 *
 * So the invariant these tests pin is one sentence long: **a job that fails
 * reaches a terminal state, and it takes the number of attempts that was
 * configured.** Every case below is a way that can go wrong.
 *
 * === WHY A STUB PIPELINE ==============================================
 * The failure has to be *classified* to exercise the retryable path, and the
 * only thing that decides the classification is the thrown error. A real
 * pipeline would need the network to produce one, and the interesting cases —
 * "retryable, then terminal", "retryable until the budget runs out" — are
 * sequences, not requests. The stub also makes the assertion exact: `run` is
 * counted, so "was it actually re-attempted" is observed rather than inferred
 * from a status that several paths can produce.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditError } from './audit-worker.js';
import { buildAuditQueue } from '../queue/build-queue.js';
import { openIsolatedSqlite, runMigrations } from '../db/client.js';
import { JobRepository } from '../repositories/job-repository.js';
import { ReportCacheRepository } from '../repositories/report-cache-repository.js';
import { CacheService } from './cache-service.js';
import {
  AuditJobSchema,
  type AuditJob,
  type AuditPipeline,
  type MetadataAnalyzer,
} from '@repopilot/core';
import { createLogger } from '../utils/logger.js';
import { _resetConfigCacheForTests } from '../config.js';

let tmpDir: string;
let prevEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'repopilot-worker-contract-'));
  prevEnv = { ...process.env };
  process.env['NODE_ENV'] = 'test';
  process.env['PAYMENT_MODE'] = 'mock';
  process.env['AUDIT_QUEUE_DRIVER'] = 'inline';
  process.env['DATABASE_URL'] = `file:${join(tmpDir, 'test.db')}`;
  process.env['LOG_LEVEL'] = 'silent';
  _resetConfigCacheForTests();
});

afterEach(() => {
  process.env = prevEnv;
  _resetConfigCacheForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** A pipeline that throws the errors it was given, one per call, in order. */
function scriptedPipeline(errors: Error[]): { pipeline: AuditPipeline; calls: () => number } {
  let calls = 0;
  const pipeline = {
    run: async (): Promise<never> => {
      const err = errors[Math.min(calls, errors.length - 1)] ?? new Error('scripted pipeline ran out of errors');
      calls += 1;
      throw err;
    },
  } as unknown as AuditPipeline;
  return { pipeline, calls: () => calls };
}

/**
 * A pipeline that never settles, for the deadline case. Nothing ever awaits it
 * to completion, and an unresolved promise does not hold the process open.
 */
function hangingPipeline(): AuditPipeline {
  return { run: () => new Promise<never>(() => undefined) } as unknown as AuditPipeline;
}

const RETRYABLE = (): AuditError => new AuditError('UPSTREAM_FAILED', 'upstream blew up', true);
const PERMANENT = (): AuditError => new AuditError('REPO_NOT_FOUND', 'repository not found', false);

async function openRepo(): Promise<{ db: ReturnType<typeof openIsolatedSqlite>; repo: JobRepository }> {
  const db = openIsolatedSqlite(process.env['DATABASE_URL']!.replace(/^file:/, ''));
  await runMigrations(db);
  return { db, repo: new JobRepository(db) };
}

async function seedQueuedJob(repo: JobRepository, jobId: string): Promise<void> {
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
}

interface Harness {
  queue: ReturnType<typeof buildAuditQueue>;
  repo: JobRepository;
}

/** The real inline queue, over an isolated SQLite database. */
async function harness(options: {
  pipeline: AuditPipeline;
  retryLimit?: number;
  jobTimeoutMs?: number;
}): Promise<Harness> {
  const { db, repo } = await openRepo();
  const queue = buildAuditQueue({
    db,
    dbMode: 'sqlite',
    repo,
    pipeline: options.pipeline,
    cache: new CacheService({
      repo: new ReportCacheRepository(db),
      enabled: false,
      ttlSeconds: 60,
      log: createLogger({ level: 'silent' }),
    }),
    cacheEnabled: false,
    metadataAnalyzer: { getHeadSha: async () => null } as unknown as MetadataAnalyzer,
    allowedHosts: ['github.com'],
    driverOverride: 'inline',
    retryLimitOverride: options.retryLimit ?? 1,
    jobTimeoutMsOverride: options.jobTimeoutMs ?? 5_000,
    // Deliberately short. The default 30 s drain is longer than any assertion
    // in this file, so a job that never settles would report vitest's timeout
    // instead of the diagnostic below — and a test whose failure message is
    // "timed out" tells you nothing about which invariant broke.
    shutdownGraceMsOverride: 1_000,
    logOverride: createLogger({ level: 'silent' }),
  });
  await queue.start();
  return { queue, repo };
}

/**
 * Poll until the job is terminal. A poll rather than a sleep, so a slow machine
 * makes a *failure* take longer to report instead of making a passing case
 * flaky.
 */
async function waitForTerminal(repo: JobRepository, jobId: string): Promise<AuditJob> {
  const deadline = Date.now() + 15_000;
  let job = await repo.findById(jobId);
  while (Date.now() < deadline) {
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 25));
    job = await repo.findById(jobId);
  }
  throw new Error(
    `job ${jobId} was still ${job?.status ?? '(missing)'} after 15000ms; ` +
      `every failure path in this file is supposed to reach a terminal state`,
  );
}

/** Seed one job, run it through the queue, and wait for it to settle. */
async function runToTerminal(options: {
  jobId: string;
  pipeline: AuditPipeline;
  retryLimit?: number;
  jobTimeoutMs?: number;
}): Promise<AuditJob> {
  const { queue, repo } = await harness(options);
  try {
    await seedQueuedJob(repo, options.jobId);
    await queue.enqueue({ jobId: options.jobId });
    return await waitForTerminal(repo, options.jobId);
  } finally {
    await queue.stop();
  }
}

describe('AuditWorker failure contract (inline driver)', () => {
  it('a retryable failure reaches a terminal state', async () => {
    // The headline invariant, and the reason R-43 got its own batch: before
    // this, the row stayed `processing` and nothing left in the process would
    // ever move it.
    const { pipeline, calls } = scriptedPipeline([RETRYABLE()]);
    const job = await runToTerminal({ jobId: 'job_retryable_terminal', pipeline });

    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('UPSTREAM_FAILED');
    expect(job.failedAt).not.toBeNull();
    // retryLimit 1 => one retry => two attempts, both thrown away.
    expect(job.attempts).toBe(2);
    expect(calls()).toBe(2);
  });

  it('spends exactly the configured attempt budget', async () => {
    // The attempt count is what the terminal decision is made from, so a driver
    // and a worker that disagree about it is how a job gets stuck. Pin both
    // ends: the count the worker recorded, and the number of times it was
    // actually asked to run.
    const { pipeline, calls } = scriptedPipeline([RETRYABLE()]);
    const job = await runToTerminal({ jobId: 'job_budget_three', pipeline, retryLimit: 2 });

    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(3);
    expect(calls()).toBe(3);
  });

  it('re-attempts the job rather than dropping the redelivery', async () => {
    // The pg-boss half of R-43, reproduced on the driver that is cheap to test.
    // The retry used to arrive, find the row in `processing`, and be skipped —
    // so a redelivery cost nothing and changed nothing. A retry that does not
    // re-run is indistinguishable from no retry at all, except that it makes
    // `AUDIT_QUEUE_RETRY_LIMIT` look like it is doing something.
    const { pipeline, calls } = scriptedPipeline([RETRYABLE(), PERMANENT()]);
    const job = await runToTerminal({ jobId: 'job_retry_reruns', pipeline });

    expect(calls()).toBe(2);
    expect(job.attempts).toBe(2);
    // The second attempt's classification is the one that gets reported, which
    // is also how we know the second attempt really ran the pipeline.
    expect(job.errorCode).toBe('REPO_NOT_FOUND');
    expect(job.status).toBe('failed');
  });

  it('does not retry a permanent failure', async () => {
    const { pipeline, calls } = scriptedPipeline([PERMANENT()]);
    const job = await runToTerminal({ jobId: 'job_permanent', pipeline });

    expect(calls()).toBe(1);
    expect(job.attempts).toBe(1);
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('REPO_NOT_FOUND');
  });

  it('fails a job that outlives its deadline, with a code that says so', async () => {
    // The deadline is the other half of the fix. Without it an audit that hangs
    // — a socket that never times out, an upstream that accepts and then says
    // nothing — is a job that never reaches a terminal state even though every
    // *thrown* error now does.
    const job = await runToTerminal({
      jobId: 'job_deadline',
      pipeline: hangingPipeline(),
      jobTimeoutMs: 150,
      retryLimit: 0,
    });

    expect(job.status).toBe('failed');
    // Not `UPSTREAM_FAILED`: a timeout is retryable, but it is not a report
    // about the upstream — a hung request and a rejected one need different
    // things done about them, and one code cannot say both.
    expect(job.errorCode).toBe('JOB_TIMEOUT');
    expect(job.error).toMatch(/150ms/);
  });

  it('does not re-run a job that already reached a terminal state', async () => {
    // The guarded take is what makes redelivery safe: a job delivered twice
    // must not be audited twice. It is also why the terminal writes are guarded
    // on `processing` — a late write must not clobber a row that settled.
    const { pipeline, calls } = scriptedPipeline([PERMANENT()]);
    const { queue, repo } = await harness({ pipeline });
    try {
      await seedQueuedJob(repo, 'job_delivered_twice');
      await queue.enqueue({ jobId: 'job_delivered_twice' });
      const first = await waitForTerminal(repo, 'job_delivered_twice');
      expect(first.status).toBe('failed');

      // Same job, delivered again. The queue no longer holds it, so this is a
      // genuinely new scheduling of an already-terminal job.
      await queue.enqueue({ jobId: 'job_delivered_twice' });
      await new Promise((r) => setTimeout(r, 250));

      expect(calls()).toBe(1);
      const after = await repo.findById('job_delivered_twice');
      expect(after?.status).toBe('failed');
      expect(after?.attempts).toBe(1);
    } finally {
      await queue.stop();
    }
  });
});
