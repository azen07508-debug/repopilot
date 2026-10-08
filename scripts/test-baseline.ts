#!/usr/bin/env tsx
/**
 * scripts/test-baseline.ts — keep `PROJECT_STATE.md`'s test totals honest.
 *
 * ## Why this is not `docs-facts.ts`
 *
 * `scripts/docs-facts.ts` generates the numbers that can be derived from the
 * source — the workspace count, the pricing table, the version string — and it
 * **excludes the test totals on purpose**, with the reason written into its
 * own header: they are only knowable after the suite runs, so a generator that
 * produced them would have to run the suite, which makes the check circular
 * (the thing being checked is also the thing doing the checking).
 *
 * That reasoning is right, and it leaves a gap: the totals in
 * `PROJECT_STATE.md` were the one set of numbers in the repository that
 * nothing verified, and they drifted — the file said `1101` while the suite
 * reported `1108`, and the drift was found by running the tests, not by a
 * gate. A document is not a source of truth just because it is written down
 * confidently.
 *
 * ## What this does instead
 *
 * It consumes a run rather than producing one. `verify:release` step 4 already
 * runs `pnpm -r test` and captures its output, so the numbers are available
 * for free at exactly the moment they are real:
 *
 *   - `--check --from <file>` parses a captured `pnpm -r test` transcript and
 *     fails if the documented total for the current leg disagrees with it.
 *   - `--write --from <file>` rewrites the documented total from the same
 *     transcript.
 *
 * So the check is not circular: the suite runs once, in the gate, and the
 * document is compared against what that run actually printed.
 *
 * ## What it does not check, and this is the honest limit
 *
 *   - **Only the total per leg.** The per-package split in `PROJECT_STATE.md`
 *     is prose with annotations ("both Postgres files, run in CI's
 *     `db: postgres` matrix leg") that a generator cannot produce, and
 *     associating a vitest summary with the package that printed it depends on
 *     pnpm's recursive output format. The total is the number that drifted and
 *     the number quoted elsewhere, so the total is what is checked.
 *   - **Only the leg it ran on, and only one leg is covered.** A SQLite run
 *     cannot verify the Postgres numbers; `--check` says which line it
 *     verified and leaves the other alone. It is worth being blunt about the
 *     consequence: `verify:release` runs in CI's sqlite leg only, so the
 *     Postgres line is currently verified by **nothing**. Closing that means
 *     giving the `db: postgres` leg a transcript and a `--check` against it;
 *     it is listed in `BACKLOG.md` rather than half-done here.
 *   - **Nothing about whether the tests are any good.** This is a count of
 *     assertions that ran. R-26 and R-27 are about checks that cannot fail.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DOC = join(REPO, 'PROJECT_STATE.md');

const BEGIN = '<!-- test-baseline:begin -->';
const END = '<!-- test-baseline:end -->';

export type Leg = 'sqlite' | 'postgres';

/** Which database the suite ran against, read the same way `apps/api` reads it. */
export function legFromEnv(env: NodeJS.ProcessEnv = process.env): Leg {
  const url = env['DATABASE_URL'] ?? '';
  return url.startsWith('postgres') ? 'postgres' : 'sqlite';
}

export interface Totals {
  passed: number;
  skipped: number;
  failed: number;
  todo: number;
  /** How many vitest summary lines were read. Zero means the parse found nothing. */
  summaries: number;
}

/**
 * `pnpm -r` prefixes every line with `<workspace-dir> <script>: `, so the
 * summary arrives as
 *
 *     apps/api test:       Tests  88 passed | 10 skipped (98)
 *
 * That is not a hypothetical: this module's first run in `verify:release`
 * reported "no vitest summary lines were found" over a transcript that
 * contained five of them, because the match was anchored on `Tests` and the
 * line starts with the package name. A check whose failure mode is a parse
 * error has to strip the wrapper rather than trust the shape of the line.
 *
 * Stripping the prefix is deliberate, rather than loosening the anchor to
 * "contains `Tests`", so that `summaries === 0` still means *no line looked
 * like a vitest summary* and cannot be reached by a per-file row or a
 * JSON log line that happens to mention the word.
 */
const PNPM_PREFIX = /^[\w@./-]+ [\w@./-]+: /;

