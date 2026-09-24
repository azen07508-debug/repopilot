/**
 * Repository Map builder tests.
 *
 * The unit tests for the parts are in `entrypoints.test.ts`,
 * `modules.test.ts` and `importance.test.ts`. What is left to check here
 * is the assembly: that the whole thing validates against its own schema,
 * that the derived lists are right, that the honest parts of the artifact
 * (limitations, degraded) actually fire, and that the function is a
 * function — same input, same output, no input mutated.
 */
import { describe, it, expect } from 'vitest';
import { MAX_DEPENDENCIES, buildRepositoryMap, type RepositoryMapInput } from './build.js';
import { MAX_ENTRYPOINTS } from './entrypoints.js';
import { MAX_MODULES } from './modules.js';
import { RepositoryMapSchema } from '../../schemas/intelligence/repository-map.js';
import type { RepoMetadata } from '../../analyzers/metadata.js';
import type { FileEntry } from '../../git/files.js';

const metadata: RepoMetadata = {
  owner: 'acme',
  name: 'demo',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: null,
  visibility: 'public',
  archived: false,
  stars: 0,
  openIssues: 0,
  openPulls: 0,
  description: null,
  primaryLanguage: 'TypeScript',
  url: 'https://github.com/acme/demo',
};

const GENERATED_AT = '2026-09-22T00:00:00.000Z';

function build(
  files: Record<string, string>,
  overrides: Partial<RepositoryMapInput> = {}
): ReturnType<typeof buildRepositoryMap> {
  const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    size: content.length,
  }));
  return buildRepositoryMap({
    metadata,
    entries,
    contents: new Map(Object.entries(files)),
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe('buildRepositoryMap', () => {
  it('produces a schema-valid map, twice, identically', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'demo', dependencies: { zod: '^3.24.1' } }),
      'src/index.ts': 'export const a = 1;\n',
      'README.md': '# demo\n',
    };
    const first = build(files);
    const second = build(files);
    expect(() => RepositoryMapSchema.parse(first)).not.toThrow();
    expect(first).toEqual(second);
    expect(first.generatedAt).toBe(GENERATED_AT);
    expect(first.schemaVersion).toBe('1.0');
  });

  it('fills the repository block from the metadata', () => {
    const map = build({ 'src/index.ts': 'export const a = 1;\n' });
    expect(map.repository).toMatchObject({
      url: 'https://github.com/acme/demo',
      owner: 'acme',
      name: 'demo',
      defaultBranch: 'main',
      commitSha: null,
      primaryLanguage: 'TypeScript',
    });
  });

  it('carries the commit sha when the caller knows it', () => {
    expect(build({ 'src/index.ts': 'x\n' }, { commitSha: 'abc123' }).repository.commitSha).toBe(
      'abc123'
    );
  });

  it('ranks languages by bytes but picks a programming language as primary', () => {
    const map = build({
      'src/index.ts': 'x',
      'data/big.json': JSON.stringify({ payload: 'y'.repeat(500) }),
    });
    expect(map.repository.languages[0]?.language).toBe('JSON');
    expect(map.repository.primaryLanguage).toBe('TypeScript');
  });

  it('falls back to the metadata primary language when nothing is recognised', () => {
    expect(build({}).repository.primaryLanguage).toBe('TypeScript');
  });

  it('reads package managers from lockfiles and the packageManager field', () => {
    const map = build({
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'package.json': JSON.stringify({ name: 'demo', packageManager: 'pnpm@9.1.0' }),
    });
    expect(map.repository.packageManagers).toEqual(['pnpm']);
  });

  it('reports several package managers when a repository uses several', () => {
    const map = build({
      'Cargo.toml': '[package]\nname = "demo"\n',
      'requirements.txt': 'requests==2.31.0\n',
      'go.mod': 'module example.com/demo\n',
    });
    expect(map.repository.packageManagers).toEqual(['cargo', 'go', 'pip']);
  });

  it('reports frameworks from the stack detector, not from every signal', () => {
    const map = build({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { react: '^18', pg: '^8' } }),
      Dockerfile: 'FROM node:22\n',
    });
    expect(map.repository.frameworks).toEqual(['React']);
  });

  it('uses the stack signals it is given instead of recomputing them', () => {
    const map = build(
      { 'src/index.ts': 'x\n' },
      { stack: [{ key: 'vue', label: 'Vue', confidence: 0.95, evidence: [] }] }
    );
    expect(map.repository.frameworks).toEqual(['Vue']);
  });

  it('admits when no framework from the fixed set was recognised', () => {
    const map = build({ 'src/index.ts': 'x\n' });
    expect(map.repository.frameworks).toEqual([]);
    expect(map.limitations.join(' ')).toContain('No framework from the stack detector');
  });

  it('separates configuration, tests and documentation', () => {
    const map = build({
      'package.json': '{}',
      'tsconfig.json': '{}',
      '.github/workflows/ci.yml': 'name: ci\n',
      'src/index.test.ts': 'x\n',
      'src/index.ts': 'x\n',
      'docs/guide.md': '# guide\n',
      'README.md': '# readme\n',
    });
    expect(map.configFiles).toEqual(['.github/workflows/ci.yml', 'package.json', 'tsconfig.json']);
    expect(map.testFiles).toEqual(['src/index.test.ts']);
    expect(map.documentationFiles).toEqual(['README.md', 'docs/guide.md']);
  });

  it('ranks entrypoints above configuration and explains both', () => {
    const map = build({ 'package.json': '{}', 'src/index.ts': 'x\n' });
    expect(map.importantFiles.map((f) => f.path)).toEqual(['src/index.ts', 'package.json']);
    expect(map.importantFiles[0]?.reason).toContain('Entrypoint (library)');
    expect(map.importantFiles[1]?.reason).toContain('Root-level configuration');
  });

  it('never names a file that is not in the tree', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'demo', bin: { demo: './dist/cli.js' } }),
      'src/index.ts': 'x\n',
      'vitest.config.ts': 'export default {};\n',
      'src/index.test.ts': 'x\n',
      'README.md': '# demo\n',
    };
    const known = new Set(Object.keys(files));
    const map = build(files);
    for (const entrypoint of map.entrypoints) expect(known.has(entrypoint.path)).toBe(true);
    for (const file of map.importantFiles) expect(known.has(file.path)).toBe(true);
    for (const list of [map.configFiles, map.testFiles, map.documentationFiles]) {
      for (const path of list) expect(known.has(path)).toBe(true);
    }
  });
});

