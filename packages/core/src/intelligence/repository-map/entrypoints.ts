/**
 * Entrypoint detection.
 *
 * An entrypoint is a file an agent should read *first*: where the program
 * starts, where a package's public surface is defined, where the test
 * runner is configured, where a contract is declared. The Repository Map
 * reports them with a confidence, because the evidence is uneven — a
 * `bin` field in `package.json` is close to a fact, while "there is a
 * `src/app.ts`" is a convention that many repositories do not follow.
 *
 * ## The rule that matters
 *
 * No entrypoint is ever reported at a path the tree does not contain. A
 * manifest declares targets that frequently do not exist in the
 * repository: `bin` points at `dist/cli.js` (build output, never
 * committed), `exports` points at compiled files, a `main` points at a
 * file that was renamed. Emitting those produces an entrypoint an agent
 * cannot open, and a map that lies about its own repository is worse than
 * a map with a missing entry — the same failure mode as a tarball root
 * derived from shape alone (`git/tarball.ts`).
 *
 * The rule is enforced in exactly one place, `resolveTarget`, and every
 * other rule reads its path out of `entries` and therefore cannot
 * violate it. It is enforced there rather than at the point where signals
 * are recorded because that is where a path can first come from
 * somewhere other than the tree — and a guard on the recording side would
 * be unreachable, which is to say untested.
 *
 * ## What is deliberately absent
 *
 * `scripts.start` names a command, not a file (`"start": "node src/x.js"`,
 * `"start": "vite"`). Parsing a command line to guess a path is exactly
 * the kind of inference this layer does not do. Likewise a Go `main.go`
 * is only reported when its content was fetched and says `package main`,
 * because the filename alone does not make it one.
 */
import type { Entrypoint } from '../../schemas/intelligence/repository-map.js';
import { toEvidenceV2 } from '../../schemas/intelligence/evidence-v2.js';
import type { FileEntry } from '../../git/files.js';

/** Enough to describe a repository; past this the list stops being a shortcut. */
export const MAX_ENTRYPOINTS = 50;

type EntrypointKind = Entrypoint['kind'];

interface Signal {
  kind: EntrypointKind;
  confidence: number;
  reason: string;
  line: number | null;
}

/**
 * When two signals agree on a path but not on what it is, the higher
 * confidence wins and the tie-break below settles the rest.
 *
 * `library` sits last on purpose: it is the label for "a package's public
 * surface, as far as we can tell", which is the weakest claim available.
 * A file that is both a `bin` and a `src/index` is a CLI.
 */
const KIND_TIEBREAK: EntrypointKind[] = [
  'contract',
  'test-runner',
  'cli',
  'worker',
  'server',
  'app',
  'library',
];

