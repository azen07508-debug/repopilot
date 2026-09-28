#!/usr/bin/env tsx
/**
 * scripts/intelligence-smoke.mts — read a real repository with the real loader
 * and check the four Repository Intelligence tools against it.
 *
 * Usage:
 *   pnpm intelligence:smoke [repo_url ...]
 *   # or: pnpm tsx scripts/intelligence-smoke.mts [repo_url ...]
 *
 * Defaults to two repositories with different shapes: a tiny one (an empty
 * graph is a valid answer and must not crash) and this repository (a NodeNext
 * monorepo with a React app, which is the shape that found the `.js → .tsx`
 * defect).
 *
 * **Why this is a script and not a test.** Everything here needs the network,
 * so it cannot be in CI — and the unit suite therefore cannot reach the one
 * path that matters most: `parseRepoUrl` → `MetadataAnalyzer` →
 * `GitHubFetcher` (tree + tarball) → the three builders → the two views. The
 * whole of that path had zero coverage until this script existed, and a real
 * defect shipped through it: `SOURCE_REWRITES` held only `.js → .ts`, so every
 * `import './components/Header.js'` naming `Header.tsx` was reported as an
 * unresolved relative import. The check below is the one that would have
 * caught it, and it is written to be independent of `resolve.ts` — it looks at
 * the tree itself and asks whether the resolver missed a file that is there.
 *
 * Not part of `verify:release`: that drives the paid audit flow, and these
 * four tools are the free ones.
 *
 * The file is `.mts`, not `.ts`: the repo root has no `"type": "module"`, so a
 * `.ts` here is compiled as CJS by tsx — top-level await is a transform error
 * there, and a `require` of `@repopilot/core` fails outright, because its
 * `exports` map declares only an `import` condition
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED`). The extension is what makes this ESM, and
 * this is the only script in `scripts/` that imports `@repopilot/core` at all
 * — the others shell out to `pnpm`, which is why nobody hit this before.
 */
import {
  RepositorySnapshots,
  buildRepositoryContext,
  createSnapshotLoader,
  dependencyGraphOf,
  dependencyGraphView,
  repositoryMapOf,
  symbolMapOf,
  symbolMapView,
  type RepositorySnapshot,
} from '../packages/mcp-server/src/intelligence.js';

const DEFAULT_REPOS = [
  'https://github.com/octocat/Hello-World',
  'https://github.com/azen07508-debug/repopilot',
];

const ALLOWED_HOSTS = ['github.com', 'raw.githubusercontent.com'];

/**
 * The token is read here, not by the loader: `createSnapshotLoader` only takes
 * what it is handed, and `packages/mcp-server/src/cli.ts` is what normally
 * reads the environment. Anonymous is 60 requests an hour per IP, which one
 * run of this script over two repositories is easily enough to exhaust.
 */
const TOKEN = process.env['GITHUB_TOKEN'];

/** Extensions a specifier may have been written as, for the check below. */
const SOURCE_SUFFIXES = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

let failures = 0;

function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
}

/**
 * The unresolved relative imports, split into the ones that are a defect and
 * the ones that are simply not there.
 *
 * The resolver's own candidate list is not consulted: this reads the
 * limitation line, rebuilds the path the specifier points at, and asks the
 * file list. An independent reading is the point — a check written against
 * `SOURCE_REWRITES` would have agreed with the defect.
 *
 * `examined` is returned so that the caller can tell a clean repository from a
 * vacuous pass: zero examined means the check proved nothing, which is exactly
 * how the `.js → .tsx` defect stayed invisible.
 */
function auditMissedImports(
  snapshot: RepositorySnapshot,
  limitations: readonly string[]
): { missed: string[]; examined: number } {
  const paths = new Set(snapshot.entries.map((entry) => entry.path));
  const missed: string[] = [];
  let examined = 0;

  for (const line of limitations) {
    const match = /^(\S+?):(\d+) imports "(.+?)" — no file/.exec(line);
    if (!match) continue;
    const [, fromPath, , specifier] = match;
    if (fromPath === undefined || specifier === undefined) continue;
    examined += 1;

    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const joined = dir === '' ? specifier : `${dir}/${specifier}`;
    const segments: string[] = [];
    for (const segment of joined.split('/')) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment);
    }
    const target = segments.join('/');

    const stem = SOURCE_SUFFIXES.some((suffix) => target.endsWith(suffix))
      ? target.slice(0, target.lastIndexOf('.'))
      : target;
    const candidates = SOURCE_SUFFIXES.map((suffix) => `${stem}${suffix}`);

    if (candidates.some((candidate) => paths.has(candidate))) {
      missed.push(`${fromPath} → ${specifier}`);
    }
  }
  return { missed, examined };
}

/**
 * A one-line, actionable reading of a fetch failure.
 *
 * Mirrors `describeError` in the tool layer (which keeps the HTTP status, so
 * that 404 / 403 / 502 stay three different next moves) and adds the one hint
 * that matters for a script run by hand: the anonymous limit is 60 requests an
 * hour per IP, and exhausting it looks like a broken repository otherwise.
 */
function describe(error: unknown): string {
  const status: unknown = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 403 && /rate limit/i.test(message)) {
    return (
      '[403] GitHub rate limit exhausted (the anonymous limit is 60 requests/hour per IP). ' +
      'Re-run with a token: GITHUB_TOKEN=$(gh auth token) pnpm intelligence:smoke'
    );
  }
  return typeof status === 'number' ? `[${status}] ${message}` : message;
}

