/**
 * Module detection tests.
 *
 * Two of these tests exist because of failures found elsewhere in this
 * codebase, not because the behaviour looked risky on paper:
 *
 *   - "invents no module for a workspace glob that matches no directory"
 *     is the module-level form of the tarball-root bug: a name derived
 *     from a pattern rather than from the tree.
 *   - "does not treat a container directory as a module" is what makes
 *     `packages/` stay a container while `packages/core` becomes a module.
 */
import { describe, it, expect } from 'vitest';
import { MIN_MODULE_FILES, detectModules } from './modules.js';
import { parseManifest, type ManifestParseResult } from './manifests.js';
import type { FileEntry } from '../../git/files.js';

const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|pnpm-workspace\.ya?ml|requirements[^/]*\.txt)$/;

function run(files: Record<string, string>, repoName = 'demo') {
  const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    size: content.length,
  }));
  const manifests = new Map<string, ManifestParseResult>();
  for (const [path, content] of Object.entries(files)) {
    if (MANIFEST.test(path)) manifests.set(path, parseManifest(path, content));
  }
  const workspaceGlobs = [
    ...new Set([...manifests.values()].flatMap((m) => m.workspaceGlobs)),
  ].sort();
  return detectModules({ repoName, entries, manifests, workspaceGlobs, entrypoints: [] });
}

