#!/usr/bin/env tsx
/**
 * preflight:production — everything that has to be true before the ASP
 * registration and the marketplace listing, in one command, in the order you
 * would do them.
 *
 * This is deliberately NOT a second implementation of `env:check` or
 * `docs:check`. It *runs* them and adds the two things neither can see:
 *
 *   1. the production config guard (`loadConfig()` → `validateProductionConfig`)
 *      against the environment you are actually about to deploy with, and
 *   2. the two brand assets, measured rather than eyeballed.
 *
 * The four steps are ordered from "what is set" to "what the API will do with
 * it": `env:check` (every variable a production deploy needs, and every
 * problem at once), the boot guard (the four invariants that stop the process),
 * the two assets, then `docs:check` (whether the documents still describe any
 * of the above correctly).
 *
 * Exit codes: 0 = ready, 1 = something is missing (the list says what).
 *
 * Invoked via `pnpm preflight:production` from the repo root.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/** The marketplace rejects anything larger. */
const ASSET_MAX_BYTES = 1_048_576;

interface Step {
  name: string;
  ok: boolean;
  /** What the operator has to do. Printed only when the step failed. */
  fix?: string;
  detail?: string;
}

const steps: Step[] = [];

// ---------------------------------------------------------------------------
// Running the existing gates.
//
// `tsx` is spawned from `node_modules/.bin` rather than through `pnpm` so this
// does not depend on pnpm's dependency-status check having a writable store.
//
// Both callers need the same three things — locate tsx, run it without letting
// a non-zero exit throw past the report, and strip the reporter's colours
// before reading the output — so they share one function. A second copy of
// "how do I read a failing gate's output" is the kind of copy that ends up
// disagreeing with the first.
// ---------------------------------------------------------------------------
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

interface GateRun {
  status: number;
  out: string;
}

/** Run a gate and report its exit status instead of throwing on it. */
function runGate(script: string, env?: Record<string, string>): GateRun | null {
  if (!existsSync(TSX)) return null;
  try {
    const out = execFileSync(TSX, [join(REPO_ROOT, 'scripts', script)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    return { status: 0, out: stripAnsi(out) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: stripAnsi(`${e.stdout ?? ''}${e.stderr ?? ''}`) };
  }
}

function tsxMissing(name: string): Step {
  return {
    name,
    ok: false,
    detail: 'node_modules/.bin/tsx is missing',
    fix: 'Run `pnpm install`.',
  };
}

// ---------------------------------------------------------------------------
// 1. The production environment, by running `env:check`.
//
// `loadConfig()` below stops at the first batch of guard failures and only
// knows the four invariants in `validateProductionConfig()`. `env:check` walks
// the whole list — including the variables the API has a default for, which is
// exactly the set a deployment can silently forget — and exits 2 when it has
// warnings and no errors, which is not a failure.
// ---------------------------------------------------------------------------
function checkEnv(): Step {
  const name = 'production environment (env:check)';
  const run = runGate('env-check.ts', { NODE_ENV: 'production' });
  if (!run) return tsxMissing(name);
  const summary =
    run.out
      .split('\n')
      .filter((l) => /error\(s\)/.test(l))
      .pop() ?? '';
  if (run.status === 0 || run.status === 2) {
    // Exit 2 is "warnings only". The deploy is allowed, but the warnings are
    // worth reading, so they stay in the detail rather than being dropped.
    const warnings = run.out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('WARNING'));
    return {
      name,
      ok: true,
      detail: warnings.length
        ? `${summary.trim()} — ${warnings.join('; ')}`
        : summary.trim() || 'no findings',
    };
  }
  const problems = run.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR'));
  return {
    name,
    ok: false,
    detail: problems.join('\n           ') || 'env:check failed',
    fix:
      'Set the named variables in the environment you are about to deploy with. ' +
      'The values are documented in `.env.example`; the runbook is ' +
      'docs/EXTERNAL_ACTIONS.md item 2.',
  };
}

// ---------------------------------------------------------------------------
// 2. The production config guard, against this environment.
//
// `validateProductionConfig` is the same function the API calls at boot, so
// passing here means the API will boot. It is the check that knows about
// `OKX_PAYMENT_RESOURCE_URL` as a boot invariant — `env:check` above reports
// the same field from the variable list, using the same predicate.
// ---------------------------------------------------------------------------
async function checkProductionConfig(): Promise<Step> {
  const name = 'production config (payment mode, address, resource URL, queue)';
  const savedNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    const mod = (await import(
      pathToFileURL(join(REPO_ROOT, 'apps/api/src/config.ts')).href
    )) as {
      _resetConfigCacheForTests: () => void;
      loadConfig: () => unknown;
    };
    // The cache has to be cleared or a previous import in this process wins.
    mod._resetConfigCacheForTests();
    mod.loadConfig();
    return { name, ok: true };
  } catch (err) {
    const e = err as Error & { issues?: string[] };
    return {
      name,
      ok: false,
      detail: e.issues ? e.issues.join('\n           ') : e.message,
      fix:
        'Set the named variables in the environment you are about to deploy with. ' +
        'The values are documented in `.env.example`; the runbook is ' +
        'docs/EXTERNAL_ACTIONS.md item 2.',
    };
  } finally {
    if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = savedNodeEnv;
  }
}

