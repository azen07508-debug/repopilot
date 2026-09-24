/**
 * Module detection.
 *
 * A "module" is a unit an agent can reason about without reading the
 * whole tree: a workspace package, a directory with its own manifest, a
 * contract package, or a top-level directory with enough source in it to
 * be a subsystem.
 *
 * ## Two rules worth stating
 *
 * 1. **Directory candidates come from real file paths, never from
 *    patterns.** The set of directories is derived by walking the text
 *    files that survived the fetch caps, so a workspace glob that matches
 *    `packages/*` in a repository with no `packages/` produces no module
 *    rather than a phantom one. This is the same discipline as
 *    `git/tarball.ts`: derive, then check against what is actually there.
 *
 * 2. **Dependencies are read from manifests only.** Resolving
 *    `import './x.js'` to a file is V0.2-f's job, and doing half of it
 *    here would produce a `dependsOn` that is neither manifest-accurate
 *    nor import-accurate. A workspace package that lists a sibling by
 *    name gets an edge; a directory module that imports across the tree
 *    does not, and the map says so in `limitations`.
 */
import { classifyFile, detectLanguage, type FileEntry } from '../../git/files.js';
import type { Entrypoint, Module } from '../../schemas/intelligence/repository-map.js';
import { moduleImportance } from './importance.js';
import type { ManifestParseResult } from './manifests.js';

/** A top-level directory needs at least this many files to count as a subsystem. */
export const MIN_MODULE_FILES = 3;
export const MAX_MODULES = 200;

export interface ModuleDetectInput {
  /** Used to name the repository-root module when no manifest names it. */
  repoName: string;
  entries: FileEntry[];
  /** Manifest path -> parse result, for every manifest the caller parsed. */
  manifests: Map<string, ManifestParseResult>;
  /** Union of every manifest's workspace globs. */
  workspaceGlobs: string[];
  entrypoints: Entrypoint[];
}

export interface ModuleDetectResult {
  modules: Module[];
  notes: string[];
}

interface Draft {
  name: string;
  path: string;
  kind: Module['kind'];
}

const CONTRACT_EXTENSIONS = /\.(sol|vy|cairo|move)$/;

/**
 * Which manifest names a directory, when it has more than one.
 *
 * Deterministic, and deliberately not alphabetical: a directory carrying
 * both a `package.json` and a `go.mod` is a JavaScript package with a Go
 * tool in it, and naming the module after whichever filename sorts first
 * would make the answer an accident of the alphabet.
 */
const MANIFEST_NAME_PRIORITY: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)go\.mod$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)pnpm-workspace\.ya?ml$/,
];

function manifestPriority(path: string): number {
  const index = MANIFEST_NAME_PRIORITY.findIndex((re) => re.test(path));
  return index === -1 ? MANIFEST_NAME_PRIORITY.length : index;
}

/** The module a manifest belongs to. The repository root is `.`, never `''`. */
function modulePathOf(manifestPath: string): string {
  const dir = dirnameOf(manifestPath);
  return dir === '' ? '.' : dir;
}

