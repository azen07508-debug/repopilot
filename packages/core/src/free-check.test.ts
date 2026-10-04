/**
 * FreeCheck unit tests — no network access.
 *
 * These drive the real `FreeCheckRunner` through its `source` seam: the
 * matching rules, the score arithmetic, the evidence strings and the
 * metadata-failure fallback are all the shipped ones.
 *
 * The file this replaced did not do that. It re-implemented the five matching
 * rules inside the test bodies — its own `README_NAMES` set, its own
 * `LOCKFILE_PATTERNS`, its own `entries.find(...)` — and then asserted on
 * those. Every assertion was about code written in the test file, so
 * `LOCKFILE_PATTERNS` could have been emptied in `free-check.ts` and the suite
 * would have stayed green. A test that cannot fail is not a test, and this one
 * was guarding the entry point of the product: the thing a prospective buyer
 * runs first, before deciding whether to pay for anything.
 *
 * Two tests in the old file did exercise the real runner, and they are kept:
 * the URL rejections happen in `parseRepoUrl`, before any source is consulted.
 */
import { describe, it, expect } from 'vitest';
import { FreeCheckRunner, type FreeCheckSource } from './free-check.js';
import type { FileEntry } from './git/files.js';
import type { RepoMetadata } from './analyzers/metadata.js';

const HOSTS = ['github.com'];

function entry(path: string): FileEntry {
  return { path, size: 100 };
}

function meta(defaultBranch: string): RepoMetadata {
  return {
    owner: 'okx',
    name: 'repopilot',
    defaultBranch,
    license: 'MIT',
    lastUpdatedAt: null,
    visibility: 'public',
    archived: false,
    stars: 12,
    openIssues: 0,
    openPulls: 0,
    description: 'A repo.',
    primaryLanguage: 'TypeScript',
    url: 'https://github.com/okx/repopilot',
  };
}

/**
 * A source that answers from a literal file list.
 *
 * `askedRefs` is recorded because which ref gets read is a decision the runner
 * makes — metadata's default branch when it has one, otherwise the hint, and
 * `main` when neither exists. That order is not observable from the report, so
 * it is recorded here.
 */
function sourceOf(
  files: string[],
  opts: { metadata?: RepoMetadata | null; metadataThrows?: boolean; treeThrows?: Error } = {}
): FreeCheckSource & { askedRefs: string[]; metadataCalls: number } {
  const state = { askedRefs: [] as string[], metadataCalls: 0 };
  const source: FreeCheckSource = {
    metadata: async () => {
      state.metadataCalls += 1;
      if (opts.metadataThrows) throw new Error('metadata unavailable');
      return opts.metadata === undefined ? meta('main') : opts.metadata;
    },
    tree: async (_owner, _repo, ref) => {
      state.askedRefs.push(ref);
      if (opts.treeThrows) throw opts.treeThrows;
      return files.map(entry);
    },
  };
  return Object.assign(source, state);
}

const COMPLETE = [
  'README.md',
  'LICENSE',
  '.env.example',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'src/index.ts',
];

function runnerWith(
  files: string[],
  opts: Parameters<typeof sourceOf>[1] = {}
): { runner: FreeCheckRunner; source: ReturnType<typeof sourceOf> } {
  const source = sourceOf(files, opts);
  return { runner: new FreeCheckRunner({ allowedHosts: HOSTS, source }), source };
}

async function report(files: string[], opts: Parameters<typeof sourceOf>[1] = {}) {
  const { runner } = runnerWith(files, opts);
  return runner.run({ repoUrl: 'https://github.com/okx/repopilot', outputLanguage: 'en' });
}

describe('FreeCheckRunner — the five presence checks', () => {
  it('passes all five on a complete repository and scores 100', async () => {
    const result = await report(COMPLETE);
    expect(result.kind).toBe('free-check');
    expect(result.reportVersion).toBe('1.0');
    expect(result.checks.map((c) => c.id)).toEqual([
      'has-readme',
      'has-license',
      'has-env-example',
      'has-lockfile',
      'has-ci',
    ]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.score).toEqual({ value: 100, passed: 5, total: 5 });
  });

  it('names the file it found as the evidence', async () => {
    const result = await report(COMPLETE);
    expect(result.checks.find((c) => c.id === 'has-readme')?.evidence).toBe('README.md found');
    expect(result.checks.find((c) => c.id === 'has-ci')?.evidence).toBe(
      '.github/workflows/ci.yml found'
    );
  });

  it('fails only the lockfile check and scores 80 when the lockfile is absent', async () => {
    const result = await report(COMPLETE.filter((f) => f !== 'pnpm-lock.yaml'));
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(['has-lockfile']);
    expect(result.checks.find((c) => c.id === 'has-lockfile')?.evidence).toBe(
      'No lockfile (reproducibility is at risk)'
    );
    expect(result.score).toEqual({ value: 80, passed: 4, total: 5 });
  });

  it('fails the README check when there is none, and says why', async () => {
    // "anywhere in the repository", not "at the repository root": the lookup
    // matches a basename at any depth, so a repository with `docs/README.md`
    // passes. The old wording described a check nobody had written.
    const result = await report(COMPLETE.filter((f) => f !== 'README.md'));
    const readme = result.checks.find((c) => c.id === 'has-readme');
    expect(readme?.passed).toBe(false);
    expect(readme?.evidence).toBe('No README anywhere in the repository');
  });

  it('accepts a README, LICENSE or .env example anywhere in the tree', async () => {
    const result = await report([
      'docs/README.md',
      'legal/LICENSE',
      'config/.env.example',
      'package.json',
      'yarn.lock',
      '.gitlab-ci.yml',
    ]);
    expect(result.score.value).toBe(100);
    expect(result.checks.find((c) => c.id === 'has-license')?.evidence).toBe('legal/LICENSE found');
  });

  /**
   * The long path comes first in the listing on purpose.
   *
   * Written the other way round — `['README.md', 'docs/README.md']` — this test
   * passed against a `findFirstByNames` that had been mutated to return the
   * *first* match instead of the shortest: the first element was already the
   * one the assertion named. A fixture whose order happens to agree with the
   * rule cannot tell the two rules apart, so the assertion was green for a
   * reason it did not state.
   */
  it('prefers the shortest path when several files match', async () => {
    const result = await report(['docs/README.md', ...COMPLETE]);
    expect(result.checks.find((c) => c.id === 'has-readme')?.evidence).toBe('README.md found');
  });

  it.each([
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['Cargo.lock', 'cargo'],
    ['go.sum', 'go'],
    ['poetry.lock', 'poetry'],
  ])('accepts %s as the lockfile (%s)', async (lockfile) => {
    const result = await report([...COMPLETE.filter((f) => f !== 'pnpm-lock.yaml'), lockfile]);
    expect(result.checks.find((c) => c.id === 'has-lockfile')?.passed).toBe(true);
  });

  it.each([
    ['.github/workflows/release.yml', 'GitHub Actions'],
    ['.circleci/config.yml', 'CircleCI'],
    ['.gitlab-ci.yml', 'GitLab CI'],
    ['.travis.yml', 'Travis'],
  ])('accepts %s as CI (%s)', async (ci) => {
    const result = await report([...COMPLETE.filter((f) => f !== '.github/workflows/ci.yml'), ci]);
    expect(result.checks.find((c) => c.id === 'has-ci')?.passed).toBe(true);
  });

  it('does not accept a workflow file that is not YAML', async () => {
    const result = await report([
      ...COMPLETE.filter((f) => f !== '.github/workflows/ci.yml'),
      '.github/workflows/ci.json',
    ]);
    expect(result.checks.find((c) => c.id === 'has-ci')?.passed).toBe(false);
  });
});

