/**
 * The Repository Map builder.
 *
 * A pure function of the tree, the file contents and the repository
 * metadata: no network, no filesystem, no clock (the timestamp is
 * injectable), and no LLM (D-009). Everything it reports is traceable to
 * a path in the repository, which is what makes the artifact worth
 * caching (D-021) and worth diffing.
 *
 * ## Why it is not wired into the pipeline
 *
 * R-20: the map is a large JSON object and must not become a field of
 * `Report` by default — `report_json` is a database column, and every
 * audit would pay for an artifact most audits do not read. V0.2-g exposes
 * it over its own surface. Nothing here touches the audit path.
 */
import { classifyFile, detectLanguage, type FileEntry } from '../../git/files.js';
import { detectStack, type StackKey, type StackSignal } from '../../analyzers/stack.js';
import type { RepoMetadata } from '../../analyzers/metadata.js';
import {
  REPOSITORY_MAP_SCHEMA_VERSION,
  RepositoryMapSchema,
  type Entrypoint,
  type ExternalDependency,
  type ImportantFile,
  type LanguageUsage,
  type RepositoryMap,
} from '../../schemas/intelligence/repository-map.js';
import { scoreImportantFile } from './importance.js';
import { MAX_ENTRYPOINTS, detectEntrypointSet, isTestPath } from './entrypoints.js';
import type { EntrypointSet } from './entrypoints.js';
import { detectModules } from './modules.js';
import {
  isParsableManifest,
  isUnparsedManifest,
  packageManagers,
  parseManifest,
  type ManifestParseResult,
} from './manifests.js';

export const MAX_LISTED_FILES = 300;
export const MAX_DEPENDENCIES = 500;
export const MAX_IMPORTANT_FILES = 60;

export interface RepositoryMapInput {
  metadata: RepoMetadata;
  /** Every file in the tree, before or after the fetch caps — the caps are reported, not hidden. */
  entries: FileEntry[];
  contents: Map<string, string>;
  /** An already-computed stack detection. Recomputed when absent. */
  stack?: StackSignal[];
  /** Part of the cache key (D-021). Null when the caller does not know it. */
  commitSha?: string | null;
  /** The tarball could not be read and the per-file path ran (ADR D-017). */
  degraded?: boolean;
  /** Why the tarball path failed, when the caller knows. */
  degradedReason?: string;
  /** GitHub truncated the tree listing. */
  truncated?: boolean;
  /** Injectable so the output is reproducible in a test. */
  generatedAt?: string;
}

