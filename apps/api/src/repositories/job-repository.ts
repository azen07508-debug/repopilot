/**
 * Job repository — typed CRUD on top of Drizzle.
 *
 * Supports both the SQLite backend (better-sqlite3, sync API) and the
 * Postgres backend (node-postgres, async API). The repository abstracts
 * over both with an `async` interface; SQLite calls complete in <1 ms
 * but are still awaited.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
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
}

export class JobRepository {
  constructor(private db: DB) {}

  async insert(job: AuditJob): Promise<void> {
    const inputJson = JSON.stringify(job.input);
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
    cache: cacheField,
  };
}