describe('buildRepositoryMap — dependency manifests', () => {
  it('reads all four package.json dependency kinds', () => {
    const map = build({
      'package.json': JSON.stringify({
        name: 'demo',
        dependencies: { zod: '^3.24.1' },
        devDependencies: { vitest: '^2.1.9' },
        peerDependencies: { react: '^18' },
        optionalDependencies: { fsevents: '^2' },
      }),
    });
    expect(map.externalDependencies.map((d) => `${d.name}:${d.kind}`).sort()).toEqual([
      'fsevents:optional',
      'react:peer',
      'vitest:dev',
      'zod:runtime',
    ]);
    expect(map.externalDependencies.every((d) => d.manifest === 'package.json')).toBe(true);
  });

  it('reads requirements.txt and notes the options it skipped', () => {
    const map = build({
      'requirements.txt': '# a comment\nrequests==2.31.0\nflask>=3.0,<4\nboto3\n-r other.txt\n',
    });
    // The version keeps its operator: `==2.31.0` is a pin, `>=3.0,<4` is a
    // range, and stripping the operator would lose which one it is.
    expect(map.externalDependencies.map((d) => `${d.name}|${d.version}`)).toEqual([
      'boto3|null',
      'flask|>=3.0,<4',
      'requests|==2.31.0',
    ]);
    expect(map.limitations.join(' ')).toContain('-r other.txt');
  });

  it('reads a multi-line pyproject dependency array', () => {
    const map = build({
      'pyproject.toml': [
        '[project]',
        'name = "demo"',
        'dependencies = [',
        '  "requests>=2.31",',
        '  "click",',
        ']',
        '',
        '[tool.poetry.group.dev.dependencies]',
        'pytest = "^8.0"',
        '',
        '[build-system]',
        'requires = ["setuptools>=68"]',
        '',
      ].join('\n'),
    });
    expect(map.externalDependencies.map((d) => `${d.name}:${d.kind}`).sort()).toEqual([
      'click:runtime',
      'pytest:dev',
      'requests:runtime',
      'setuptools:dev',
    ]);
  });

  it('reads Cargo dependencies, including an inline table version', () => {
    const map = build({
      'Cargo.toml': [
        '[package]',
        'name = "demo"',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'serde = { version = "1.0", features = ["derive"] }',
        'tokio = "1.40"',
        'local = { path = "../local" }',
        '',
        '[dev-dependencies]',
        'criterion = "0.5"',
        '',
      ].join('\n'),
    });
    expect(map.externalDependencies.map((d) => `${d.name}=${d.version}:${d.kind}`)).toEqual([
      'criterion=0.5:dev',
      'local=null:runtime',
      'serde=1.0:runtime',
      'tokio=1.40:runtime',
    ]);
  });

  it('reads a go.mod require block and drops the trailing comment', () => {
    const map = build({
      'go.mod':
        'module example.com/demo\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgolang.org/x/text v0.19.0 // indirect\n)\n\nrequire github.com/stretchr/testify v1.9.0\n',
    });
    expect(map.externalDependencies.map((d) => `${d.name}@${d.version}`)).toEqual([
      'github.com/gin-gonic/gin@v1.10.0',
      'github.com/stretchr/testify@v1.9.0',
      'golang.org/x/text@v0.19.0',
    ]);
  });

  it('names the manifests it did not parse', () => {
    const map = build({ Gemfile: 'source "https://rubygems.org"\n', 'src/index.ts': 'x\n' });
    expect(map.limitations.join(' ')).toContain('Gemfile');
  });

  it('says so when there is no manifest at all', () => {
    expect(build({ 'src/index.ts': 'x\n' }).limitations.join(' ')).toContain(
      'No dependency manifest was found'
    );
  });

  it('keeps a package declared in two sections as two declarations', () => {
    // `zod` in both `dependencies` and `devDependencies` is a real mistake
    // worth seeing, so the dedupe key includes the kind. Collapsing them
    // would make the map agree that the repository is fine.
    const map = build({
      'package.json': JSON.stringify({
        name: 'demo',
        dependencies: { zod: '^3.24.1' },
        devDependencies: { zod: '^3.24.1' },
      }),
    });
    expect(map.externalDependencies.map((d) => d.kind).sort()).toEqual(['dev', 'runtime']);
  });

  it('caps the dependency list and says so', () => {
    const dependencies: Record<string, string> = {};
    for (let i = 0; i < MAX_DEPENDENCIES + 10; i++) {
      dependencies[`dep-${String(i).padStart(4, '0')}`] = '1.0.0';
    }
    const map = build({ 'package.json': JSON.stringify({ name: 'big', dependencies }) });
    expect(map.externalDependencies).toHaveLength(MAX_DEPENDENCIES);
    expect(map.limitations.join(' ')).toContain(`Only the first ${MAX_DEPENDENCIES}`);
  });
});

