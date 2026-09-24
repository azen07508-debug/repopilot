/**
 * Entrypoint detection tests.
 *
 * The load-bearing test in this file is "never reports a path that is not
 * in the tree": every other behaviour is a matter of taste, while that one
 * is the difference between a map an agent can navigate and a map that
 * sends it to a file which does not exist.
 */
import { describe, it, expect } from 'vitest';
import { MAX_ENTRYPOINTS, detectEntrypoints } from './entrypoints.js';
import type { FileEntry } from '../../git/files.js';

function tree(paths: string[], contents: Record<string, string> = {}) {
  const entries: FileEntry[] = paths.map((path) => ({
    path,
    size: contents[path]?.length ?? 10,
  }));
  return { entries, contents: new Map(Object.entries(contents)) };
}

describe('detectEntrypoints', () => {
  it('finds the conventional src/index and calls it a library', () => {
    const entrypoints = detectEntrypoints(tree(['src/index.ts', 'README.md']));
    expect(entrypoints).toHaveLength(1);
    expect(entrypoints[0]).toMatchObject({ path: 'src/index.ts', kind: 'library', confidence: 0.85 });
  });

  it('finds an entry file in every workspace package, not only at the root', () => {
    const entrypoints = detectEntrypoints(
      tree(['packages/core/src/index.ts', 'packages/web/src/index.ts'])
    );
    expect(entrypoints.map((e) => e.path).sort()).toEqual([
      'packages/core/src/index.ts',
      'packages/web/src/index.ts',
    ]);
  });

  it('never reports a path that is not in the tree', () => {
    // The ordinary case for a compiled package: `bin` and `main` point at
    // build output that was never committed.
    const entrypoints = detectEntrypoints(
      tree(['package.json'], {
        'package.json': JSON.stringify({
          name: 'demo',
          bin: { demo: 'dist/cli.js' },
          main: './dist/index.js',
        }),
      })
    );
    expect(entrypoints).toEqual([]);
  });

  it('reports the file a bin field points at, when that file exists', () => {
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'bin/run.js'], {
        'package.json': JSON.stringify({ bin: { run: './bin/run.js' } }),
      })
    );
    expect(entrypoints).toHaveLength(1);
    expect(entrypoints[0]).toMatchObject({ path: 'bin/run.js', kind: 'cli', confidence: 0.95 });
  });

  it('resolves an extensionless main the way Node does', () => {
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'lib/entry.ts'], {
        'package.json': JSON.stringify({ main: 'lib/entry' }),
      })
    );
    expect(entrypoints.map((e) => e.path)).toEqual(['lib/entry.ts']);
  });

  it('resolves a directory main to its index file', () => {
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'lib/index.js'], {
        'package.json': JSON.stringify({ main: './lib' }),
      })
    );
    expect(entrypoints.map((e) => e.path)).toEqual(['lib/index.js']);
  });

  it('does not map a dist target onto a source file', () => {
    // `dist/thing.js` -> `lib/thing.ts` is a real build convention and an
    // unverifiable one. Guessing it hands the agent a path the package
    // does not ship, which is worse than reporting no entrypoint.
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'lib/thing.ts'], {
        'package.json': JSON.stringify({ main: './dist/thing.js' }),
      })
    );
    expect(entrypoints).toEqual([]);
  });

  it('ignores exports conditions that are not files in the repository', () => {
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'src/public.ts'], {
        'package.json': JSON.stringify({
          exports: { '.': { types: './dist/public.d.ts', default: './dist/public.js' } },
        }),
      })
    );
    expect(entrypoints).toEqual([]);
  });

  it('uses an exports leaf that does exist', () => {
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'src/public.ts'], {
        'package.json': JSON.stringify({ exports: { '.': './src/public.ts' } }),
      })
    );
    expect(entrypoints.map((e) => e.path)).toEqual(['src/public.ts']);
    expect(entrypoints[0]?.kind).toBe('library');
  });

  it('requires a Go main.go to declare package main', () => {
    const yes = detectEntrypoints(
      tree(['cmd/serve/main.go'], { 'cmd/serve/main.go': 'package main\n\nfunc main() {}\n' })
    );
    expect(yes).toHaveLength(1);
    expect(yes[0]).toMatchObject({ path: 'cmd/serve/main.go', kind: 'app', confidence: 0.9 });
    expect(yes[0]?.evidence[0]?.startLine).toBe(1);

    const no = detectEntrypoints(tree(['util/main.go'], { 'util/main.go': 'package util\n' }));
    expect(no).toEqual([]);
  });

  it('treats a Solidity test contract as a test, not an entrypoint', () => {
    const entrypoints = detectEntrypoints(
      tree(['test/Token.t.sol', 'script/Deploy.s.sol', 'contracts/Token.sol'], {
        'test/Token.t.sol': 'contract TokenTest {}\n',
        'script/Deploy.s.sol': 'contract Deploy {}\n',
        'contracts/Token.sol': 'contract Token {}\n',
      })
    );
    expect(entrypoints.map((e) => e.path).sort()).toEqual([
      'contracts/Token.sol',
      'script/Deploy.s.sol',
    ]);
    expect(entrypoints.find((e) => e.path === 'script/Deploy.s.sol')?.kind).toBe('contract');
  });

  it('finds a test-runner configuration', () => {
    const entrypoints = detectEntrypoints(tree(['vitest.config.ts', 'src/a.ts']));
    expect(entrypoints).toHaveLength(1);
    expect(entrypoints[0]).toMatchObject({ path: 'vitest.config.ts', kind: 'test-runner' });
  });

  it('lets the stronger signal decide the kind, and keeps both as evidence', () => {
    // `src/index.ts` says library at 0.85; the `bin` field says cli at 0.95.
    const entrypoints = detectEntrypoints(
      tree(['package.json', 'src/index.ts'], {
        'package.json': JSON.stringify({ bin: { demo: './src/index.ts' } }),
      })
    );
    expect(entrypoints).toHaveLength(1);
    expect(entrypoints[0]?.kind).toBe('cli');
    expect(entrypoints[0]?.evidence).toHaveLength(2);
  });

  it('records the line a Dockerfile CMD was found on', () => {
    const entrypoints = detectEntrypoints(
      tree(['Dockerfile'], { Dockerfile: 'FROM node:22\nWORKDIR /app\nCMD ["node","index.js"]\n' })
    );
    expect(entrypoints).toHaveLength(1);
    expect(entrypoints[0]?.evidence[0]?.startLine).toBe(3);
  });

  it('gives every entrypoint at least one piece of evidence', () => {
    const entrypoints = detectEntrypoints(
      tree(['src/index.ts', 'Dockerfile', 'vitest.config.ts'], {
        Dockerfile: 'FROM node\nCMD ["node","x"]\n',
      })
    );
    expect(entrypoints.length).toBeGreaterThan(0);
    for (const entrypoint of entrypoints) expect(entrypoint.evidence.length).toBeGreaterThan(0);
  });

  it('is deterministic regardless of the order the tree was listed in', () => {
    const paths = ['src/index.ts', 'vitest.config.ts', 'index.html', 'src/server.ts'];
    const forwards = detectEntrypoints(tree(paths));
    const backwards = detectEntrypoints(tree([...paths].reverse()));
    expect(forwards).toEqual(backwards);
  });

  it('orders by descending confidence', () => {
    const entrypoints = detectEntrypoints(tree(['src/index.ts', 'vitest.config.ts', 'index.html']));
    const confidences = entrypoints.map((e) => e.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });

  it('caps the list', () => {
    const paths = Array.from(
      { length: MAX_ENTRYPOINTS + 20 },
      (_, i) => `packages/p${String(i).padStart(3, '0')}/src/index.ts`
    );
    expect(detectEntrypoints(tree(paths))).toHaveLength(MAX_ENTRYPOINTS);
  });

  it('returns nothing for an empty tree', () => {
    expect(detectEntrypoints({ entries: [], contents: new Map() })).toEqual([]);
  });

  it('skips a manifest whose content was never fetched', () => {
    const entrypoints = detectEntrypoints({
      entries: [{ path: 'package.json', size: 100 }],
      contents: new Map(),
    });
    expect(entrypoints).toEqual([]);
  });
});