export function detectModules(input: ModuleDetectInput): ModuleDetectResult {
  const notes: string[] = [];
  const text = input.entries.filter((e) => classifyFile(e.path, e.size).kind === 'text');

  // Every manifest that shares a directory is a candidate; the highest
  // priority one names it. Resolved by sorting first so the result does
  // not depend on the order the tree was listed in.
  const manifestDirs = new Map<string, string>();
  for (const path of [...input.manifests.keys()].sort(compareStrings)) {
    const modulePath = modulePathOf(path);
    const existing = manifestDirs.get(modulePath);
    if (existing === undefined || manifestPriority(path) < manifestPriority(existing)) {
      manifestDirs.set(modulePath, path);
    }
  }

  const drafts = new Map<string, Draft>();
  const add = (path: string, name: string, kind: Module['kind']): void => {
    if (!drafts.has(path)) drafts.set(path, { name, path, kind });
  };
  /** `Module.path` is `min(1)`, so the root is `.` and never the empty string. */
  const ROOT = '.';
  const rootName = input.repoName.trim() === '' ? ROOT : input.repoName;

  // Every ancestor directory of a text file. Derived, so a directory that
  // exists only in a glob pattern never enters the set.
  const dirs = new Set<string>();
  for (const entry of text) {
    const segments = entry.path.split('/');
    for (let i = 1; i < segments.length; i++) dirs.add(segments.slice(0, i).join('/'));
  }

  // 1. Workspace packages: a glob match that also carries a manifest.
  const { matched, unexpanded } = expandWorkspaceGlobs(input.workspaceGlobs, dirs);
  for (const dir of [...matched].sort(compareStrings)) {
    const manifestPath = manifestDirs.get(dir);
    if (!manifestPath) continue;
    add(dir, input.manifests.get(manifestPath)?.packageName ?? basenameOf(dir), 'workspace-package');
  }
  if (unexpanded.length > 0) {
    notes.push(`Workspace pattern(s) were not expanded: ${unexpanded.join(', ')}.`);
  }

  // 2. Contract packages. A Foundry or Hardhat project at the root is a
  //    contract package in its own right; otherwise a `contracts/`
  //    directory with sources is.
  const hasContractSources = (dir: string): boolean =>
    text.some((e) => e.path.startsWith(`${dir}/`) && CONTRACT_EXTENSIONS.test(e.path));
  const rootHasContractTool =
    text.some((e) => e.path === 'foundry.toml') ||
    text.some((e) => /^hardhat\.config\.[cm]?[jt]s$/.test(e.path));
  if (hasContractSources('contracts')) add('contracts', 'contracts', 'contract-package');
  else if (rootHasContractTool) add(ROOT, rootName, 'contract-package');

  // 3. Any other directory with its own manifest. Catches a monorepo with
  //    no workspace file at all.
  for (const modulePath of [...manifestDirs.keys()].sort(compareStrings)) {
    if (drafts.has(modulePath)) continue;
    const manifestPath = manifestDirs.get(modulePath) ?? '';
    // A root `pnpm-workspace.yaml` declares the workspace, not a package:
    // no name, no dependencies, nothing to build. It is the one root
    // manifest that does not make the root a module.
    if (modulePath === ROOT && /(^|\/)pnpm-workspace\.ya?ml$/.test(manifestPath)) continue;
    add(
      modulePath,
      input.manifests.get(manifestPath)?.packageName ?? basenameOf(modulePath),
      'package'
    );
  }

  // 4. Top-level directories with enough source to be a subsystem.
  for (const dir of [...dirs].sort(compareStrings)) {
    if (dir.includes('/')) continue;
    if (drafts.has(dir)) continue;
    // A container is not a module: `packages/` holds the workspace
    // packages and is not itself one.
    if ([...drafts.keys()].some((p) => p.startsWith(`${dir}/`))) continue;
    const files = text.filter((e) => e.path.startsWith(`${dir}/`));
    if (files.length < MIN_MODULE_FILES) continue;
    add(dir, dir, 'directory');
  }

  // 5. A flat repository still has a root, and "no modules" is a worse
  //    answer than "one module, the repository itself".
  if (drafts.size === 0 && text.length >= MIN_MODULE_FILES) add(ROOT, rootName, 'directory');

  // --- Name resolution -----------------------------------------------------
  const ordered = [...drafts.values()].sort((a, b) => compareStrings(a.path, b.path));
  const byName = new Map<string, Draft>();
  for (const draft of ordered) {
    if (byName.has(draft.name)) {
      notes.push(`Two modules are named "${draft.name}"; the map keeps the first by path.`);
      continue;
    }
    byName.set(draft.name, draft);
  }

  // --- Dependencies --------------------------------------------------------
  const dependsOnByPath = new Map<string, string[]>();
  for (const draft of ordered) {
    // Every manifest in this directory, not only the one that named it: a
    // root with both a `package.json` and a `go.mod` has dependencies in
    // both, and reading one of them would understate the module.
    const relevant: ManifestParseResult[] = [];
    for (const [manifestPath, parsed] of input.manifests) {
      if (modulePathOf(manifestPath) === draft.path) relevant.push(parsed);
    }
    if (relevant.length === 0 && draft.path !== ROOT) {
      for (const [manifestPath, parsed] of input.manifests) {
        if (manifestPath.startsWith(`${draft.path}/`)) relevant.push(parsed);
      }
    }

    const names = new Set<string>();
    for (const manifest of relevant) {
      for (const dependency of manifest.dependencies) names.add(dependency.name);
    }
    dependsOnByPath.set(
      draft.path,
      [...names].filter((name) => name !== draft.name && byName.has(name)).sort(compareStrings)
    );
  }

  const fanIn = new Map<string, number>();
  for (const deps of dependsOnByPath.values()) {
    for (const dep of deps) fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
  }

  // --- Assemble ------------------------------------------------------------
  const modules: Module[] = ordered.map((draft) => {
    const files = filesOf(draft, text);
    const languages = new Set<string>();
    for (const file of files) {
      const language = detectLanguage(file.path);
      if (language) languages.add(language);
    }
    return {
      name: draft.name,
      path: draft.path,
      kind: draft.kind,
      importance: moduleImportance({
        fanIn: fanIn.get(draft.name) ?? 0,
        fileCount: files.length,
        hasEntrypoint: input.entrypoints.some((e) => isUnder(e.path, draft.path)),
      }),
      fileCount: files.length,
      languages: [...languages].sort(compareStrings),
      dependsOn: dependsOnByPath.get(draft.path) ?? [],
    };
  });

  modules.sort((a, b) => b.importance - a.importance || compareStrings(a.path, b.path));

  if (modules.length > MAX_MODULES) {
    notes.push(`Only the first ${MAX_MODULES} of ${modules.length} modules are listed.`);
    return { modules: modules.slice(0, MAX_MODULES), notes };
  }
  return { modules, notes };
}