/**
 * A cap is only worth reporting when it actually cut something.
 *
 * These exist because the first version of `limitations` guessed: it
 * compared the *length of the returned list* against the cap with `>=`,
 * which cannot tell "exactly 50 entrypoints" from "50 of 80", and it
 * compared the *raw declaration count* against the cap while the list had
 * been sliced on the *deduplicated* count. Both produced a limitation
 * line for a complete list — the map claiming to be partial when it was
 * not, which is the same class of error as naming a path that is not in
 * the tree.
 */
describe('buildRepositoryMap — caps are reported only when they bite', () => {
  function toolFiles(count: number): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      files[`src/bin/tool-${String(i).padStart(3, '0')}.ts`] = 'export const run = () => 0;\n';
    }
    return files;
  }

  it('does not claim the entrypoint list was capped when it is exactly the cap', () => {
    const map = build(toolFiles(MAX_ENTRYPOINTS));
    expect(map.entrypoints).toHaveLength(MAX_ENTRYPOINTS);
    expect(map.limitations.join('\n')).not.toContain('entrypoints are listed');
  });

  it('reports the true total when the entrypoint list really is capped', () => {
    const total = MAX_ENTRYPOINTS + 1;
    const map = build(toolFiles(total));
    expect(map.entrypoints).toHaveLength(MAX_ENTRYPOINTS);
    expect(map.limitations.join('\n')).toContain(
      `Only the first ${MAX_ENTRYPOINTS} of ${total} entrypoints are listed.`
    );
  });

  it('does not call the dependency list truncated when deduplication shortened it, not the cap', () => {
    // 600 declarations that deduplicate to 450: over the cap as written,
    // under it as listed. Counting the declarations would report a
    // truncation that did not happen, and report the wrong total.
    const distinct = MAX_DEPENDENCIES - 50;
    const lines: string[] = [];
    for (let i = 0; i < distinct; i++) lines.push(`pkg-${String(i).padStart(4, '0')}==1.0.0`);
    for (let i = 0; i < 150; i++) lines.push(`pkg-${String(i).padStart(4, '0')}==1.0.0`);

    const map = build({ 'requirements.txt': `${lines.join('\n')}\n` });
    expect(map.externalDependencies).toHaveLength(distinct);
    expect(map.limitations.join('\n')).not.toContain('dependencies are listed');
  });

  it('says a capped module list once, not twice', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_MODULES + 5; i++) {
      files[`packages/p${String(i).padStart(3, '0')}/package.json`] = JSON.stringify({
        name: `p${i}`,
      });
    }
    const map = build(files);
    expect(map.modules).toHaveLength(MAX_MODULES);

    // Matched on meaning rather than wording: the duplicate this guards
    // against used different words ("capped at") for the same fact, so a
    // literal string check would have missed it.
    const moduleLimitLines = map.limitations.filter(
      (l) => /modules?\b/i.test(l) && /capped|listed/i.test(l)
    );
    expect(moduleLimitLines).toHaveLength(1);
    expect(moduleLimitLines.join('\n')).toContain(
      `Only the first ${MAX_MODULES} of ${MAX_MODULES + 5} modules are listed.`
    );
  });
});

