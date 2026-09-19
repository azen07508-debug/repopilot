/**
 * Database setup. We support two backends:
 *
 *   * SQLite (better-sqlite3) — local dev, small self-hosted installs.
 *     `DATABASE_URL=file:./data/repopilot.db`
 *   * Postgres (pg) — production. `DATABASE_URL=postgres://...`
 *
 * The two backends have **separate** schema files and migration paths. The
 * repository layer in `job-repository.ts` is the single point of access; it
 * accepts a tagged-union `DB` value and dispatches to the right driver
 * based on the URL prefix.
 *
 * Do not pretend one Drizzle table works on both; JSONB / TIMESTAMPTZ
 * idioms on Postgres are different from TEXT on SQLite, and we keep the
 * two schema files honest about that.
 */
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import * as schemaSqlite from './schema.js';
import * as schemaPg from './schema.pg.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ name: 'repopilot-db' });

export type DbMode = 'sqlite' | 'pg';

export interface SqliteHandle {
  mode: 'sqlite';
  db: ReturnType<typeof drizzleSqlite<typeof schemaSqlite>>;
  raw: Database.Database;
}

export interface PgHandle {
  mode: 'pg';
  db: ReturnType<typeof drizzlePg<typeof schemaPg>>;
  pool: pg.Pool;
}

export type DB = SqliteHandle | PgHandle;

export function detectMode(url: string): DbMode {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'pg';
  }
  return 'sqlite';
}

let cached: DB | null = null;

export function openDatabase(url: string): DB {
  if (cached) return cached;
  const mode = detectMode(url);
  if (mode === 'sqlite') {
    const path = url.replace(/^file:/, '');
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    const sqlite = new Database(path);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    cached = {
      mode: 'sqlite',
      db: drizzleSqlite(sqlite, { schema: schemaSqlite }),
      raw: sqlite,
    };
    return cached;
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  cached = {
    mode: 'pg',
    db: drizzlePg(pool, { schema: schemaPg }),
    pool,
  };
  return cached;
}

/**
 * Open a brand-new SQLite database, bypassing the module-level cache
 * used by `openDatabase`. Intended for unit tests that need a
 * hermetic database per case.
 */
export function openIsolatedSqlite(url: string): DB {
  const path = url.replace(/^file:/, '');
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return {
    mode: 'sqlite',
    db: drizzleSqlite(sqlite, { schema: schemaSqlite }),
    raw: sqlite,
  };
}

export async function closeDatabase(): Promise<void> {
  if (!cached) return;
  if (cached.mode === 'pg') {
    await cached.pool.end();
  } else {
    cached.raw.close();
  }
  cached = null;
}

/**
 * Apply schema migrations. SQLite: synchronous (better-sqlite3 is sync).
 * Postgres: async (one statement at a time, awaited).
 *
 * The CREATE statements are kept **deliberately identical** at the column
 * name level (job_id, status, etc.) so application code does not need to
 * know which backend is in use. Only the storage class differs.
 */
export async function runMigrations(db: DB): Promise<void> {
  if (db.mode === 'sqlite') {
    // better-sqlite3's `db.run` only supports a single statement per call.
    db.raw.exec(`BEGIN`);
    try {
      db.raw.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          report_json TEXT,
          payment_id TEXT,
          error TEXT,
          attempts TEXT NOT NULL DEFAULT '0',
          started_at TEXT,
          completed_at TEXT,
          failed_at TEXT,
          error_code TEXT,
          idempotency_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      // Idempotent column adds for upgrade-in-place. Each statement is
      // wrapped in a try/catch so re-running the migration is safe.
      const addCols = [
        `ALTER TABLE jobs ADD COLUMN attempts TEXT NOT NULL DEFAULT '0'`,
        `ALTER TABLE jobs ADD COLUMN started_at TEXT`,
        `ALTER TABLE jobs ADD COLUMN completed_at TEXT`,
        `ALTER TABLE jobs ADD COLUMN failed_at TEXT`,
        `ALTER TABLE jobs ADD COLUMN error_code TEXT`,
        `ALTER TABLE jobs ADD COLUMN idempotency_key TEXT`,
        `ALTER TABLE jobs ADD COLUMN cache_json TEXT`,
      ];
      for (const stmt of addCols) {
        try {
          db.raw.exec(stmt);
        } catch (err) {
          // Column already exists. The schema is idempotent.
          const msg = (err as Error)?.message ?? 'unknown';
          log.debug({ stmt, err: msg }, 'alter table: column may already exist');
        }
      }
      db.raw.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
      db.raw.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)`);
      db.raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_payment_id ON jobs(payment_id) WHERE payment_id IS NOT NULL`);
      db.raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);
      db.raw.exec(`
        CREATE TABLE IF NOT EXISTS report_cache (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          key_version TEXT NOT NULL,
          report TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          hits INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_report_cache_key ON report_cache(key, key_version)`);
      db.raw.exec(`CREATE INDEX IF NOT EXISTS idx_report_cache_expires ON report_cache(expires_at)`);
      db.raw.exec(`COMMIT`);
    } catch (e) {
      db.raw.exec(`ROLLBACK`);
      throw e;
    }
    return;
  }
  // Postgres path. Use the pool directly so we don't depend on Drizzle's
  // SQL builder here (we want plain SQL so reviewers can copy-paste it into
  // psql for debugging).
  const client = await db.pool.connect();
  try {
    await client.query(`BEGIN`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        input_json JSONB NOT NULL,
        report_json JSONB,
        payment_id TEXT,
        error TEXT,
        attempts TEXT NOT NULL DEFAULT '0',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        error_code TEXT,
        idempotency_key TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    // Idempotent column adds for upgrade-in-place. Each statement is
    // wrapped in a try/catch so re-running the migration is safe.
    const addCols = [
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts TEXT NOT NULL DEFAULT '0'`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS error_code TEXT`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cache_json JSONB`,
    ];
    for (const stmt of addCols) {
      try {
        await client.query(stmt);
      } catch (err) {
        // Column already exists. The schema is idempotent.
        const msg = (err as Error)?.message ?? 'unknown';
        log.debug({ stmt, err: msg }, 'alter table: column may already exist');
      }
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_payment_id ON jobs(payment_id) WHERE payment_id IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS report_cache (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        key_version TEXT NOT NULL,
        report JSONB NOT NULL,
        commit_sha TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_report_cache_key ON report_cache(key, key_version)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_report_cache_expires ON report_cache(expires_at)`);
    await client.query(`COMMIT`);
  } catch (e) {
    await client.query(`ROLLBACK`).catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
