#!/usr/bin/env tsx
/**
 * scripts/audit-diff.ts — run the four reference audits and compare them to a
 * recorded baseline.
 *
 * Usage:
 *   pnpm tsx scripts/audit-diff.ts             run the audits, print the diff
 *   pnpm tsx scripts/audit-diff.ts --update    run them and rewrite the baseline
 *   pnpm tsx scripts/audit-diff.ts --no-run    compare the newest outputs already
 *                                              on disk, without hitting GitHub
 *   pnpm tsx scripts/audit-diff.ts --only pino run the matching audits only
 *
 * `--only` takes a substring of the label. It exists because the four audits
 * are one long command, and a long command is one that can be pushed into the
 * background — where the MCP handshake inside `mcp-audit.ts` times out. One
 * audit per invocation keeps every run short and observable.
 *
 * Why this exists
 * ---------------
 * Every batch of the repair plan ends the same way: run the same four audits,
 * read five scores and three counts out of each, and write the comparison into
 * the close-out by hand. Fifteen minutes of a human copying numbers between a
 * terminal and a markdown table, once per batch, is both slow and a second
 * copy of a fact — the thing this whole exercise is about.
 *
 * Deliberately NOT a CI gate
 * --------------------------
 * The audits read live GitHub repositories. The numbers move when *they*
 * change, not only when we do, so a non-zero diff is information rather than a
 * failure, and a red build here would be noise. This is an acceptance tool for
 * a human running a batch, not a check.
 *
 * Cost: four audits, ~90 GitHub requests (the full audits scan 20 commits of
 * history each). Export `GITHUB_TOKEN` to stay inside the rate limit.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'screenshots');
const BASELINE = join(ROOT, 'scripts', 'audit-baseline.json');
const MCP_AUDIT = join(ROOT, 'scripts', 'mcp-audit.ts');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const MCP_CLI = join(ROOT, 'packages', 'mcp-server', 'dist', 'cli.js');

interface AuditSpec {
  label: string;
  url: string;
  mode: 'quick' | 'full';
}

/**
 * The reference set. Two shapes of the same tiny repository, one large real
 * library, and this repository auditing itself — which is the only one of the
 * four that a change here is expected to move.
 */
const AUDITS: AuditSpec[] = [
  { label: 'octocat/Hello-World quick', url: 'https://github.com/octocat/Hello-World', mode: 'quick' },
  { label: 'octocat/Hello-World full', url: 'https://github.com/octocat/Hello-World', mode: 'full' },
  { label: 'pinojs/pino full', url: 'https://github.com/pinojs/pino', mode: 'full' },
  { label: 'self (repopilot) full', url: 'https://github.com/azen07508-debug/repopilot', mode: 'full' },
];

interface Metrics {
  mode: string;
  status: string;
  overall: number | null;
  documentation: number | null;
  reproducibility: number | null;
  securityHygiene: number | null;
  deploymentReadiness: number | null;
  blockers: number;
  docGaps: number;
  secFindings: number;
  fixtureFindings: number;
  stack: string[];
}

/** Same slug rule as `mcp-audit.ts`, so the two agree on a filename. */
function slugOf(url: string): string {
  return url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\//g, '-');
}

function newestOutput(slug: string, mode: string, notOlderThan?: number): string | undefined {
  if (!existsSync(OUT_DIR)) return undefined;
  const prefix = `mcp-audit-${slug}-${mode}-`;
  const candidates = readdirSync(OUT_DIR)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
    .map((n) => join(OUT_DIR, n))
    .filter((p) => notOlderThan === undefined || statSync(p).mtimeMs >= notOlderThan)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

function metricsOf(path: string): Metrics {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    status?: string;
    scores?: number;
    scoreBreakdown?: Record<string, number>;
    blockerCount?: number;
    documentationGapCount?: number;
    securityFindingCount?: number;
    fixtureFindingCount?: number;
    detectedStack?: string[];
    report?: { auditMode?: string };
  };
  const sb = raw.scoreBreakdown ?? {};
  const num = (v: number | undefined): number | null => (typeof v === 'number' ? v : null);
  return {
    mode: raw.report?.auditMode ?? 'unknown',
    status: raw.status ?? 'unknown',
    overall: num(raw.scores),
    documentation: num(sb['documentation']),
    reproducibility: num(sb['reproducibility']),
    securityHygiene: num(sb['securityHygiene']),
    deploymentReadiness: num(sb['deploymentReadiness']),
    blockers: raw.blockerCount ?? 0,
    docGaps: raw.documentationGapCount ?? 0,
    secFindings: raw.securityFindingCount ?? 0,
    fixtureFindings: raw.fixtureFindingCount ?? 0,
    stack: raw.detectedStack ?? [],
  };
}

