/**
 * The real fixtures, loaded once.
 *
 * `docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.2 asks for fixtures before
 * algorithms, and `fixtures/` is the only repository this suite can reach
 * without a network. Three test files had grown their own copy of this walk —
 * each with its own guess at how many `..` reach the root — so it lives here
 * now, and the number of `..` is counted once.
 *
 * The `generatedAt` constant exists because every artifact carries a
 * timestamp: a builder that reads the clock cannot be snapshotted, and a
 * snapshot that moves is not a snapshot.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEntry } from '../git/files.js';
import type { RepoMetadata } from '../analyzers/metadata.js';

/** `packages/core/src/test-utils/` → `fixtures/`. */
export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures'
);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** Above this a fixture file is listed but not read, as the fetcher does. */
const MAX_FIXTURE_FILE_BYTES = 200_000;

/** The timestamp every artifact in a test is built with. */
export const GENERATED_AT = '2026-09-28T00:00:00.000Z';

export interface Fixture {
  entries: FileEntry[];
  contents: Map<string, string>;
}

export function loadFixture(name: string): Fixture {
  const root = join(FIXTURES_DIR, name);
  const entries: FileEntry[] = [];
  const contents = new Map<string, string>();

  function walk(dir: string): void {
    for (const child of readdirSync(dir)) {
      if (child === '.DS_Store') continue;
      const full = join(dir, child);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(child)) walk(full);
        continue;
      }
      const path = relative(root, full).replace(/\\/g, '/');
      entries.push({ path, size: stat.size });
      if (stat.size < MAX_FIXTURE_FILE_BYTES) contents.set(path, readFileSync(full, 'utf8'));
    }
  }

  walk(root);
  return { entries, contents };
}

/** Every fixture, sorted, so a snapshot list does not depend on readdir order. */
export const FIXTURE_NAMES: string[] = readdirSync(FIXTURES_DIR)
  .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory())
  .sort();

/**
 * Repository metadata for a fixture.
 *
 * A fixture on disk has no GitHub API response behind it, so these fields are
 * invented — and invented the same way every time, because the Repository Map
 * reports them verbatim and a snapshot that moved would be a snapshot of the
 * invention rather than of the map.
 */
export function metadataFor(name: string): RepoMetadata {
  return {
    owner: 'repopilot',
    name,
    defaultBranch: 'main',
    license: null,
    lastUpdatedAt: null,
    visibility: 'public',
    archived: false,
    stars: 0,
    openIssues: 0,
    openPulls: 0,
    description: null,
    primaryLanguage: null,
    url: `https://github.com/repopilot/${name}`,
  };
}
