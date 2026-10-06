/**
 * `NonceRepository` — the durable half of the R-40 fix.
 *
 * The adapter-level half is in `packages/okx-adapter/src/okx-adapter.test.ts`,
 * where a signed envelope can actually be produced. What cannot be tested
 * there is the thing that makes the record durable: the *statement*.
 *
 * `burn()` is `INSERT ... ON CONFLICT DO NOTHING` and reports whether the
 * insert happened, rather than `SELECT` then `INSERT`. The difference is not
 * style — it is the difference between one winner and several. So the tests
 * here are about the driver's report, on both drivers.
 *
 * The Postgres half is skipped unless `DATABASE_URL` points at Postgres, the
 * same gate `postgres.integration.test.ts` and `pg-boss.integration.test.ts`
 * use. It is the half that matters for concurrency: `pg.Pool` opens up to ten
 * connections, so burns can genuinely race inside the server — but only once
 * the pool is warm, which is the part that is easy to get wrong and is
 * explained at the case itself. `better-sqlite3` is synchronous — a `burn()`
 * call runs to completion before the next one starts — so the SQLite case
 * below proves the statement's semantics and cannot prove anything about
 * interleaving.
 *
 * Both halves are mutation-checked. Replacing `ON CONFLICT DO NOTHING` with
 * `SELECT` then `INSERT` fails the Postgres case 3/3 (see the case comment).
 * Replacing `INSERT OR IGNORE` with a plain `INSERT` fails the first SQLite
 * case, which is the point of asserting `false` rather than "no row": a plain
 * `INSERT` on the second call throws the unique violation instead of answering
 * `false`, and a route that propagates it answers 500 to a replay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openIsolatedSqlite, openDatabase, runMigrations, closeDatabase, type DB } from '../db/client.js';
import { NonceRepository } from '../repositories/nonce-repository.js';

const URL = process.env['DATABASE_URL'] ?? '';
const IS_PG = URL.startsWith('postgres://') || URL.startsWith('postgresql://');
const IT = IS_PG ? describe : describe.skip;

describe('NonceRepository — SQLite', () => {
  let db: DB;
  let repo: NonceRepository;

  beforeAll(async () => {
    // `:memory:` and not a file. This suite asserts `burn()` returns `true` for
    // keys it names, and a file-backed database keeps those rows between runs —
    // so the second `pnpm test` would see every key already burned and report
    // the guard as broken. The guard would be working exactly as designed.
    db = openIsolatedSqlite('file::memory:');
    await runMigrations(db);
    repo = new NonceRepository(db);
  });

  afterAll(() => {
    if (db.mode === 'sqlite') db.raw.close();
  });

  it('claims a key on the first call and refuses every call after it', async () => {
    expect(await repo.burn('0xaaa:0x1')).toBe(true);
    expect(await repo.burn('0xaaa:0x1')).toBe(false);
    expect(await repo.burn('0xaaa:0x1')).toBe(false);
  });

  it('keeps distinct keys independent', async () => {
    // The guard keys on the authorization, not on the buyer: one buyer running
    // two audits signs twice, with two nonces, and both must be accepted.
    expect(await repo.burn('0xbbb:0x2')).toBe(true);
    expect(await repo.burn('0xbbb:0x3')).toBe(true);
    expect(await repo.burn('0xccc:0x2')).toBe(true);
  });

  it('survives a second repository on the same database', async () => {
    // "A restart" is a new object graph over the same file. This is the
    // property the in-process `Set` did not have.
    const other = new NonceRepository(db);
    expect(await repo.burn('0xeee:0x5')).toBe(true);
    expect(await other.burn('0xeee:0x5')).toBe(false);
  });
});

IT('NonceRepository — live Postgres', () => {
  let db: DB;
  let repo: NonceRepository;

  beforeAll(async () => {
    db = openDatabase(URL);
    expect(db.mode).toBe('pg');
    await runMigrations(db);
    repo = new NonceRepository(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  /** Unique per run so a reused database does not carry state between runs. */
  const key = (n: string): string => `0xpg_${Date.now()}_${n}:0x1`;

  it('claims a key on the first call and refuses every call after it', async () => {
    const k = key('once');
    expect(await repo.burn(k)).toBe(true);
    expect(await repo.burn(k)).toBe(false);
  });

  it('gives a concurrent burst exactly one winner', async () => {
    // === THE WARM-UP IS LOAD-BEARING ==================================
    // A cold `pg.Pool` has no connections. Ten `Promise.all` burns on a cold
    // pool do **not** race: the pool establishes connections as the event loop
    // reaches them, and each new connection's queued work runs to completion
    // before the next connection is ready. Measured — a `SELECT`-then-`INSERT`
    // implementation passed this test 3/3 with the warm-up removed, and failed
    // 3/3 with it, on
    // `duplicate key value violates unique constraint "burned_nonces_pkey"`.
    // That error is the proof the race is real: two SELECTs both read "no row"
    // and both tried to insert.
    //
    // Ten distinct keys, so the warm-up is implementation-agnostic and cannot
    // itself depend on the property under test.
    // ==================================================================
    await Promise.all(Array.from({ length: 10 }, (_, i) => repo.burn(`${key('warm')}_${i}`)));

    const k = key('race');
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.burn(k)));
    // Exactly one. `SELECT` then `INSERT` lets several of these through, and
    // every extra `true` here is a second audit bought with one signature.
    //
    // The assertion is one-sided on purpose: if the warm-up ever fails to
    // produce a real race, this goes quietly green rather than red — a weaker
    // check, but never a false failure. A racy implementation can only lose
    // the race later.
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('survives a second repository on the same database', async () => {
    const k = key('restart');
    expect(await repo.burn(k)).toBe(true);
    expect(await new NonceRepository(db).burn(k)).toBe(false);
  });
});
