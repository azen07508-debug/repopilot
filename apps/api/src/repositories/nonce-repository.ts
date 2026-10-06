/**
 * NonceRepository — the durable `NonceStore`.
 *
 * `OkxPaymentAdapter` burns a buyer's `(from, nonce)` pair on first use, so one
 * signed authorization buys one audit. While that record lived in the process,
 * a restart — or a second replica — forgot it and the same signature worked
 * again (R-40). This is the version that survives both, because it lives in
 * the database the service already runs on.
 *
 * `burn` is a single statement and the statement is the test. A `SELECT`
 * followed by an `INSERT` leaves a window in which two concurrent requests
 * both read "not burned" and both insert; `ON CONFLICT DO NOTHING` makes the
 * insert itself the comparison and has the driver report whether it happened
 * (`changes` / `rowCount`). That is why this is a method on a repository
 * rather than a lookup plus an insert at the call site.
 *
 * **Rows are never deleted, on purpose.** An authorization cannot be replayed
 * after its `validBefore` regardless — `verifyEip3009` rejects a closed window
 * before the store is consulted — so a pruning job would only be removing rows
 * that are already inert. One row per paid audit is tens of bytes, which is
 * not a growth problem worth a scheduler. If that stops being true, the
 * `burned_at` column is what a retention rule would read.
 */
import type { NonceStore } from '@repopilot/okx-adapter';
import type { DB } from '../db/client.js';

export class NonceRepository implements NonceStore {
  constructor(private readonly db: DB) {}

  async burn(key: string): Promise<boolean> {
    const burnedAt = new Date().toISOString();
    if (this.db.mode === 'sqlite') {
      const r = this.db.raw
        .prepare(`INSERT OR IGNORE INTO burned_nonces (key, burned_at) VALUES (?, ?)`)
        .run(key, burnedAt);
      return Number(r.changes) > 0;
    }
    const r = await this.db.pool.query(
      `INSERT INTO burned_nonces (key, burned_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, burnedAt],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
