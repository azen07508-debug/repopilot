/**
 * Seeds the database with one example audit job. Useful for the admin UI.
 */
import { openDatabase, runMigrations, closeDatabase } from './client.js';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { JobRepository } from '../repositories/job-repository.js';
import { JobService } from '../services/job-service.js';
import { AuditPipeline } from '@repopilot/core';
import { MockPaymentAdapter } from '@repopilot/okx-adapter';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_URL);
  await runMigrations(db);
  const repo = new JobRepository(db);
  const pipeline = new AuditPipeline({
    githubToken: cfg.GITHUB_TOKEN,
    allowedHosts: cfg.ALLOWED_REPO_HOSTS,
  });
  const service = new JobService(repo, pipeline, new MockPaymentAdapter());
  const job = await service.create({
    repoUrl: 'https://github.com/okx/repopilot',
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