async function inspect(repoUrl: string): Promise<void> {
  console.log(`\n=== ${repoUrl}`);

  let fetches = 0;
  const real = createSnapshotLoader({
    allowedHosts: ALLOWED_HOSTS,
    ...(TOKEN === undefined ? {} : { githubToken: TOKEN }),
  });
  const snapshots = new RepositorySnapshots({
    allowedHosts: ALLOWED_HOSTS,
    load: async (url, ref) => {
      fetches += 1;
      return real(url, ref);
    },
  });

  const started = Date.now();
  const snapshot = await snapshots.get(repoUrl);
  console.log(
    `  fetched ${snapshot.owner}/${snapshot.repo}@${snapshot.ref} in ${Date.now() - started}ms — ` +
      `${snapshot.entries.length} entries, ${snapshot.contents.size} read, truncated=${snapshot.truncated}, degraded=${snapshot.degraded}`
  );

  check(fetches === 1, 'one fetch per repository');
  check(snapshot.entries.length > 0, 'the tree is not empty');
  check(
    snapshot.contents.size <= snapshot.entries.length,
    'no file was read that is not in the tree'
  );

  // The alias path: the ref the tool answers with, named straight back.
  const beforeAlias = fetches;
  await snapshots.get(repoUrl, snapshot.ref);
  check(fetches === beforeAlias, 'naming the resolved ref back is a cache hit');

  const map = repositoryMapOf(snapshot);
  const symbols = symbolMapView(symbolMapOf(snapshot));
  const graph = dependencyGraphOf(snapshot);
  const graphView = dependencyGraphView(graph);
  const context = buildRepositoryContext(snapshot);

  const nodeIds = new Set(graphView.nodes.map((node) => node.id));
  check(
    graphView.edges.every((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    'every edge points at a node the answer contains',
    `${graphView.edges.length} edges over ${graphView.nodes.length} nodes`
  );
  check(
    graphView.edges.every((edge) => edge.evidence.length > 0),
    'every edge carries its evidence line'
  );
  check(
    graphView.externalDependencies.length ===
      graph.nodes.filter((node) => node.kind === 'external-dependency').length ||
      graphView.externalTrimmed.omitted > 0,
    'externals are pulled out of the node list'
  );
  check(
    graphView.nodes.every((node) => node.kind !== 'external-dependency'),
    'no external is left in the node list'
  );

  const audit = auditMissedImports(snapshot, graphView.limitations);
  check(
    audit.missed.length === 0,
    'no unresolved relative import names a file that is in the tree',
    audit.missed.length > 0
      ? audit.missed.slice(0, 5).join('; ')
      : `${audit.examined} unresolved relative import(s) examined`
  );

  check(
    context.fileCount === snapshot.entries.length,
    'the context counts the whole tree, not just what was read'
  );
  check(
    context.symbolTotal ===
      symbolMapView(symbolMapOf(snapshot), { maxSymbols: 1_000_000 }).symbolsTrimmed.total,
    'the context reports the true symbol total, not a capped one'
  );
  check(
    map.externalDependencies.every((dependency) => dependency.manifest !== ''),
    'every declared dependency names the manifest that declared it'
  );

  const trimmed = [
    ['modules', context.modulesTrimmed],
    ['importantFiles', context.importantFilesTrimmed],
    ['edges', context.edgesTrimmed],
    ['declaredDependencies', context.declaredDependenciesTrimmed],
    ['symbols', symbols.symbolsTrimmed],
    ['nodes', graphView.nodesTrimmed],
    ['graphEdges', graphView.edgesTrimmed],
  ] as const;
  const silentCuts = trimmed
    .filter(([, list]) => list.omitted > 0 && list.note === null)
    .map(([label]) => label);
  check(silentCuts.length === 0, 'every list that was cut says that it was', silentCuts.join(', '));

  console.log(
    `  — map: ${map.modules.length} modules, ${map.externalDependencies.length} declared deps; ` +
      `symbols: ${symbols.symbols.length}/${symbols.symbolsTrimmed.total} in ${symbols.languageCoverage.length} languages; ` +
      `graph: ${graphView.nodes.length} nodes, ${graphView.edges.length}/${graphView.edgesTrimmed.total} edges, ${graphView.externalDependencies.length} externals; ` +
      `context: ${context.fileCount} files, ${context.symbolTotal} symbols, degraded=${context.degraded}`
  );
  if (context.limitations.length > 0) {
    console.log(`  — ${context.limitations.length} limitations, first three:`);
    for (const line of context.limitations.slice(0, 3)) console.log(`      ${line}`);
  }
}

async function main(): Promise<void> {
  const repos = process.argv.slice(2);
  if (repos.length === 0) repos.push(...DEFAULT_REPOS);

  console.log(
    TOKEN === undefined
      ? 'GitHub token: none — anonymous, 60 requests/hour per IP'
      : 'GitHub token: GITHUB_TOKEN'
  );

  for (const repoUrl of repos) {
    try {
      await inspect(repoUrl);
    } catch (error: unknown) {      // One repository failing must not hide the others: the point of running
      // this over several shapes is that a shape may be the thing that breaks.
      failures += 1;
      console.log(`\n=== ${repoUrl}`);
      console.log(`  FAIL  could not read the repository: ${describe(error)}`);
    }
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