function filesOf(draft: Draft, text: FileEntry[]): FileEntry[] {
  if (draft.path === '.') return text;
  const prefix = `${draft.path}/`;
  return text.filter((e) => e.path.startsWith(prefix));
}

/** Is `path` the module itself, or a file inside it? */
function isUnder(path: string, modulePath: string): boolean {
  return modulePath === '.' || path === modulePath || path.startsWith(`${modulePath}/`);
}

/**
 * Match workspace globs against directories that are known to exist.
 *
 * Only the two shapes package managers actually use are expanded — `dir/*`
 * and `dir/**`. Anything else is reported rather than approximated: a
 * negation pattern (`!packages/legacy`) expanded as a positive one would
 * add a module the workspace deliberately excludes, and a wrong module
 * list is worse than a short one.
 */
function expandWorkspaceGlobs(
  globs: string[],
  dirs: Set<string>
): { matched: Set<string>; unexpanded: string[] } {
  const matched = new Set<string>();
  const unexpanded: string[] = [];

  for (const raw of globs) {
    const glob = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (glob === '') continue;

    if (glob.endsWith('/**')) {
      const base = glob.slice(0, -3);
      const hits = [...dirs].filter((d) => d === base || d.startsWith(`${base}/`));
      if (hits.length === 0) unexpanded.push(raw);
      else for (const dir of hits) matched.add(dir);
      continue;
    }

    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      const hits = [...dirs].filter(
        (d) => d.startsWith(`${base}/`) && !d.slice(base.length + 1).includes('/')
      );
      if (hits.length === 0) unexpanded.push(raw);
      else for (const dir of hits) matched.add(dir);
      continue;
    }

    if (glob.includes('*') || glob.startsWith('!')) {
      unexpanded.push(raw);
      continue;
    }

    if (dirs.has(glob)) matched.add(glob);
    else unexpanded.push(raw);
  }

  return { matched, unexpanded };
}

function dirnameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

function basenameOf(dir: string): string {
  const cut = dir.lastIndexOf('/');
  return cut === -1 ? dir : dir.slice(cut + 1);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