describe('FreeCheckRunner — reading the repository', () => {
  it('reads the branch the metadata reports', async () => {
    const { runner, source } = runnerWith(COMPLETE, { metadata: meta('trunk') });
    await runner.run({ repoUrl: 'https://github.com/okx/repopilot', outputLanguage: 'en' });
    expect(source.askedRefs).toEqual(['trunk']);
  });

  it('falls back to main when the metadata carries no branch', async () => {
    const { runner, source } = runnerWith(COMPLETE, { metadata: null });
    await runner.run({ repoUrl: 'https://github.com/okx/repopilot', outputLanguage: 'en' });
    expect(source.askedRefs).toEqual(['main']);
  });

  it('still produces a report when the metadata call fails', async () => {
    const result = await report(COMPLETE, { metadataThrows: true });
    expect(result.metadata).toBeNull();
    expect(result.score.value).toBe(100);
  });

  it('propagates a tree failure so the caller can map it to a status', async () => {
    const boom = new Error('404 Not Found');
    await expect(report(COMPLETE, { treeThrows: boom })).rejects.toThrow('404 Not Found');
  });

  it('reports the parsed owner and name', async () => {
    const result = await report(COMPLETE);
    expect(result.repository).toMatchObject({
      host: 'github.com',
      owner: 'okx',
      name: 'repopilot',
      valid: true,
    });
  });
});

describe('FreeCheckRunner — stack detection', () => {
  it('reads the stack off the file names', async () => {
    const result = await report(COMPLETE);
    expect(result.stack?.languages).toContain('TypeScript');
    expect(result.stack?.languages).toContain('JavaScript');
    expect(result.stack?.runtimes).toContain('Node.js');
    expect(result.stack?.frameworks).toContain('GitHub Actions');
  });

  it('reports an empty stack rather than guessing at an unknown repository', async () => {
    const result = await report(['README.md', 'LICENSE', '.env.example']);
    expect(result.stack).toEqual({ languages: [], frameworks: [], runtimes: [] });
  });
});

describe('FreeCheckRunner — refusals happen before the network', () => {
  it('rejects a non-https URL', async () => {
    const { runner, source } = runnerWith(COMPLETE);
    await expect(
      runner.run({ repoUrl: 'http://github.com/okx/repopilot', outputLanguage: 'en' })
    ).rejects.toThrow();
    expect(source.metadataCalls).toBe(0);
    expect(source.askedRefs).toEqual([]);
  });

  it('rejects an off-allowlist host', async () => {
    const { runner, source } = runnerWith(COMPLETE);
    await expect(
      runner.run({ repoUrl: 'https://gitlab.com/foo/bar', outputLanguage: 'en' })
    ).rejects.toThrow(/not in the allowlist/);
    expect(source.metadataCalls).toBe(0);
  });
});

/**
 * A known gap, recorded rather than hidden.
 *
 * `README_FILENAMES` lists `README.md` and `readme.md` but not `Readme.md`, and
 * the lookup compares basenames exactly, so a repository whose README is titled
 * in mixed case is told `has-readme: FAIL` and loses twenty points on the free
 * check — while the paid audit, which reads the same list, agrees with it. Two
 * consumers share the list, so widening the match is a change to paid scoring
 * and belongs in its own commit.
 *
 * `it.fails` is deliberate: the day someone makes the lookup case-insensitive,
 * this turns into a failure and the marker gets removed.
 */
describe('FreeCheckRunner — known gaps', () => {
  it.fails('recognises a README whose name is in mixed case', async () => {
    const result = await report(COMPLETE.filter((f) => f !== 'README.md').concat('Readme.md'));
    expect(result.checks.find((c) => c.id === 'has-readme')?.passed).toBe(true);
  });
});