/**
 * Sum every vitest `Tests` summary line in a captured `pnpm -r test` output.
 *
 * Vitest prints one per package, in the form
 * `      Tests  1108 passed (1108)` or
 * `      Tests  88 passed | 10 skipped (98)`, optionally with `failed` and
 * `todo`. `pnpm -r` runs the workspaces sequentially, so summing them gives
 * the repository total.
 *
 * A `summaries === 0` result is reported rather than treated as zero: a run
 * that printed no summary is a parse failure, not a suite with no tests, and
 * silently reporting `0 passed` would be R-26's shape.
 */
export function parseTestSummary(output: string): Totals {
  const totals: Totals = { passed: 0, skipped: 0, failed: 0, todo: 0, summaries: 0 };
  // Strip ANSI so a colourised transcript parses the same as a piped one.
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '');
  for (const raw of clean.split('\n')) {
    // Drop pnpm's per-line prefix first (see `PNPM_PREFIX`), then anchor: the
    // summary is `Tests …` with optional leading whitespace and a possible
    // `✓`/`×` marker. Anchoring after the strip is what keeps a per-file row
    // (`✓ src/foo.test.ts (3 tests)`) or a log line that merely contains the
    // word from being counted as a summary.
    const line = raw.replace(PNPM_PREFIX, '');
    const m = /^\s*(?:[✓×✗]\s*)?Tests\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    const body = m[1] ?? '';
    const pick = (word: string): number => {
      const found = new RegExp(`(\\d+)\\s+${word}`).exec(body);
      return found ? Number(found[1]) : 0;
    };
    totals.passed += pick('passed');
    totals.skipped += pick('skipped');
    totals.failed += pick('failed');
    totals.todo += pick('todo');
    totals.summaries += 1;
  }
  return totals;
}

function renderLeg(leg: Leg, t: Totals): string {
  const label =
    leg === 'sqlite'
      ? '**sqlite** (no `DATABASE_URL`)'
      : '**postgres** (`DATABASE_URL` set)';
  const parts = [`${t.passed} passed`];
  if (t.skipped > 0) parts.push(`${t.skipped} skipped`);
  if (t.failed > 0) parts.push(`${t.failed} failed`);
  if (t.todo > 0) parts.push(`${t.todo} todo`);
  const total = t.passed + t.skipped + t.failed + t.todo;
  return `- ${label}: ${parts.join(' + ')} (${total})`;
}

/** The block as it should appear, with `leg`'s line replaced and the other kept. */
export function renderBlock(existing: string | null, leg: Leg, t: Totals): string {
  // Keep the other leg's bullet, drop everything else — including this leg's
  // previous bullet and the generator comment, which the template re-emits.
  const lines = existing
    ? existing
        .split('\n')
        .filter((l) => l.startsWith('- ') && !new RegExp(`^- \\*\\*${leg}\\*\\*`).test(l))
    : [];
  lines.push(renderLeg(leg, t));
  // Stable order: sqlite first, then postgres, regardless of which leg wrote.
  lines.sort((a, b) => (a.includes('**sqlite**') ? -1 : 1) - (b.includes('**sqlite**') ? -1 : 1));
  return [
    BEGIN,
    '<!-- Generated by `scripts/test-baseline.ts --write`. Do not edit by hand. -->',
    ...lines,
    END,
  ].join('\n');
}

/** The block's current contents, without the markers, or `null` when absent. */
export function readBlock(doc: string): string | null {
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return doc.slice(start + BEGIN.length, end).trim();
}

/** The documented total for one leg, as `passed`/`skipped`, or `null`. */
export function documentedTotals(block: string, leg: Leg): Totals | null {
  const line = block.split('\n').find((l) => new RegExp(`^- \\*\\*${leg}\\*\\*`).test(l));
  if (!line) return null;
  const pick = (word: string): number => {
    const found = new RegExp(`(\\d+)\\s+${word}`).exec(line);
    return found ? Number(found[1]) : 0;
  };
  return {
    passed: pick('passed'),
    skipped: pick('skipped'),
    failed: pick('failed'),
    todo: pick('todo'),
    summaries: 1,
  };
}

export interface CheckResult {
  ok: boolean;
  leg: Leg;
  observed: Totals;
  documented: Totals | null;
  message: string;
}

/**
 * Compare a captured run against the document.
 *
 * Only the current leg is compared; the other line is carried, not verified,
 * and the message says so rather than implying the whole block is current.
 */
