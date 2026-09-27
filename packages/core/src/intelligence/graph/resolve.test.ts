/**
 * Specifier resolution.
 *
 * The assertions that matter are the ones a plausible implementation gets
 * wrong: a `..` that walks out of the repository, a `.js` import that names a
 * `.ts` file, a Python leading dot that means "my own package", and a miss
 * that gets answered with a nearby path instead of with "I do not know".
 */
import { describe, it, expect } from 'vitest';
import {
  dirOf,
  indexTree,
  isRelativeSpecifier,
  normalisePath,
  packageNameOf,
  resolveSpecifier,
  stripRootPrefix,
  type ResolveInput,
  type TreeIndex,
} from './resolve.js';

function tree(paths: string[]): TreeIndex {
  return indexTree(paths.map((path) => ({ path, size: 1 })));
}

function resolve(
  specifier: string,
  fromPath: string,
  language: string,
  paths: string[],
  extra: Partial<ResolveInput> = {}
) {
  return resolveSpecifier({
    specifier,
    fromPath,
    language,
    tree: tree(paths),
    ...extra,
  });
}

describe('path helpers', () => {
  it('collapses . and .. , and refuses to walk above the root', () => {
    expect(normalisePath('a/b/../c')).toBe('a/c');
    expect(normalisePath('./a/b')).toBe('a/b');
    expect(normalisePath('a//b')).toBe('a/b');
    expect(normalisePath('..')).toBeNull();
    expect(normalisePath('a/../..')).toBeNull();
    expect(normalisePath('.')).toBeNull();
  });

  it('takes the directory of a path', () => {
    expect(dirOf('a/b/c.ts')).toBe('a/b');
    expect(dirOf('a.ts')).toBe('');
  });

  it('reads a package name, scoped or not', () => {
    expect(packageNameOf('react')).toBe('react');
    expect(packageNameOf('react/jsx-runtime')).toBe('react');
    expect(packageNameOf('@scope/pkg/deep/er')).toBe('@scope/pkg');
    expect(packageNameOf('@scope')).toBe('@scope');
  });

  it('strips a root prefix, and refuses one that is not a prefix', () => {
    expect(stripRootPrefix('github.com/me/proj/internal/x', ['github.com/me/proj'])).toBe('internal/x');
    expect(stripRootPrefix('github.com/me/other/x', ['github.com/me/proj'])).toBeNull();
    // The prefix itself is the root, which no file is.
    expect(stripRootPrefix('github.com/me/proj', ['github.com/me/proj'])).toBeNull();
  });

  it('requires the prefix to end at a path boundary', () => {
    // `projextra` is a different module that merely starts with the same
    // letters. Reading it as this repository's would resolve an import from
    // somewhere else onto a file here — an edge to the wrong file.
    expect(stripRootPrefix('github.com/me/projextra/x', ['github.com/me/proj'])).toBeNull();
  });

  it('tolerates a trailing slash on the prefix', () => {
    expect(stripRootPrefix('github.com/me/proj/internal/x', ['github.com/me/proj/'])).toBe('internal/x');
  });

  it('recognises a relative specifier', () => {
    expect(isRelativeSpecifier('./a')).toBe(true);
    expect(isRelativeSpecifier('../a')).toBe(true);
    expect(isRelativeSpecifier('.')).toBe(true);
    expect(isRelativeSpecifier('a/b')).toBe(false);
    expect(isRelativeSpecifier('.hidden')).toBe(false);
  });

  it('indexes every ancestor directory of every file', () => {
    const index = tree(['a/b/c.ts', 'a/d.ts']);
    expect([...index.directories].sort()).toEqual(['a', 'a/b']);
    expect(index.files.has('a/b/c.ts')).toBe(true);
  });
});

