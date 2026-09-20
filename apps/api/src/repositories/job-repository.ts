/**
 * Job repository — typed CRUD on top of Drizzle.
 *
 * Supports both the SQLite backend (better-sqlite3, sync API) and the
 * Postgres backend (node-postgres, async API). The repository abstracts
 * over both with an `async` interface; SQLite calls complete in <1 ms
 * but are still awaited.
 */
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { jobs as jobsSqlite, type JobRow as JobRowSqlite } from '../db/schema.js';
import { jobs as jobsPg, type PgJobRow } from '../db/schema.pg.js';
import type { DB } from '../db/client.js';
import type { AuditJob, CreateAuditInput, Report } from '@repopilot/core';

type AnyJobRow = JobRowSqlite | PgJobRow;

export interface JobLifecyclePatch {
  status?: AuditJob['status'];
  report?: Report | null;
  paymentId?: string | null;
  error?: string | null;
  errorCode?: string | null;
  attempts?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  idempotencyKey?: string | null;
  cacheJson?: string | null;
  commitSha?: string | null;
}

/**
 * Repository identity, supplied by the caller that already parsed the
 * URL. The repository never parses `repoUrl` itself — host allow-listing
 * must stay in one place (`parseRepoUrl`).
 *
 * `mode` and `target` are read off `job.input`, so only owner/repo are
 * required here.
 */
export interface JobRepoIdentity {
  owner: string;
  repo: string;
}

export class JobRepository {
  constructor(private db: DB) {}

  async insert(job: AuditJob, identity?: JobRepoIdentity): Promise<void> {
    const inputJson = JSON.stringify(job.input);
    // Nullable by design: a caller that has no parsed identity leaves the
    // history columns NULL, and history queries simply skip those rows.
    const owner = identity?.owner ?? null;
    const repo = identity?.repo ?? null;
    const mode = job.input.mode ?? null;
    const target = job.input.target ?? null;
    if (this.db.mode === 'sqlite') {
      this.db.db.insert(jobsSqlite)
        .values({
          jobId: job.jobId,
          status: job.status,
          inputJson,
          reportJson: null,
          paymentId: job.paymentId,
          error: job.error,
          attempts: '0',
          startedAt: null,
          completedAt: null,
          failedAt: null,
          errorCode: null,
          idempotencyKey: null,
          cacheJson: null,
          owner,
          repo,
          commitSha: null,
          mode,
          target,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
        .run();
      return;
    }
    await this.db.db.insert(jobsPg)
      .values({
        jobId: job.jobId,
        status: job.status,
        inputJson,
        reportJson: null,
        paymentId: job.paymentId,
        error: job.error,
        attempts: '0',
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        idempotencyKey: null,
        cacheJson: null,
        owner,
        repo,
        commitSha: null,
        mode,
        target,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })
      .execute();
  }

  /**
   * Update a job. Status changes can be guarded by `expectedStatus` so the
   * state machine (queued -> processing -> completed | failed) cannot be
   * corrupted by concurrent worker invocations.
   */
  async update(
    jobId: string,
    patch: JobLifecyclePatch,
    expectedStatus?: AuditJob['status'],
  ): Promise<{ updated: boolean }> {
    const updatedAt = new Date().toISOString();
    if (this.db.mode === 'sqlite') {
      const updates: Partial<JobRowSqlite> = { updatedAt };
      if (patch.status !== undefined) updates.status = patch.status;
      if (patch.report !== undefined) updates.reportJson = patch.report ? JSON.stringify(patch.report) : null;
      if (patch.paymentId !== undefined) updates.paymentId = patch.paymentId;
      if (patch.error !== undefined) updates.error = patch.error;
      if (patch.errorCode !== undefined) updates.errorCode = patch.errorCode;
      if (patch.attempts !== undefined) updates.attempts = String(patch.attempts);
      if (patch.startedAt !== undefined) updates.startedAt = patch.startedAt;
      if (patch.completedAt !== undefined) updates.completedAt = patch.completedAt;
      if (patch.failedAt !== undefined) updates.failedAt = patch.failedAt;
      if (patch.idempotencyKey !== undefined) updates.idempotencyKey = patch.idempotencyKey;
      if (patch.cacheJson !== undefined) updates.cacheJson = patch.cacheJson;
      if (patch.commitSha !== undefined) updates.commitSha = patch.commitSha;

      const where = expectedStatus
        ? and(eq(jobsSqlite.jobId, jobId), eq(jobsSqlite.status, expectedStatus))
        : eq(jobsSqlite.jobId, jobId);
      const result = this.db.db.update(jobsSqlite).set(updates).where(where).run();
      return { updated: result.changes > 0 };
    }
    const updates: Partial<PgJobRow> = { updatedAt };
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.report !== undefined) updates.reportJson = patch.report ? (patch.report as unknown as object) : null;
    if (patch.paymentId !== undefined) updates.paymentId = patch.paymentId;
    if (patch.error !== undefined) updates.error = patch.error;
    if (patch.errorCode !== undefined) updates.errorCode = patch.errorCode;
    if (patch.attempts !== undefined) updates.attempts = String(patch.attempts);
    if (patch.startedAt !== undefined) updates.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) updates.completedAt = patch.completedAt;
    if (patch.failedAt !== undefined) updates.failedAt = patch.failedAt;
    if (patch.idempotencyKey !== undefined) updates.idempotencyKey = patch.idempotencyKey;
    if (patch.cacheJson !== undefined) updates.cacheJson = patch.cacheJson;
    if (patch.commitSha !== undefined) updates.commitSha = patch.commitSha;

    const conditions = expectedStatus
      ? and(eq(jobsPg.jobId, jobId), eq(jobsPg.status, expectedStatus))
      : eq(jobsPg.jobId, jobId);
    const setSql = this.db.db.update(jobsPg).set(updates).where(conditions);
    const result = await setSql.execute();
    return { updated: (result.rowCount ?? 0) > 0 };
  }

