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
 * `BLOCK_DOCS` also names the blocks each document carries, because the
 * comparison in `checkBlocks()` can only see a block that is present. A
 * document that loses one entirely has nothing left to be stale, and
 * `docs/RELEASE_CHECKLIST.md` spent an unknown length of time in exactly that
 * state with a green tick.
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
 * Five checks carry no generated block at all — they assert an invariant and
 * print nothing:
 *
 *   1. the `BILLING` map and the `server.tool()` registrations agree;
 *   2. `docs/INDEX.md` links every `docs/*.md` file, and every link resolves;
 *   3. every `pnpm <script>` a document names exists;
 *   4. `CHANGELOG.md` names each release category at most once per release;
 *   5. every statement of an audit price agrees, and the atomic registration
 *      values are those prices.
 *
 * Check 3 is the one that already paid for itself: `PROJECT_STATE.md` told an
 * operator to run `pnpm start:api` and `pnpm start:worker`, and neither has
 * ever existed at the root. It also closes the gap check 1 names: the test
 * called "registers every tool the billing map advertises" checked a
 * hand-copied list, so the billing map itself was asserted by nothing.
 *
 * Check 4 is the newest and the narrowest: a duplicated `### Changed` in
 * `[Unreleased]` made the Contents link point at the first of two sections,
 * leaving the second unreachable (2026-10-04).
 *
 * Check 5 is the one with money behind it. `PRICE_FULL_AUDIT` was stated as
 * `0.10` in `.env.example` and `0.05` in every other place that stated it,
 * while `docs/EXTERNAL_ACTIONS.md` told the operator to set the price from
 * `.env.example` — so the runbook pointed at the one wrong copy, and the
 * disagreement would have surfaced as a failed payment on the first real sale.
 * See `readPriceStatements()` for the full account.
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
    registered.push(capture(m, 1));
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
    entries.push({ name: capture(m, 1), cost: capture(m, 2) === 'true' ? 'paid' : 'free' });
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
    const [head, ...rest] = TOOLS.filter((t) => t.cost === cost);
    // Destructuring says "there is no first element" in the form the type
    // checker can read; `group.length === 0` said the same thing to a human.
    if (head === undefined) continue;
    lines.push(`${`  ${cost}:`.padEnd(labelWidth + 2)}${head.name}`);
    for (const tool of rest) {
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

/**
 * Every markdown file a block may appear in, and *which* blocks it carries.
 *
 * The list of ids is the load-bearing part. `checkBlocks()` can only compare a
 * block it finds, so a document that loses a block entirely — markers, body,
 * the lot — passes: there is nothing to be stale. `docs/RELEASE_CHECKLIST.md`
 * was in exactly that state when this map was written, reading
 * "(every workspace: )" with no block at all, and `pnpm docs:check` was green.
 * A check whose scope is "whatever I happen to find" cannot see a deletion.
 *
 * Declaring the ids makes the block set a fact the code holds rather than a
 * fact the document happens to have, which is D-034 applied to the last part
 * of the mechanism that was still implicit.
 */
const BLOCK_DOCS: Record<string, string[]> = {
  'README.md': ['fixture-count', 'mcp-tool-count'],
  'PROJECT_STATE.md': [
    'compose-service-count',
    'compose-services',
    'fixture-count',
    'mcp-tool-count',
    'mcp-tools',
    'workspace-count',
    'workspace-layout',
  ],
  'ROADMAP.md': ['workspace-count'],
  'docs/ARCHITECTURE.md': ['compose-services', 'mcp-tools-box'],
  'docs/INDEX.md': ['mcp-tool-count'],
  'docs/MCP_CLIENT_SETUP.md': ['mcp-tool-count'],
  'docs/RELEASE_CHECKLIST.md': ['workspace-count'],
};

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
  'RISKS.md':
    'a risk register; the version labels record when a risk was mitigated, so ' +
    'no number here is derivable. Its shape is checked instead of its contents, ' +
    'by `checkRisksRegister()`',
  'docs/API.md': 'the HTTP surface; endpoints and payloads, no derivable counts',
  'docs/AVATAR_BRIEF.md': 'a design brief; its measurements are re-taken by preflight:production',
  'docs/DEPLOYMENT.md': 'operator instructions',
  'docs/EXTERNAL_ACTIONS.md': 'the user-side checklist',
  'docs/HERO_IMAGE_BRIEF.md': 'a design brief; its measurements are re-taken by preflight:production',
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

  for (const [path, declared] of Object.entries(BLOCK_DOCS)) {
    const text = read(path);
    const found: string[] = [];
    for (const m of text.matchAll(BLOCK_RE)) {
      total += 1;
      const id = capture(m, 1);
      found.push(id);
      const actual = capture(m, 2).trim();
      const expected = render(id).trim();
      if (actual !== expected) {
        problems.push({
          where: `${path} (docs-facts:${id})`,
          message: `generated block is stale\n${describeDiff(actual, expected)}`,
        });
      }
    }

    // The blocks this document declares, against the blocks it has. A missing
    // one is the case `checkBlocks()` alone cannot see, because a block that is
    // not there cannot be stale.
    for (const id of declared) {
      if (!found.includes(id)) {
        problems.push({
          where: path,
          message:
            `declares the block "docs-facts:${id}" and does not contain it. ` +
            'Either the markers were deleted — in which case the number it ' +
            'guarded is now unchecked, which is how RELEASE_CHECKLIST came to ' +
            'read "(every workspace: )" with a green tick — or the document ' +
            'should no longer declare it, and BLOCK_DOCS is the thing to edit.',
        });
      }
    }
    for (const id of found) {
      if (!declared.includes(id)) {
        problems.push({
          where: path,
          message:
            `contains a "docs-facts:${id}" block that BLOCK_DOCS does not ` +
            'declare for it. Add it there, so a deletion is detectable.',
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
  const owned = new Set(Object.keys(BLOCK_DOCS));
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
    const href = capture(m, 1);
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
          const name = capture(m, 1);
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

/**
 * A documented `docker run` must not ask for a configuration the API refuses
 * to start with.
 *
 * `validateProductionConfig` (`apps/api/src/config.ts`, R-02) rejects
 * `NODE_ENV=production` together with `PAYMENT_MODE=mock`. A document that
 * tells a human to pass both hands them a container that exits before the
 * first request, and the failure reads as "/health never came up" rather than
 * as the config error it is.
 *
 * This is not hypothetical and it is not a one-off. The same command was
 * documented in three places. It was found and corrected twice —
 * `docs/DEPLOYMENT.md`, and `docker-check.sh`'s own smoke test — and both
 * corrections are in `CHANGELOG.md` as fixed. `README.md` and
 * `docs/EXTERNAL_ACTIONS.md` still carried the broken pair until 2026-10-05,
 * the second of them underneath an acceptance criterion that the pair made
 * unmeetable. Two `CHANGELOG` entries saying "it now runs as
 * `NODE_ENV=development`" is not a check.
 *
 * Only fenced code blocks are inspected, and only those that invoke
 * `docker run`. The pairing appears legitimately in prose — `RISKS.md`,
 * `ROADMAP.md` and `docs/DEPLOYMENT.md` all *explain* that the combination is
 * refused — and flagging those would train the reader to ignore this check.
 *
 * Not covered: `NODE_ENV=production` with the `inline` default of
 * `AUDIT_QUEUE_DRIVER`, which is refused for the same reason but is an
 * *absence*, so detecting it needs a judgement this check should not make.
 */
function checkDockerRunConfig(): Problem[] {
  const problems: Problem[] = [];
  for (const path of allDocPaths()) {
    let fenced = false;
    let fenceStart = 0;
    let block: string[] = [];

    const flush = (): void => {
      const text = block.join('\n');
      block = [];
      if (!/\bdocker run\b/.test(text)) return;
      if (!/NODE_ENV=production/.test(text)) return;
      if (!/PAYMENT_MODE=mock/.test(text)) return;
      problems.push({
        where: `${path}:${fenceStart + 1}`,
        message:
          'this `docker run` sets NODE_ENV=production with PAYMENT_MODE=mock, ' +
          'which validateProductionConfig refuses (R-02) — the container exits ' +
          'before the first request. Use NODE_ENV=development for a local run, ' +
          'or PAYMENT_MODE=okx for production.',
      });
    };

    read(path)
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*```/.test(line)) {
          if (fenced) flush();
          else fenceStart = i;
          fenced = !fenced;
          return;
        }
        if (fenced) block.push(line);
      });
    // An unterminated fence would otherwise swallow the block silently.
    flush();
  }
  return problems;
}

/**
 * `CHANGELOG.md` names each Keep-a-Changelog category at most once per release.
 *
 * A repeated `### Changed` is not cosmetic. Heading anchors are positional: the
 * second one becomes `#changed-1`, and the Contents list at the top of the file
 * links `[Changed](#changed)`. So the second section is reachable from nowhere,
 * and the document claims to have one Changed section while having two. Nothing
 * noticed, because every other check in this script asks about *generated
 * blocks* and `CHANGELOG.md` is deliberately block-free.
 *
 * Found on 2026-10-04: `[Unreleased]` carried `### Changed` at line 81 and
 * again at line 840. Merging them was a two-line deletion — the content was
 * never wrong, only the heading was duplicated — but no check had ever looked
 * at heading structure, so it had been that way for an unknown number of
 * batches, growing each time.
 *
 * Deliberately *not* checked here: whether a given bullet sits under the right
 * category. `[Unreleased]` also files a run of feature additions under
 * `### Changed`, and separating them needs a per-bullet judgement — several
 * read "no longer claims" or "instead of" and belong in Fixed. A check that
 * guessed at that would be worse than a sentence describing it.
 */
/** USDT on every network this product settles on has 6 decimals. */
const PRICE_ATOMIC_DECIMALS = 6;

interface PriceStatement {
  where: string;
  /** Decimal USDT, as a human reads it. */
  amount: string;
}

/**
 * The capture group of a match the pattern guarantees is present.
 *
 * `required()` re-runs a pattern and reads group 1 out of a fresh match; this
 * is the same rule for a match already in hand — a `matchAll` iteration, or an
 * `exec` whose result has been checked for null. TypeScript types *every*
 * capture group as `string | undefined`, because a group may be optional
 * (`(...)?`) and the type is not derived from the pattern; every group read in
 * this file is mandatory, so the value is always there, and this is how that
 * gets said out loud.
 *
 * It throws rather than substituting a default, for the reason `required()`
 * does: `docs-facts` exists to fail when the source stops matching the shape it
 * is reading. An `undefined` that reaches a generated document is a wrong fact
 * with a green tick beside it.
 */
function capture(m: RegExpMatchArray, group: number): string {
  const v = m[group];
  if (v === undefined) {
    const seen = m[0].replace(/\s+/g, ' ').slice(0, 60);
    throw new Error(
      `docs-facts: the pattern that matched "${seen}" has no capture group ${group}. ` +
        'Fix the pattern rather than trusting the result.'
    );
  }
  return v;
}

/** Read a value that must be there, or fail with a message that says what to fix. */
function required(pattern: RegExp, text: string, what: string): string {
  const m = pattern.exec(text);
  if (!m) {
    throw new Error(
      `docs-facts: could not read ${what}. The statement was reworded or moved; ` +
        `fix readPriceStatements() rather than trusting the result.`
    );
  }
  return capture(m, 1);
}

/**
 * Every place that states an audit price.
 *
 * This check exists because they disagreed. `PRICE_FULL_AUDIT` was `0.10` in
 * `.env.example` and `0.05` in every other place that stated it —
 * including `MARKETPLACE_LISTING.md`, which is the price a buyer reads, and the
 * registration values, which are what the marketplace is told. And
 * `docs/EXTERNAL_ACTIONS.md` instructs the operator to "set the price exactly
 * as documented in `.env.example`", so the runbook pointed at the one wrong
 * copy.
 *
 * The failure mode is not a wrong number on a page. In `okx` mode the server
 * builds the 402 challenge from `PRICE_FULL_AUDIT` (via `apps/api/src/config.ts`
 * → `server.ts` → `priceFor()`), so a buyer who reads 0.05 on the listing and
 * signs an EIP-3009 authorization for 0.05 would be challenged for 0.10. The
 * first real sale fails at the payment step — the worst place to find out, and
 * the hardest for the buyer to diagnose.
 *
 * A price is a number with a customer on one side and a signature on the other.
 * Two statements of it need a check that compares them, not a third statement.
 *
 * Deliberately out of scope, and written down here so the boundary is a
 * decision rather than an oversight: the worked request/response payloads in
 * `docs/API.md` and `docs/MCP_CLIENT_SETUP.md`. They illustrate the *shape* a
 * client parses; a buyer never reads their numbers — the buyer reads the
 * challenge, which the atomic membership check below does cover. Pinning them
 * would make every example edit a gate failure for no safety gain, so they are
 * kept in step by hand and this comment is why they are not in the list.
 */
function readPriceStatements(): PriceStatement[] {
  const statements: PriceStatement[] = [];
  const add = (where: string, amount: string) => statements.push({ where, amount });

  // 1. The server default — what is charged when nothing overrides it.
  const config = read('apps/api/src/config.ts');
  add(
    'apps/api/src/config.ts',
    required(/PRICE_AUDIT:\s*z\.string\(\)\.default\('([\d.]+)'\)/, config, 'the PRICE_AUDIT default')
  );

  // 2. The env template — what `cp .env.example .env` gives an operator.
  const env = read('.env.example');
  add('.env.example', required(/^PRICE_AUDIT=([\d.]+)$/m, env, 'PRICE_AUDIT'));

  // 3. The compose default, which applies when the env file is absent.
  const compose = read('docker-compose.yml');
  add(
    'docker-compose.yml',
    required(/PRICE_AUDIT:\s*\$\{PRICE_AUDIT:-([\d.]+)\}/, compose, 'the compose PRICE_AUDIT default')
  );

  // 4. The sold price, in both languages. Anchored on the heading so a
  //    reworded one fails loudly instead of silently matching nothing.
  const listing = read('MARKETPLACE_LISTING.md');
  add(
    'MARKETPLACE_LISTING.md (English)',
    required(/\*\*Release Gate — ([\d.]+) USDT\*\*/, listing, 'the English Release Gate price')
  );
  add(
    'MARKETPLACE_LISTING.md (简体中文)',
    required(/\*\*发版门禁 — ([\d.]+) USDT\*\*/, listing, 'the Chinese Release Gate price')
  );

  // 5. The registration table in the snapshot — the price the ASP is
  //    registered with, in the decimal form the marketplace displays. The
  //    atomic-unit forms live in §5.2–§5.3 and §5.5, and are checked by
  //    membership in `checkPrices()` below.
  const snapshot = read('docs/OKX_REQUIREMENTS_SNAPSHOT.md');
  add(
    'docs/OKX_REQUIREMENTS_SNAPSHOT.md §1.3',
    required(
      /\| `RepoPilot Release Gate` \| A2MCP \| `([\d.]+)` USDT \|/,
      snapshot,
      'the §1.3 Release Gate registration price'
    )
  );

  // The count is asserted, not assumed. Deleting an `add()` call is the one
  // way this check can shrink without anything failing: `required()` never
  // runs, so no throw, no finding — the check just quietly covers less. The
  // number below is the only place it is written down, so bumping it is a
  // deliberate act rather than a comment that drifts. (An earlier draft of
  // this file claimed "the count is always 8" in a comment. It was 10, then
  // 12 for the two-tier layout, and 6 now that there is one price.)
  const EXPECTED_STATEMENTS = 6;
  if (statements.length !== EXPECTED_STATEMENTS) {
    throw new Error(
      `docs-facts: read ${statements.length} price statements, expected ${EXPECTED_STATEMENTS}. ` +
        'An `add()` call was probably removed or duplicated — which is not a price ' +
        'disagreement, it is this check covering less than it used to.'
    );
  }

  return statements;
}

/**
 * The price must be one number, and the registration values must be that
 * number in atomic units.
 *
 * The registration values are checked by *membership* rather than by position:
 * every atomic value the snapshot states has to be a price this repository
 * actually charges. `100000` (= 0.10) sitting beside a 0.05 price is the exact
 * defect this exists for, and membership catches it without this check having
 * to know which table row is which service.
 *
 * What this deliberately does NOT read: test fixtures. `factory.test.ts`,
 * `okx-adapter.test.ts`, `mcp-server/index.test.ts` and the API integration
 * test all build a `PaymentConfig` with their own numbers, and they are
 * *supposed* to differ from production — a fixture that used the real price
 * cannot see a hard-coded real price. The fixtures are not statements to a
 * customer, so they are out of scope here.
 *
 * An earlier version of this comment went further and claimed the off-production
 * fixture is what *makes* `priceFor` discriminating, citing a measurement:
 * "with the fixture at `0.05`, replacing `priceFor`'s return with a literal
 * `0.05` survives the whole suite (19/19 green); with the fixture at `0.13` the
 * same mutation fails one test." The second half was false. Re-measured
 * 2026-10-05: with `PRICING` at `0.13`, replacing `priceFor`'s body with
 * `return { amount: '0.13', currency: 'USDT' }` survived all 39 tests in the
 * package. An off-production fixture only stops a function hard-coding the
 * *production* value; every test in that block passed `PRICING.audit` in and
 * asserted `PRICING.audit` out, which a literal satisfies. What guards
 * `priceFor` is a test that feeds it **two** differently priced configs, added
 * along with this correction. A fixture carrying one price cannot be that
 * guard — which is the actual reason the fixtures stay out of this check, and
 * not the cost of a guard this check was never providing.
 */
function checkPrices(): Problem[] {
  const problems: Problem[] = [];
  // No `statements.length < N` guard here: `readPriceStatements()` reads every
  // statement through `required()`, which throws rather than returning empty,
  // so a zero-length list is impossible and a `<` guard could never fire. What
  // *is* reachable is "the count changed", and `readPriceStatements()` asserts
  // that itself, with an `!==` rather than a `<`.
  const statements = readPriceStatements();

  // One price, so this is one agreement check rather than one per tier. It used
  // to be a `Record<'quick' | 'full', string>` and a loop over the two keys;
  // with the second tier gone, a loop over one key is only a place for a second
  // key to reappear by accident.
  const values = [...new Set(statements.map((s) => s.amount))];
  if (values.length > 1) {
    problems.push({
      where: 'docs-facts: the audit price',
      message:
        `stated ${values.length} different ways: ` +
        statements.map((s) => `${s.where} says ${s.amount}`).join('; ') +
        '. A buyer reads one of these and the server charges by another. ' +
        'Pick the number that should win and change every other statement to match.',
    });
  }

  // Normalised the same way the atomic values are, so the free tier's `0`
  // compares equal to `0.00` rather than reporting itself as a mismatch.
  const allowed = new Set([...values, '0'].map((v) => Number(v).toFixed(2)));
  const snapshot = read('docs/OKX_REQUIREMENTS_SNAPSHOT.md');

  const atomic: { where: string; raw: string }[] = [];
  for (const m of snapshot.matchAll(/`service\[(\d)\]\.fee`\s*\|\s*`(\d+)`/g)) {
    atomic.push({ where: `service[${capture(m, 1)}].fee`, raw: capture(m, 2) });
  }
  for (const m of snapshot.matchAll(/"maxAmountRequired": "(\d+)"/g)) {
    atomic.push({ where: 'the 402 example in §5.5', raw: capture(m, 1) });
  }
  for (const m of snapshot.matchAll(/`maxAmountRequired: "(\d+)"`/g)) {
    atomic.push({ where: 'the 402 prose in §5.5', raw: capture(m, 1) });
  }

  if (atomic.length < 3) {
    problems.push({
      where: 'docs-facts: prices',
      message:
        `only ${atomic.length} atomic registration value(s) were readable from ` +
        'docs/OKX_REQUIREMENTS_SNAPSHOT.md, expected at least 3 (the free ' +
        'tier, the paid one, and the 402 example). This check is no longer ' +
        'covering the registration values.',
    });
    return problems;
  }

  for (const { where, raw } of atomic) {
    const decimal = (Number(raw) / 10 ** PRICE_ATOMIC_DECIMALS).toFixed(2);
    if (!allowed.has(decimal)) {
      problems.push({
        where: `docs/OKX_REQUIREMENTS_SNAPSHOT.md (${where})`,
        message:
          `registers ${raw} atomic units = ${decimal} USDT, which is not a price ` +
          `this repository charges (${[...allowed].join(', ')}). The marketplace ` +
          'would advertise one amount and the 402 challenge would ask for another.',
      });
    }
  }

  return problems;
}

function checkChangelogStructure(): Problem[] {
  const problems: Problem[] = [];
  const lines = read('CHANGELOG.md').split('\n');

  const CATEGORIES = new Set([
    'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security',
  ]);

  let release = '(above the first `## ` heading)';
  let headings = 0;
  let seen = new Map<string, number[]>();

  const flush = () => {
    for (const [name, at] of seen) {
      if (at.length < 2) continue;
      problems.push({
        where: `CHANGELOG.md (${release})`,
        message:
          `"### ${name}" appears ${at.length} times (lines ${at.join(', ')}). ` +
          'Anchors are positional, so only the first is reachable as ' +
          `#${name.toLowerCase()} — the Contents list links that one and the ` +
          'rest are reachable from nowhere. Merge them into one section.',
      });
    }
  };

  for (const [i, line] of lines.entries()) {
    if (line.startsWith('## ')) {
      flush();
      release = line.slice(3).trim();
      seen = new Map();
      continue;
    }
    const m = /^### (.+)$/.exec(line);
    if (!m) continue;
    headings += 1;
    const name = capture(m, 1).trim();
    if (!CATEGORIES.has(name)) continue;
    seen.set(name, [...(seen.get(name) ?? []), i + 1]);
  }
  flush();

  // A rename of the file, or a change to the heading level, would leave the
  // loop above with nothing to inspect and this check green. That is the same
  // failure the `total === 0` guard in `checkBlocks()` exists for (R-26).
  if (headings === 0) {
    problems.push({
      where: 'CHANGELOG.md',
      message:
        'no "### " headings found at all. Either the file was renamed or its ' +
        'heading level changed, and this check is currently a no-op.',
    });
  }

  return problems;
}

/* ────────────────────────── RISKS.md, as a register ─────────────────────── */

/**
 * The five values `RISKS.md` defines for a `**Status:**` line.
 *
 * This list is the check's vocabulary, not the document's, and that is the
 * point: a sixth value added to the file without being added here fails. The
 * alternative — accept whatever follows `**Status:**` — accepts "still broken"
 * and "TODO", which are statuses nothing can compare.
 */
const RISK_STATUS_VALUES = [
  'Fixed',
  'Accepted residual',
  'Open',
  'Mitigated in',
  'Mitigated by design',
];

/**
 * GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens.
 *
 * Checked against all forty-two anchors in the file before it was trusted. A
 * slug function that is *nearly* right is worse than none: it fails on the
 * anchors that are correct, and the temptation is then to "fix" the anchor
 * rather than the function, which breaks the link that worked.
 */
function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

interface RiskEntry {
  id: string;
  line: number;
  anchor: string;
  status: string[];
  /** Lines carrying a `**Status:**` that does not start the line. */
  folded: number[];
}

interface RiskContentsRow {
  id: string;
  href: string;
  line: number;
}

function readRisksRegister(): { entries: RiskEntry[]; contents: RiskContentsRow[] } {
  const entries: RiskEntry[] = [];
  const contents: RiskContentsRow[] = [];

  for (const [i, line] of read('RISKS.md').split('\n').entries()) {
    const heading = /^## (R-\d+) — (.+)$/.exec(line);
    if (heading !== null) {
      const id = capture(heading, 1);
      entries.push({
        id,
        line: i + 1,
        anchor: anchorOf(`${id} — ${capture(heading, 2)}`),
        status: [],
        folded: [],
      });
      continue;
    }

    const link = /^- \[(R-\d+)\]\(#([^)]+)\)/.exec(line);
    if (link !== null) {
      contents.push({ id: capture(link, 1), href: capture(link, 2), line: i + 1 });
      continue;
    }

    // Everything between two headings belongs to the earlier one. The Contents
    // and "How to read this file" sit above the first heading, so a `**Status:**`
    // written in them is attributed to nothing rather than to the wrong entry —
    // and that section has to be able to name the marker it is describing.
    const current = entries[entries.length - 1];
    if (current === undefined) continue;
    if (line.startsWith('**Status:**')) {
      current.status.push(line.slice('**Status:**'.length).trim());
    } else if (line.includes('**Status:**')) {
      current.folded.push(i + 1);
    }
  }

  return { entries, contents };
}

const RISKS = readRisksRegister();

/**
 * `RISKS.md` is a register, and what makes it one is its index and its states.
 *
 * The index. R-36 and R-37 were both added to the body without reaching the
 * Contents and nothing noticed, so a reader using the file's own table of
 * contents could not reach two of its entries — the same defect as a reference
 * to an `R-42` that did not exist, one level up. The anchor is checked as well
 * as the id: `#r-13--a-gate-on-a-large-repository-times-out` and the heading it
 * points at are two hand-written strings that have to agree, and a Contents row
 * that resolves to nothing is indistinguishable from one that resolves.
 *
 * The states. Every entry carries exactly one `**Status:**` line and the line
 * starts the line; both halves are load-bearing. Twenty-one entries had no
 * status at all and three carried one folded into their `**Severity:**` line,
 * so `grep '^\*\*Status:'` returned eighteen of twenty-one and looked complete.
 * That is why the sweep was not a tidy-up: three of the entries it touched were
 * wrong — R-11 reported a blocker that had been resolved in the change that
 * wrote it, R-19 described a mitigation in a class that does not exist, and
 * R-21 claimed a pin the file it named does not carry. A register whose states
 * cannot be read is a register whose states are not checked.
 */
function checkRisksRegister(): Problem[] {
  const problems: Problem[] = [];

  // A change to the heading level, the em dash, or the file's name would leave
  // the loops below with nothing to inspect and this check green. R-26.
  if (RISKS.entries.length === 0) {
    problems.push({
      where: 'RISKS.md',
      message:
        'no "## R-NN — " headings found. Either the file was renamed or its ' +
        'heading format changed, and this check is currently a no-op.',
    });
    return problems;
  }

  const byId = new Map(RISKS.entries.map((e) => [e.id, e]));
  const listedIds = new Set(RISKS.contents.map((c) => c.id));

  for (const entry of RISKS.entries) {
    if (!listedIds.has(entry.id)) {
      problems.push({
        where: `RISKS.md (${entry.id}, line ${entry.line})`,
        message:
          'is not in the Contents, so a reader who follows the table of ' +
          'contents never reaches it.',
      });
    }
  }

  for (const row of RISKS.contents) {
    const entry = byId.get(row.id);
    if (entry === undefined) {
      problems.push({
        where: `RISKS.md (Contents, line ${row.line})`,
        message: `${row.id} is listed and has no "## ${row.id} — " heading.`,
      });
      continue;
    }
    if (entry.anchor !== row.href) {
      problems.push({
        where: `RISKS.md (Contents, line ${row.line})`,
        message:
          `${row.id} links to #${row.href} and the heading computes to ` +
          `#${entry.anchor}. One of the two changed; the link is the one a ` +
          'reader follows.',
      });
    }
  }

  for (const entry of RISKS.entries) {
    for (const line of entry.folded) {
      problems.push({
        where: `RISKS.md (${entry.id}, line ${line})`,
        message:
          'carries a "**Status:**" that does not start the line — it is ' +
          'appended to a "**Severity:**" or "**Likelihood:**" line. It reads ' +
          'correctly and searches as nothing, which is how three entries were ' +
          'counted as having no status at all.',
      });
    }

    if (entry.status.length === 0) {
      problems.push({
        where: `RISKS.md (${entry.id}, line ${entry.line})`,
        message:
          'has no "**Status:**" line, so "which of these are still open?" is ' +
          `not answerable for it. Use one of: ${RISK_STATUS_VALUES.join(', ')}.`,
      });
      continue;
    }
    if (entry.status.length > 1) {
      problems.push({
        where: `RISKS.md (${entry.id}, line ${entry.line})`,
        message: `has ${entry.status.length} "**Status:**" lines. An entry is in one state.`,
      });
      continue;
    }

    // The value is sometimes bolded (`**Fixed 2026-10-08.**`). That is emphasis
    // on the same value, not a sixth one, so the markers come off first.
    const value = (entry.status[0] ?? '').replace(/^\*\*/, '');
    if (!RISK_STATUS_VALUES.some((v) => value.startsWith(v))) {
      problems.push({
        where: `RISKS.md (${entry.id}, line ${entry.line})`,
        message:
          `has the status "${value}", which is not one of the five values the ` +
          `file defines: ${RISK_STATUS_VALUES.join(', ')}. A status outside the ` +
          'vocabulary is a status nothing can compare.',
      });
    }
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
  for (const path of Object.keys(BLOCK_DOCS)) {
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
  ...checkDockerRunConfig(),
  ...checkChangelogStructure(),
  ...checkRisksRegister(),
  ...checkPrices(),
];

console.log('docs-facts: recompute and compare');
console.log('──────────────────────────────────────────────');
console.log(
  `  ${TOOLS.length} MCP tools · ${WORKSPACES.packages.length} packages + ` +
    `${WORKSPACES.apps.length} apps · ${SERVICES.length} compose services · ` +
    `${DOC_FILES.length} docs · ${RISKS.entries.length} risks`
);

if (problems.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m 0 issues');
  process.exit(0);
}

for (const p of problems) {
  console.log(`  \x1b[33m!\x1b[0m ${p.where}: ${p.message}`);
}
console.log(`\n  ${problems.length} issue(s).`);
// Only the block problems are fixable by rewriting the generated blocks. A
// duplicated `### Changed` is not, and telling the reader to run `docs:facts`
// for it sends them at a command that will not change anything.
if (problems.some((p) => p.where.includes('docs-facts:'))) {
  console.log('  Run `pnpm docs:facts` to rewrite the generated blocks.');
}
process.exit(1);