const PATH_RULES: { match: RegExp; kind: EntrypointKind; confidence: number; reason: string }[] = [
  // Node / TypeScript. `(^|/)` rather than `^` so that every workspace
  // package's own `src/index.ts` counts, not just the repository root's.
  { match: /(^|\/)src\/index\.(ts|tsx|js|jsx|mjs|cjs)$/, kind: 'library', confidence: 0.85, reason: 'src/index is the conventional package entry' },
  { match: /(^|\/)src\/main\.(ts|tsx|js|jsx)$/, kind: 'app', confidence: 0.8, reason: 'src/main is the conventional application entry' },
  { match: /(^|\/)src\/server\.(ts|tsx|js|jsx)$/, kind: 'server', confidence: 0.8, reason: 'src/server starts an HTTP server' },
  { match: /(^|\/)src\/app\.(ts|tsx|js|jsx)$/, kind: 'app', confidence: 0.7, reason: 'src/app is the conventional application entry' },
  { match: /(^|\/)src\/cli\.(ts|js|mjs)$/, kind: 'cli', confidence: 0.7, reason: 'src/cli is the conventional command-line entry' },
  { match: /(^|\/)src\/worker\.(ts|js)$/, kind: 'worker', confidence: 0.7, reason: 'src/worker is the conventional background-worker entry' },
  { match: /(^|\/)(src\/)?bin\/[^/]+\.(ts|js|mjs|cjs)$/, kind: 'cli', confidence: 0.75, reason: 'A file under bin/ is an executable entry' },
  { match: /^index\.(ts|tsx|js|jsx|mjs|cjs)$/, kind: 'library', confidence: 0.7, reason: 'A root index file is the package entry' },
  { match: /(^|\/)main\.(ts|js|mjs)$/, kind: 'app', confidence: 0.6, reason: 'A main file is the application entry' },
  { match: /(^|\/)app\.(ts|tsx|js)$/, kind: 'app', confidence: 0.6, reason: 'An app file is the application entry' },
  { match: /(^|\/)server\.(ts|js)$/, kind: 'server', confidence: 0.6, reason: 'A server file starts an HTTP server' },

  // Web frameworks.
  { match: /(^|\/)pages\/_app\.(tsx|jsx|ts|js)$/, kind: 'app', confidence: 0.75, reason: 'Next.js pages/_app is the application entry' },
  { match: /(^|\/)app\/layout\.(tsx|jsx|ts|js)$/, kind: 'app', confidence: 0.7, reason: 'Next.js app/layout is the application entry' },
  { match: /^index\.html$/, kind: 'app', confidence: 0.6, reason: 'A root index.html is the page entry' },

  // Python.
  { match: /(^|\/)(main|__main__)\.py$/, kind: 'app', confidence: 0.75, reason: 'main.py / __main__.py is the conventional Python entry' },
  { match: /(^|\/)(app|wsgi|asgi)\.py$/, kind: 'server', confidence: 0.7, reason: 'wsgi/asgi/app is the conventional Python server entry' },
  { match: /(^|\/)manage\.py$/, kind: 'cli', confidence: 0.7, reason: 'manage.py is the Django command entry' },

  // Rust / C#.
  { match: /(^|\/)src\/main\.rs$/, kind: 'app', confidence: 0.8, reason: 'src/main.rs is the Cargo binary entry' },
  { match: /(^|\/)src\/bin\/[^/]+\.rs$/, kind: 'app', confidence: 0.75, reason: 'src/bin/*.rs is a Cargo binary target' },
  { match: /(^|\/)Program\.cs$/, kind: 'app', confidence: 0.6, reason: 'Program.cs is the conventional .NET entry' },

  // Test runners.
  { match: /(^|\/)(vitest|jest|karma|mocha|ava|jasmine)\.config\.(ts|js|mjs|cjs)$/, kind: 'test-runner', confidence: 0.9, reason: 'Test-runner configuration' },
  { match: /(^|\/)(playwright|cypress)\.config\.(ts|js|mjs|cjs)$/, kind: 'test-runner', confidence: 0.9, reason: 'End-to-end test-runner configuration' },
  { match: /(^|\/)pytest\.ini$/, kind: 'test-runner', confidence: 0.9, reason: 'pytest configuration' },
  { match: /(^|\/)conftest\.py$/, kind: 'test-runner', confidence: 0.85, reason: 'pytest fixture bootstrap' },
  { match: /(^|\/)phpunit\.xml(\.dist)?$/, kind: 'test-runner', confidence: 0.85, reason: 'PHPUnit configuration' },

  // Contracts. `script/*.s.sol` is a Foundry deployment script, which is
  // an entrypoint in the only sense that matters here: run this.
  { match: /(^|\/)script\/[^/]+\.s\.sol$/, kind: 'contract', confidence: 0.9, reason: 'Foundry deployment script' },
  { match: /(^|\/)contracts\/[^/]+\.sol$/, kind: 'contract', confidence: 0.55, reason: 'A contract under contracts/' },
  { match: /(^|\/)src\/[^/]+\.sol$/, kind: 'contract', confidence: 0.5, reason: 'A contract under a Foundry src/ layout' },
];

/** Extensions tried when a manifest target has none, in Node's order. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.sol'];

export interface EntrypointDetectInput {
  /** Every file in the tree, not only the text ones — a declared target is resolved against all of it. */
  entries: FileEntry[];
  contents: Map<string, string>;
}