describe('buildRepositoryMap — honest degradation', () => {
  it('is not degraded by default', () => {
    const map = build({ 'src/index.ts': 'x\n' });
    expect(map.degraded).toBe(false);
    expect(map.limitations.join('\n')).not.toContain('one file at a time');
  });

  it('says so when the archive could not be read, and why', () => {
    const map = build(
      { 'src/index.ts': 'x\n' },
      { degraded: true, degradedReason: 'the archive is not a gzip stream' }
    );
    expect(map.degraded).toBe(true);
    expect(map.limitations.join('\n')).toContain('the archive is not a gzip stream');
  });

  it('treats a truncated tree as degraded', () => {
    const map = build({ 'src/index.ts': 'x\n' }, { truncated: true });
    expect(map.degraded).toBe(true);
    expect(map.limitations.join('\n')).toContain('truncated the file tree');
  });

  it('states the scope of the module graph it built', () => {
    const map = build({ 'package.json': '{}', 'src/index.ts': 'x\n' });
    expect(map.modules.length).toBeGreaterThan(0);
    expect(map.limitations.join(' ')).toContain('source-level imports are not resolved');
  });

  it('handles an empty repository without throwing', () => {
    const map = build({});
    expect(map.entrypoints).toEqual([]);
    expect(map.modules).toEqual([]);
    expect(map.externalDependencies).toEqual([]);
    expect(map.importantFiles).toEqual([]);
    expect(map.repository.languages).toEqual([]);
    expect(() => RepositoryMapSchema.parse(map)).not.toThrow();
  });

  it('does not mutate the inputs it was given', () => {
    const entries: FileEntry[] = [{ path: 'src/index.ts', size: 2 }];
    const contents = new Map([['src/index.ts', 'x\n']]);
    const entriesBefore = JSON.stringify(entries);
    buildRepositoryMap({ metadata, entries, contents, generatedAt: GENERATED_AT });
    expect(JSON.stringify(entries)).toBe(entriesBefore);
    expect([...contents.keys()]).toEqual(['src/index.ts']);
  });

  it('names a directory with several manifests deterministically', () => {
    // Three manifests in one directory. Which one names the module must
    // not depend on the order the tree happened to be listed in, so the
    // priority is explicit rather than "whichever was seen last".
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'js-root' }),
      'go.mod': 'module example.com/go-root\n',
      'Cargo.toml': '[package]\nname = "rust-root"\n',
      'src/index.ts': 'x\n',
    };
    const forwards = build(files);
    expect(forwards.modules.find((m) => m.path === '.')?.name).toBe('js-root');

    const reversed: Record<string, string> = {};
    for (const key of Object.keys(files).reverse()) reversed[key] = files[key] ?? '';
    expect(build(reversed)).toEqual(forwards);
  });

  it('is deterministic across a reordered tree', () => {
    const files: Record<string, string> = {
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/a/src/index.ts': 'export const a = 1;\n',
      'packages/b/package.json': JSON.stringify({ name: 'b', dependencies: { a: '1.0.0' } }),
      'packages/b/src/index.ts': 'export const b = 2;\n',
      'README.md': '# demo\n',
    };
    const forwards = build(files);
    const reversed: Record<string, string> = {};
    for (const key of Object.keys(files).reverse()) reversed[key] = files[key] ?? '';
    expect(build(reversed)).toEqual(forwards);
  });
});
