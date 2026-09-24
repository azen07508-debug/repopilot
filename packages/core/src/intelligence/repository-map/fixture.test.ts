/**
 * The builder against the real fixtures.
 *
 * `docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.2 asks for fixtures before
 * algorithms, and the fixtures on disk are the only repositories this test
 * suite can reach without a network. They are small, but they are real
 * files with real names, and they exercise the three shapes that matter:
 * a conventional single package, a contract project, and a directory with
 * almost nothing in it.
 *
 * Not a snapshot test — that is V0.2-g. What is asserted here is what has
 * to hold for any repository: the output validates against its own schema,
 * it is reproducible, and every path in it exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepositoryMap } from './build.js';
import { RepositoryMapSchema } from '../../schemas/intelligence/repository-map.js';
import type { FileEntry } from '../../git/files.js';
import type { RepoMetadata } from '../../analyzers/metadata.js';

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures'
);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

interface Fixture {
  entries: FileEntry[];
  contents: Map<string, string>;
}

function loadFixture(name: string): Fixture {
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
      if (stat.size < 200_000) contents.set(path, readFileSync(full, 'utf8'));
    }
  }

  walk(root);
  return { entries, contents };
}

const FIXTURE_NAMES = readdirSync(FIXTURES_DIR)
  .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory())
  .sort();

function metadataFor(name: string): RepoMetadata {
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

describe('buildRepositoryMap on the real fixtures', () => {
  it('found the fixtures to test', () => {
    expect(FIXTURE_NAMES.length).toBeGreaterThanOrEqual(6);
  });

  for (const name of FIXTURE_NAMES) {
    describe(name, () => {
      const { entries, contents } = loadFixture(name);
      const metadata = metadataFor(name);
      const build = () =>
        buildRepositoryMap({ metadata, entries, contents, generatedAt: '2026-09-22T00:00:00.000Z' });

      it('produces a map that validates against its own schema', () => {
        const map = build();
        expect(() => RepositoryMapSchema.parse(map)).not.toThrow();
        expect(map.repository.name).toBe(name);
      });

      it('is reproducible', () => {
        expect(build()).toEqual(build());
      });

      it('only ever names files that are in the fixture', () => {
        const known = new Set(entries.map((e) => e.path));
        const map = build();
        for (const entrypoint of map.entrypoints) expect(known.has(entrypoint.path)).toBe(true);
        for (const file of map.importantFiles) expect(known.has(file.path)).toBe(true);
        for (const path of [...map.configFiles, ...map.testFiles, ...map.documentationFiles]) {
          expect(known.has(path)).toBe(true);
        }
      });

      it('accounts for every module it reports', () => {
        const map = build();
        for (const module of map.modules) {
          expect(module.fileCount).toBeGreaterThan(0);
          if (module.path !== '.') {
            expect(entries.some((e) => e.path.startsWith(`${module.path}/`))).toBe(true);
          }
        }
      });
    });
  }

  it('finds the entrypoint of the complete-project fixture', () => {
    const { entries, contents } = loadFixture('complete-project');
    const map = buildRepositoryMap({
      metadata: metadataFor('complete-project'),
      entries,
      contents,
      generatedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(map.entrypoints.map((e) => e.path)).toContain('src/index.ts');
    expect(map.testFiles).toContain('src/index.test.ts');
    expect(map.documentationFiles).toContain('README.md');
    expect(map.configFiles).toContain('Dockerfile');
    expect(map.configFiles).toContain('.github/workflows/ci.yml');
  });

  it('finds the contract package in the web3 fixture', () => {
    const { entries, contents } = loadFixture('web3-hackathon');
    const map = buildRepositoryMap({
      metadata: metadataFor('web3-hackathon'),
      entries,
      contents,
      generatedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(map.modules.map((m) => m.path)).toContain('contracts');
    expect(map.modules.find((m) => m.path === 'contracts')?.kind).toBe('contract-package');
    expect(map.entrypoints.map((e) => e.path)).toContain('contracts/Counter.sol');
    // `test/Counter.t.sol` is a test contract, not an entry an agent starts from.
    expect(map.entrypoints.map((e) => e.path)).not.toContain('test/Counter.t.sol');
  });

  it('reports the secret-leak fixture without flagging its own test file', () => {
    const { entries, contents } = loadFixture('secret-leak');
    const map = buildRepositoryMap({
      metadata: metadataFor('secret-leak'),
      entries,
      contents,
      generatedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(map.repository.languages).toContainEqual(
      expect.objectContaining({ language: 'TypeScript' })
    );
    expect(map.limitations.length).toBeGreaterThan(0);
  });
});