/**
 * The detection result, cap included.
 *
 * `total` and `truncated` exist because a caller cannot recover them from
 * the array alone: a list of exactly `MAX_ENTRYPOINTS` entries is either a
 * repository with exactly that many or one with more, and the two deserve
 * different `limitations` text. Without them the caller has to guess with
 * `length >= MAX_ENTRYPOINTS`, which reports possible truncation for a
 * list that is in fact complete.
 */
export interface EntrypointSet {
  entrypoints: Entrypoint[];
  total: number;
  truncated: boolean;
}

export function detectEntrypointSet(input: EntrypointDetectInput): EntrypointSet {
  const known = new Set(input.entries.map((e) => e.path));
  const byPath = new Map<string, Signal[]>();

  function add(path: string, signal: Signal): void {
    const list = byPath.get(path);
    if (list) list.push(signal);
    else byPath.set(path, [signal]);
  }

  for (const entry of input.entries) {
    for (const rule of PATH_RULES) {
      if (rule.match.test(entry.path)) {
        add(entry.path, { kind: rule.kind, confidence: rule.confidence, reason: rule.reason, line: null });
      }
    }
  }

  for (const entry of input.entries) {
    const content = input.contents.get(entry.path);
    if (content === undefined) continue;
    for (const signal of contentSignals(entry.path, content)) add(entry.path, signal);
  }

  for (const entry of input.entries) {
    if (!entry.path.endsWith('package.json')) continue;
    const content = input.contents.get(entry.path);
    if (content === undefined) continue;
    for (const { target, signal } of packageJsonSignals(entry.path, content, known)) add(target, signal);
  }

  const out: Entrypoint[] = [];
  for (const [path, signals] of byPath) {
    const sorted = [...signals].sort(bySignalStrength);
    const best = sorted[0];
    if (!best) continue;
    out.push({
      path,
      kind: best.kind,
      confidence: best.confidence,
      // Every signal is kept, including the ones that lost. A file that
      // is both a `bin` and a `src/index` is worth knowing about, and the
      // disagreement is the interesting part.
      evidence: sorted.map((s) =>
        toEvidenceV2(
          { file: path, line: s.line, reason: s.reason },
          { source: 'static-analysis', confidence: s.confidence }
        )
      ),
    });
  }

  out.sort((a, b) => b.confidence - a.confidence || compareStrings(a.path, b.path));
  return {
    entrypoints: out.slice(0, MAX_ENTRYPOINTS),
    total: out.length,
    truncated: out.length > MAX_ENTRYPOINTS,
  };
}

/** Just the entrypoints, for callers that do not report the cap. */
export function detectEntrypoints(input: EntrypointDetectInput): Entrypoint[] {
  return detectEntrypointSet(input).entrypoints;
}

/** Content-derived signals. Only ever called with content actually in hand. */
function contentSignals(path: string, content: string): Signal[] {
  const out: Signal[] = [];
  const base = path.split('/').pop() ?? '';

  if (/^Dockerfile[^/]*$/.test(base)) {
    const line = lineMatching(content, /^\s*(CMD|ENTRYPOINT)\b/);
    if (line !== null) {
      out.push({ kind: 'app', confidence: 0.6, reason: 'Dockerfile declares CMD or ENTRYPOINT', line });
    }
  }

  if (base === 'main.go') {
    const line = lineMatching(content, /^\s*package\s+main\b/);
    if (line !== null) {
      out.push({ kind: 'app', confidence: 0.9, reason: 'Go main package', line });
    }
  }

  // A `.sol` file under test/ or a `.t.sol` is a test contract, not an
  // entry an agent should start from.
  if (base.endsWith('.sol') && !isTestPath(path)) {
    const line = lineMatching(content, /^\s*(?:abstract\s+)?(?:contract|library|interface)\s+\w+/);
    if (line !== null) {
      out.push({ kind: 'contract', confidence: 0.6, reason: 'Solidity contract declaration', line });
    }
  }

  return out;
}