/* ───────────────────────────────── output ───────────────────────────────── */

const score = (v: number | null): string => (v === null ? '—' : v.toFixed(1));

const COLUMNS: Array<{ head: string; width: number; of: (m: Metrics) => string }> = [
  { head: 'mode', width: 6, of: (m) => m.mode },
  { head: 'status', width: 10, of: (m) => m.status },
  { head: 'overall', width: 8, of: (m) => score(m.overall) },
  { head: 'doc', width: 7, of: (m) => score(m.documentation) },
  { head: 'repro', width: 7, of: (m) => score(m.reproducibility) },
  { head: 'sec', width: 7, of: (m) => score(m.securityHygiene) },
  { head: 'deploy', width: 7, of: (m) => score(m.deploymentReadiness) },
  { head: 'blockers', width: 9, of: (m) => String(m.blockers) },
  { head: 'docGaps', width: 8, of: (m) => String(m.docGaps) },
  { head: 'secFind', width: 8, of: (m) => String(m.secFindings) },
  { head: 'fixture', width: 8, of: (m) => String(m.fixtureFindings) },
];

const LABEL_WIDTH = 26;

function header(): string {
  return 'audit'.padEnd(LABEL_WIDTH) + COLUMNS.map((c) => c.head.padStart(c.width)).join('');
}

function row(label: string, m: Metrics): string {
  return label.padEnd(LABEL_WIDTH) + COLUMNS.map((c) => c.of(m).padStart(c.width)).join('');
}

/**
 * The table is the deliverable, so it is checked rather than eyeballed.
 *
 * `padStart` on a value longer than its column silently widens the row and
 * shifts every column after it — which is how the hand-written table this
 * replaces ended up with `docGapssecFind` for a header. A width mismatch is
 * reported instead of printed.
 */
function tableProblems(): string[] {
  const problems: string[] = [];
  const want = header().length;
  for (const label of Object.keys(current)) {
    const m = current[label];
    if (m === undefined) continue;
    const got = row(label, m).length;
    if (got !== want) {
      problems.push(`table row for "${label}" is ${got} columns wide, header is ${want}`);
    }
  }
  return problems;
}