describe('detectModules', () => {
  it('turns pnpm workspace globs into modules named by their manifest', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
      'packages/core/package.json': JSON.stringify({ name: '@demo/core' }),
      'packages/core/src/index.ts': 'export const a = 1;\n',
      'apps/api/package.json': JSON.stringify({ name: '@demo/api' }),
      'apps/api/src/server.ts': 'export const b = 2;\n',
    });
    expect(modules.map((m) => m.name).sort()).toEqual(['@demo/api', '@demo/core']);
    expect(modules.every((m) => m.kind === 'workspace-package')).toBe(true);
  });

  it('reads package.json workspaces as well as pnpm-workspace.yaml', () => {
    const { modules } = run({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/a/src/index.ts': 'export const a = 1;\n',
    });
    expect(modules.map((m) => m.name)).toContain('a');
  });

  it('does not turn a lone pnpm-workspace.yaml into a root module', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/a/src/index.ts': 'export const a = 1;\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['packages/a']);
  });

  it('does turn a root package.json into a module', () => {
    const { modules } = run({
      'package.json': JSON.stringify({ name: 'single-package' }),
      'src/index.ts': 'export const a = 1;\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['.']);
    expect(modules[0]?.name).toBe('single-package');
    expect(modules[0]?.kind).toBe('package');
  });

  it('links workspace packages by manifest dependency name', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/core/package.json': JSON.stringify({ name: '@demo/core' }),
      'packages/core/src/index.ts': 'export const a = 1;\n',
      'packages/api/package.json': JSON.stringify({ name: '@demo/api', dependencies: { '@demo/core': 'workspace:*' } }),
      'packages/api/src/index.ts': 'export const b = 2;\n',
    });
    expect(modules.find((m) => m.name === '@demo/api')?.dependsOn).toEqual(['@demo/core']);
    expect(modules.find((m) => m.name === '@demo/core')?.dependsOn).toEqual([]);
  });

  it('does not turn an external dependency into a module edge', () => {
    const { modules } = run({
      'package.json': JSON.stringify({ name: 'demo', dependencies: { zod: '^3.24.1' } }),
      'src/index.ts': 'export const a = 1;\n',
    });
    expect(modules[0]?.dependsOn).toEqual([]);
  });

  it('invents no module for a workspace glob that matches no directory', () => {
    const { modules, notes } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'services/*'\n",
      'src/index.ts': 'export const a = 1;\n',
    });
    expect(modules).toEqual([]);
    expect(notes.join(' ')).toContain('services/*');
  });

  it('reports a recursive workspace glob that matches no directory', () => {
    // The `/*` shape is covered above; `/**` takes a different branch with
    // its own filter and its own `unexpanded` push, so a pattern that
    // matched nothing there would have been dropped in silence. A mutation
    // that removed exactly that push was the one mutation of sixteen the
    // suite did not catch, which is why this test exists.
    const { modules, notes } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'services/**'\n",
      'src/index.ts': 'export const a = 1;\n',
    });
    expect(modules).toEqual([]);
    expect(notes.join(' ')).toContain('services/**');
  });

  it('ignores a matched directory that has no manifest', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/empty/README.md': '# nothing here\n',
      'packages/real/package.json': JSON.stringify({ name: 'real' }),
      'packages/real/src/index.ts': 'export const a = 1;\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['packages/real']);
  });

  it('reports a glob shape it will not approximate', () => {
    const { modules, notes } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/**/*'\n",
      'packages/a/b/package.json': JSON.stringify({ name: 'b' }),
      'packages/a/b/src/index.ts': 'export const a = 1;\n',
    });
    expect(notes.join(' ')).toContain('packages/**/*');
    // The nested package is still found by the manifest rule.
    expect(modules.map((m) => m.path)).toEqual(['packages/a/b']);
  });

  it('names a module after its directory when the manifest has no name', () => {
    const { modules } = run({
      'services/worker/package.json': JSON.stringify({}),
      'services/worker/src/index.ts': 'export const a = 1;\n',
    });
    expect(modules.map((m) => m.name)).toEqual(['worker']);
  });

  it('does not treat a container directory as a module', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/a/src/index.ts': 'export const a = 1;\n',
      'packages/b/package.json': JSON.stringify({ name: 'b' }),
      'packages/b/src/index.ts': 'export const b = 2;\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['packages/a', 'packages/b']);
    expect(modules.map((m) => m.path)).not.toContain('packages');
  });

  it('promotes a top-level directory with enough source to a module', () => {
    const { modules } = run({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'README.md': '# hi\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['src']);
    expect(modules[0]).toMatchObject({ kind: 'directory', fileCount: 3, name: 'src' });
  });

  it('leaves a top-level directory below the threshold alone', () => {
    const { modules } = run({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
    });
    expect(modules).toEqual([]);
  });

  it('falls back to a single root module for a flat repository', () => {
    const { modules } = run(
      {
        'index.ts': 'export const a = 1;\n',
        'util.ts': 'export const b = 2;\n',
        'types.ts': 'export const c = 3;\n',
      },
      'flat-repo'
    );
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      path: '.',
      name: 'flat-repo',
      kind: 'directory',
      fileCount: 3,
    });
  });

  it('finds a contracts package', () => {
    const { modules } = run({
      'contracts/Token.sol': 'contract Token {}\n',
      'contracts/Vault.sol': 'contract Vault {}\n',
      'README.md': '# hi\n',
    });
    expect(modules.map((m) => m.path)).toEqual(['contracts']);
    expect(modules[0]?.kind).toBe('contract-package');
    expect(modules[0]?.languages).toEqual(['Solidity']);
  });

  it('finds a root Foundry project', () => {
    const { modules } = run(
      {
        'foundry.toml': '[profile.default]\n',
        'src/Token.sol': 'contract Token {}\n',
        'test/Token.t.sol': 'contract T {}\n',
        'README.md': '# hi\n',
      },
      'my-protocol'
    );
    expect(modules.map((m) => m.path)).toEqual(['.']);
    expect(modules[0]?.kind).toBe('contract-package');
  });

  it('lists the languages present in a module', () => {
    const { modules } = run({
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
      'apps/web/src/index.ts': 'export const a = 1;\n',
      'apps/web/src/style.css': 'body { color: red; }\n',
    });
    expect(modules[0]?.languages).toEqual(['CSS', 'JSON', 'TypeScript']);
    expect(modules[0]?.fileCount).toBe(3);
  });

  it('keeps the first module when two share a name, and says so', () => {
    const { modules, notes } = run({
      'packages/x/core/package.json': JSON.stringify({ name: 'core' }),
      'packages/x/core/src/index.ts': 'export const a = 1;\n',
      'packages/y/core/package.json': JSON.stringify({ name: 'core' }),
      'packages/y/core/src/index.ts': 'export const b = 2;\n',
    });
    expect(modules).toHaveLength(2);
    expect(notes.join(' ')).toContain('"core"');
  });

  it('scores a depended-on module above an isolated one', () => {
    const { modules } = run({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/shared/package.json': JSON.stringify({ name: 'shared' }),
      'packages/shared/src/index.ts': 'export const a = 1;\n',
      'packages/a/package.json': JSON.stringify({ name: 'a', dependencies: { shared: '1.0.0' } }),
      'packages/a/src/index.ts': 'export const b = 2;\n',
      'packages/b/package.json': JSON.stringify({ name: 'b', dependencies: { shared: '1.0.0' } }),
      'packages/b/src/index.ts': 'export const c = 3;\n',
    });
    expect(modules[0]?.name).toBe('shared');
    expect(modules[0]?.importance).toBeGreaterThan(modules[1]?.importance ?? 0);
  });

  it('is deterministic regardless of the order the tree was listed in', () => {
    const files: Record<string, string> = {
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/a/src/index.ts': 'export const a = 1;\n',
      'packages/b/package.json': JSON.stringify({ name: 'b', dependencies: { a: '1.0.0' } }),
      'packages/b/src/index.ts': 'export const b = 2;\n',
    };
    const forwards = run(files);
    const shuffled: Record<string, string> = {};
    for (const key of Object.keys(files).reverse()) shuffled[key] = files[key] ?? '';
    expect(run(shuffled)).toEqual(forwards);
  });

  it('exposes the threshold it uses', () => {
    expect(MIN_MODULE_FILES).toBe(3);
  });
});
