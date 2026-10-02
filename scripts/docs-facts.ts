#!/usr/bin/env tsx
/**
 * scripts/docs-facts.ts — the facts the documentation states about the code,
 * derived from the code instead of typed into prose.
 *
 * Why this exists
 * ---------------
 * The 2026-10-01 architecture review found fourteen places where a document
 * disagreed with the repository. Nearly all of them were the same shape: a
 * number or a name that can be read out of the source tree, written into a
 * paragraph by hand, and then kept in step by discipline. Discipline lost.
 *
 * The fix is not "be more careful". It is to stop keeping a second copy. The
 * facts below are computed here, written into the documents between markers,
 * and recomputed by `pnpm docs:check`, which exits non-zero on any divergence.
 *
 *   pnpm docs:facts    rewrite the generated blocks in place
 *   pnpm docs:check    recompute and compare; exit 1 on any divergence
 *
 * What is generated
 * -----------------
 *   mcp-tool-count        the number of registered MCP tools
 *   mcp-tools             a Tool / Cost table
 *   mcp-tools-box         the same list as the ASCII box in ARCHITECTURE.md
 *   workspace-layout      the workspace package names, grouped
 *   workspace-count       "3 packages + 2 apps"
 *   compose-service-count the number of compose services
 *   compose-services      the compose service table
 *   fixture-count         the number of fixture repositories
 *
 * Which documents are covered is itself a rule
 * --------------------------------------------
 * The first version of this script carried a hand-written list of four
 * documents. `ROADMAP.md` was not on it, and it had drifted in exactly the way
 * the fourteen had: "all 5 packages + 2 apps" (there have never been five
 * packages) and "5 fixtures" directly above six fixture names. A check whose
 * scope is a list nobody re-reads has the defect it was written to find, one
 * level up (D-032).
 *
 * Every markdown file in the repository is therefore in exactly one of two
 * lists: `BLOCK_DOCS`, which may carry generated blocks, or `BLOCK_FREE_DOCS`,
 * which deliberately does not and says why. `checkBlockScope()` fails if a file
 * is in neither or in both, so adding a document forces the question instead of
 * defaulting to "unchecked".
 *
 * What is deliberately *not* generated
 * ------------------------------------
 * Test baseline numbers (they are only knowable after the suite runs, so a
 * generator would be circular), version strings, and narrative sentences.
 * Those stay hand-written and are covered by the per-batch discipline. They
 * are four or five of the fourteen, not the bulk.
 *
 * The analyzer list is in the same category, for a different reason: "how
 * many analyzers are there" has no single answer. `packages/core/src/analyzers`
 * holds eight modules, `ReportBuilder.build()` calls nine functions, and
 * `metadata.ts` is called by the pipeline rather than by the builder. A
 * generator would have to pick one of three defensible numbers and defend it,
 * which is worse than the sentence in ARCHITECTURE.md naming the nine calls in
 * order and claiming no count at all.
 *
 * Three checks carry no generated block at all — they assert an invariant and
 * print nothing:
 *
 *   1. the `BILLING` map and the `server.tool()` registrations agree;
 *   2. `docs/INDEX.md` links every `docs/*.md` file, and every link resolves;
 *   3. every `pnpm <script>` a document names exists.
 *
 * Check 3 is the one that already paid for itself: `PROJECT_STATE.md` told an
 * operator to run `pnpm start:api` and `pnpm start:worker`, and neither has
 * ever existed at the root. It also closes the gap check 1 names: the test
 * called "registers every tool the billing map advertises" checked a
 * hand-copied list, so the billing map itself was asserted by nothing.
 *
 * Every source read is a text file in this repository. No build, no network,
 * no environment. It runs in about a tenth of a second, which is why it can
 * sit in CI on every push.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

/* ────────────────────────────── fact sources ────────────────────────────── */

interface ToolFact {
  name: string;
  cost: 'paid' | 'free';
}

/**
 * The MCP tools, from the two places the code states them.
 *
 * `server.tool('name', …)` is what a client actually sees. `BILLING` is what
 * `get_repopilot_capabilities` tells an agent it can afford. They are two
 * statements of one list, so they are read separately and compared — a tool
 * added to one and not the other is a real defect, not a documentation
 * problem, and this refuses to guess which is right.
 */