/**
 * Entrypoints declared by a `package.json`.
 *
 * Returns the *targets*, already resolved to paths that exist, so the
 * caller can record the file rather than the manifest that named it.
 */
function packageJsonSignals(
  manifestPath: string,
  content: string,
  known: Set<string>
): { target: string; signal: Signal }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // A malformed manifest is a finding for the audit layer. Here it
    // simply yields no signal.
    return [];
  }
  if (!isRecord(parsed)) return [];

  const dir = dirnameOf(manifestPath);
  const out: { target: string; signal: Signal }[] = [];

  const bin = parsed['bin'];
  const binTargets =
    typeof bin === 'string'
      ? [bin]
      : isRecord(bin)
        ? Object.values(bin).filter((v): v is string => typeof v === 'string')
        : [];
  for (const raw of [...binTargets].sort(compareStrings)) {
    const target = resolveTarget(dir, raw, known);
    if (target) {
      out.push({
        target,
        signal: { kind: 'cli', confidence: 0.95, reason: `\`bin\` in ${manifestPath} declares this file`, line: null },
      });
    }
  }

  for (const field of ['main', 'module'] as const) {
    const value = parsed[field];
    if (typeof value !== 'string') continue;
    const target = resolveTarget(dir, value, known);
    if (target) {
      out.push({
        target,
        signal: { kind: 'library', confidence: 0.8, reason: `\`${field}\` in ${manifestPath} points here`, line: null },
      });
    }
  }

  // `exports` is a tree of conditions. Only `./`-relative leaves are
  // candidates — `"types"`, `"default"` and package specifiers are not
  // files in this repository.
  const exportLeaves = exportTargets(parsed['exports']).filter((v) => v.startsWith('./')).sort(compareStrings);
  for (const leaf of exportLeaves) {
    const target = resolveTarget(dir, leaf, known);
    if (target) {
      out.push({
        target,
        signal: { kind: 'library', confidence: 0.7, reason: `\`exports\` in ${manifestPath} resolves here`, line: null },
      });
      break;
    }
  }

  return out;
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (isRecord(value)) return Object.values(value).flatMap(exportTargets);
  return [];
}

/**
 * Turn a manifest-declared target into a repository path, or `null`.
 *
 * **This function is the only place a path that did not come from the
 * tree can enter the result**, so it is where "never report a path the
 * repository does not have" is enforced: every branch ends in a
 * `known.has` check, and `null` means the target was declared but is not
 * there.
 *
 * Node's resolution order, limited to what is observable here: the exact
 * path, then the path plus a source extension, then the path as a
 * directory with an `index` file. No guessing across directories — a
 * `main` of `./dist/index.js` whose only real file is `src/index.ts` is
 * *not* resolved, because that mapping is a build convention this layer
 * cannot verify.
 */
function resolveTarget(dir: string, raw: string, known: Set<string>): string | null {
  let target = raw.trim().replace(/\\/g, '/');
  if (target === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return null;
  if (target.startsWith('./')) target = target.slice(2);

  const normalized = normalizePath(dir === '' ? target : `${dir}/${target}`);
  if (normalized === null || normalized === '') return null;
  if (known.has(normalized)) return normalized;

  if (!normalized.includes('.')) {
    for (const ext of RESOLVE_EXTENSIONS) {
      if (known.has(normalized + ext)) return normalized + ext;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexed = `${normalized}/index${ext}`;
      if (known.has(indexed)) return indexed;
    }
  }
  return null;
}

/** Collapse `.` and `..`; `null` when the path escapes the repository root. */
function normalizePath(input: string): string | null {
  const out: string[] = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

function bySignalStrength(a: Signal, b: Signal): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const ka = KIND_TIEBREAK.indexOf(a.kind);
  const kb = KIND_TIEBREAK.indexOf(b.kind);
  if (ka !== kb) return ka - kb;
  return compareStrings(a.reason, b.reason);
}

function lineMatching(content: string, re: RegExp): number | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? '')) return i + 1;
  }
  return null;
}

function dirnameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?|e2e)\//.test(path) || /\.t\.sol$/.test(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
