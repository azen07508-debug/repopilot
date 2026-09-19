/**
 * Postgres schema for the jobs table.
 *
 * This is the SECOND of two schema files (see `schema.sqlite.ts`). We do not
 * pretend a single Drizzle table works on both backends; the column types
 * are deliberately different (JSONB + TIMESTAMPTZ here, TEXT on SQLite).
 *
 * The repository layer is the only consumer of `JobRow`; routes and services
 * always go through the repository. If you add a column, add it to BOTH
 * schema files and to both migration paths in `migrate.ts`.
 */
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const jobs = pgTable(
  'jobs',
  {
    jobId: text('job_id').primaryKey(),
    status: text('status').notNull(),
    inputJson: jsonb('input_json').notNull(),
    reportJson: jsonb('report_json'),
    paymentId: text('payment_id'),
    error: text('error'),
    attempts: text('attempts').notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'string' }),
    errorCode: text('error_code'),
    idempotencyKey: text('idempotency_key'),
    cacheJson: jsonb('cache_json'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => ({
    statusIdx: index('idx_jobs_status').on(t.status),
    createdIdx: index('idx_jobs_created').on(t.createdAt),
    paymentIdIdx: uniqueIndex('uq_jobs_payment_id').on(t.paymentId),
    idempotencyKeyIdx: uniqueIndex('uq_jobs_idempotency_key').on(t.idempotencyKey),
  }),
);

export type PgJobRow = typeof jobs.$inferSelect;
export type PgNewJobRow = typeof jobs.$inferInsert;