export function buildRepositoryMap(input: RepositoryMapInput): RepositoryMap {
  const text = input.entries.filter((e) => classifyFile(e.path, e.size).kind === 'text');

  const manifests = new Map<string, ManifestParseResult>();
  const unparsedManifests: string[] = [];
  for (const entry of text) {
    if (isParsableManifest(entry.path)) {
      const content = input.contents.get(entry.path);
      if (content === undefined) continue;
      manifests.set(entry.path, parseManifest(entry.path, content));
    } else if (isUnparsedManifest(entry.path)) {
      unparsedManifests.push(entry.path);
    }
  }
  unparsedManifests.sort(compareStrings);

  const workspaceGlobs = [
    ...new Set([...manifests.values()].flatMap((m) => m.workspaceGlobs)),
  ].sort(compareStrings);

  const stack = input.stack ?? detectStack(input.entries, input.contents);

  const entrypointSet = detectEntrypointSet({ entries: input.entries, contents: input.contents });
  const entrypoints = entrypointSet.entrypoints;
  const { modules, notes: moduleNotes } = detectModules({
    repoName: input.metadata.name,
    entries: input.entries,
    manifests,
    workspaceGlobs,
    entrypoints,
  });

  const languages = collectLanguages(text);
  const configFiles = listFiles(text, 'configuration files', isConfigFile);
  const testFiles = listFiles(text, 'test files', isTestFile);
  const documentationFiles = listFiles(text, 'documentation files', isDocumentationFile);
  const dependencyList = collectDependencies(manifests);
  const importantFiles = collectImportantFiles(entrypoints, configFiles.files);
  const frameworks = collectFrameworks(stack);
  const degraded = Boolean(input.degraded) || Boolean(input.truncated);

  const limitations = buildLimitations({
    degraded,
    degradedReason: input.degradedReason,
    truncated: Boolean(input.truncated),
    entrypointTruncation: entrypointSet,
    moduleCount: modules.length,
    moduleNotes,
    manifestCount: manifests.size,
    unparsedManifests,
    manifestNotes: [...manifests.values()].flatMap((m) => m.notes),
    lists: [configFiles, testFiles, documentationFiles],
    dependencyList,
    frameworks,
    hasProgrammingLanguage: languages.some((l) => !NON_PROGRAMMING_LANGUAGES.has(l.language)),
  });

  // Validated at the boundary rather than trusted. The schema is the
  // single source of truth for this artifact (the project's Zod rule), and
  // a builder that can emit a shape the schema rejects is a builder whose
  // declared return type is a lie. `parse` also materialises the defaults,
  // so a consumer never sees a missing `evidence: []`.
  return RepositoryMapSchema.parse({
    schemaVersion: REPOSITORY_MAP_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repository: {
      url: input.metadata.url,
      owner: input.metadata.owner,
      name: input.metadata.name,
      defaultBranch: input.metadata.defaultBranch,
      commitSha: input.commitSha ?? null,
      primaryLanguage: pickPrimaryLanguage(languages, input.metadata.primaryLanguage),
      languages,
      frameworks,
      packageManagers: packageManagers(
        text.map((e) => e.path),
        input.contents
      ),
    },
    entrypoints,
    modules,
    importantFiles,
    configFiles: configFiles.files,
    testFiles: testFiles.files,
    documentationFiles: documentationFiles.files,
    externalDependencies: dependencyList.dependencies,
    limitations,
    degraded,
  });
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * Formats that can dominate a repository by bytes without saying anything
 * about what it is written in.
 *
 * `languages` reports all of them, because "this repo is 40% JSON" is a
 * true and occasionally useful fact. `primaryLanguage` is the answer to a
 * different question, and a fixture-heavy repository answering "JSON"
 * would be technically defensible and practically useless.
 */
const NON_PROGRAMMING_LANGUAGES = new Set(['JSON', 'YAML', 'TOML', 'Markdown']);

function collectLanguages(text: FileEntry[]): LanguageUsage[] {
  const byLanguage = new Map<string, { fileCount: number; bytes: number }>();
  for (const entry of text) {
    const language = detectLanguage(entry.path);
    if (!language) continue;
    const usage = byLanguage.get(language) ?? { fileCount: 0, bytes: 0 };
    usage.fileCount += 1;
    usage.bytes += entry.size;
    byLanguage.set(language, usage);
  }

  return [...byLanguage]
    .map(([language, usage]) => ({ language, fileCount: usage.fileCount, bytes: usage.bytes }))
    .sort(
      (a, b) =>
        b.bytes - a.bytes || b.fileCount - a.fileCount || compareStrings(a.language, b.language)
    );
}

function pickPrimaryLanguage(languages: LanguageUsage[], fallback: string | null): string | null {
  const programming = languages.find((l) => !NON_PROGRAMMING_LANGUAGES.has(l.language));
  return programming?.language ?? languages[0]?.language ?? fallback;
}

// ---------------------------------------------------------------------------
// Frameworks
// ---------------------------------------------------------------------------

/**
 * Which `StackSignal` keys are frameworks.
 *
 * Not every signal: `docker`, `github-actions`, `postgresql` and the
 * deployment platforms are things a repository *has*, not things it is
 * written in. Listing them as frameworks would make the field mean "the
 * stack detector fired", which is not what a consumer reads it as.
 */
const FRAMEWORK_KEYS = new Set<StackKey>([
  'react',
  'nextjs',
  'vite',
  'vue',
  'svelte',
  'hardhat',
  'foundry',
]);

function collectFrameworks(stack: StackSignal[]): string[] {
  return stack
    .filter((s) => FRAMEWORK_KEYS.has(s.key) && s.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence || compareStrings(a.label, b.label))
    .map((s) => s.label);
}

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

const CONFIG_BASENAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'tsconfig.json',
  'jsconfig.json',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'foundry.toml',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'pipfile',
  'makefile',
  'justfile',
  'procfile',
  'railway.toml',
  'railway.json',
  'render.yaml',
  'vercel.json',
  'fly.toml',
  'netlify.toml',
  'wrangler.toml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'poetry.lock',
  'uv.lock',
  'pipfile.lock',
  'cargo.lock',
  'go.sum',
  'composer.lock',
  'gemfile.lock',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  'requirements.txt',
]);

const CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)(tsconfig|jsconfig)\.[^/]*\.json$/,
  /(^|\/)(vite|vitest|jest|next|nuxt|svelte|astro|rollup|webpack|esbuild|playwright|cypress|karma|mocha)\.config\.[cm]?[jt]s$/,
  /(^|\/)(eslint|prettier)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.(eslintrc|prettierrc|babelrc|stylelintrc)(\.[^/]+)?$/,
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)hardhat\.config\.[cm]?[jt]s$/,
  /(^|\/)\.github\/[^/]+$/,
  /(^|\/)\.github\/[^/]+\/[^/]+$/,
];

export function isConfigFile(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (CONFIG_BASENAMES.has(base.toLowerCase())) return true;
  return CONFIG_PATTERNS.some((re) => re.test(path));
}

const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc']);
const DOCUMENTATION_BASENAMES = new Set([
  'readme',
  'license',
  'licence',
  'changelog',
  'contributing',
  'code_of_conduct',
  'security',
  'authors',
  'notice',
  'governance',
]);

export function isDocumentationFile(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const extension = dot === -1 ? '' : base.slice(dot).toLowerCase();
  if (DOCUMENTATION_EXTENSIONS.has(extension)) return true;
  if (DOCUMENTATION_BASENAMES.has(base.toLowerCase())) return true;
  return path.startsWith('docs/');
}

/**
 * Test files, by filename as well as by directory.
 *
 * Both halves are needed and neither is optional. `src/foo.test.ts` sits
 * next to the code it tests and has no `test/` directory anywhere in its
 * path, while `tests/helpers.py` is a test file with no `test` in its
 * name. A detector that only knew about directories reported an empty
 * `testFiles` for this repository — the fixture test caught it, which is
 * why the assertion exists.
 */
const TEST_FILE_PATTERNS: RegExp[] = [
  /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.py$/,
  /(^|\/)[^/]+_test\.go$/,
  /(^|\/)[^/]+Tests?\.(cs|java|kt)$/,
  /(^|\/)[^/]+\.t\.sol$/,
  /(^|\/)conftest\.py$/,
];