export function checkAgainstRun(output: string, opts: { doc?: string; leg?: Leg } = {}): CheckResult {
  const leg = opts.leg ?? legFromEnv();
  const doc = opts.doc ?? readFileSync(DOC, 'utf8');
  const observed = parseTestSummary(output);

  if (observed.summaries === 0) {
    return {
      ok: false, leg, observed, documented: null,
      message:
        'no vitest summary lines were found in the captured test output, so ' +
        'this check verified nothing. That is a parse failure, not a suite ' +
        'with no tests.',
    };
  }

  const block = readBlock(doc);
  if (block === null) {
    return {
      ok: false, leg, observed, documented: null,
      message: `PROJECT_STATE.md has no ${BEGIN} … ${END} block.`,
    };
  }

  const documented = documentedTotals(block, leg);
  if (documented === null) {
    return {
      ok: false, leg, observed, documented: null,
      message: `the test-baseline block has no line for the ${leg} leg.`,
    };
  }

  const same =
    documented.passed === observed.passed &&
    documented.skipped === observed.skipped &&
    documented.failed === observed.failed &&
    documented.todo === observed.todo;

  if (same) {
    return {
      ok: true, leg, observed, documented,
      message:
        `PROJECT_STATE.md matches this run on the ${leg} leg: ` +
        `${observed.passed} passed + ${observed.skipped} skipped. ` +
        `The other leg is carried, not verified by this run — and nothing ` +
        `verifies it today: \`verify:release\` runs in CI's sqlite leg only, ` +
        `so the ${leg === 'sqlite' ? 'postgres' : 'sqlite'} line is checked ` +
        'nowhere and has to be updated by hand after a run on that database.',
    };
  }

  return {
    ok: false, leg, observed, documented,
    message:
      `PROJECT_STATE.md disagrees with this run on the ${leg} leg. ` +
      `The suite reported ${observed.passed} passed + ${observed.skipped} skipped` +
      (observed.failed ? ` + ${observed.failed} failed` : '') +
      `; the document says ${documented.passed} passed + ${documented.skipped} skipped. ` +
      'Run `pnpm test:baseline --write` after a test run, or fix the suite.',
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const fromIdx = args.indexOf('--from');
  const from = fromIdx === -1 ? null : args[fromIdx + 1] ?? null;

  if (!write && !check) {
    console.error('usage: test-baseline.ts (--write | --check) [--from <captured pnpm -r test output>]');
    process.exit(2);
  }
  if (from && !existsSync(from)) {
    console.error(`--from needs a file that exists; got ${from}`);
    process.exit(2);
  }
  if (check && !from) {
    // `--check` never runs the suite: it exists to be cheap enough to sit in a
    // gate, and a gate that spends ten minutes to re-derive what it just
    // derived is a gate people route around.
    console.error('--check needs --from <captured pnpm -r test output>; it does not run the suite.');
    process.exit(2);
  }

  let output: string;
  if (from) {
    output = readFileSync(from, 'utf8');
  } else {
    // `--write` with no transcript runs the suite itself, so the common case is
    // one command. stderr is inherited: a failing suite should be visible while
    // it happens, not only in the parse.
    output = execSync('pnpm -r test', {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  const leg = legFromEnv();
  const doc = readFileSync(DOC, 'utf8');

  if (check) {
    const result = checkAgainstRun(output, { doc, leg });
    console.log(`test-baseline (${leg}): ${result.message}`);
    process.exit(result.ok ? 0 : 1);
  }

  const observed = parseTestSummary(output);
  if (observed.summaries === 0) {
    console.error('test-baseline: no vitest summary lines found; refusing to write a baseline of nothing.');
    process.exit(1);
  }
  const block = renderBlock(readBlock(doc), leg, observed);
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  const next =
    start === -1 || end === -1 || end < start
      ? `${doc.trimEnd()}\n\n${block}\n`
      : doc.slice(0, start) + block + doc.slice(end + END.length);
  writeFileSync(DOC, next, 'utf8');
  console.log(
    `test-baseline: wrote the ${leg} leg into PROJECT_STATE.md — ` +
      `${observed.passed} passed + ${observed.skipped} skipped ` +
      `(from ${observed.summaries} vitest summary line(s)).`,
  );
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('test-baseline.ts') || entry.endsWith('test-baseline.js')) {
  main();
}
