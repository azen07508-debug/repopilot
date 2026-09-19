/**
 * Migration runner. Schema is hand-rolled per-driver (see `schema.ts` and
 * `schema.pg.ts`); `runMigrations` in `client.ts` creates the right tables
 * for whichever backend `DATABASE_URL` points at.
 *
 * Usage: `pnpm db:migrate`
 */
import { openDatabase, runMigrations, closeDatabase } from './client.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_URL);
  await runMigrations(db);
  logger.info({ mode: db.mode, url: cfg.DATABASE_URL }, 'Migrations applied.');
  await closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err);
  process.exit(1);
});
