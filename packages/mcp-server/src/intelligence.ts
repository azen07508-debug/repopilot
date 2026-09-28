/**
 * Repository Intelligence for the MCP server (V0.2-g).
 *
 * The three artifacts have existed since V0.2-d/e/f and nothing could reach
 * them. This is the surface: four tools that answer "what is this repository,
 * and where do I start?" — the question an agent asks before it reads a single
 * file, and the one the paid audit answers only as a side effect of scoring.
 *
 * ## What "free" means here
 *
 * `index.ts` used to say the free tools never scan a repository. That was true
 * when every free tool derived from a stored report, and it stops being true
 * here — so the rule is restated rather than quietly broken:
 *
 *   **Free means no analysis pipeline.** No scoring, no finding collection, no
 *   secret scan, no commit history, no LLM boundary. A free tool may read a
 *   repository; it may not *judge* one.
 *
 * That reading is what D-019 asks for. The reason those tools must be free is
 * that an agent calls them five to ten times while finding its way around a
 * repository, and a paid call at that frequency is a paid call nobody makes.
 * Reading the tree is three requests — metadata, tree, tarball — not one per
 * file, because D-017 replaced the per-file path. Judging the repository is
 * what costs money.
 *
 * ## Why a snapshot is cached
 *
 * A snapshot holds every file's contents, so an uncached second question about
 * the same repository would re-download it. The cache is bounded twice over —
 * by count and by bytes — because R-17 is about memory and an agent looping
 * over repositories is exactly how a cache becomes a leak. It is in-process
 * and dies with the server; D-021's `intelligence_cache` is what makes it
 * survive, and that is V0.4's work, together with the HTTP endpoints (§6).
 */
import {
  DEFAULT_LIMITS,
  GitHubFetcher,
  MetadataAnalyzer,
  buildDependencyGraph,
  buildRepositoryMap,
  buildSymbolMap,
  filterFiles,
  parseRepoUrl,
  type DependencyGraph,
  type FileEntry,
  type RepoMetadata,
  type RepositoryMap,
  type SymbolMap,
} from '@repopilot/core';

/** Everything the three builders need, plus where it came from. */
export interface RepositorySnapshot {
  owner: string;
  repo: string;
  /** The ref the snapshot was taken at — the default branch when none was named. */
  ref: string;
  metadata: RepoMetadata;
  /**
   * Every file in the tree, **before** the fetch caps.
   *
   * The builders report a file they were given no content for rather than
   * guessing, so passing the whole tree is what makes a capped read visible in
   * `limitations` instead of silently absent (D-025 decision 7).
   */
  entries: FileEntry[];
  /** The files that were actually read. */
  contents: Map<string, string>;
  /** GitHub truncated the tree listing. */
  truncated: boolean;
  /** The tarball could not be read and the request-per-file path ran (D-017). */
  degraded: boolean;
  degradedReason?: string;
}

/** The seam a test drives instead of the network. */
export type SnapshotLoader = (repoUrl: string, ref?: string) => Promise<RepositorySnapshot>;

export interface SnapshotSourceOptions {
  githubToken?: string;
  allowedHosts: string[];
  /** At most this many snapshots are kept. */
  maxSnapshots?: number;
  /** And at most this many bytes of file contents across all of them. */
  maxCachedBytes?: number;
  load?: SnapshotLoader;
}

export const MAX_SNAPSHOTS = 8;
export const MAX_CACHED_BYTES = 64 * 1024 * 1024;

/**
 * Read a repository once and hand the same snapshot to every question about it.
 *
 * Least-recently-used eviction, bounded by count **and** bytes. A single
 * snapshot can be up to `DEFAULT_LIMITS.maxTotalBytes` (50 MiB), so a count
 * bound alone would allow half a gigabyte; a byte bound alone would allow one
 * enormous repository to evict nothing and one tiny repository to fill the map
 * with entries. Both, or the bound is not a bound.
 */
export class RepositorySnapshots {
  private readonly cache = new Map<string, RepositorySnapshot>();
  private readonly load: SnapshotLoader;
  private readonly maxSnapshots: number;
  private readonly maxCachedBytes: number;
  private cachedBytes = 0;

  constructor(opts: SnapshotSourceOptions) {
    this.load = opts.load ?? createSnapshotLoader(opts);
    this.maxSnapshots = opts.maxSnapshots ?? MAX_SNAPSHOTS;
    this.maxCachedBytes = opts.maxCachedBytes ?? MAX_CACHED_BYTES;
  }