/** Every metric that moved, as `name  before → after  (delta)`. */
function changes(before: Metrics, after: Metrics): string[] {
  const out: string[] = [];
  const pairs: Array<[string, number | null, number | null]> = [
    ['overall', before.overall, after.overall],
    ['documentation', before.documentation, after.documentation],
    ['reproducibility', before.reproducibility, after.reproducibility],
    ['securityHygiene', before.securityHygiene, after.securityHygiene],
    ['deploymentReadiness', before.deploymentReadiness, after.deploymentReadiness],
    ['blockers', before.blockers, after.blockers],
    ['documentationGaps', before.docGaps, after.docGaps],
    ['securityFindings', before.secFindings, after.secFindings],
    ['fixtureFindings', before.fixtureFindings, after.fixtureFindings],
  ];
  for (const [name, a, b] of pairs) {
    if (a === b) continue;
    const fmt = (v: number | null) => (v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
    const delta = typeof a === 'number' && typeof b === 'number' ? b - a : null;
    const shown = delta === null ? '' : `  (${delta > 0 ? '+' : ''}${Number.isInteger(delta) ? delta : delta.toFixed(1)})`;
    out.push(`    ${name.padEnd(20)} ${fmt(a)} → ${fmt(b)}${shown}`);
  }
  if (before.stack.join(',') !== after.stack.join(',')) {
    out.push(`    detectedStack        [${before.stack.join(', ')}] → [${after.stack.join(', ')}]`);
  }
  if (before.status !== after.status) {
    out.push(`    status               ${before.status} → ${after.status}`);
  }
  return out;
}

/* ─────────────────────────────────── main ───────────────────────────────── */

const args = process.argv.slice(2);
const doRun = !args.includes('--no-run');
const doUpdate = args.includes('--update');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? undefined : args[onlyIndex + 1];
if (onlyIndex !== -1 && only === undefined) {
  console.error('audit-diff: --only needs a substring of the label, e.g. --only pino');
  process.exit(2);
}

const selected =
  only === undefined ? AUDITS : AUDITS.filter((a) => a.label.toLowerCase().includes(only.toLowerCase()));
if (selected.length === 0) {
  console.error(
    `audit-diff: --only "${only}" matched none of:\n` +
      AUDITS.map((a) => `  ${a.label}`).join('\n')
  );
  process.exit(2);
}

if (doRun && !existsSync(MCP_CLI)) {
  console.error(
    `audit-diff: ${MCP_CLI.replace(ROOT + '/', '')} does not exist.\n` +
      `  The audits drive the built MCP server. Run \`pnpm build\` first, ` +
      `or pass --no-run to compare the outputs already in screenshots/.`
  );
  process.exit(1);
}

const current: Record<string, Metrics> = {};
const failures: string[] = [];

for (const audit of selected) {
  const slug = slugOf(audit.url);
  let path: string | undefined;

  if (doRun) {
    console.log(`\n▶ ${audit.label}`);
    const startedAt = Date.now();
    const res = spawnSync(TSX, [MCP_AUDIT, audit.url, audit.mode], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (res.status !== 0) {
      failures.push(`${audit.label}: mcp-audit.ts exited ${res.status ?? 'on a signal'}`);
      continue;
    }
    // `mcp-audit.ts` stamps the filename with the current time, so the run
    // that just finished is the newest file with a fresh mtime.
    path = newestOutput(slug, audit.mode, startedAt - 5000);
  } else {
    path = newestOutput(slug, audit.mode);
  }

  if (path === undefined) {
    failures.push(`${audit.label}: no mcp-audit output found in screenshots/`);
    continue;
  }
  const m = metricsOf(path);
  // The output is located by filename, so the filename is not evidence that
  // the right audit was read. The report says which mode produced it.
  if (m.mode !== audit.mode) {
    failures.push(
      `${audit.label}: ${path.replace(ROOT + '/', '')} reports auditMode="${m.mode}", ` +
        `expected "${audit.mode}" — the filename matched but the content did not`
    );
    continue;
  }
  current[audit.label] = m;
}

console.log('\n── current ──');
console.log(header());
for (const label of Object.keys(current)) {
  console.log(row(label, current[label]));
}
failures.push(...tableProblems());

if (doUpdate) {
  // Merged, not replaced: `--only pino --update` refreshes one entry and must
  // not silently drop the other three from the record.
  const existing = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { audits?: Record<string, Metrics> }).audits ?? {}
    : {};
  const payload = {
    capturedAt: new Date().toISOString().slice(0, 10),
    note:
      'Reference audit metrics. Compared against by scripts/audit-diff.ts. ' +
      'This is a measurement record, not a gate — a non-zero diff means the ' +
      'numbers moved, and someone has to say whether that was us. ' +
      'Three of the four targets are other people\'s repositories; the fourth ' +
      'audits this one, so its numbers move whenever we push, and a self-audit ' +
      'diff is usually about us rather than about the tool.',
    audits: { ...existing, ...current },
  };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`\nbaseline written: ${BASELINE.replace(ROOT + '/', '')}`);
}

if (existsSync(BASELINE) && !doUpdate) {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    capturedAt?: string;
    audits?: Record<string, Metrics>;
  };
  console.log(`\n── vs baseline (captured ${baseline.capturedAt ?? 'unknown'}) ──`);
  for (const audit of selected) {
    const before = baseline.audits?.[audit.label];
    const after = current[audit.label];
    if (after === undefined) continue;
    if (before === undefined) {
      console.log(`  ${audit.label}\n    not in the baseline — new reference audit`);
      continue;
    }
    const moved = changes(before, after);
    console.log(`  ${audit.label}`);
    console.log(moved.length === 0 ? '    (no change)' : moved.join('\n'));
  }
}

if (failures.length > 0) {
  console.error('\naudit-diff: the comparison is incomplete');
  for (const f of failures) console.error(`  ! ${f}`);
  process.exit(1);
}