describe('resolveSpecifier — relative', () => {
  it('finds a sibling with an appended extension', () => {
    expect(resolve('./b', 'src/a.ts', 'TypeScript', ['src/a.ts', 'src/b.ts'])).toEqual({
      kind: 'file',
      path: 'src/b.ts',
    });
  });

  it('finds a directory index', () => {
    expect(resolve('./b', 'src/a.ts', 'TypeScript', ['src/a.ts', 'src/b/index.ts'])).toEqual({
      kind: 'file',
      path: 'src/b/index.ts',
    });
  });

  it('walks up with ..', () => {
    expect(resolve('../lib/c', 'src/deep/a.ts', 'TypeScript', ['src/deep/a.ts', 'src/lib/c.ts'])).toEqual(
      { kind: 'file', path: 'src/lib/c.ts' }
    );
  });

  it('reads a .js specifier as the .ts file it names (D-001)', () => {
    // NodeNext ESM requires the emitted extension in the source, so the file
    // on disk is `index.ts`. Without the rewrite every internal import in
    // such a repository is reported as broken.
    expect(resolve('./index.js', 'src/a.test.ts', 'TypeScript', ['src/a.test.ts', 'src/index.ts'])).toEqual(
      { kind: 'file', path: 'src/index.ts' }
    );
    expect(resolve('./view.jsx', 'src/a.tsx', 'TypeScript', ['src/a.tsx', 'src/view.tsx'])).toEqual({
      kind: 'file',
      path: 'src/view.tsx',
    });
  });

  it('prefers a real .js file over its .ts original', () => {
    expect(
      resolve('./x.js', 'src/a.ts', 'TypeScript', ['src/a.ts', 'src/x.js', 'src/x.ts'])
    ).toEqual({ kind: 'file', path: 'src/x.js' });
  });

  it('prefers the importing language when a repository holds both', () => {
    expect(resolve('./util', 'src/a.py', 'Python', ['src/a.py', 'src/util.ts', 'src/util.py'])).toEqual({
      kind: 'file',
      path: 'src/util.py',
    });
  });

  it('reports a relative miss as unresolved rather than as an external package', () => {
    const result = resolve('./missing', 'src/a.ts', 'TypeScript', ['src/a.ts']);
    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') return;
    expect(result.reason).toContain('missing');
  });

  it('refuses a specifier that walks above the repository root', () => {
    // `src/a.ts` can reach the root, so `../../etc/passwd` is outside it.
    const result = resolve('../../etc/passwd', 'src/a.ts', 'TypeScript', ['src/a.ts', 'etc/passwd']);
    expect(result.kind).toBe('unresolved');
  });

  it('resolves a Solidity import', () => {
    expect(
      resolve('../contracts/Counter.sol', 'test/Counter.t.sol', 'Solidity', [
        'test/Counter.t.sol',
        'contracts/Counter.sol',
      ])
    ).toEqual({ kind: 'file', path: 'contracts/Counter.sol' });
  });
});

describe('resolveSpecifier — bare', () => {
  it('is external when nothing in the repository claims the name', () => {
    expect(resolve('react', 'src/a.ts', 'TypeScript', ['src/a.ts'])).toEqual({
      kind: 'external',
      package: 'react',
    });
  });

  it('is external for a scoped package, named without its subpath', () => {
    expect(resolve('@scope/pkg/sub', 'src/a.ts', 'TypeScript', ['src/a.ts'])).toEqual({
      kind: 'external',
      package: '@scope/pkg',
    });
  });

  it('resolves a workspace module to its entry file', () => {
    const modules = new Map([['@repopilot/core', 'packages/core']]);
    const paths = ['packages/core/src/index.ts', 'apps/api/src/a.ts'];
    expect(resolve('@repopilot/core', 'apps/api/src/a.ts', 'TypeScript', paths, { modules })).toEqual({
      kind: 'file',
      path: 'packages/core/src/index.ts',
    });
  });

  it('reads a subpath as the package it starts with', () => {
    // The module map is keyed by package name, so `@repopilot/core/sub` has
    // to be looked up as `@repopilot/core`. Nothing here can name the file a
    // subpath points at, which is why the answer is the module, not a file.
    const modules = new Map([['@repopilot/core', 'packages/core']]);
    const paths = ['packages/core/src/lib.ts', 'apps/api/src/a.ts'];
    expect(resolve('@repopilot/core/sub', 'apps/api/src/a.ts', 'TypeScript', paths, { modules })).toEqual({
      kind: 'module',
      path: 'packages/core',
      name: '@repopilot/core',
    });
  });

  it('resolves a root prefix outside Go as well', () => {
    // `rootPrefixes` is documented as "import prefixes that stand for the
    // repository root", not as a Go feature; a tsconfig path alias is the
    // same idea spelled differently.
    expect(
      resolve('@app/utils', 'src/a.ts', 'TypeScript', ['src/a.ts', 'utils.ts'], {
        rootPrefixes: ['@app'],
      })
    ).toEqual({ kind: 'file', path: 'utils.ts' });
  });

  it('falls back to a module node when the entry file is not where anyone expects', () => {
    const modules = new Map([['@repopilot/core', 'packages/core']]);
    const paths = ['packages/core/src/lib.ts', 'apps/api/src/a.ts'];
    expect(resolve('@repopilot/core', 'apps/api/src/a.ts', 'TypeScript', paths, { modules })).toEqual({
      kind: 'module',
      path: 'packages/core',
      name: '@repopilot/core',
    });
  });

  it('treats an absolute filesystem path as unresolved, not as a package', () => {
    const result = resolve('/etc/passwd', 'src/a.sh', 'Shell', ['src/a.sh']);
    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') return;
    expect(result.reason).toContain('absolute');
  });
});