  /**
   * The snapshot for a repository, from the cache when it is already there.
   *
   * The key is `owner/repo@ref`, and `ref` is empty when the caller named
   * none — resolving the default branch costs a request, so it happens once,
   * inside the loader, and the resolved name is recorded on the snapshot. A
   * branch is not a commit, so a long-lived cache would serve a moved branch;
   * this one lives as long as the server process, and a caller that needs a
   * fixed view passes the commit as `ref`.
   */
  async get(repoUrl: string, ref?: string): Promise<RepositorySnapshot> {
    const key = cacheKey(repoUrl, ref);
    const hit = this.cache.get(key);
    if (hit) {
      this.touch(key, hit);
      return hit;
    }

    // The caller may be naming the ref an earlier load already resolved.
    // `get_repository_context` answers with `repository.ref`, and the natural
    // next call — `get_symbol_map` on the same repository — passes it straight
    // back; without this the two calls are two keys and the repository is
    // fetched twice, which is the one thing this class exists to prevent.
    if (ref !== undefined) {
      const unnamed = cacheKey(repoUrl, undefined);
      const held = this.cache.get(unnamed);
      if (held !== undefined && held.ref === ref) {
        this.touch(unnamed, held);
        return held;
      }
    }

    const snapshot = await this.load(repoUrl, ref);
    this.remember(key, snapshot);
    return snapshot;
  }

  /** Re-insert so the Map's iteration order stays least-recently-used first. */
  private touch(key: string, snapshot: RepositorySnapshot): void {
    this.cache.delete(key);
    this.cache.set(key, snapshot);
  }

  /** What the cache is holding. Surfaced by `get_repository_context`. */
  stats(): { snapshots: number; bytes: number; maxSnapshots: number; maxCachedBytes: number } {
    return {
      snapshots: this.cache.size,
      bytes: this.cachedBytes,
      maxSnapshots: this.maxSnapshots,
      maxCachedBytes: this.maxCachedBytes,
    };
  }

  private remember(key: string, snapshot: RepositorySnapshot): void {
    // A ref and the same ref spelled as the default branch are two keys for
    // one snapshot; keeping both would spend the byte budget twice.
    for (const [existing, held] of this.cache) {
      if (held.owner === snapshot.owner && held.repo === snapshot.repo && held.ref === snapshot.ref) {
        this.forget(existing);
      }
    }

    this.cache.set(key, snapshot);
    this.cachedBytes += byteSize(snapshot);

    while (
      this.cache.size > this.maxSnapshots ||
      (this.cachedBytes > this.maxCachedBytes && this.cache.size > 1)
    ) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.forget(oldest.value);
    }
  }

  private forget(key: string): void {
    const held = this.cache.get(key);
    if (!held) return;
    this.cache.delete(key);
    this.cachedBytes -= byteSize(held);
  }
}

function cacheKey(repoUrl: string, ref: string | undefined): string {
  return `${repoUrl.replace(/\/+$/, '').toLowerCase()}@${ref ?? ''}`;
}

function byteSize(snapshot: RepositorySnapshot): number {
  let total = 0;
  for (const content of snapshot.contents.values()) total += content.length;
  return total;
}

/**
 * The real loader: three requests, then the builders have what they need.
 *
 * It mirrors `AuditPipeline.run` up to the point where the pipeline starts
 * judging — same URL validation, same metadata fetch, same tarball read — so a
 * repository the audit can read is a repository these tools can read, and a
 * refusal (a host outside the allowlist, a missing repository) is the same
 * refusal. What it does not do is the part that costs money.
 */
export function createSnapshotLoader(opts: {
  githubToken?: string;
  allowedHosts: string[];
}): SnapshotLoader {
  return async (repoUrl, ref) => {
    const parsed = parseRepoUrl(repoUrl, opts.allowedHosts);
    const metadata = await new MetadataAnalyzer({ token: opts.githubToken }).fetch(
      parsed.owner,
      parsed.repo
    );
    const wanted = ref ?? metadata.defaultBranch;

    const fetcher = new GitHubFetcher(opts.githubToken);
    const { entries, truncated } = await fetcher.fetchTree(parsed.owner, parsed.repo, wanted);
    const { included } = filterFiles(entries, {
      maxFiles: DEFAULT_LIMITS.maxFiles,
      maxFileBytes: DEFAULT_LIMITS.maxFileBytes,
    });
    const { contents, degraded, reason } = await fetcher.fetchRepositoryContents(
      parsed.owner,
      parsed.repo,
      wanted,
      included,
      {
        maxFileBytes: DEFAULT_LIMITS.maxFileBytes,
        maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes,
      }
    );

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      ref: wanted,
      metadata,
      entries,
      contents,
      truncated,
      degraded,
      ...(reason === undefined ? {} : { degradedReason: reason }),
    };
  };
}

