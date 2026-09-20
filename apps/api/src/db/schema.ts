/**
 * SQLite schema for the jobs table.
 *
 * This is the FIRST of two schema files (see `schema.pg.ts`). We do not
 * pretend a single Drizzle table works on both backends; the column types
 * are deliberately different (TEXT here, JSONB + TIMESTAMPTZ on Postgres).
 *
 * The repository layer is the only consumer of `JobRow`; routes and services
 * always go through the repository. If you add a column, add it to BOTH
 * schema files and to both migration paths in `migrate.ts`.
 */
import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable(
  'jobs',
  {
    jobId: text('job_id').primaryKey(),
    status: text('status').notNull(),
    inputJson: text('input_json').notNull(),
    reportJson: text('report_json'),
    paymentId: text('payment_id'),
    error: text('error'),
    attempts: text('attempts').notNull().default('0'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    failedAt: text('failed_at'),
    errorCode: text('error_code'),
    idempotencyKey: text('idempotency_key'),
    cacheJson: text('cache_json'),
    // Repository identity, promoted out of `input_json` so audit history
    // and before/after comparison can be queried without scanning every
    // row. Nullable on purpose: rows written before this migration keep
    // NULL and are simply not returned by history queries.
    owner: text('owner'),
    repo: text('repo'),
    commitSha: text('commit_sha'),
    mode: text('mode'),
    target: text('target'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    statusIdx: index('idx_jobs_status').on(t.status),
    createdIdx: index('idx_jobs_created').on(t.createdAt),
    paymentIdIdx: uniqueIndex('uq_jobs_payment_id').on(t.paymentId),
    idempotencyKeyIdx: uniqueIndex('uq_jobs_idempotency_key').on(t.idempotencyKey),
    repoHistoryIdx: index('idx_jobs_owner_repo_created').on(t.owner, t.repo, t.createdAt),
    commitShaIdx: index('idx_jobs_commit_sha').on(t.commitSha),
  }),
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
