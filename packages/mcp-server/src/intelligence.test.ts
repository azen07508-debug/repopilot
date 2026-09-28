import { describe, it, expect, vi } from 'vitest';
import { buildDependencyGraph, buildSymbolMap, type RepoMetadata } from '@repopilot/core';
import {
  RepositorySnapshots,
  dependencyGraphView,
  symbolMapView,
  type RepositorySnapshot,
  type SnapshotLoader,
} from './intelligence.js';

const URL = 'https://github.com/repopilot/sample';

function metadata(name: string, defaultBranch = 'main'): RepoMetadata {
  return {
    owner: 'repopilot',
    name,
    defaultBranch,
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

/** A snapshot of `name`, holding `bytes` bytes of file content. */
function snapshot(name: string, bytes = 10, ref = 'main'): RepositorySnapshot {
  const content = 'x'.repeat(bytes);
  return {
    owner: 'repopilot',
    repo: name,
    ref,
    metadata: metadata(name),
    entries: [{ path: 'src/index.ts', size: bytes }],
    contents: new Map([['src/index.ts', content]]),
    truncated: false,
    degraded: false,
  };
}

/** A loader that answers with a fresh snapshot per repository. */
function recordingLoader(): SnapshotLoader & { mock: { calls: unknown[][] } } {
  return vi.fn(async (repoUrl: string) => {
    const name = repoUrl.slice(repoUrl.lastIndexOf('/') + 1);
    return snapshot(name);
  }) as unknown as SnapshotLoader & { mock: { calls: unknown[][] } };
}

describe('RepositorySnapshots', () => {
  it('reads a repository once and answers every later question from the cache', async () => {
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load });

    const first = await cache.get(URL);
    const second = await cache.get(URL);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('serves the ref it resolved from the same snapshot when the caller names it back', async () => {
    // The sequence the tools invite: get_repository_context answers with
    // repository.ref, and get_symbol_map is then called with that ref. Two
    // keys, one repository — fetching it again would be the exact cost this
    // cache was built to avoid.
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load });

    const unnamed = await cache.get(URL);
    const named = await cache.get(URL, 'main');

    expect(load).toHaveBeenCalledTimes(1);
    expect(named).toBe(unnamed);
    expect(cache.stats().snapshots).toBe(1);
  });

  it('does not serve a different ref from the default-branch snapshot', async () => {
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load });

    await cache.get(URL);
    await cache.get(URL, 'release-1.0');

    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1]?.[1]).toBe('release-1.0');
  });

  it('evicts the least recently used repository when the count bound is reached', async () => {
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load, maxSnapshots: 2 });

    await cache.get('https://github.com/repopilot/one');
    await cache.get('https://github.com/repopilot/two');
    await cache.get('https://github.com/repopilot/three');

    expect(cache.stats().snapshots).toBe(2);
    // `one` is gone, so asking for it again is a fetch.
    await cache.get('https://github.com/repopilot/one');
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('counts a cache hit as a use, so the hit is not the one evicted', async () => {
    // The re-insert on a hit is the whole of the LRU policy: without it the
    // Map's order is insertion order, and the repository read most recently
    // would be the next to go.
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load, maxSnapshots: 2 });
    const one = 'https://github.com/repopilot/one';
    const two = 'https://github.com/repopilot/two';

    await cache.get(one);
    await cache.get(two);
    await cache.get(one); // `one` is now the most recently used
    await cache.get('https://github.com/repopilot/three');

    await cache.get(one);
    expect(load).toHaveBeenCalledTimes(3); // one, two, three — `one` was still held
    await cache.get(two);
    expect(load).toHaveBeenCalledTimes(4); // `two` was the one evicted
  });

  it('evicts on the byte bound as well as the count bound', async () => {
    // A count bound alone allows `maxSnapshots` copies of a 50 MiB repository.
    const load = vi.fn(async (repoUrl: string) => {
      const name = repoUrl.slice(repoUrl.lastIndexOf('/') + 1);
      return snapshot(name, 1000);
    }) as unknown as SnapshotLoader;
    const cache = new RepositorySnapshots({
      allowedHosts: ['github.com'],
      load,
      maxSnapshots: 10,
      maxCachedBytes: 2500,
    });

    await cache.get('https://github.com/repopilot/one');
    await cache.get('https://github.com/repopilot/two');
    expect(cache.stats().bytes).toBe(2000);

    await cache.get('https://github.com/repopilot/three');
    expect(cache.stats().bytes).toBe(2000);
    expect(cache.stats().snapshots).toBe(2);
  });

  it('keeps the one snapshot that is larger than the whole byte bound', async () => {
    // Otherwise a repository over the bound evicts itself and is re-fetched on
    // every single call — the bound would make the cache a no-op for exactly
    // the repositories that cost the most to read.
    const load = vi.fn(async () => snapshot('huge', 5000)) as unknown as SnapshotLoader;
    const cache = new RepositorySnapshots({
      allowedHosts: ['github.com'],
      load,
      maxCachedBytes: 1000,
    });

    await cache.get(URL);
    await cache.get(URL);

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats().snapshots).toBe(1);
  });

  it('stores one entry when the same snapshot is reached by two keys', async () => {
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load });

    await cache.get(URL, 'main');
    await cache.get(URL); // the loader resolves `main` again, as the default branch

    expect(cache.stats().snapshots).toBe(1);
    expect(cache.stats().bytes).toBe(10);
  });

  it('reports what it is holding', async () => {
    const cache = new RepositorySnapshots({
      allowedHosts: ['github.com'],
      load: recordingLoader(),
      maxSnapshots: 3,
      maxCachedBytes: 4096,
    });

    expect(cache.stats()).toEqual({
      snapshots: 0,
      bytes: 0,
      maxSnapshots: 3,
      maxCachedBytes: 4096,
    });

    await cache.get(URL);
    expect(cache.stats()).toMatchObject({ snapshots: 1, bytes: 10 });
  });

  it('treats a trailing slash and a different case as the same repository', async () => {
    const load = recordingLoader();
    const cache = new RepositorySnapshots({ allowedHosts: ['github.com'], load });

    await cache.get('https://github.com/repopilot/sample/');
    await cache.get('https://GitHub.com/repopilot/sample');

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('the trimmed views', () => {
  /**
   * Built by the real builders rather than hand-written.
   *
   * A literal would have to keep up with two schemas by hand — an edge carries
   * a `kind` and a full evidence record — and a view test that fails because
   * the fixture went stale says nothing about the view.
   */
  const files: Record<string, string> = {
    // `./nowhere.js` matches no file, so the builder refuses it and reports it
    // rather than pointing the edge at the nearest-looking path.
    'src/a.ts': [
      "import react from 'react';",
      "import { z } from 'zod';",
      "import { b } from './b.js';",
      "import { missing } from './nowhere.js';",
      '',
      'export const a = [react, z, b, missing];',
      '',
    ].join('\n'),
    'src/b.ts': [
      "import { deep } from './deep/c.js';",
      '',
      'export const b = deep;',
      '',
    ].join('\n'),
    // Imported by `src/b.ts`, and the reason it is here: a node exists because
    // an edge touches it, so a file nobody imports is not in the graph at all.
    'src/deep/c.ts': 'export function deep(): void {}\n',
  };
  const entries = Object.entries(files).map(([path, content]) => ({ path, size: content.length }));
  const contents = new Map(Object.entries(files));
  const graph = buildDependencyGraph({ entries, contents });
  const map = buildSymbolMap({ entries, contents });

  it('pulls externals out of the node list and leaves the builder limitations alone', () => {
    const view = dependencyGraphView(graph);

    expect(view.externalDependencies).toEqual(['react', 'zod']);
    expect(view.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/b.ts', 'src/deep/c.ts']);
    // The builder's own account of what it could not read survives the view,
    // and the view adds nothing when it withheld nothing.
    expect(view.limitations).toHaveLength(1);
    expect(view.limitations[0]).toContain('./nowhere.js');
  });

  it('drops an edge whose far end was capped away', () => {
    // A line number pointing at a node the answer does not contain is a dead
    // end, so the cap applies to nodes first and the edges follow.
    const view = dependencyGraphView(graph, { maxNodes: 1 });

    expect(view.nodes.map((n) => n.id)).toEqual(['src/a.ts']);
    expect(view.edges).toEqual([]);
    expect(view.limitations).toContain(view.nodesTrimmed.note);
  });

  it('filters the symbol map by prefix and reports the filtered total', () => {
    const view = symbolMapView(map, { pathPrefix: 'src/deep' });

    expect(view.symbols.map((s) => s.name)).toEqual(['deep']);
    // The filtered total, not the whole map's: a caller who narrowed and got
    // one symbol must not be told that three were withheld.
    expect(view.symbolsTrimmed).toEqual({ returned: 1, total: 1, omitted: 0, note: null });
  });

  it('accepts a prefix however it is spelled', () => {
    // `./src/deep/`, `src/deep` and `src/deep/` are one directory, and a
    // caller that gets an empty answer from the first spelling will not try
    // the other two — it will conclude the directory is empty.
    for (const pathPrefix of ['./src/deep/', 'src/deep', '/src/deep/']) {
      const view = symbolMapView(map, { pathPrefix });
      expect(view.symbols.map((s) => s.name), `prefix ${pathPrefix}`).toEqual(['deep']);
    }
  });

  it('matches a prefix on directory boundaries, not on characters', () => {
    // `src/deep` is a directory. `src/deeper/` and `src/deep-notes.ts` are not
    // inside it, and a caller who asked about one directory must not be handed
    // its neighbours — the same class of error as an edge to the nearest-
    // looking path, and just as hard to notice.
    const neighbours: Record<string, string> = {
      'src/deep/c.ts': 'export function deep(): void {}\n',
      'src/deeper/d.ts': 'export function deeper(): void {}\n',
      'src/deep-notes.ts': 'export const notes = 1;\n',
    };

    const view = symbolMapView(
      buildSymbolMap({
        entries: Object.entries(neighbours).map(([path, content]) => ({ path, size: content.length })),
        contents: new Map(Object.entries(neighbours)),
      }),
      { pathPrefix: 'src/deep' }
    );

    expect(view.symbols.map((s) => s.path)).toEqual(['src/deep/c.ts']);
  });

  it('reads "." as the root, the way the Repository Map spells it', () => {
    // The map reports the root module as `path: "."`, so an agent that reads
    // `modules[0].path` and passes it back must get the repository, not an
    // empty list with no explanation.
    const view = symbolMapView(map, { pathPrefix: '.' });

    expect(view.symbols.map((s) => s.name)).toEqual(['a', 'b', 'deep']);
    expect(view.symbolsTrimmed.note).toBeNull();
  });

  it('narrows the graph to a subtree and leaves the external surface whole', () => {
    const view = dependencyGraphView(graph, { pathPrefix: 'src/deep' });

    expect(view.nodes.map((n) => n.id)).toEqual(['src/deep/c.ts']);
    expect(view.edges).toEqual([]);
    // Externals are not filtered. Their ids are `external:<package>`, so a
    // prefix that matches a directory can never match one — filtering them
    // would empty the list, and "what does this repository depend on" is not a
    // question about a subtree.
    expect(view.externalDependencies).toEqual(['react', 'zod']);
  });

  it('includes the node whose id is the prefix itself', () => {
    // A node's id can name a directory — a Go package, a module — and asking
    // for that directory has to include the directory.
    const view = dependencyGraphView(graph, { pathPrefix: 'src/deep/c.ts' });

    expect(view.nodes.map((n) => n.id)).toEqual(['src/deep/c.ts']);
  });

  it('sorts the external list even when the graph hands its nodes over unsorted', () => {
    // The builder sorts nodes by id, and `external:<name>` sorts as the name
    // does — so today this sort changes nothing. It is here because the view
    // promises a sorted list, and a promise it keeps only while its input
    // happens to arrive sorted is a promise it does not keep.
    const shuffled = { ...graph, nodes: [...graph.nodes].reverse() };

    expect(dependencyGraphView(shuffled).externalDependencies).toEqual(['react', 'zod']);
  });
});