// ---------------------------------------------------------------------------
// 3. The brand assets.
//
// The registration picture is 1:1 and the listing banner is 2:1, and they are
// not interchangeable — uploading the banner as `--picture` gets it rejected or
// centre-cropped, which cuts the wordmark and the terminal off the sides. Both
// facts were wrong in the documents until 2026-10-04, so this measures the
// files instead of quoting them.
// ---------------------------------------------------------------------------
function pngSize(path: string): { bytes: number; width: number; height: number } | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { bytes: buf.length, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkAsset(
  name: string,
  relPath: string,
  wantRatio: number,
  ratioLabel: string,
  usedFor: string
): Step {
  const path = join(REPO_ROOT, relPath);
  const size = pngSize(path);
  if (!size) {
    return {
      name,
      ok: false,
      detail: `${relPath} is missing or is not a PNG`,
      fix: `Create it — the spec is in docs/${ratioLabel === '1:1' ? 'AVATAR_BRIEF' : 'HERO_IMAGE_BRIEF'}.md`,
    };
  }
  const ratio = size.width / size.height;
  const ratioOk = Math.abs(ratio - wantRatio) < 0.01;
  const bytesOk = size.bytes <= ASSET_MAX_BYTES;
  const detail =
    `${relPath} — ${size.width}x${size.height}, ratio ${ratio.toFixed(2)} (want ${ratioLabel}), ` +
    `${(size.bytes / 1024).toFixed(0)} KB (cap ${ASSET_MAX_BYTES / 1024} KB) — ${usedFor}`;
  const problems: string[] = [];
  if (!ratioOk) {
    problems.push(
      `it is ${ratioLabel === '1:1' ? 'not square' : 'not 2:1'} — ` +
        (ratioLabel === '1:1'
          ? 'a 2:1 file here gets rejected or centre-cropped, which cuts the wordmark and the terminal off the sides'
          : 'a square file here letterboxes on the listing page')
    );
  }
  if (!bytesOk) problems.push(`it is over the ${ASSET_MAX_BYTES / 1024} KB marketplace cap`);
  return {
    name,
    ok: problems.length === 0,
    detail,
    fix: problems.length ? `Replace the file: ${problems.join('; ')}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. The prices and the documented facts, by running `docs:check`.
// ---------------------------------------------------------------------------
function checkDocsFacts(): Step {
  const name = 'documented facts and prices (docs:check)';
  const run = runGate('docs-facts.ts', undefined);
  if (!run) return tsxMissing(name);
  if (run.status === 0) {
    const summary = run.out.split('\n').filter((l) => l.includes('·')).pop() ?? '';
    return { name, ok: true, detail: summary.trim() };
  }
  // The reporter colours the `!` on a finding, so a `startsWith('!')` test
  // against the raw line matches nothing and the failure comes out as a bare
  // "docs:check failed" — which is the least useful possible message for the
  // check whose whole job is to name the field that disagrees. `runGate`
  // strips the codes; this is why. (This bit me once already; see RISKS R-36.)
  const findings = run.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('!') || l.startsWith('Error:'));
  return {
    name,
    ok: false,
    detail: findings.join('\n           ') || 'docs:check failed',
    fix:
      'Fix the disagreement it names. A price stated two ways is a failed payment ' +
      'on the first real sale, not a typo.',
  };
}

// ---------------------------------------------------------------------------
// Report
//
// Wrapped in `main()` rather than written at the top level: `tsx` compiles
// these scripts to CJS (the root `package.json` sets no `"type"`), and
// esbuild rejects top-level `await` in CJS output. `intelligence-smoke.mts`
// takes the other way out — an `.mts` extension — but every other script in
// `scripts/` is `.ts`, and one more `.ts` is worth more than one more
// extension to remember.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  steps.push(checkEnv());
  steps.push(await checkProductionConfig());
  steps.push(
    checkAsset(
      'brand asset — registration picture',
      'docs/brand/avatar.png',
      1,
      '1:1',
      'onchainos agent create --picture'
    )
  );
  steps.push(
    checkAsset(
      'brand asset — listing banner',
      'docs/brand/hero.png',
      2,
      '2:1',
      'the listing page and the README front door'
    )
  );
  steps.push(checkDocsFacts());

  const failed = steps.filter((s) => !s.ok);

  console.log('\npreflight:production');
  console.log('─'.repeat(78));
  for (const s of steps) {
    console.log(`${s.ok ? ' OK  ' : 'FAIL '} ${s.name}`);
    if (s.detail) console.log(`       ${s.detail}`);
    if (!s.ok && s.fix) console.log(`       → ${s.fix}`);
  }
  console.log('─'.repeat(78));

  if (failed.length === 0) {
    console.log('All automated pre-flight checks pass.');
    console.log('');
    console.log('What is left is human-side, in this order:');
    console.log('  1. docs/EXTERNAL_ACTIONS.md item 5 — domain, DNS and TLS, so the');
    console.log('     resource URL in the 402 challenge resolves.');
    console.log('  2. docs/EXTERNAL_ACTIONS.md item 2 — `onchainos agent pre-check` and');
    console.log('     `agent create`, using the values in');
    console.log('     docs/OKX_REQUIREMENTS_SNAPSHOT.md §5.1–§5.4.');
    console.log('  3. docs/EXTERNAL_ACTIONS.md item 6 — submit the listing copy from');
    console.log('     MARKETPLACE_LISTING.md and upload both brand assets.');
    process.exit(0);
  }

  console.log(`${failed.length} step(s) need attention before the listing can be submitted.`);
  console.log('Each FAIL above names the field or file and what to do to it.');
  process.exit(1);
}

void main();
