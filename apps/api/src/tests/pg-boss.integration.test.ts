/**
 * PgBossAuditQueue end-to-end, against a live Postgres.
 *
 * Skipped unless `DATABASE_URL` points at Postgres — the same gate
 * `postgres.integration.test.ts` uses. `.github/workflows/ci.yml` provides the
 * Postgres 16 service container, so the `db: postgres` matrix leg runs this
 * file and the `sqlite` leg skips it. Locally:
 *
 *   docker run -d --name repopilot-pg -p 5432:5432 \
 *     -e POSTGRES_DB=repopilot_test \
 *     -e POSTGRES_USER=repopilot \
 *     -e POSTGRES_PASSWORD=repopilot_test \
 *     postgres:16-alpine
 *
 *   DATABASE_URL=postgres://repopilot:repopilot_test@localhost:5432/repopilot_test \
 *     pnpm --filter @repopilot/api test src/tests/pg-boss.integration.test.ts
 *
 * === WHY THIS FILE EXISTS ==============================================
 * `PgBossAuditQueue` is the production queue (`AUDIT_QUEUE_DRIVER=pg-boss`,
 * D-031's container topology) and nothing had ever run it. The Postgres
 * integration suite exercised `JobRepository` — insert, fetch, JSONB, the
 * unique index — and stopped there. The queue's own behaviour was read off
 * pg-boss's type declarations rather than observed: that `enqueue` reaches
 * `runOne`, that a thrown error is retried and then stops, that
 * `consume: false` really does not consume. `BACKLOG.md` has carried
 * "End-to-end Postgres verification remains a release-blocker" since rc.2.
 *
 * The types were checked by hand on 2026-10-06 against pg-boss@12.26.1's own
 * `dist/types.d.ts` and they were all right — `WorkHandler` does take
 * `Job<T>[]`, `getQueueStats` does return `QueueStats[]`. That is exactly the
 * kind of claim a type declaration can support and a test cannot replace: the
 * types say the shapes are right, not that a job ever comes out the other end.
 *
 * === WHY EVERY CASE HAS ITS OWN QUEUE NAME =============================
 * A pg-boss queue lives in the *database*, not the process. Two instances on
 * one Postgres that share a queue name will each consume the other's jobs, so
 * a suite that reused one name would have cases eating each other's work and
 * failing at random. That is also why `PgBossAuditQueueDeps.queueName` exists:
 * production keeps the default (`repopilot_audit_v1`) so a restart reattaches
 * to the same queue, and anything sharing a database can pick another.
 */
import { describe, it, expect } from 'vitest';
import { PgBossAuditQueue, type PgBossAuditQueueDeps } from '../queue/pg-boss-audit-queue.js';

const URL = process.env['DATABASE_URL'] ?? '';
const IS_PG = URL.startsWith('postgres://') || URL.startsWith('postgresql://');
const IT = IS_PG ? describe : describe.skip;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until `predicate` holds. Used instead of a fixed sleep so a slow CI
 * runner does not turn a passing case red — the assertion is "this eventually
 * happens", and the only thing a longer wait changes is how long a *failure*
 * takes to report.
 */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

let seq = 0;
/** A queue name no other case (or run) can collide with. */
function uniqueQueueName(): string {
  return `repopilot_it_${process.pid}_${Date.now().toString(36)}_${seq++}`;
}

function makeQueue(
  queueName: string,
  overrides: Partial<Pick<PgBossAuditQueueDeps, 'runOne' | 'consume' | 'retryLimit'>> = {},
): PgBossAuditQueue {
  return new PgBossAuditQueue({
    connectionString: URL,
    queueName,
    runOne: overrides.runOne ?? (async () => undefined),
    concurrency: 1,
    retryLimit: overrides.retryLimit ?? 1,
    expireInSeconds: 60,
    consume: overrides.consume,
  });
}