function readMcpTools(): ToolFact[] {
  const src = read('packages/mcp-server/src/index.ts');

  const registered: string[] = [];
  for (const m of src.matchAll(/server\.tool\(\s*'([a-z0-9_]+)'/g)) {
    registered.push(m[1]);
  }
  if (registered.length < 5) {
    throw new Error(
      `docs-facts: found only ${registered.length} server.tool() registrations in ` +
        `packages/mcp-server/src/index.ts. The registration pattern changed; ` +
        `fix readMcpTools() rather than trusting the result.`
    );
  }

  const billingStart = src.indexOf('const BILLING = {');
  const billingEnd = src.indexOf('} as const;', billingStart);
  if (billingStart === -1 || billingEnd === -1) {
    throw new Error('docs-facts: could not find the BILLING map in packages/mcp-server/src/index.ts.');
  }
  const billing = src.slice(billingStart, billingEnd);
  const entries: ToolFact[] = [];
  for (const m of billing.matchAll(/([a-z0-9_]+):\s*\{[\s\S]*?paid:\s*(true|false)/g)) {
    entries.push({ name: m[1], cost: m[2] === 'true' ? 'paid' : 'free' });
  }

  const registeredSet = new Set(registered);
  const billedSet = new Set(entries.map((e) => e.name));
  const onlyRegistered = registered.filter((n) => !billedSet.has(n));
  const onlyBilled = [...billedSet].filter((n) => !registeredSet.has(n));
  if (onlyRegistered.length > 0 || onlyBilled.length > 0) {
    throw new Error(
      'docs-facts: the BILLING map and the server.tool() registrations disagree.\n' +
        (onlyRegistered.length > 0 ? `  registered but not billed: ${onlyRegistered.join(', ')}\n` : '') +
        (onlyBilled.length > 0 ? `  billed but not registered: ${onlyBilled.join(', ')}\n` : '') +
        '  Fix the code first — the documents would otherwise be derived from a contradiction.'
    );
  }

  // Registration order, so the table reads the way the file does.
  return registered.map((name) => {
    const entry = entries.find((e) => e.name === name);
    if (entry === undefined) throw new Error(`docs-facts: no billing entry for ${name}`);
    return entry;
  });
}

interface WorkspaceFact {
  dir: string;
  name: string;
}

interface WorkspacesFact {
  packages: WorkspaceFact[];
  apps: WorkspaceFact[];
}

/** Workspace members, from the globs in `pnpm-workspace.yaml`. */
function readWorkspaces(): WorkspacesFact {
  const cfg = parseYaml(read('pnpm-workspace.yaml')) as { packages?: string[] };
  const globs = cfg.packages ?? [];

  const collect = (group: 'packages' | 'apps'): WorkspaceFact[] => {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .filter((name) => globs.some((g) => g === `${group}/*` || g === `${group}/${name}`))
      .filter((name) => existsSync(join(dir, name, 'package.json')))
      .sort()
      .map((name) => ({
        dir: `${group}/${name}`,
        name: readJson<{ name: string }>(`${group}/${name}/package.json`).name,
      }));
  };

  return { packages: collect('packages'), apps: collect('apps') };
}

interface ServiceFact {
  name: string;
  kind: string;
  published: string;
}

/**
 * Compose services, from `docker-compose.yml`.
 *
 * `kind` is read off `restart`: a service that must not restart is a job, and
 * its exit code is the signal. `published` is the first port mapping, if any.
 */
function readComposeServices(): ServiceFact[] {
  const cfg = parseYaml(read('docker-compose.yml')) as {
    services?: Record<string, { restart?: string; ports?: string[] }>;
  };
  const services = cfg.services ?? {};
  return Object.entries(services).map(([name, svc]) => ({
    name,
    kind: svc.restart === 'no' ? 'one-shot job' : 'long-running',
    published: svc.ports?.[0] ?? '—',
  }));
}

function readRootScripts(): string[] {
  const pkg = readJson<{ scripts?: Record<string, string> }>('package.json');
  return Object.keys(pkg.scripts ?? {});
}

function readDocFiles(): string[] {
  return readdirSync(join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Fixture repositories, from `fixtures/`.
 *
 * A directory, not a list in a document: `README.md` and `PROJECT_STATE.md`
 * both said "6 sample repos", which was right, and `ROADMAP.md` said "5
 * fixtures" above six fixture names, which was not.
 */
function readFixtures(): string[] {
  return readdirSync(join(ROOT, 'fixtures'))
    .filter((name) => statSync(join(ROOT, 'fixtures', name)).isDirectory())
    .sort();
}

const TOOLS = readMcpTools();
const WORKSPACES = readWorkspaces();
const SERVICES = readComposeServices();
const FIXTURES = readFixtures();
const SCRIPTS = readRootScripts();
const DOC_FILES = readDocFiles();

/* ──────────────────────────────── renderers ─────────────────────────────── */

/**
 * The ASCII box in ARCHITECTURE.md.
 *
 * Rendered rather than drawn so the borders cannot drift from the contents —
 * a hand-aligned box is a second copy of every tool name's length. It emits
 * its own fence, because a box only lines up in a monospace context; the
 * `docs-facts` markers stay outside the fence.
 */
function renderToolsBox(): string {
  const lines: string[] = [`packages/mcp-server (stdio), ${TOOLS.length} tools`];
  const labelWidth = 6; // "paid:" / "free:" plus a gap

  for (const cost of ['paid', 'free'] as const) {
    const group = TOOLS.filter((t) => t.cost === cost);
    if (group.length === 0) continue;
    lines.push(`${`  ${cost}:`.padEnd(labelWidth + 2)}${group[0].name}`);
    for (const tool of group.slice(1)) {
      lines.push(`${' '.repeat(labelWidth + 2)}${tool.name}`);
    }
  }

  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '─'.repeat(width);
  const box = [
    `┌${bar}┐`,
    ...lines.map((l) => `│  ${l.padEnd(width - 4)}  │`),
    `└${bar}┘`,
  ];
  return ['```text', ...box, '```'].join('\n');
}

const RENDERERS: Record<string, () => string> = {
  'mcp-tool-count': () => String(TOOLS.length),

  'mcp-tools': () => {
    const rows = ['| Tool | Cost |', '| --- | --- |'];
    for (const tool of TOOLS) rows.push(`| \`${tool.name}\` | ${tool.cost} |`);
    return rows.join('\n');
  },

  'mcp-tools-box': renderToolsBox,

  'workspace-layout': () => {
    const line = (label: string, items: WorkspaceFact[]) =>
      `- ${label} (${items.length}): ${items.map((w) => `\`${w.name}\``).join(', ')}`;
    return [line('packages', WORKSPACES.packages), line('apps', WORKSPACES.apps)].join('\n');
  },

  'workspace-count': () =>
    `${WORKSPACES.packages.length} packages + ${WORKSPACES.apps.length} apps`,

  'compose-service-count': () => String(SERVICES.length),

  'fixture-count': () => String(FIXTURES.length),

  'compose-services': () => {
    const rows = ['| Service | Kind | Published |', '| --- | --- | --- |'];
    for (const svc of SERVICES) {
      const port = svc.published === '—' ? '—' : `\`${svc.published}\``;
      rows.push(`| \`${svc.name}\` | ${svc.kind} | ${port} |`);
    }
    return rows.join('\n');
  },
};

/* ────────────────────────────── block plumbing ──────────────────────────── */

const BLOCK_RE = /<!--\s*docs-facts:([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*docs-facts:end\s*-->/g;

/** Every markdown file a block may appear in. */
const BLOCK_DOCS = [
  'README.md',
  'PROJECT_STATE.md',
  'ROADMAP.md',
  'docs/ARCHITECTURE.md',
  'docs/INDEX.md',
  'docs/MCP_CLIENT_SETUP.md',
  'docs/RELEASE_CHECKLIST.md',
];

/**
 * Every markdown file that deliberately carries no generated block, with the
 * reason. The reason is the point: "it has no derivable facts" and "its facts
 * are only knowable after a run" are different decisions, and the next person
 * to add a count to one of these files needs to know which one it was.
 */
const BLOCK_FREE_DOCS: Record<string, string> = {
  'BACKLOG.md': 'a prioritised TODO list; it names work, not counts',
  'CHANGELOG.md': 'a historical record — every number in it was true when written',
  'DECISIONS.md': 'dated decision records; a decision is a historical document',
  'MARKETPLACE_LISTING.md': 'marketplace copy; the facts it states are not derivable',
  'README_OKX.md': 'OKX integration notes; the flow, not the counts',
  'RISKS.md': 'a risk register; the version labels record when a risk was mitigated',
  'docs/API.md': 'the HTTP surface; endpoints and payloads, no derivable counts',
  'docs/DEPLOYMENT.md': 'operator instructions',
  'docs/EXTERNAL_ACTIONS.md': 'the user-side checklist',
  'docs/HERO_IMAGE_BRIEF.md': 'a design brief',
  'docs/OKX_LIVE_INTEGRATION.md': 'a runbook for an external service',
  'docs/OKX_REQUIREMENTS_SNAPSHOT.md': "a dated snapshot of an external party's requirements",
  'docs/REPOSITORY_INTELLIGENCE_PLAN.md': 'the phased plan; its tables are Phase-0 snapshots',
  'docs/SECURITY.md': 'the threat model',
};

/** Every markdown file scanned for `pnpm <script>` references. */
function allDocPaths(): string[] {
  const rootDocs = readdirSync(ROOT).filter((f) => f.endsWith('.md'));
  return [...rootDocs, ...DOC_FILES.map((f) => `docs/${f}`)].sort();
}

function render(id: string): string {
  const fn = RENDERERS[id];
  if (fn === undefined) {
    throw new Error(
      `docs-facts: unknown block id "${id}". Known ids: ${Object.keys(RENDERERS).join(', ')}`
    );
  }
  return fn();
}

function replaceBlocks(text: string): string {
  return text.replace(BLOCK_RE, (_whole, id: string) => {
    const body = render(id);
    return body.includes('\n')
      ? `<!-- docs-facts:${id} -->\n${body}\n<!-- docs-facts:end -->`
      : `<!-- docs-facts:${id} -->${body}<!-- docs-facts:end -->`;
  });
}

/* ────────────────────────────────── checks ──────────────────────────────── */

interface Problem {
  where: string;
  message: string;
}

/**
 * The first few lines that differ, so a CI failure is readable.
 *
 * The first version of this dumped both blocks in full; a stale tool box is
 * sixteen lines, twice, and the one line that mattered was buried in the
 * middle of it. A check nobody can read is a check nobody fixes.
 */
const MAX_REPORTED_DIFF_LINES = 5;

function describeDiff(actual: string, expected: string): string {
  const a = actual.split('\n');
  const b = expected.split('\n');
  const lines: string[] = [];

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (lines.length === MAX_REPORTED_DIFF_LINES) {
      lines.push('      … and further differences');
      break;
    }
    if (i >= a.length) lines.push(`      line ${i + 1}: missing from the file, code says ${JSON.stringify(b[i])}`);
    else if (i >= b.length) lines.push(`      line ${i + 1}: ${JSON.stringify(a[i])} is not in the code any more`);
    else lines.push(`      line ${i + 1}: file has ${JSON.stringify(a[i])}, code has ${JSON.stringify(b[i])}`);
  }
  return lines.join('\n');
}

/** Generated blocks whose body does not match what the code says. */
function checkBlocks(): Problem[] {
  const problems: Problem[] = [];
  let total = 0;

  for (const path of BLOCK_DOCS) {
    const text = read(path);
    for (const m of text.matchAll(BLOCK_RE)) {
      total += 1;
      const id = m[1];
      const actual = m[2].trim();
      const expected = render(id).trim();
      if (actual !== expected) {
        problems.push({
          where: `${path} (docs-facts:${id})`,
          message: `generated block is stale\n${describeDiff(actual, expected)}`,
        });
      }
    }
  }

  // A marker syntax change that stops the regex matching would turn every
  // block check into a no-op that still prints a green tick. R-26.
  if (total === 0) {
    problems.push({
      where: 'docs-facts',
      message:
        'no generated blocks found in any document. Either the markers were ' +
        'removed or BLOCK_RE no longer matches them — the check is currently a no-op.',
    });
  }
  return problems;
}

/**
 * Every markdown file is in `BLOCK_DOCS` or `BLOCK_FREE_DOCS` — never both,
 * never neither.
 *
 * Without this, the scope of the whole mechanism is a list, and a document
 * added later is unchecked by default. That is how `ROADMAP.md` came to say
 * "all 5 packages + 2 apps" in a repository that has always had three.
 */
function checkBlockScope(): Problem[] {
  const problems: Problem[] = [];
  const owned = new Set(BLOCK_DOCS);
  const free = new Set(Object.keys(BLOCK_FREE_DOCS));

  for (const path of allDocPaths()) {
    const inOwned = owned.has(path);
    const inFree = free.has(path);
    if (inOwned && inFree) {
      problems.push({ where: path, message: 'listed in both BLOCK_DOCS and BLOCK_FREE_DOCS' });
    } else if (!inOwned && !inFree) {
      problems.push({
        where: path,
        message:
          'is in neither BLOCK_DOCS nor BLOCK_FREE_DOCS, so nothing checks it. ' +
          'Add it to BLOCK_DOCS if it states a fact the code holds, or to ' +
          'BLOCK_FREE_DOCS with the reason it does not.',
      });
    }
  }

  for (const path of [...owned, ...free]) {
    if (!existsSync(join(ROOT, path))) {
      problems.push({ where: path, message: 'listed in docs-facts but does not exist' });
    }
  }
  return problems;
}

/** `docs/INDEX.md` must link every `docs/*.md`, and every link must resolve. */
function checkIndex(): Problem[] {
  const problems: Problem[] = [];
  const index = read('docs/INDEX.md');
  const targets = new Set<string>();
  for (const m of index.matchAll(/\]\(([^)]+)\)/g)) {
    const href = m[1];
    if (/^[a-z]+:/.test(href) || href.startsWith('#')) continue;
    targets.add(href);
    if (!existsSync(join(ROOT, 'docs', href))) {
      problems.push({ where: 'docs/INDEX.md', message: `link target does not exist: ${href}` });
    }
  }

  const linked = new Set([...targets].map((t) => t.replace(/^.*\//, '')));
  for (const file of DOC_FILES) {
    // INDEX.md is the list, so it is the one document that does not list
    // itself. Every other docs/*.md must be reachable from it.
    if (file === 'INDEX.md') continue;
    if (!linked.has(file)) {
      problems.push({
        where: 'docs/INDEX.md',
        message:
          `docs/${file} exists but INDEX.md never links it — INDEX claims to be ` +
          `the single entry point for every document`,
      });
    }
  }
  return problems;
}

/** pnpm builtins, so `pnpm install` is not reported as a missing script. */
const PNPM_BUILTINS = new Set([
  'install', 'add', 'remove', 'rm', 'update', 'up', 'run', 'exec', 'dlx', 'create', 'init',
  'import', 'publish', 'pack', 'link', 'unlink', 'prune', 'why', 'list', 'ls', 'outdated',
  'audit', 'licenses', 'patch', 'config', 'doctor', 'store', 'root', 'bin', 'env', 'setup',
  'fetch', 'deploy', 'rebuild', 'approve-builds', 'dedupe', 'help', 'tsx', 'tsc', 'vitest',
  'vite', 'drizzle-kit',
]);

/** Every `pnpm <script>` a document names must exist at the root. */
function checkCommandReferences(): Problem[] {
  const problems: Problem[] = [];
  const scripts = new Set(SCRIPTS);
  for (const path of allDocPaths()) {
    read(path)
      .split('\n')
      .forEach((line, i) => {
        // Backticked single-word commands only. Prose like "pnpm 11.x
        // workspaces" is not a command reference, and `pnpm -r test` /
        // `pnpm --filter X y` name a script through a flag, not directly.
        for (const m of line.matchAll(/`pnpm ([a-z][a-z0-9:_-]*)`/g)) {
          const name = m[1];
          if (scripts.has(name) || PNPM_BUILTINS.has(name)) continue;
          problems.push({
            where: `${path}:${i + 1}`,
            message:
              `\`pnpm ${name}\` is not a root script. Fix the reference, or add ` +
              `${name} to PNPM_BUILTINS in scripts/docs-facts.ts if it is a pnpm builtin.`,
          });
        }
      });
  }
  return problems;
}

/* ─────────────────────────────────── main ───────────────────────────────── */

const mode = process.argv[2] ?? '--check';
if (mode !== '--check' && mode !== '--write') {
  console.error(`docs-facts: mode must be --check or --write, got: ${mode}`);
  process.exit(2);
}

if (mode === '--write') {
  let touched = 0;
  for (const path of BLOCK_DOCS) {
    const before = read(path);
    const after = replaceBlocks(before);
    if (before !== after) {
      writeFileSync(join(ROOT, path), after, 'utf8');
      touched += 1;
      console.log(`  updated ${path}`);
    }
  }
  console.log(`docs-facts: ${touched} file(s) rewritten`);
  process.exit(0);
}

const problems = [
  ...checkBlockScope(),
  ...checkBlocks(),
  ...checkIndex(),
  ...checkCommandReferences(),
];

console.log('docs-facts: recompute and compare');
console.log('──────────────────────────────────────────────');
console.log(
  `  ${TOOLS.length} MCP tools · ${WORKSPACES.packages.length} packages + ` +
    `${WORKSPACES.apps.length} apps · ${SERVICES.length} compose services · ` +
    `${DOC_FILES.length} docs`
);

if (problems.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m 0 issues');
  process.exit(0);
}

for (const p of problems) {
  console.log(`  \x1b[33m!\x1b[0m ${p.where}: ${p.message}`);
}
console.log(`\n  ${problems.length} issue(s). Run \`pnpm docs:facts\` to rewrite the generated blocks.`);
process.exit(1);
