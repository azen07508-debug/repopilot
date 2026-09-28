/**
 * The Dependency Graph builder.
 *
 * The load-bearing assertions here are the ones about what the artifact does
 * *not* contain: an import that matches no file is not an edge, a graph that
 * dropped edges at a cap says so, and a language with no extractor is named
 * rather than quietly contributing nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildDependencyGraph, type DependencyGraphInput } from './dependency-graph.js';
import { DependencyGraphSchema } from '../../schemas/intelligence/graph.js';
import { FIXTURE_NAMES, loadFixture } from '../../test-utils/fixtures.js';
import type { FileEntry } from '../../git/files.js';

function build(files: Record<string, string>, overrides: Partial<DependencyGraphInput> = {}) {
  const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    size: Buffer.byteLength(content),
  }));
  return buildDependencyGraph({
    entries,
    contents: new Map(Object.entries(files)),
    ...overrides,
  });
}

function edgePairs(graph: { edges: { from: string; to: string }[] }): string[] {
  return graph.edges.map((edge) => `${edge.from} -> ${edge.to}`);
}

describe('buildDependencyGraph', () => {
  it('connects a file to the file it imports', () => {
    const graph = build({
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': 'export const b = 1;\n',
    });

    expect(edgePairs(graph)).toEqual(['src/a.ts -> src/b.ts']);
    expect(graph.limitations).toEqual([]);
  });

  it('gives both files a node, and only files that take part', () => {
    const graph = build({
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': 'export const b = 1;\n',
      'src/untouched.ts': 'export const c = 1;\n',
    });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(graph.nodes.every((node) => node.kind === 'file')).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'src/b.ts')?.name).toBe('b.ts');
  });

  it('makes a bare specifier an external dependency, named without its subpath', () => {
    const graph = build({ 'src/a.ts': "import { jsx } from 'react/jsx-runtime';\n" });

    expect(graph.nodes).toEqual([
      { id: 'external:react', kind: 'external-dependency', name: 'react', path: null },
      { id: 'src/a.ts', kind: 'file', name: 'a.ts', path: 'src/a.ts' },
    ]);
    expect(edgePairs(graph)).toEqual(['src/a.ts -> external:react']);
  });

  it('makes a Go import a module node, because Go imports a package', () => {
    const graph = build(
      {
        'go.mod': 'module github.com/me/proj\n',
        'cmd/main.go': 'import "github.com/me/proj/internal/x"\n',
        'internal/x/x.go': 'package x\n',
      },
      { rootPrefixes: ['github.com/me/proj'] }
    );

    const module = graph.nodes.find((node) => node.kind === 'module');
    expect(module?.id).toBe('module:internal/x');
    expect(module?.path).toBe('internal/x');
    expect(edgePairs(graph)).toEqual(['cmd/main.go -> module:internal/x']);
  });

  it('resolves a workspace module through the map it was given', () => {
    const graph = build(
      {
        'apps/api/src/a.ts': "import { x } from '@repopilot/core';\n",
        'packages/core/src/index.ts': 'export const x = 1;\n',
      },
      { modules: new Map([['@repopilot/core', 'packages/core']]) }
    );

    expect(edgePairs(graph)).toEqual(['apps/api/src/a.ts -> packages/core/src/index.ts']);
  });

  it('counts repeated imports as one edge, keeping every line as evidence', () => {
    const graph = build({
      'src/a.ts': ["import { x } from './b.js';", '', "import { y } from './b.js';"].join('\n'),
      'src/b.ts': 'export const x = 1;\n',
    });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.weight).toBe(2);
    expect(graph.edges[0]?.evidence.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it('gives every edge evidence that names a file and a line', () => {
    const graph = build({
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': 'export const b = 1;\n',
    });

    const evidence = graph.edges[0]?.evidence[0];
    expect(evidence?.path).toBe('src/a.ts');
    expect(evidence?.file).toBe('src/a.ts');
    expect(evidence?.line).toBe(1);
    expect(evidence?.startLine).toBe(1);
    expect(evidence?.source).toBe('dependency-analysis');
    expect(evidence?.reason).toContain('./b.js');
    // Which extractor produced the line, so a reader knows what tier to
    // trust: the compiler, or a line pattern.
    expect(evidence?.reason).toContain('TypeScript');
  });

  it('is more certain about a file than about a directory', () => {
    const graph = build(
      {
        'cmd/main.go': 'import "github.com/me/proj/internal/x"\n',
        'internal/x/x.go': 'package x\n',
      },
      { rootPrefixes: ['github.com/me/proj'] }
    );
    expect(graph.edges[0]?.evidence[0]?.confidence).toBe(0.9);

    const files = build({
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': 'export const b = 1;\n',
    });
    expect(files.edges[0]?.evidence[0]?.confidence).toBe(1);
  });

  it('reports a relative import that matches no file, and emits no edge for it', () => {
    const graph = build({ 'src/a.ts': "import { gone } from './gone.js';\n" });

    expect(graph.edges).toEqual([]);
    expect(graph.limitations).toHaveLength(1);
    expect(graph.limitations[0]).toContain('src/a.ts:1');
    expect(graph.limitations[0]).toContain('./gone.js');
  });

  it('does not report a submodule guess that missed', () => {
    // `from pkg.util import Thing` also tries `pkg.util.Thing`. `Thing` is a
    // class, not a module, and saying so would be noise on every Python file.
    const graph = build({
      'pkg/__init__.py': '',
      'pkg/util.py': 'class Thing:\n    pass\n',
      'main.py': 'from pkg.util import Thing\n',
    });

    expect(edgePairs(graph)).toEqual(['main.py -> pkg/util.py']);
    expect(graph.limitations).toEqual([]);
  });

  it('never turns an uncertain guess into an external dependency', () => {
    // `from fastapi import FastAPI` also tries `fastapi.FastAPI`. `FastAPI`
    // is a class, and the dependency is `fastapi` — the certain record. An
    // edge to `external:fastapi.FastAPI` would invent a package that does not
    // exist, and it would appear once per imported name.
    const graph = build({ 'main.py': 'from fastapi import FastAPI, Depends\n' });

    expect(edgePairs(graph)).toEqual(['main.py -> external:fastapi']);
    expect(graph.limitations).toEqual([]);
  });

  it('does not report a relative submodule guess that missed', () => {
    // `from . import missing` also tries `.missing`. If that file is not
    // there, the name came from `__init__.py` — a normal import, not a
    // broken one.
    const graph = build({
      'pkg/__init__.py': '',
      'pkg/views.py': 'from . import missing\n',
    });

    expect(edgePairs(graph)).toEqual(['pkg/views.py -> pkg/__init__.py']);
    expect(graph.limitations).toEqual([]);
  });

  it('names a language it has no extractor for instead of contributing nothing', () => {
    const graph = build({ 'src/lib.cairo': 'func main() {}\n', 'src/other.cairo': 'func x() {}\n' });

    expect(graph.nodes).toEqual([]);
    expect(graph.limitations).toHaveLength(1);
    expect(graph.limitations[0]).toContain('Cairo');
    expect(graph.limitations[0]).toContain('2 file(s)');
  });

  it('ignores data and documentation formats entirely', () => {
    const graph = build({
      'package.json': '{"dependencies":{"react":"^19"}}',
      'README.md': '# hi',
    });

    expect(graph.nodes).toEqual([]);
    expect(graph.limitations).toEqual([]);
  });

  it('skips a file over the byte limit and says so (R-18)', () => {
    const huge = `import { b } from './b.js';\n${'// padding\n'.repeat(80_000)}`;
    const graph = build(
      { 'src/big.ts': huge, 'src/b.ts': 'export const b = 1;\n' },
      { maxFileBytes: 1024 }
    );

    expect(graph.edges).toEqual([]);
    expect(graph.limitations.some((line) => line.includes('exceeded'))).toBe(true);
  });

  it('reads a file that is exactly at the byte limit', () => {
    // The limit is a ceiling, not a threshold: a file of exactly the limit
    // is inside it.
    const source = "import './b.js';\n";
    const graph = build(
      { 'src/a.ts': source, 'src/b.ts': '' },
      { maxFileBytes: Buffer.byteLength(source) }
    );

    expect(edgePairs(graph)).toEqual(['src/a.ts -> src/b.ts']);
  });

  it('skips a file whose content was never fetched', () => {
    const graph = buildDependencyGraph({
      entries: [{ path: 'src/a.ts', size: 10 }],
      contents: new Map(),
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.limitations).toEqual([]);
  });

  it('does not fail the graph when one extractor throws', async () => {
    vi.resetModules();
    vi.doMock('./imports.js', async () => {
      const actual = await vi.importActual<typeof import('./imports.js')>('./imports.js');
      return {
        ...actual,
        extractImports: (path: string, content: string, language: string) => {
          if (path.endsWith('bad.ts')) throw new Error('extractor exploded');
          return actual.extractImports(path, content, language);
        },
      };
    });

    try {
      const { buildDependencyGraph: buildWithBrokenExtractor } = await import('./dependency-graph.js');
      const graph = buildWithBrokenExtractor({
        entries: [
          { path: 'src/bad.ts', size: 30 },
          { path: 'src/a.ts', size: 30 },
          { path: 'src/b.ts', size: 20 },
        ],
        contents: new Map([
          ['src/bad.ts', "import { b } from './b.js';\n"],
          ['src/a.ts', "import { b } from './b.js';\n"],
          ['src/b.ts', 'export const b = 1;\n'],
        ]),
      });

      expect(() => DependencyGraphSchema.parse(graph)).not.toThrow();
      expect(edgePairs(graph)).toEqual(['src/a.ts -> src/b.ts']);
      expect(graph.limitations.some((line) => line.includes('extractor exploded'))).toBe(true);
    } finally {
      vi.doUnmock('./imports.js');
      vi.resetModules();
    }
  });

  it('produces the same graph whatever order the tree was listed in', () => {
    const files: Record<string, string> = {
      'src/b.ts': "import { a } from './a.js';\n",
      'src/a.ts': 'export const a = 1;\n',
      'src/z.py': 'from a import b\n',
    };
    const forwards = build(files);
    const reversed: Record<string, string> = {};
    for (const key of Object.keys(files).reverse()) reversed[key] = files[key] ?? '';

    expect(build(reversed)).toEqual(forwards);
  });

  it('sorts nodes and edges so two runs are byte-identical', () => {
    const files = {
      'src/z.ts': "import { a } from './a.js';\n",
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': 'export const b = 1;\n',
    };
    expect(JSON.stringify(build(files))).toBe(JSON.stringify(build(files)));
  });

  it('sorts the node list by id, not by the order nodes were discovered', () => {
    // The target of the first edge is found before the file that wrote it, so
    // insertion order would put `src/b.ts` first.
    const graph = build({
      'src/a.ts': "import { b } from './b.js';\n",
      'src/b.ts': '',
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('sorts the edge list by target, not by the order the specifiers were written', () => {
    // `./b.js` sorts before `react`, but `external:react` sorts before
    // `src/b.ts`. The artifact has to be ordered by where the edge goes, or
    // two repositories with the same imports listed differently would produce
    // different bytes.
    const graph = build({
      'src/a.ts': "import { b } from './b.js';\nimport { jsx } from 'react/jsx-runtime';\n",
      'src/b.ts': '',
    });

    expect(edgePairs(graph)).toEqual(['src/a.ts -> external:react', 'src/a.ts -> src/b.ts']);
  });

  it('does not mutate the inputs it was given', () => {
    const entries: FileEntry[] = [{ path: 'src/a.ts', size: 26 }];
    const contents = new Map([['src/a.ts', "import x from './x.js';\n"]]);
    const entriesCopy = [...entries];

    buildDependencyGraph({ entries, contents });

    expect(entries).toEqual(entriesCopy);
    expect(contents.get('src/a.ts')).toBe("import x from './x.js';\n");
  });

  it('caps the edge list and reports the true total', () => {
    const graph = build(
      {
        'src/a.ts': "import './b.js';\nimport './c.js';\nimport './d.js';\n",
        'src/b.ts': '',
        'src/c.ts': '',
        'src/d.ts': '',
      },
      { maxEdges: 1 }
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.limitations.some((line) => line.includes('first 1 of 3 edges'))).toBe(true);
  });

  it('caps the node list and reports the true total', () => {
    const graph = build(
      {
        'src/a.ts': "import './b.js';\nimport './c.js';\n",
        'src/b.ts': '',
        'src/c.ts': '',
      },
      { maxNodes: 2 }
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.limitations.some((line) => line.includes('first 2 of 3 nodes'))).toBe(true);
  });

  it('caps the imports read from one file and says which file', () => {
    const graph = build(
      {
        'src/a.ts': "import './b.js';\nimport './c.js';\n",
        'src/b.ts': '',
        'src/c.ts': '',
      },
      { maxImportsPerFile: 1 }
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.limitations.some((line) => line.includes('src/a.ts') && line.includes('1 import'))).toBe(
      true
    );
  });

  it('does not claim a cap when nothing was cut', () => {
    const graph = build(
      { 'src/a.ts': "import './b.js';\n", 'src/b.ts': '' },
      { maxEdges: 10, maxNodes: 10, maxImportsPerFile: 10 }
    );

    expect(graph.limitations).toEqual([]);
  });

  it('says how many more files had their imports capped', () => {
    // The per-file list stops at MAX_FAILURE_LINES. A list that stops must not
    // read as the whole list, so the remainder gets its own line.
    const files: Record<string, string> = { 'src/target.ts': '', 'src/other.ts': '' };
    for (let index = 0; index < 21; index += 1) {
      files[`src/f${index}.ts`] = "import './target.js';\nimport './other.js';\n";
    }

    const graph = build(files, { maxImportsPerFile: 1 });

    expect(graph.limitations.filter((line) => line.includes('only the first 1'))).toHaveLength(20);
    expect(graph.limitations.some((line) => line.includes('more file(s) with capped imports'))).toBe(true);
  });
});

describe('buildDependencyGraph — the real fixtures', () => {
  it('has fixtures to run against', () => {
    expect(FIXTURE_NAMES.length).toBeGreaterThan(0);
  });

  for (const name of FIXTURE_NAMES) {
    it(`builds a schema-valid graph for ${name}, twice, identically`, () => {
      const { entries, contents } = loadFixture(name);
      const first = buildDependencyGraph({ entries, contents });
      const second = buildDependencyGraph({ entries, contents });

      expect(() => DependencyGraphSchema.parse(first)).not.toThrow();
      expect(first).toEqual(second);

      // Every edge points at a node that exists, and every edge carries a
      // line — an edge a consumer cannot trace is an edge it cannot check.
      const ids = new Set(first.nodes.map((node) => node.id));
      for (const edge of first.edges) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
        expect(edge.evidence.length).toBeGreaterThan(0);
        expect(edge.evidence.length).toBe(edge.weight);
      }
    });
  }
});