  async findById(jobId: string): Promise<AuditJob | null> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.db.select().from(jobsSqlite).where(eq(jobsSqlite.jobId, jobId)).get();
      return row ? rowToJob(row) : null;
    }
    const rows = await this.db.db.select().from(jobsPg).where(eq(jobsPg.jobId, jobId)).limit(1);
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }

  async findByPaymentId(paymentId: string): Promise<AuditJob | null> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.db.select().from(jobsSqlite).where(eq(jobsSqlite.paymentId, paymentId)).get();
      return row ? rowToJob(row) : null;
    }
    const rows = await this.db.db.select().from(jobsPg).where(eq(jobsPg.paymentId, paymentId)).limit(1);
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<AuditJob | null> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.db.select().from(jobsSqlite).where(eq(jobsSqlite.idempotencyKey, key)).get();
      return row ? rowToJob(row) : null;
    }
    const rows = await this.db.db.select().from(jobsPg).where(eq(jobsPg.idempotencyKey, key)).limit(1);
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }

  async list(limit = 50): Promise<AuditJob[]> {
    if (this.db.mode === 'sqlite') {
      return this.db.db
        .select()
        .from(jobsSqlite)
        .all()
        .slice(-limit)
        .map(rowToJob);
    }
    const rows = await this.db.db.select().from(jobsPg).limit(limit);
    return rows.map(rowToJob);
  }

  /**
   * Audit history for one repository, newest first.
   *
   * Rows written before the identity columns existed carry NULL
   * owner/repo and are intentionally excluded rather than guessed at.
   */
  async listByRepo(owner: string, repo: string, limit = 20): Promise<AuditJob[]> {
    if (this.db.mode === 'sqlite') {
      return this.db.db
        .select()
        .from(jobsSqlite)
        .where(and(eq(jobsSqlite.owner, owner), eq(jobsSqlite.repo, repo)))
        .orderBy(desc(jobsSqlite.createdAt))
        .limit(limit)
        .all()
        .map(rowToJob);
    }
    const rows = await this.db.db
      .select()
      .from(jobsPg)
      .where(and(eq(jobsPg.owner, owner), eq(jobsPg.repo, repo)))
      .orderBy(desc(jobsPg.createdAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  /**
   * Completed jobs that actually carry a report, newest first.
   *
   * This is the data source for before/after comparison: two entries
   * from this list are enough to build an AuditDiff without touching
   * the repository again.
   */
  async listCompletedByRepo(owner: string, repo: string, limit = 20): Promise<AuditJob[]> {
    if (this.db.mode === 'sqlite') {
      return this.db.db
        .select()
        .from(jobsSqlite)
        .where(
          and(
            eq(jobsSqlite.owner, owner),
            eq(jobsSqlite.repo, repo),
            eq(jobsSqlite.status, 'completed'),
            isNotNull(jobsSqlite.reportJson)
          )
        )
        .orderBy(desc(jobsSqlite.createdAt))
        .limit(limit)
        .all()
        .map(rowToJob);
    }
    const rows = await this.db.db
      .select()
      .from(jobsPg)
      .where(
        and(
          eq(jobsPg.owner, owner),
          eq(jobsPg.repo, repo),
          eq(jobsPg.status, 'completed'),
          isNotNull(jobsPg.reportJson)
        )
      )
      .orderBy(desc(jobsPg.createdAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  /** The most recent job recorded against an exact commit. */
  async findByCommitSha(owner: string, repo: string, commitSha: string): Promise<AuditJob | null> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.db
        .select()
        .from(jobsSqlite)
        .where(
          and(
            eq(jobsSqlite.owner, owner),
            eq(jobsSqlite.repo, repo),
            eq(jobsSqlite.commitSha, commitSha)
          )
        )
        .orderBy(desc(jobsSqlite.createdAt))
        .limit(1)
        .all()[0];
      return row ? rowToJob(row) : null;
    }
    const rows = await this.db.db
      .select()
      .from(jobsPg)
      .where(
        and(
          eq(jobsPg.owner, owner),
          eq(jobsPg.repo, repo),
          eq(jobsPg.commitSha, commitSha)
        )
      )
      .orderBy(desc(jobsPg.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }
}

function rowToJob(row: AnyJobRow): AuditJob {
  // JSON columns can come back as either a string (SQLite) or already-parsed
  // (Postgres JSONB). Normalise here.
  const inputRaw = (row as { inputJson: unknown }).inputJson;
  const reportRaw = (row as { reportJson: unknown }).reportJson;
  const errorCodeRaw = (row as { errorCode?: string | null }).errorCode ?? null;
  const startedAtRaw = (row as { startedAt?: string | null }).startedAt ?? null;
  const completedAtRaw = (row as { completedAt?: string | null }).completedAt ?? null;
  const failedAtRaw = (row as { failedAt?: string | null }).failedAt ?? null;
  const attemptsRaw = (row as { attempts?: number | string }).attempts ?? 0;
  const idempotencyKeyRaw = (row as { idempotencyKey?: string | null }).idempotencyKey ?? null;
  const commitShaRaw = (row as { commitSha?: string | null }).commitSha ?? null;
  const cacheRaw = (row as { cacheJson?: string | null | object }).cacheJson ?? null;
  let cacheField: { hit: boolean; keyVersion: string; expiresAt: string | null } | null = null;
  if (cacheRaw !== null && cacheRaw !== undefined && cacheRaw !== '') {
    const parsed = typeof cacheRaw === 'string' ? (JSON.parse(cacheRaw) as { hit: boolean; keyVersion: string; expiresAt: string | null }) : (cacheRaw as { hit: boolean; keyVersion: string; expiresAt: string | null });
    cacheField = {
      hit: Boolean(parsed.hit),
      keyVersion: String(parsed.keyVersion ?? 'v1'),
      expiresAt: parsed.expiresAt ?? null,
    };
  }
  return {
    jobId: row.jobId,
    status: row.status as AuditJob['status'],
    input: typeof inputRaw === 'string' ? (JSON.parse(inputRaw) as CreateAuditInput) : (inputRaw as CreateAuditInput),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paymentId: row.paymentId,
    report: reportRaw === null || reportRaw === undefined
      ? null
      : typeof reportRaw === 'string'
        ? (JSON.parse(reportRaw) as Report)
        : (reportRaw as Report),
    error: row.error,
    errorCode: errorCodeRaw,
    startedAt: startedAtRaw,
    completedAt: completedAtRaw,
    failedAt: failedAtRaw,
    attempts: typeof attemptsRaw === 'string' ? Number(attemptsRaw) : attemptsRaw,
    idempotencyKey: idempotencyKeyRaw,
    commitSha: commitShaRaw,
    cache: cacheField,
  };
}
