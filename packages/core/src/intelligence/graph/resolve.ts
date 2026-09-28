/**
 * Import specifier → repository path (V0.2-f).
 *
 * Everything here is pure: it takes a specifier, the file it was written in,
 * and an index of what the tree actually contains, and answers where the
 * specifier points. Nothing reads a file, a lockfile or a package manager,
 * which is what makes it testable without a repository and deterministic
 * across machines.
 *
 * Three rules run through all of it:
 *
 *  - **A path outside the tree is never returned.** `../../../../etc/passwd`
 *    is not a dependency. `normalisePath` refuses to walk above the root, and
 *    every candidate is checked against the tree before it is used.
 *  - **A guess is not a resolution.** When the candidates miss, the answer is
 *    `unresolved` or `external` with a reason, never the nearest-looking
 *    path. An edge to the wrong file is worse than no edge: it is the
 *    difference between an agent reading the right file and reading a
 *    plausible one.
 *  - **Determinism.** Candidates are generated in a fixed order and the first
 *    hit wins, so the same tree always produces the same edge.
 */
import type { FileEntry } from '../../git/files.js';

/** What the tree contains, built once and shared by every resolution. */
export interface TreeIndex {
  /** Every path in the tree, normalised. */
  files: ReadonlySet<string>;
  /** Every directory holding at least one file, including all ancestors. */
  directories: ReadonlySet<string>;
}

export type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'module'; path: string; name: string }
  | { kind: 'external'; package: string }
  | { kind: 'unresolved'; reason: string };

export interface ResolveInput {
  specifier: string;
  /** The file the specifier was written in. */
  fromPath: string;
  language: string;
  tree: TreeIndex;
  /** Module name → the directory it owns, from the Repository Map. */
  modules?: ReadonlyMap<string, string>;
  /**
   * Import prefixes that stand for the repository root — a `go.mod` module
   * path, most often. `github.com/me/proj/internal/x` resolves to
   * `internal/x` when `github.com/me/proj` is a prefix.
   */
  rootPrefixes?: readonly string[];
}

export function indexTree(entries: readonly FileEntry[]): TreeIndex {
  const files = new Set<string>();
  const directories = new Set<string>();

  for (const entry of entries) {
    const path = normalisePath(entry.path);
    if (path === null) continue;
    files.add(path);
    let dir = dirOf(path);
    while (dir !== '') {
      directories.add(dir);
      dir = dirOf(dir);
    }
  }

  return { files, directories };
}

