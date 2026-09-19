/**
 * ReportCacheRepository — persistent cache of finalized audit reports.
 *
 * Backed by the same `db` instance the rest of the app uses (SQLite or
 * Postgres), so the cache survives process restarts and is shared across
 * replicas that share the database.
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/client.js';

export interface ReportCacheRow {
  key: string;
  keyVersion: string;
  report: unknown;
  commitSha: string;
  createdAt: string;
  expiresAt: string;
  hits: number;
}

export class ReportCacheRepository {
  constructor(private readonly db: DB) {}

  async upsert(row: Omit<ReportCacheRow, 'createdAt' | 'hits'> & { createdAt?: string; hits?: number }): Promise<void> {
    const createdAt = row.createdAt ?? new Date().toISOString();
    const hits = row.hits ?? 0;
    const id = randomUUID();
    if (this.db.mode === 'sqlite') {
      this.db.raw
        .prepare(
          `INSERT INTO report_cache (id, key, key_version, report, commit_sha, created_at, expires_at, hits)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key, key_version) DO UPDATE SET
             report = excluded.report,
             commit_sha = excluded.commit_sha,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at,
             hits = 0`,
        )
        .run(id, row.key, row.keyVersion, JSON.stringify(row.report), row.commitSha, createdAt, row.expiresAt, hits);
    } else {
      await this.db.pool.query(
        `INSERT INTO report_cache (id, key, key_version, report, commit_sha, created_at, expires_at, hits)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (key, key_version) DO UPDATE SET
           report = EXCLUDED.report,
           commit_sha = EXCLUDED.commit_sha,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           hits = 0`,
        [id, row.key, row.keyVersion, JSON.stringify(row.report), row.commitSha, createdAt, row.expiresAt, hits],
      );
    }
  }

  async findByKey(key: string, keyVersion: string): Promise<ReportCacheRow | null> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.raw
        .prepare(
          `SELECT key, key_version as keyVersion, report, commit_sha as commitSha,
                  created_at as createdAt, expires_at as expiresAt, hits
             FROM report_cache
            WHERE key = ? AND key_version = ?`,
        )
        .get(key, keyVersion) as
        | (Omit<ReportCacheRow, 'report'> & { report: string })
        | undefined;
      if (!row) return null;
      if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
      return { ...row, report: JSON.parse(row.report) };
    }
    const r = await this.db.pool.query<{
      key: string;
      key_version: string;
      report: string;
      commit_sha: string;
      created_at: string;
      expires_at: string;
      hits: number;
    }>(
      `SELECT key, key_version, report, commit_sha, created_at, expires_at, hits
         FROM report_cache
        WHERE key = $1 AND key_version = $2`,
      [key, keyVersion],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0]!;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return {
      key: row.key,
      keyVersion: row.key_version,
      report: JSON.parse(row.report),
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      hits: row.hits,
    };
  }

  async incrementHits(key: string, keyVersion: string): Promise<void> {
    if (this.db.mode === 'sqlite') {
      this.db.raw.prepare(`UPDATE report_cache SET hits = hits + 1 WHERE key = ? AND key_version = ?`).run(key, keyVersion);
    } else {
      await this.db.pool.query(`UPDATE report_cache SET hits = hits + 1 WHERE key = $1 AND key_version = $2`, [
        key,
        keyVersion,
      ]);
    }
  }

  async deleteByKey(key: string, keyVersion: string): Promise<void> {
    if (this.db.mode === 'sqlite') {
      this.db.raw.prepare(`DELETE FROM report_cache WHERE key = ? AND key_version = ?`).run(key, keyVersion);
    } else {
      await this.db.pool.query(`DELETE FROM report_cache WHERE key = $1 AND key_version = $2`, [key, keyVersion]);
    }
  }

  async pruneExpired(): Promise<number> {
    const now = new Date().toISOString();
    if (this.db.mode === 'sqlite') {
      const r = this.db.raw.prepare(`DELETE FROM report_cache WHERE expires_at <= ?`).run(now);
      return Number(r.changes);
    }
    const r = await this.db.pool.query(`DELETE FROM report_cache WHERE expires_at <= $1`, [now]);
    return r.rowCount ?? 0;
  }

  async count(): Promise<number> {
    if (this.db.mode === 'sqlite') {
      const row = this.db.raw.prepare(`SELECT COUNT(*) as n FROM report_cache`).get() as { n: number };
      return row.n;
    }
    const r = await this.db.pool.query<{ n: string }>(`SELECT COUNT(*)::int as n FROM report_cache`);
    return Number(r.rows[0]?.n ?? 0);
  }
}