export function isTestFile(path: string): boolean {
  if (isTestPath(path)) return true;
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

interface FileList {
  label: string;
  files: string[];
  total: number;
  truncated: boolean;
}

function listFiles(entries: FileEntry[], label: string, match: (path: string) => boolean): FileList {
  const all = entries
    .map((e) => e.path)
    .filter(match)
    .sort(compareStrings);
  if (all.length <= MAX_LISTED_FILES) {
    return { label, files: all, total: all.length, truncated: false };
  }
  return { label, files: all.slice(0, MAX_LISTED_FILES), total: all.length, truncated: true };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

interface DependencyList {
  dependencies: ExternalDependency[];
  /** After deduplication — the length of the list the cap was applied to. */
  total: number;
  truncated: boolean;
}

function collectDependencies(manifests: Map<string, ManifestParseResult>): DependencyList {
  const out: ExternalDependency[] = [];
  const seen = new Set<string>();
  for (const path of [...manifests.keys()].sort(compareStrings)) {
    const parsed = manifests.get(path);
    if (!parsed) continue;
    for (const dependency of parsed.dependencies) {
      // Keyed by kind as well as name: a package listed in both
      // `dependencies` and `devDependencies` really is declared twice, and
      // collapsing the two would hide a misplacement worth seeing.
      const key = `${path}\u0000${dependency.kind}\u0000${dependency.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dependency);
    }
  }
  out.sort(
    (a, b) =>
      compareStrings(a.manifest, b.manifest) ||
      compareStrings(a.name, b.name) ||
      compareStrings(a.kind, b.kind)
  );
  if (out.length <= MAX_DEPENDENCIES) {
    return { dependencies: out, total: out.length, truncated: false };
  }
  return { dependencies: out.slice(0, MAX_DEPENDENCIES), total: out.length, truncated: true };
}

// ---------------------------------------------------------------------------
// Important files
// ---------------------------------------------------------------------------

function collectImportantFiles(entrypoints: Entrypoint[], configFiles: string[]): ImportantFile[] {
  const entrypointByPath = new Map(entrypoints.map((e) => [e.path, e]));
  const configSet = new Set(configFiles);
  const paths = [...new Set([...entrypointByPath.keys(), ...configSet])].sort(compareStrings);

  const out: ImportantFile[] = [];
  for (const path of paths) {
    const entrypoint = entrypointByPath.get(path);
    const score = scoreImportantFile({
      entrypoint: entrypoint ? { kind: entrypoint.kind, confidence: entrypoint.confidence } : null,
      configLevel: configSet.has(path) ? (path.includes('/') ? 'nested' : 'root') : null,
    });
    if (!score) continue;
    out.push({ path, reason: score.reasons.join('; '), importance: score.importance });
  }

  out.sort((a, b) => b.importance - a.importance || compareStrings(a.path, b.path));
  return out.slice(0, MAX_IMPORTANT_FILES);
}

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

interface LimitationInput {
  degraded: boolean;
  degradedReason?: string;
  truncated: boolean;
  entrypointTruncation: EntrypointSet;
  moduleCount: number;
  moduleNotes: string[];
  manifestCount: number;
  unparsedManifests: string[];
  manifestNotes: string[];
  lists: FileList[];
  dependencyList: DependencyList;
  frameworks: string[];
  hasProgrammingLanguage: boolean;
}

function buildLimitations(input: LimitationInput): string[] {
  const out: string[] = [
    'Static analysis only — repository code is NEVER executed by RepoPilot.',
    'The map describes text files only; binaries and noise directories (node_modules, dist, .git, …) were not read.',
  ];

  if (input.degraded) {
    out.push(
      input.degradedReason
        ? `The archive could not be read (${input.degradedReason}), so content was fetched one file at a time (ADR D-017); the request cost was higher and the map may be incomplete.`
        : 'The archive could not be read, so content was fetched one file at a time (ADR D-017); the request cost was higher and the map may be incomplete.'
    );
  }
  if (input.truncated) {
    out.push('GitHub truncated the file tree, so the map covers only part of the repository.');
  }
  if (input.moduleCount > 0) {
    out.push(
      'Module boundaries and module-level dependencies come from manifests and directory layout; source-level imports are not resolved (V0.2-f).'
    );
  }
  if (input.manifestCount === 0) {
    out.push('No dependency manifest was found, so external dependencies are unknown.');
  }
  if (input.unparsedManifests.length > 0) {
    out.push(
      `These manifests were not parsed for dependencies: ${summarise(input.unparsedManifests)}.`
    );
  }
  out.push(...input.manifestNotes);

  for (const list of input.lists) {
    if (list.truncated) {
      out.push(`Only the first ${MAX_LISTED_FILES} of ${list.total} ${list.label} are listed.`);
    }
  }
  if (input.dependencyList.truncated) {
    out.push(
      `Only the first ${MAX_DEPENDENCIES} of ${input.dependencyList.total} dependencies are listed.`
    );
  }
  if (input.entrypointTruncation.truncated) {
    out.push(
      `Only the first ${MAX_ENTRYPOINTS} of ${input.entrypointTruncation.total} entrypoints are listed.`
    );
  }
  // Module truncation is reported by `detectModules` itself, which knows
  // the true total. Restating it here would put two lines about one fact
  // in `limitations`.
  if (input.frameworks.length === 0 && input.hasProgrammingLanguage) {
    out.push(
      'No framework from the stack detector\u2019s fixed set was recognised; a framework outside that set does not appear in this map.'
    );
  }
  out.push(...input.moduleNotes);

  return out;
}

function summarise(names: string[]): string {
  const shown = names.slice(0, 5).join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