describe('resolveSpecifier — Python', () => {
  const paths = ['pkg/__init__.py', 'pkg/mod.py', 'pkg/sub/__init__.py', 'pkg/util.py', 'main.py'];

  it('resolves a dotted absolute import', () => {
    expect(resolve('pkg.util', 'main.py', 'Python', paths)).toEqual({ kind: 'file', path: 'pkg/util.py' });
  });

  it('resolves a package to its __init__', () => {
    expect(resolve('pkg', 'main.py', 'Python', paths)).toEqual({ kind: 'file', path: 'pkg/__init__.py' });
  });

  it('reads one leading dot as the file’s own package', () => {
    expect(resolve('.util', 'pkg/mod.py', 'Python', paths)).toEqual({ kind: 'file', path: 'pkg/util.py' });
    expect(resolve('.', 'pkg/mod.py', 'Python', paths)).toEqual({
      kind: 'file',
      path: 'pkg/__init__.py',
    });
  });

  it('reads two leading dots as the parent package', () => {
    // `pkg/sub/mod.py` is in package `pkg.sub`, so `..` is `pkg` and the rest
    // is appended to it — not resolved against the repository root.
    expect(resolve('..util', 'pkg/sub/mod.py', 'Python', [...paths, 'pkg/sub/mod.py'])).toEqual({
      kind: 'file',
      path: 'pkg/util.py',
    });
  });

  it('finds a module under a src/ layout', () => {
    expect(resolve('pkg.util', 'main.py', 'Python', ['src/pkg/util.py', 'main.py'])).toEqual({
      kind: 'file',
      path: 'src/pkg/util.py',
    });
  });

  it('refuses a relative import that walks above the root', () => {
    expect(resolve('...x', 'pkg/mod.py', 'Python', paths).kind).toBe('unresolved');
  });

  it('allows a relative import that lands exactly on the root', () => {
    // `pkg/sub/mod.py` is in package `pkg.sub`, so three dots is the root and
    // the rest is appended there. Only walking *above* the root is refused.
    expect(resolve('...util', 'pkg/sub/mod.py', 'Python', ['pkg/sub/mod.py', 'util.py'])).toEqual({
      kind: 'file',
      path: 'util.py',
    });
  });

  it('reads a path-style specifier against the same candidates', () => {
    // `./x` is not how Python spells a relative import, but a caller that
    // writes it means `from . import x` — and that has to reach a package
    // through its `__init__.py`, not through `index.py`.
    expect(resolve('./x', 'src/a.py', 'Python', ['src/a.py', 'src/x/__init__.py'])).toEqual({
      kind: 'file',
      path: 'src/x/__init__.py',
    });
  });

  it('refuses a relative import that walks above the root', () => {
    // A root-level `a.py` is not in a package, so `..` has nowhere to go.
    // Clamping to the root instead would resolve it to `x.py`, which is not
    // what it names.
    expect(resolve('../x', 'a.py', 'Python', ['a.py', 'x.py']).kind).toBe('unresolved');
  });
});