// ---------------------------------------------------------------------------
// The three artifacts
// ---------------------------------------------------------------------------

export function repositoryMapOf(snapshot: RepositorySnapshot): RepositoryMap {
  return buildRepositoryMap({
    metadata: snapshot.metadata,
    entries: snapshot.entries,
    contents: snapshot.contents,
    degraded: snapshot.degraded,
    ...(snapshot.degradedReason === undefined ? {} : { degradedReason: snapshot.degradedReason }),
    truncated: snapshot.truncated,
  });
}

export function symbolMapOf(snapshot: RepositorySnapshot): SymbolMap {
  return buildSymbolMap({ entries: snapshot.entries, contents: snapshot.contents });
}

export function dependencyGraphOf(snapshot: RepositorySnapshot): DependencyGraph {
  return buildDependencyGraph({ entries: snapshot.entries, contents: snapshot.contents });
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

/**
 * What a trimmed list withheld.
 *
 * R-20 is the reason this exists: an artifact over a two-thousand-file
 * repository is megabytes of JSON, and a tool that returns it whole does not
 * inform the agent, it fills the context window. The cap is therefore part of
 * the contract, and — the rule this codebase keeps having to relearn
 * (D-025 decision 7) — **the code that cut the list is the code that says it
 * did**. A caller cannot tell "there were 500" from "the first 500 of 9000" by
 * looking at the list.
 */
export interface Trimmed {
  returned: number;
  total: number;
  omitted: number;
  /** The sentence a caller can act on, or null when nothing was withheld. */
  note: string | null;
}

function trimNote(label: string, returned: number, total: number): Trimmed {
  return {
    returned,
    total,
    omitted: total - returned,
    note:
      total > returned
        ? `${label}: the first ${returned} of ${total} are listed; ${total - returned} more were withheld.`
        : null,
  };
}

export const MAX_SYMBOLS_RETURNED = 500;
export const MAX_EDGES_RETURNED = 500;
export const MAX_NODES_RETURNED = 1000;
export const MAX_EXTERNAL_RETURNED = 200;

export interface SymbolMapView {
  schemaVersion: string;
  languageCoverage: SymbolMap['languageCoverage'];
  symbols: SymbolMap['symbols'];
  symbolsTrimmed: Trimmed;
  degraded: boolean;
  /**
   * Carried through unchanged, and not folded into `limitations`: the symbol
   * map names the languages it could not read here, and that is the one thing
   * about it a caller must not lose to trimming.
   */
  failures: SymbolMap['failures'];
}

/**
 * The symbol map, capped for a context window.
 *
 * Order is the builder's, not this function's: symbols arrive sorted by path
 * then line, so a prefix of the list is a whole-file-at-a-time answer rather
 * than a random sample. `path_prefix` is how a caller narrows to the directory
 * it cares about instead of asking for more.
 */
export function symbolMapView(
  map: SymbolMap,
  opts: { maxSymbols?: number; pathPrefix?: string } = {}
): SymbolMapView {
  const maxSymbols = opts.maxSymbols ?? MAX_SYMBOLS_RETURNED;
  const prefix = normalisePrefix(opts.pathPrefix);

  const matching = map.symbols.filter((symbol) => underPrefix(symbol.path, prefix));
  const kept = matching.slice(0, maxSymbols);

  return {
    schemaVersion: map.schemaVersion,
    languageCoverage: map.languageCoverage,
    symbols: kept,
    symbolsTrimmed: trimNote(
      prefix === null ? 'Symbols' : `Symbols under "${prefix}"`,
      kept.length,
      matching.length
    ),
    degraded: map.degraded,
    failures: map.failures,
  };
}

export interface DependencyGraphView {
  schemaVersion: string;
  nodes: DependencyGraph['nodes'];
  edges: DependencyGraph['edges'];
  nodesTrimmed: Trimmed;
  edgesTrimmed: Trimmed;
  externalDependencies: string[];
  externalTrimmed: Trimmed;
  limitations: string[];
}

/**
 * The dependency graph, capped for a context window.
 *
 * External packages are pulled out of the node list into a flat name list:
 * they are the one part of the graph an agent usually wants whole, they are
 * cheap, and leaving them mixed into `nodes` is how a graph's node cap ends up
 * spending itself on `react` instead of on the repository.
 */
export function dependencyGraphView(
  graph: DependencyGraph,
  opts: { maxNodes?: number; maxEdges?: number; maxExternal?: number; pathPrefix?: string } = {}
): DependencyGraphView {
  const maxNodes = opts.maxNodes ?? MAX_NODES_RETURNED;
  const maxEdges = opts.maxEdges ?? MAX_EDGES_RETURNED;
  const maxExternal = opts.maxExternal ?? MAX_EXTERNAL_RETURNED;
  const prefix = normalisePrefix(opts.pathPrefix);

  const externals = graph.nodes
    .filter((node) => node.kind === 'external-dependency')
    .map((node) => node.name)
    .sort();
  const keptExternals = externals.slice(0, maxExternal);
  const externalTrimmed = trimNote('External dependencies', keptExternals.length, externals.length);

  const internalNodes = graph.nodes.filter(
    (node) => node.kind !== 'external-dependency' && underPrefix(node.id, prefix)
  );
  const keptNodes = internalNodes.slice(0, maxNodes);
  const keptIds = new Set(keptNodes.map((node) => node.id));
  const nodesTrimmed = trimNote('Nodes', keptNodes.length, internalNodes.length);

  // An edge is only useful if both ends are in the answer: an edge to a node
  // that was capped away is a line number an agent cannot follow.
  const internalEdges = graph.edges.filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to));
  const keptEdges = internalEdges.slice(0, maxEdges);
  const edgesTrimmed = trimNote('Edges', keptEdges.length, internalEdges.length);

  return {
    schemaVersion: graph.schemaVersion,
    nodes: keptNodes,
    edges: keptEdges,
    nodesTrimmed,
    edgesTrimmed,
    externalDependencies: keptExternals,
    externalTrimmed,
    limitations: [
      ...graph.limitations,
      ...[nodesTrimmed.note, edgesTrimmed.note, externalTrimmed.note].filter(
        (note): note is string => note !== null
      ),
    ],
  };
}