IT('PgBossAuditQueue (live Postgres)', () => {
  it('delivers an enqueued job to runOne, once', async () => {
    const seen: string[] = [];
    const q = makeQueue(uniqueQueueName(), {
      runOne: async (jobId) => {
        seen.push(jobId);
      },
    });
    await q.start();
    try {
      const result = await q.enqueue({ jobId: 'job_delivered' });
      expect(result.jobId).toBe('job_delivered');
      expect(result.accepted).toBe(true);

      await waitFor(() => seen.length >= 1, 'runOne to be called');

      // The handler resolved, so pg-boss marks the job completed and must not
      // hand it out again. Give it a window to prove that.
      await sleep(1_500);
      expect(seen).toEqual(['job_delivered']);
    } finally {
      await q.stop();
    }
  }, 40_000);

  it('retries a failed job up to retryLimit, then stops', async () => {
    const attempts: number[] = [];
    const q = makeQueue(uniqueQueueName(), {
      retryLimit: 1,
      runOne: async () => {
        attempts.push(Date.now());
        throw new Error('deliberate failure');
      },
    });
    await q.start();
    try {
      await q.enqueue({ jobId: 'job_retry' });

      // retryLimit is "number of times a job is allowed to be retried", so 1
      // means two attempts in total. The queue sets retryDelay=5, hence the
      // generous window.
      await waitFor(() => attempts.length >= 2, 'the first retry', 25_000);

      // And then it must stop. Two more retry windows go by with nothing.
      const afterRetries = attempts.length;
      await sleep(12_000);
      expect(attempts.length).toBe(afterRetries);
      expect(attempts.length).toBeLessThanOrEqual(2);
    } finally {
      await q.stop();
    }
  }, 60_000);

  it('enqueues from a consume:false instance and lets a consuming instance run it', async () => {
    // This is the split deployment: the API process constructs the queue to
    // enqueue and never consumes (`REPOPILOT_API_MODE=http`), the worker
    // process is the sole consumer. If `consume: false` were ignored, both
    // would poll the same queue — the failure mode the flag exists to stop.
    const queueName = uniqueQueueName();
    const seen: string[] = [];
    const apiSide = makeQueue(queueName, {
      consume: false,
      runOne: async () => {
        seen.push('API-SIDE-MUST-NOT-RUN');
      },
    });
    const workerSide = makeQueue(queueName, {
      runOne: async (jobId) => {
        seen.push(jobId);
      },
    });

    await apiSide.start();
    try {
      const result = await apiSide.enqueue({ jobId: 'job_split' });
      expect(result.accepted).toBe(true);

      // Nothing consumes it yet.
      await sleep(3_000);
      expect(seen).toEqual([]);

      // Now the worker side attaches and picks up the job the API side queued.
      await workerSide.start();
      try {
        await waitFor(() => seen.length >= 1, 'the worker side to consume the job');
        expect(seen).toEqual(['job_split']);
      } finally {
        await workerSide.stop();
      }
    } finally {
      await apiSide.stop();
    }
  }, 60_000);

  it('refuses to enqueue before start and after stop', async () => {
    const q = makeQueue(uniqueQueueName());

    await expect(q.enqueue({ jobId: 'job_too_early' })).rejects.toThrow(/before start/i);

    await q.start();
    await q.stop();

    await expect(q.enqueue({ jobId: 'job_too_late' })).rejects.toThrow(/before start|shutting down/i);
  }, 40_000);

  it('reports health as unavailable until started, then ok, then unavailable', async () => {
    const q = makeQueue(uniqueQueueName());

    const before = await q.health();
    expect(before.driver).toBe('pg-boss');
    expect(before.status).toBe('unavailable');
    expect(before.acceptingJobs).toBe(false);

    await q.start();
    try {
      const during = await q.health();
      expect(during.driver).toBe('pg-boss');
      // 'ok' on a reachable queue; 'degraded' only if the stats probe failed.
      expect(['ok', 'degraded']).toContain(during.status);
      expect(during.acceptingJobs).toBe(true);
    } finally {
      await q.stop();
    }

    const after = await q.health();
    expect(after.status).toBe('unavailable');
    expect(after.acceptingJobs).toBe(false);
  }, 40_000);
});
