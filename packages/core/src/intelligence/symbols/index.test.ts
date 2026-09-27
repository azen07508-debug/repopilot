/**
 * Routing, degradation and the caps.
 *
 * The load-bearing test in this file is "a parser failure in one language
 * does not fail the map". D-018 and the schema both state it as a hard rule,
 * and it is the one thing that cannot be checked by reading the code: it
 * needs a parser that actually throws.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_FILE_BYTES, buildSymbolMap, type SymbolMapInput } from './index.js';
import { SymbolMapSchema } from '../../schemas/intelligence/symbol-map.js';
import type { FileEntry } from '../../git/files.js';

function build(files: Record<string, string>, overrides: Partial<SymbolMapInput> = {}) {
  const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    size: Buffer.byteLength(content),
  }));
  return buildSymbolMap({
    entries,
    contents: new Map(Object.entries(files)),
    ...overrides,
  });
}

describe('buildSymbolMap', () => {
  it('routes each language to its own parser and reports the coverage', () => {
    const map = build({
      'src/a.ts': 'export function tsFn(): void {}\n',
      'src/b.py': 'def py_fn():\n    pass\n',
      'src/C.sol': 'contract C {\n    function f() public {}\n}\n',
      'cmd/main.go': 'package main\n\nfunc Go() {}\n',
    });

    const byLanguage = new Map(map.languageCoverage.map((c) => [c.language, c]));
    expect(byLanguage.get('TypeScript')?.parser).toBe('typescript-compiler');
    expect(byLanguage.get('TypeScript')?.degraded).toBe(false);
    expect(byLanguage.get('Python')?.parser).toBe('regex');
    expect(byLanguage.get('Solidity')?.parser).toBe('regex');
    expect(byLanguage.get('Go')?.parser).toBe('heuristic');
    expect(map.degraded).toBe(false);
    expect(map.failures).toEqual([]);
  });

  it('counts the files per language', () => {
    const map = build({
      'a.py': 'def a():\n    pass\n',
      'b.py': 'def b():\n    pass\n',
    });
    expect(map.languageCoverage).toEqual([
      { language: 'Python', fileCount: 2, parser: 'regex', degraded: false },
    ]);
  });

  it('ignores data and documentation formats entirely', () => {
    const map = build({
      'package.json': '{"name":"x"}',
      'README.md': '# hi',
      'config.yaml': 'a: 1',
    });
    expect(map.symbols).toEqual([]);
    expect(map.languageCoverage).toEqual([]);
    expect(map.failures).toEqual([]);
  });

  it('names a language it has no extractor for instead of silently returning nothing', () => {
    const map = build({ 'src/lib.cairo': 'func main() {}\n', 'src/other.cairo': 'func x() {}\n' });
    expect(map.symbols).toEqual([]);
    expect(map.degraded).toBe(true);
    expect(map.failures).toHaveLength(1);
    expect(map.failures[0]?.language).toBe('Cairo');
    expect(map.failures[0]?.reason).toContain('2 file(s)');
  });

  it('skips a file over the byte limit and says so (R-18)', () => {
    const huge = `def big():\n    pass\n${'# padding\n'.repeat(DEFAULT_MAX_FILE_BYTES)}`;
    const map = build({ 'big.py': huge, 'small.py': 'def small():\n    pass\n' });
    expect(map.symbols.map((s) => s.name)).toEqual(['small']);
    expect(map.degraded).toBe(true);
    expect(map.failures.some((f) => f.reason.includes('exceeded'))).toBe(true);
  });

  it('does not fail the map when one parser throws', async () => {
    vi.resetModules();
    vi.doMock('./typescript.js', () => ({
      parseTypeScript: () => {
        throw new Error('compiler exploded');
      },
    }));

    try {
      const { buildSymbolMap: buildWithBrokenParser } = await import('./index.js');
      const map = buildWithBrokenParser({
        entries: [
          { path: 'src/a.ts', size: 30 },
          { path: 'src/b.py', size: 20 },
        ],
        contents: new Map([
          ['src/a.ts', 'export function tsFn(): void {}\n'],
          ['src/b.py', 'def py_fn():\n    pass\n'],
        ]),
      });

      // The map exists, it says it is degraded, and the language that was
      // fine still contributed.
      expect(() => SymbolMapSchema.parse(map)).not.toThrow();
      expect(map.degraded).toBe(true);
      expect(map.symbols.some((s) => s.name === 'py_fn')).toBe(true);
      expect(map.failures.some((f) => f.reason.includes('compiler exploded'))).toBe(true);
      expect(map.languageCoverage.find((c) => c.language === 'TypeScript')?.degraded).toBe(true);
    } finally {
      vi.doUnmock('./typescript.js');
      vi.resetModules();
    }
  });

  it('keeps a language degraded once one of its files has degraded', async () => {
    // One bad file among good ones. Whether the language is reported as
    // degraded must not depend on which file happened to be read last —
    // assigning the last result instead of OR-ing it makes the warning
    // disappear from a map that is still incomplete.
    vi.resetModules();
    vi.doMock('./python.js', () => ({
      parsePython: (path: string) => {
        if (path.includes('bad')) throw new Error('scanner failed');
        return [];
      },
    }));

    try {
      const { buildSymbolMap: buildWithBrokenScanner } = await import('./index.js');
      const map = buildWithBrokenScanner({
        entries: [
          { path: 'a_bad.py', size: 20 },
          { path: 'b_good.py', size: 20 },
        ],
        contents: new Map([
          ['a_bad.py', 'def x():\n    pass\n'],
          ['b_good.py', 'def y():\n    pass\n'],
        ]),
      });

      expect(map.languageCoverage).toEqual([
        { language: 'Python', fileCount: 2, parser: 'regex', degraded: true },
      ]);
      expect(map.failures).toHaveLength(1);
    } finally {
      vi.doUnmock('./python.js');
      vi.resetModules();
    }
  });

  it('produces the same map whatever order the tree was listed in', () => {
    const files: Record<string, string> = {
      'src/b.ts': 'export const b = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/z.py': 'def z():\n    pass\n',
    };
    const forwards = build(files);
    const reversed: Record<string, string> = {};
    for (const key of Object.keys(files).reverse()) reversed[key] = files[key] ?? '';
    expect(build(reversed)).toEqual(forwards);
  });

  it('sorts symbols by path and line', () => {
    const map = build({
      'src/z.ts': 'export const z = 1;\n',
      'src/a.ts': 'export const first = 1;\nexport const second = 2;\n',
    });
    expect(map.symbols.map((s) => `${s.path}#${s.name}`)).toEqual([
      'src/a.ts#first',
      'src/a.ts#second',
      'src/z.ts#z',
    ]);
  });

  it('caps the symbol list and reports the cap', () => {
    const source = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const map = build({ 'src/a.ts': source }, { maxSymbols: 4 });
    expect(map.symbols).toHaveLength(4);
    expect(map.degraded).toBe(true);
    expect(map.failures.some((f) => f.reason.includes('capped at 4'))).toBe(true);
  });

  it('does not claim a cap when the list is exactly at it', () => {
    const source = Array.from({ length: 4 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const map = build({ 'src/a.ts': source }, { maxSymbols: 4 });
    expect(map.symbols).toHaveLength(4);
    expect(map.failures.some((f) => f.reason.includes('capped'))).toBe(false);
  });

  it('reports no reference counts, because none were computed', () => {
    // V0.2-f resolves imports. Until then `references` is 0 everywhere, and
    // the schema says so: 0 does not imply dead code.
    const map = build({ 'src/a.ts': 'export function used(): void {}\n' });
    expect(map.symbols.every((s) => s.references === 0)).toBe(true);
  });

  it('names no path that is not in the tree', () => {
    const map = build({ 'src/a.ts': 'export const a = 1;\n' });
    const known = new Set(['src/a.ts']);
    for (const symbol of map.symbols) expect(known.has(symbol.path)).toBe(true);
  });

  it('skips a file whose content was never fetched', () => {
    const map = buildSymbolMap({
      entries: [{ path: 'src/a.ts', size: 10 }],
      contents: new Map(),
    });
    expect(map.symbols).toEqual([]);
    expect(map.languageCoverage).toEqual([]);
  });

  it('does not mutate the inputs it was given', () => {
    const entries: FileEntry[] = [{ path: 'src/a.ts', size: 22 }];
    const contents = new Map([['src/a.ts', 'export const a = 1;\n']]);
    const entriesCopy = [...entries];
    buildSymbolMap({ entries, contents });
    expect(entries).toEqual(entriesCopy);
    expect(contents.get('src/a.ts')).toBe('export const a = 1;\n');
  });
});

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

function loadFixture(name: string): { entries: FileEntry[]; contents: Map<string, string> } {
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

describe('buildSymbolMap — the real fixtures', () => {
  const fixtures = readdirSync(FIXTURES_DIR).filter((name) =>
    statSync(join(FIXTURES_DIR, name)).isDirectory()
  );

  it('has fixtures to run against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const name of fixtures) {
    it(`builds a schema-valid map for ${name}, twice, identically`, () => {
      const { entries, contents } = loadFixture(name);
      const first = buildSymbolMap({ entries, contents });
      const second = buildSymbolMap({ entries, contents });

      expect(() => SymbolMapSchema.parse(first)).not.toThrow();
      expect(first).toEqual(second);

      for (const symbol of first.symbols) {
        expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
        expect(symbol.startLine).toBeGreaterThan(0);
        expect(symbol.id).toBe(`${symbol.path}#${symbol.name}#${symbol.startLine}`);
      }
    });
  }
});