/**
 * A `path_prefix` read as a directory, or `null` for "no filter".
 *
 * `.` is the root, and the Repository Map spells the root module exactly that
 * — so an agent that reads `modules[0].path` and passes it straight back must
 * not get an empty answer. The trailing slash comes off because
 * `underPrefix` puts it back as a segment boundary.
 */
function normalisePrefix(prefix: string | undefined): string | null {
  if (prefix === undefined) return null;
  const clean = prefix.replace(/^\.?\//, '').replace(/\/+$/, '');
  return clean === '' || clean === '.' ? null : clean;
}

/**
 * Is this id under the prefix?
 *
 * A segment boundary, not a string prefix. `src/deep` is a directory;
 * `src/deeper/d.ts` and `src/deep-notes.ts` are not inside it, and handing
 * them to a caller who asked about `src/deep` is the same class of error as an
 * edge drawn to the nearest-looking path. The identity case is for the graph,
 * where a node's id can be a directory in its own right (a Go package, a
 * module).
 */
function underPrefix(id: string, prefix: string | null): boolean {
  return prefix === null || id === prefix || id.startsWith(`${prefix}/`);
}

// ---------------------------------------------------------------------------
// The one-call overview
// ---------------------------------------------------------------------------

export const MAX_CONTEXT_MODULES = 20;
export const MAX_CONTEXT_FILES = 20;
export const MAX_CONTEXT_EDGES = 25;
/**
 * Forty, where the map allows five hundred.
 *
 * The list is what a caller scans for "does this use FastAPI or Express?", and
 * the framework/driver surface of a repository is inside forty almost always.
 * A repository that declares three hundred has one that wants the graph, not
 * a longer list of names.
 */
export const MAX_CONTEXT_DEPENDENCIES = 40;

export interface RepositoryContext {
  repository: {
    url: string;
    owner: string;
    name: string;
    ref: string;
    defaultBranch: string;
    primaryLanguage: string | null;
    languages: RepositoryMap['repository']['languages'];
    frameworks: string[];
    packageManagers: string[];
  };
  /** Where to start reading, in the order the map ranked them. */
  entrypoints: RepositoryMap['entrypoints'];
  modules: RepositoryMap['modules'];
  modulesTrimmed: Trimmed;
  importantFiles: RepositoryMap['importantFiles'];
  importantFilesTrimmed: Trimmed;
  /** The heaviest imports in the repository, which is where the coupling is. */
  topEdges: { from: string; to: string; weight: number }[];
  edgesTrimmed: Trimmed;
  /**
   * What the manifests **declare**, with the version and the kind.
   *
   * Not the same set as the graph's `externalDependencies`, and the difference
   * is the reason both exist: a manifest declares what is not imported (a dev
   * tool, a peer that is provided) and an import reaches what is not declared
   * (a phantom dependency). This one is the manifest's account, which is why
   * it carries a version and a kind and the graph's does not — and why a
   * caller who wants "what does this code actually pull in" asks the graph.
   */
  declaredDependencies: {
    name: string;
    version: string | null;
    kind: RepositoryMap['externalDependencies'][number]['kind'];
  }[];
  declaredDependenciesTrimmed: Trimmed;
  /** Declarations by kind, so a caller learns the shape without the list. */
  symbolCounts: { type: string; count: number }[];
  symbolTotal: number;
  fileCount: number;
  /** Every artifact's own account of what it could not read, merged. */
  limitations: string[];
  /**
   * True when an artifact was weaker than it could have been — the fetch fell
   * back, the tree was truncated, a language has no parser, a list hit its cap.
   *
   * It is the OR of two flags with different scopes, so it is a *signal to go
   * read `limitations`*, not a diagnosis: the reason may concern data this
   * answer does not itself contain. On this repository it is true because the
   * symbol list was capped at 500 and HTML/CSS have no extractor — and the
   * symbol list is exactly what `get_repository_context` does not return.
   */
  degraded: boolean;
}

/**
 * One call that answers "what is this repository?".
 *
 * Built from the same three artifacts as the three tools above, trimmed harder
 * because it is meant to be the *first* call, not the last: it names the
 * entrypoints, the modules, the files worth reading first, the heaviest edges
 * and the declared dependencies, and it hands back the counts so an agent
 * knows when to follow up with a narrower question.
 *
 * It deliberately does not include the symbols. A declaration list is what
 * `get_symbol_map` is for, and inlining a capped one here would double the
 * size of the answer to buy a worse version of a tool that already exists.
 */
export function buildRepositoryContext(
  snapshot: RepositorySnapshot,
  opts: {
    maxModules?: number;
    maxFiles?: number;
    maxEdges?: number;
    maxDependencies?: number;
  } = {}
): RepositoryContext {
  const maxModules = opts.maxModules ?? MAX_CONTEXT_MODULES;
  const maxFiles = opts.maxFiles ?? MAX_CONTEXT_FILES;
  const maxEdges = opts.maxEdges ?? MAX_CONTEXT_EDGES;
  const maxDependencies = opts.maxDependencies ?? MAX_CONTEXT_DEPENDENCIES;

  const map = repositoryMapOf(snapshot);
  const symbols = symbolMapOf(snapshot);
  const graph = dependencyGraphOf(snapshot);

  const modules = map.modules.slice(0, maxModules);
  const files = map.importantFiles.slice(0, maxFiles);
  const dependencies = map.externalDependencies.slice(0, maxDependencies);
  const modulesTrimmed = trimNote('Modules', modules.length, map.modules.length);
  const filesTrimmed = trimNote('Important files', files.length, map.importantFiles.length);
  const dependenciesTrimmed = trimNote(
    'Declared dependencies',
    dependencies.length,
    map.externalDependencies.length
  );

  const ranked = [...graph.edges].sort(
    (a, b) => b.weight - a.weight || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
  );
  const topEdges = ranked.slice(0, maxEdges);
  const edgesTrimmed = trimNote('Import edges', topEdges.length, ranked.length);

  const counts = new Map<string, number>();
  for (const symbol of symbols.symbols) counts.set(symbol.type, (counts.get(symbol.type) ?? 0) + 1);

  return {
    repository: {
      url: map.repository.url,
      owner: map.repository.owner,
      name: map.repository.name,
      ref: snapshot.ref,
      defaultBranch: map.repository.defaultBranch,
      primaryLanguage: map.repository.primaryLanguage,
      languages: map.repository.languages,
      frameworks: map.repository.frameworks,
      packageManagers: map.repository.packageManagers,
    },
    entrypoints: map.entrypoints,
    modules,
    modulesTrimmed,
    importantFiles: files,
    importantFilesTrimmed: filesTrimmed,
    topEdges: topEdges.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.weight })),
    edgesTrimmed,
    declaredDependencies: dependencies.map((dependency) => ({
      name: dependency.name,
      version: dependency.version,
      kind: dependency.kind,
    })),
    declaredDependenciesTrimmed: dependenciesTrimmed,
    symbolCounts: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1)),
    symbolTotal: symbols.symbols.length,
    fileCount: snapshot.entries.length,
    limitations: [
      ...map.limitations,
      ...symbols.failures.map((failure) => `${failure.language}: ${failure.reason}`),
      ...graph.limitations,
      ...[
        modulesTrimmed.note,
        filesTrimmed.note,
        edgesTrimmed.note,
        dependenciesTrimmed.note,
      ].filter((note): note is string => note !== null),
    ],
    degraded: map.degraded || symbols.degraded,
  };
}
