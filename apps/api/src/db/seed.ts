/**
 * Seeds the database with one example audit job. Useful for the admin UI.
 *
 * The example used to be `okx/repopilot`, which is not a repository that has
 * ever existed: the seeded job failed the moment the worker tried to fetch it,
 * which is the opposite of useful for a row whose purpose is to be looked at.
 * It is now a real repository, the same one the web form opens on.
 */
import { openDatabase, runMigrations, closeDatabase } from './client.js';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { JobRepository } from '../repositories/job-repository.js';
import { JobService } from '../services/job-service.js';
import { MockPaymentAdapter } from '@repopilot/okx-adapter';

/** A real repository. See the note above for why this is not a placeholder. */
const EXAMPLE_REPO_URL = 'https://github.com/pinojs/pino';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_URL);
  await runMigrations(db);
  const repo = new JobRepository(db);
  const service = new JobService(repo, new MockPaymentAdapter());
  const job = await service.create({
    repoUrl: EXAMPLE_REPO_URL,
    mode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    includeLaunchCopy: true,
  });
  logger.info({ jobId: job.jobId, mode: db.mode }, 'Seeded job');
  await closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
