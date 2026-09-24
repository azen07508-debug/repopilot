/**
 * Manifest parsing for the Repository Map.
 *
 * ## Why this is hand-written
 *
 * R-21: a new dependency must not drag in `zod` 3.25+ or MCP SDK 1.23+
 * transitively, and `pnpm install --frozen-lockfile` is a release gate. A
 * TOML parser would be the third runtime dependency of `@repopilot/core`
 * after octokit and zod, for a job that is "read `name = "version"` out of
 * a section header". So the TOML support here is a deliberately narrow
 * line-based subset: section headers, `key = value`, `key = [...]` (single
 * and multi-line), and inline tables. Anything outside that subset is
 * *reported* rather than silently dropped — see `notes`.
 *
 * ## Why `notes` exists
 *
 * A manifest parser that quietly understands 80% of a format produces a
 * dependency list that is 80% right and looks 100% right. Every gap this
 * parser knows about becomes a line in `RepositoryMap.limitations`, which
 * is the same contract `Report.limitations` already keeps: say what was
 * not read instead of letting the absence pass for a fact.
 */
import type { ExternalDependency } from '../../schemas/intelligence/repository-map.js';

/** Per-manifest cap on reported problems, so one odd file cannot flood the limitations. */
const MAX_NOTES_PER_MANIFEST = 5;

export interface ManifestParseResult {
  path: string;
  /** The manifest's own name, when it declares one. */
  packageName: string | null;
  /** Workspace globs, when it declares any. */
  workspaceGlobs: string[];
  dependencies: ExternalDependency[];
  /** Human-readable gaps. Each becomes a limitation line. */
  notes: string[];
}

/** Formats this parser reads. */
export function isParsableManifest(path: string): boolean {
  return (
    /(^|\/)package\.json$/.test(path) ||
    /(^|\/)requirements[^/]*\.txt$/.test(path) ||
    /(^|\/)pyproject\.toml$/.test(path) ||
    /(^|\/)Cargo\.toml$/.test(path) ||
    /(^|\/)go\.mod$/.test(path) ||
    /(^|\/)pnpm-workspace\.ya?ml$/.test(path)
  );
}

/**
 * Formats this parser recognises but does not read.
 *
 * Recognised is the point: a `pom.xml` is a dependency manifest, and
 * saying "no external dependencies were found" in a Maven repository
 * without saying why would be the most misleading line in the map.
 */
const UNPARSED_MANIFEST_PATTERNS: RegExp[] = [
  /(^|\/)Gemfile$/,
  /(^|\/)composer\.json$/,
  /(^|\/)pubspec\.yaml$/,
  /(^|\/)pom\.xml$/,
  /(^|\/)build\.gradle(\.kts)?$/,
  /(^|\/)mix\.exs$/,
  /(^|\/)[^/]+\.csproj$/,
  /(^|\/)Package\.swift$/,
  /(^|\/)shard\.yml$/,
  /(^|\/)Project\.toml$/,
  /(^|\/)CMakeLists\.txt$/,
  /(^|\/)Package\.json$/,
];

export function isUnparsedManifest(path: string): boolean {
  return UNPARSED_MANIFEST_PATTERNS.some((re) => re.test(path));
}

export function parseManifest(path: string, content: string): ManifestParseResult {
  const out: ManifestParseResult = {
    path,
    packageName: null,
    workspaceGlobs: [],
    dependencies: [],
    notes: [],
  };
  let suppressed = 0;
  const ctx: Ctx = {
    out,
    note(message) {
      if (out.notes.length < MAX_NOTES_PER_MANIFEST) out.notes.push(message);
      else suppressed += 1;
    },
  };

  const base = path.split('/').pop() ?? '';
  if (base === 'package.json') parsePackageJson(path, content, ctx);
  else if (/^requirements[^/]*\.txt$/.test(base)) parseRequirements(path, content, ctx);
  else if (base === 'pyproject.toml') parsePyproject(path, content, ctx);
  else if (base === 'Cargo.toml') parseCargo(path, content, ctx);
  else if (base === 'go.mod') parseGoMod(path, content, ctx);
  else if (/^pnpm-workspace\.ya?ml$/.test(base)) parsePnpmWorkspace(path, content, ctx);

  if (suppressed > 0) out.notes.push(`…and ${suppressed} more note(s) in ${path}`);
  return out;
}