describe('resolveSpecifier — Go', () => {
  const paths = ['go.mod', 'internal/x/a.go', 'cmd/main.go'];

  it('resolves a module-path import to the package directory', () => {
    expect(
      resolve('github.com/me/proj/internal/x', 'cmd/main.go', 'Go', paths, {
        rootPrefixes: ['github.com/me/proj'],
      })
    ).toEqual({ kind: 'module', path: 'internal/x', name: 'x' });
  });

  it('is external when no prefix claims the import', () => {
    expect(resolve('github.com/other/lib', 'cmd/main.go', 'Go', paths)).toEqual({
      kind: 'external',
      package: 'github.com',
    });
  });

  it('is unresolved when the prefix matches but the directory is absent', () => {
    const result = resolve('github.com/me/proj/internal/gone', 'cmd/main.go', 'Go', paths, {
      rootPrefixes: ['github.com/me/proj'],
    });
    expect(result.kind).toBe('unresolved');
  });
});

describe('resolveSpecifier — Rust', () => {
  const paths = [
    'src/lib.rs',
    'src/a.rs',
    'src/a/b.rs',
    'src/a/other.rs',
    'src/util/mod.rs',
    'src/other.rs',
  ];

  it('roots crate:: at the crate source', () => {
    expect(resolve('crate::other', 'src/a.rs', 'Rust', paths)).toEqual({
      kind: 'file',
      path: 'src/other.rs',
    });
    expect(resolve('crate::util', 'src/a.rs', 'Rust', paths)).toEqual({
      kind: 'file',
      path: 'src/util/mod.rs',
    });
  });

  it('reads self:: against the file’s own module directory, not its parent', () => {
    // `src/a.rs` owns `src/a/`, which is where `mod b;` looks.
    expect(resolve('self::b', 'src/a.rs', 'Rust', paths)).toEqual({ kind: 'file', path: 'src/a/b.rs' });
  });

  it('gives a crate root the directory it sits in', () => {
    // `src/lib.rs` is the crate root, so `mod a;` is `src/a.rs` — not
    // `src/lib/a.rs`. The same holds for `main.rs` and `mod.rs`.
    expect(resolve('self::a', 'src/lib.rs', 'Rust', paths)).toEqual({ kind: 'file', path: 'src/a.rs' });
  });

  it('reads super:: as the parent module', () => {
    // `src/a/b.rs` is module `crate::a::b`, so `super` is `crate::a` and
    // `super::other` is `src/a/other.rs` — not `src/other.rs`.
    expect(resolve('super::other', 'src/a/b.rs', 'Rust', paths)).toEqual({
      kind: 'file',
      path: 'src/a/other.rs',
    });
    expect(resolve('super::super::other', 'src/a/b.rs', 'Rust', paths)).toEqual({
      kind: 'file',
      path: 'src/other.rs',
    });
  });
});

describe('resolveSpecifier — Java and Kotlin', () => {
  it('reads a dotted import against a source root', () => {
    expect(resolve('com.acme.Thing', 'app/Main.java', 'Java', ['src/main/java/com/acme/Thing.java'])).toEqual(
      { kind: 'file', path: 'src/main/java/com/acme/Thing.java' }
    );
  });

  it('prefers the repository-relative reading when it exists', () => {
    expect(resolve('com.acme.Thing', 'app/Main.java', 'Java', ['com/acme/Thing.java'])).toEqual({
      kind: 'file',
      path: 'com/acme/Thing.java',
    });
  });
});

describe('resolveSpecifier — determinism and edges', () => {
  it('answers the same way twice', () => {
    const paths = ['src/a.ts', 'src/b.ts'];
    expect(resolve('./b', 'src/a.ts', 'TypeScript', paths)).toEqual(
      resolve('./b', 'src/a.ts', 'TypeScript', paths)
    );
  });

  it('treats an empty specifier as unresolved rather than as the root', () => {
    expect(resolve('   ', 'src/a.ts', 'TypeScript', ['src/a.ts']).kind).toBe('unresolved');
  });
});