export function resolveSpecifier(input: ResolveInput): Resolution {
  const specifier = input.specifier.trim();
  if (specifier === '') return { kind: 'unresolved', reason: 'the specifier is empty' };

  for (const candidate of fileCandidates(specifier, input)) {
    if (input.tree.files.has(candidate)) return { kind: 'file', path: candidate };
  }

  const dir = moduleDirectory(specifier, input);
  if (dir !== null && input.tree.directories.has(dir)) {
    return { kind: 'module', path: dir, name: moduleNameFor(dir, input.modules) };
  }

  return missFor(specifier, input);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * Join and collapse `.` / `..`, or `null` when the result would leave the
 * repository. This is the one place the "no path outside the tree" rule is
 * enforced, so every candidate goes through it.
 */
export function normalisePath(input: string): string | null {
  const out: string[] = [];
  for (const segment of input.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length === 0 ? null : out.join('/');
}

export function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

/**
 * The package a bare specifier names. `@scope/pkg/deep` → `@scope/pkg`,
 * `pkg/deep` → `pkg`.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split('/').filter((segment) => segment !== '');
  const first = segments[0];
  if (first === undefined) return specifier;
  if (first.startsWith('@') && segments.length > 1) return `${first}/${segments[1]}`;
  return first;
}

/** `github.com/me/proj/internal/x` with prefix `github.com/me/proj` → `internal/x`. */
export function stripRootPrefix(specifier: string, prefixes: readonly string[]): string | null {
  for (const prefix of prefixes) {
    const clean = prefix.replace(/\/+$/, '');
    if (clean === '') continue;
    // The prefix itself is the root, which no file is — and `startsWith`
    // already refuses it, since `"a/b"` does not start with `"a/b/"`.
    if (specifier.startsWith(`${clean}/`)) {
      return normalisePath(specifier.slice(clean.length + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * The extensions a specifier without one may be hiding.
 *
 * The importing language's own extensions come first, so a Python file
 * importing `./util` prefers `util.py` over `util.ts` when a repository
 * happens to hold both.
 */
const EXTENSIONS_BY_LANGUAGE: Record<string, readonly string[]> = {
  TypeScript: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
  JavaScript: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
  Vue: ['.vue', '.ts', '.js'],
  Svelte: ['.svelte', '.ts', '.js'],
  Python: ['.py', '.pyi'],
  Solidity: ['.sol'],
  Go: ['.go'],
  Rust: ['.rs'],
  Java: ['.java'],
  Kotlin: ['.kt', '.kts'],
  Ruby: ['.rb'],
  Shell: ['.sh', '.bash'],
  Protobuf: ['.proto'],
  GraphQL: ['.graphql', '.gql'],
};

const FALLBACK_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.rb',
  '.sol',
  '.json',
];

function extensionsFor(language: string): readonly string[] {
  return EXTENSIONS_BY_LANGUAGE[language] ?? FALLBACK_EXTENSIONS;
}

/** Entry files a directory may expose, for a specifier that names a package. */
const INDEX_BASENAMES: readonly string[] = ['index', 'mod', '__init__', 'main'];

/** Source roots a language's absolute imports are written against. */
const SOURCE_ROOTS_BY_LANGUAGE: Record<string, readonly string[]> = {
  Java: ['', 'src/main/java/', 'src/test/java/', 'src/', 'app/src/main/java/'],
  Kotlin: ['', 'src/main/kotlin/', 'src/test/kotlin/', 'src/', 'app/src/main/kotlin/'],
};

function fileCandidates(specifier: string, input: ResolveInput): string[] {
  const { fromPath, language, rootPrefixes = [] } = input;

  // Go imports a package, which is a directory — see `moduleDirectory`.
  if (language === 'Go') return [];

  if (language === 'Python') return pythonCandidates(specifier, fromPath);
  if (language === 'Rust') return rustCandidates(specifier, fromPath, language);
  if (language === 'Java' || language === 'Kotlin') return absoluteCandidates(specifier, language);

  if (isRelativeSpecifier(specifier)) return relativeCandidates(specifier, fromPath, language);

  // A bare specifier that names a workspace module: its entry file, when the
  // tree has the shape everyone uses.
  const moduleDir = moduleDirectory(specifier, input);
  if (moduleDir !== null) return entryCandidates(moduleDir, language);

  const stripped = stripRootPrefix(specifier, rootPrefixes);
  if (stripped !== null) return withExtensions(stripped, language);

  return [];
}

function moduleDirectory(specifier: string, input: ResolveInput): string | null {
  const { language, modules, rootPrefixes = [] } = input;

  if (language === 'Go') return stripRootPrefix(specifier, rootPrefixes);
  if (isRelativeSpecifier(specifier) || specifier.startsWith('.')) return null;
  if (specifier.startsWith('/')) return null;

  return modules?.get(packageNameOf(specifier)) ?? null;
}

function missFor(specifier: string, input: ResolveInput): Resolution {
  if (specifier.startsWith('/')) {
    return {
      kind: 'unresolved',
      reason: `"${specifier}" is an absolute filesystem path, which no repository-relative path can match`,
    };
  }
  if (isRelativeSpecifier(specifier) || specifier.startsWith('.')) {
    return {
      kind: 'unresolved',
      reason: `no file in the repository matches the relative import "${specifier}"`,
    };
  }
  if (input.language === 'Go' && stripRootPrefix(specifier, input.rootPrefixes ?? []) !== null) {
    return {
      kind: 'unresolved',
      reason: `the Go import "${specifier}" names a package directory the repository does not contain`,
    };
  }
  return { kind: 'external', package: packageNameOf(specifier) };
}

function withExtensions(base: string, language: string): string[] {
  const out = [base, ...sourceRewrites(base, language)];
  for (const ext of extensionsFor(language)) out.push(`${base}${ext}`);
  return out;
}

/** Languages whose source and emitted extensions differ. */
const REWRITTEN_LANGUAGES = new Set(['TypeScript', 'JavaScript', 'Vue', 'Svelte']);

/**
 * What an emitted extension can have been written as.
 *
 * TypeScript's ESM output requires the *emitted* extension in the source, so
 * an import that looks like it names a `.js` file names its original. Without
 * this rewrite every internal import in such a repository is reported
 * unresolved — which is every repository this tool is aimed at, since the
 * convention is what `"module": "NodeNext"` asks for (D-001 in this very
 * repository).
 *
 * It is a **fan-out, not a pair**, and `.js → .tsx` is the entry that was
 * missing. `Header.tsx` compiles to `Header.js`, so a React project on NodeNext
 * writes `import { Header } from './components/Header.js'` for a file called
 * `Header.tsx` — and with only `.js → .ts` in this table, all nine such imports
 * in this repository were reported as unresolved relative imports while
 * extension-less ones resolved fine. Found by running the tool against this
 * repository rather than against a fixture.
 *
 * The pairs are derived, not guessed: `.ts`/`.tsx`/`.js`/`.jsx` all emit
 * `.js`; `.tsx`/`.jsx` emit `.jsx`; `.mts` emits `.mjs`; `.cts` emits `.cjs`.
 * The first candidate that exists on disk wins, so the order is a tie-break
 * for a case TypeScript itself rejects as ambiguous.
 */
const SOURCE_REWRITES: readonly (readonly [string, readonly string[]])[] = [
  ['.js', ['.ts', '.tsx', '.js', '.jsx']],
  ['.jsx', ['.tsx', '.jsx']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
];

function sourceRewrites(base: string, language: string): string[] {
  if (!REWRITTEN_LANGUAGES.has(language)) return [];

  const out: string[] = [];
  for (const [from, to] of SOURCE_REWRITES) {
    if (!base.endsWith(from)) continue;
    const stem = base.slice(0, -from.length);
    for (const ext of to) out.push(`${stem}${ext}`);
  }
  return out;
}

/** A directory's entry files, then its index files, in a fixed order. */
function entryCandidates(dir: string, language: string): string[] {
  const out: string[] = [];
  for (const basename of INDEX_BASENAMES) {
    out.push(...withExtensions(`${dir}/${basename}`, language));
  }
  out.push(...withExtensions(`${dir}/src/index`, language));
  return out;
}

function relativeCandidates(specifier: string, fromPath: string, language: string): string[] {
  const base = normalisePath(`${dirOf(fromPath)}/${specifier}`);
  if (base === null) return [];

  const out = withExtensions(base, language);
  for (const ext of extensionsFor(language)) out.push(`${base}/index${ext}`);
  return out;
}

/** Java and Kotlin import a dotted path written against a source root. */
function absoluteCandidates(specifier: string, language: string): string[] {
  const path = specifier.replace(/\./g, '/');
  const roots = SOURCE_ROOTS_BY_LANGUAGE[language] ?? [''];
  const out: string[] = [];
  for (const root of roots) {
    out.push(...withExtensions(`${root}${path}`, language));
  }
  return out;
}

/**
 * Python, where the specifier is dotted and a leading dot means "relative to
 * my own package". One dot is the file's directory, two is its parent, and
 * so on — `from ..util import x` inside `pkg/sub/mod.py` means `pkg/util.py`.
 */
function pythonCandidates(specifier: string, fromPath: string): string[] {
  const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;

  if (dots === 0) {
    const path = specifier.replace(/\./g, '/');
    const out = pythonModuleCandidates(path);
    // A repository with a `src/` layout writes the same import either way.
    for (const candidate of pythonModuleCandidates(`src/${path}`)) out.push(candidate);
    return out;
  }

  let dir = dirOf(fromPath);
  for (let level = 1; level < dots; level += 1) {
    // A pop from the root would leave it. `from .. import x` in a root-level
    // module is an error in Python, not a reference to the root — clamping to
    // the root instead would resolve it to a file that is not what it names.
    if (dir === '') return [];
    dir = dirOf(dir);
  }

  const rest = specifier.slice(dots).replace(/\./g, '/');
  const joined = normalisePath(rest === '' ? dir : `${dir}/${rest}`);
  if (joined === null) return [];
  return pythonModuleCandidates(joined);
}

function pythonModuleCandidates(path: string): string[] {
  return [`${path}.py`, `${path}.pyi`, `${path}/__init__.py`];
}

/**
 * Rust, where `crate::a::b` is rooted at the crate source and `super::` /
 * `self::` are relative. A module can be a file or a directory with `mod.rs`,
 * and the same `use` statement may name either.
 *
 * `crate::` is resolved against `src/`, which is the convention. A crate
 * rooted somewhere else reports `unresolved` rather than being guessed at —
 * without the tree in hand there is nothing to guess from, and an edge to the
 * wrong module is worse than no edge.
 */
function rustCandidates(specifier: string, fromPath: string, language: string): string[] {
  const cleaned = specifier.trim().replace(/^::/, '');

  if (cleaned.startsWith('crate::') || cleaned === 'crate') {
    const rest = cleaned.slice('crate::'.length).replace(/::/g, '/');
    return rustPathCandidates(`src/${rest}`, language);
  }

  if (cleaned.startsWith('self::') || cleaned.startsWith('super::')) {
    let dir = rustModuleDirOf(fromPath);
    let rest = cleaned;
    while (rest.startsWith('super::')) {
      dir = dirOf(dir);
      rest = rest.slice('super::'.length);
    }
    rest = rest.replace(/^self::/, '').replace(/::/g, '/');
    const joined = normalisePath(rest === '' ? dir : `${dir}/${rest}`);
    return joined === null ? [] : rustPathCandidates(joined, language);
  }

  return [];
}

/**
 * The directory a Rust file's child modules live in.
 *
 * `src/a.rs` owns `src/a/`, not `src/` — that is the whole point of the
 * non-`mod.rs` layout. A crate root (`lib.rs`, `main.rs`) and a `mod.rs` own
 * the directory they sit in.
 */
const RUST_CRATE_ROOTS = new Set(['lib.rs', 'main.rs', 'mod.rs']);

function rustModuleDirOf(path: string): string {
  const dir = dirOf(path);
  const basename = dir === '' ? path : path.slice(dir.length + 1);
  if (RUST_CRATE_ROOTS.has(basename)) return dir;

  const stem = basename.replace(/\.rs$/, '');
  return dir === '' ? stem : `${dir}/${stem}`;
}

function rustPathCandidates(path: string, language: string): string[] {
  const out = [`${path}.rs`, `${path}/mod.rs`];
  out.push(...withExtensions(path, language));
  return out;
}

function moduleNameFor(dir: string, modules: ReadonlyMap<string, string> | undefined): string {
  if (modules) {
    for (const [name, moduleDir] of modules) {
      if (moduleDir === dir) return name;
    }
  }
  const cut = dir.lastIndexOf('/');
  return cut === -1 ? dir : dir.slice(cut + 1);
}