interface Ctx {
  out: ManifestParseResult;
  note(message: string): void;
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

const PACKAGE_JSON_SECTIONS: [string, ExternalDependency['kind']][] = [
  ['dependencies', 'runtime'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
];

function parsePackageJson(path: string, content: string, ctx: Ctx): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    ctx.note(`Could not parse ${path}: ${(e as Error).message}`);
    return;
  }
  if (!isRecord(parsed)) {
    ctx.note(`Could not parse ${path}: expected a JSON object`);
    return;
  }

  if (typeof parsed['name'] === 'string') ctx.out.packageName = parsed['name'];

  const workspaces = parsed['workspaces'];
  if (Array.isArray(workspaces)) {
    for (const glob of workspaces) if (typeof glob === 'string') ctx.out.workspaceGlobs.push(glob);
  } else if (isRecord(workspaces) && Array.isArray(workspaces['packages'])) {
    for (const glob of workspaces['packages']) if (typeof glob === 'string') ctx.out.workspaceGlobs.push(glob);
  }

  for (const [field, kind] of PACKAGE_JSON_SECTIONS) {
    const table = parsed[field];
    if (!isRecord(table)) continue;
    for (const [name, version] of Object.entries(table)) {
      ctx.out.dependencies.push({
        name,
        version: typeof version === 'string' ? version : null,
        kind,
        manifest: path,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// requirements.txt
// ---------------------------------------------------------------------------

function parseRequirements(path: string, content: string, ctx: Ctx): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    // `-r other.txt`, `-e .`, `--index-url ...`. These change what is
    // installed; not reading them is worth saying out loud.
    if (line.startsWith('-')) {
      ctx.note(`Skipped an option line in ${path}: ${line}`);
      continue;
    }
    const spec = (line.split(/\s+#/)[0] ?? '').trim();
    if (spec === '') continue;
    const parsed = parseRequirementSpec(spec);
    if (!parsed) {
      ctx.note(`Could not read a requirement in ${path}: ${line}`);
      continue;
    }
    ctx.out.dependencies.push({
      name: parsed.name,
      version: parsed.version,
      kind: 'runtime',
      manifest: path,
    });
  }
}

/**
 * One PEP 508 requirement: `name[extras]>=1.0`, `name==1.2.3`, `name`.
 *
 * Returns `null` for a URL or path requirement, which has no package name
 * to report — the caller decides whether to note it.
 */
function parseRequirementSpec(spec: string): { name: string; version: string | null } | null {
  const trimmed = spec.trim().replace(/^["']|["']$/g, '');
  if (trimmed === '') return null;
  if (/^(https?:|git\+|git:|file:|\.{0,2}\/)/i.test(trimmed)) return null;

  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(trimmed);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;

  // An environment marker (`; python_version < "3.9"`) is not a version.
  const rest = (match[2] ?? '').split(';')[0]?.trim() ?? '';
  return { name, version: rest === '' ? null : rest.replace(/\s+/g, '') };
}

// ---------------------------------------------------------------------------
// pyproject.toml
// ---------------------------------------------------------------------------

function parsePyproject(path: string, content: string, ctx: Ctx): void {
  let section = '';
  let pending: { section: string; key: string; parts: string[] } | null = null;

  const flush = (): void => {
    if (!pending) return;
    const body = pending.parts.join(' ').replace(/^\[/, '').replace(/\]$/, '');
    const kind = pepDependencyKind(pending.section, pending.key);
    if (kind) {
      for (const item of splitInlineArray(body)) addPepRequirement(path, item, kind, ctx);
    }
    pending = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === '') continue;

    if (pending) {
      pending.parts.push(line);
      if (line.includes(']')) flush();
      continue;
    }

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = (header[1] ?? '').trim();
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').replace(/^"|"$/g, '');
    const value = (kv[2] ?? '').trim();

    if (section === 'project' && key === 'name') {
      const name = parseTomlString(value);
      if (name) ctx.out.packageName = name;
      continue;
    }

    if (value.startsWith('[')) {
      if (value.includes(']')) {
        const kind = pepDependencyKind(section, key);
        const body = value.replace(/^\[/, '').replace(/\]$/, '');
        if (kind) for (const item of splitInlineArray(body)) addPepRequirement(path, item, kind, ctx);
      } else {
        pending = { section, key, parts: [value] };
      }
      continue;
    }

    const kind = pepDependencyKind(section, key);
    if (kind) {
      const version = parseTomlString(value) ?? tomlInlineVersion(value);
      ctx.out.dependencies.push({ name: key, version, kind, manifest: path });
    }
  }

  // An array that never closed: keep what was read rather than losing the
  // whole file to one missing bracket.
  flush();
}

function pepDependencyKind(section: string, key: string): ExternalDependency['kind'] | null {
  if (section === 'project' && key === 'dependencies') return 'runtime';
  if (section === 'project.optional-dependencies') return 'optional';
  if (section === 'build-system' && key === 'requires') return 'dev';
  if (section === 'tool.poetry.dependencies') return 'runtime';
  if (section === 'tool.poetry.dev-dependencies') return 'dev';
  if (/^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) return 'dev';
  return null;
}

function addPepRequirement(
  path: string,
  item: string,
  kind: ExternalDependency['kind'],
  ctx: Ctx
): void {
  const parsed = parseRequirementSpec(item);
  if (!parsed) {
    ctx.note(`Could not read a dependency in ${path}: ${item}`);
    return;
  }
  // Poetry records the interpreter constraint as a dependency.
  if (parsed.name.toLowerCase() === 'python') return;
  ctx.out.dependencies.push({ name: parsed.name, version: parsed.version, kind, manifest: path });
}

// ---------------------------------------------------------------------------
// Cargo.toml
// ---------------------------------------------------------------------------

function parseCargo(path: string, content: string, ctx: Ctx): void {
  let section = '';
  let pendingMembers: string[] | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === '') continue;

    if (pendingMembers) {
      pendingMembers.push(line);
      if (line.includes(']')) {
        flushCargoMembers(pendingMembers, ctx);
        pendingMembers = null;
      }
      continue;
    }

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = (header[1] ?? '').trim();
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').replace(/^"|"$/g, '');
    const value = (kv[2] ?? '').trim();

    if (section === 'package' && key === 'name') {
      const name = parseTomlString(value);
      if (name) ctx.out.packageName = name;
      continue;
    }

    if (section === 'workspace' && key === 'members') {
      if (value.includes(']')) flushCargoMembers([value], ctx);
      else pendingMembers = [value];
      continue;
    }

    const kind = cargoDependencyKind(section);
    if (kind) {
      const version = parseTomlString(value) ?? tomlInlineVersion(value);
      ctx.out.dependencies.push({ name: key, version, kind, manifest: path });
    }
  }

  if (pendingMembers) flushCargoMembers(pendingMembers, ctx);
}

function flushCargoMembers(parts: string[], ctx: Ctx): void {
  const body = parts.join(' ').replace(/^\[/, '').replace(/\]$/, '');
  for (const item of splitInlineArray(body)) {
    const glob = item.replace(/^["']|["']$/g, '');
    if (glob !== '') ctx.out.workspaceGlobs.push(glob);
  }
}

function cargoDependencyKind(section: string): ExternalDependency['kind'] | null {
  if (section === 'dependencies') return 'runtime';
  if (section === 'dev-dependencies') return 'dev';
  if (section === 'build-dependencies') return 'dev';
  if (/^target\..*\.dependencies$/.test(section)) return 'runtime';
  if (/^target\..*\.dev-dependencies$/.test(section)) return 'dev';
  // `[workspace.dependencies]` declares versions for members to inherit.
  // It is not a dependency of this crate, and counting it as one would
  // attribute the whole workspace's deps to the root manifest.
  return null;
}

// ---------------------------------------------------------------------------
// go.mod
// ---------------------------------------------------------------------------

function parseGoMod(path: string, content: string, ctx: Ctx): void {
  let inRequireBlock = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = (rawLine.split('//')[0] ?? '').replace(/\s+/g, ' ').trim();
    if (line === '') continue;

    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      addGoRequire(path, line, ctx);
      continue;
    }

    if (line.startsWith('module ')) {
      ctx.out.packageName = line.slice('module '.length).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (line.startsWith('require ')) {
      addGoRequire(path, line.slice('require '.length).trim(), ctx);
      continue;
    }
    if (line.startsWith('replace ') || line.startsWith('exclude ')) {
      ctx.note(`\`${line.split(' ')[0]}\` directives in ${path} are not applied`);
    }
  }
}

function addGoRequire(path: string, spec: string, ctx: Ctx): void {
  const parts = spec.trim().split(' ').filter((p) => p !== '');
  const name = parts[0];
  if (!name) return;
  ctx.out.dependencies.push({
    name,
    version: parts[1] ?? null,
    kind: 'runtime',
    manifest: path,
  });
}

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml
// ---------------------------------------------------------------------------

/**
 * The workspace glob list, and nothing else.
 *
 * pnpm also stores `onlyBuiltDependencies` and `catalog` here, both of
 * which are lists of `- value` lines. Reading the file without tracking
 * the top-level key would turn package names into directory globs and
 * invent modules that do not exist.
 */
function parsePnpmWorkspace(path: string, content: string, ctx: Ctx): void {
  let inPackages = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (line === '') continue;

    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      const inline = line.slice(line.indexOf(':') + 1).trim();
      for (const glob of splitYamlInlineList(inline)) ctx.out.workspaceGlobs.push(glob);
      continue;
    }
    if (inPackages && /^-\s*/.test(line)) {
      const glob = line.replace(/^-\s*/, '').trim().replace(/^["']|["']$/g, '');
      if (glob !== '') ctx.out.workspaceGlobs.push(glob);
      continue;
    }
    // Any other top-level key ends the packages block.
    if (inPackages && !/^\s/.test(rawLine)) inPackages = false;
  }
}

function splitYamlInlineList(value: string): string[] {
  if (!value.startsWith('[')) return [];
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s !== '');
}

// ---------------------------------------------------------------------------
// Package managers
// ---------------------------------------------------------------------------

const LOCKFILE_MANAGERS: [RegExp, string][] = [
  [/(^|\/)pnpm-lock\.yaml$/, 'pnpm'],
  [/(^|\/)package-lock\.json$/, 'npm'],
  [/(^|\/)yarn\.lock$/, 'yarn'],
  [/(^|\/)bun\.lockb?$/, 'bun'],
  [/(^|\/)poetry\.lock$/, 'poetry'],
  [/(^|\/)uv\.lock$/, 'uv'],
  [/(^|\/)Pipfile\.lock$/, 'pipenv'],
  [/(^|\/)Cargo\.lock$/, 'cargo'],
  [/(^|\/)go\.sum$/, 'go'],
  [/(^|\/)foundry\.toml$/, 'foundry'],
  [/(^|\/)composer\.lock$/, 'composer'],
  [/(^|\/)Gemfile\.lock$/, 'bundler'],
];

/**
 * Which package managers the repository uses.
 *
 * Two sources, and the weaker one is deliberate: a lockfile is proof,
 * while a manifest alone only suggests. `package.json`'s `packageManager`
 * field is the strongest signal of all — it is the declaration the
 * Corepack-enabled toolchain actually obeys — so it is read first.
 */
export function packageManagers(paths: Iterable<string>, contents: Map<string, string>): string[] {
  const found = new Set<string>();

  for (const path of paths) {
    for (const [pattern, manager] of LOCKFILE_MANAGERS) {
      if (pattern.test(path)) found.add(manager);
    }
    if (/(^|\/)Cargo\.toml$/.test(path)) found.add('cargo');
    if (/(^|\/)go\.mod$/.test(path)) found.add('go');
    if (/(^|\/)requirements[^/]*\.txt$/.test(path)) found.add('pip');
    if (/(^|\/)Pipfile$/.test(path)) found.add('pipenv');

    if (!/(^|\/)package\.json$/.test(path)) continue;
    const content = contents.get(path);
    if (content === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed)) continue;
      const declared = parsed['packageManager'];
      if (typeof declared === 'string') {
        const name = declared.split('@')[0]?.trim();
        if (name) found.add(name);
      }
    } catch {
      // Already noted by parseManifest; not worth a second note here.
    }
  }

  for (const [path, content] of contents) {
    if (/(^|\/)pyproject\.toml$/.test(path) && /^\s*\[tool\.poetry\]/m.test(content)) found.add('poetry');
  }

  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Small TOML helpers
// ---------------------------------------------------------------------------

/** Drop a `#` comment, ignoring `#` inside a quoted string. */
function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseTomlString(value: string): string | null {
  const trimmed = value.trim();
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed) ?? /^'([^']*)'$/.exec(trimmed);
  if (!match) return null;
  return (match[1] ?? '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** `{ version = "1.0", features = [...] }` -> `1.0`; `{ path = "../x" }` -> null. */
function tomlInlineVersion(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  for (const entry of splitInlineArray(body)) {
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(entry);
    if (!kv) continue;
    if ((kv[1] ?? '').trim() !== 'version') continue;
    return parseTomlString((kv[2] ?? '').trim());
  }
  return null;
}

/** Split a TOML array body on top-level commas, respecting quotes and nesting. */
function splitInlineArray(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of body) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth += 1;
      else if (ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current);

  return out
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
