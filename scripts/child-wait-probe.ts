#!/usr/bin/env tsx
/**
 * scripts/child-wait-probe.ts — prove that every branch of `waitForAnswer`
 * actually fires.
 *
 * ## Why this is not a test in a test runner
 *
 * `scripts/` has no test harness: `pnpm -r test` walks the workspace packages
 * and the root is not one of them, so a `*.test.ts` next to the module would
 * be a test nothing runs — R-31's shape, one directory over. Giving the root
 * its own runner is a decision about the gate, not a detail of this file, so
 * it is recorded in `BACKLOG.md` instead of guessed at here.
 *
 * What this is instead: a probe you run by hand, which **asserts** and exits
 * non-zero. It exists because the shared wait is worth having *only* for its
 * failure branches — the happy path is four lines — and those are the branches
 * no gate exercises. `verify:release` proves the success path on every push
 * (three `waitForApi` calls and one `waitForOutput`); nothing proves that a
 * dead child still reports its exit code, or that the three messages have not
 * collapsed back into the one that named the wrong failure.
 *
 * Being suspicious of a refactor here is the reason this file exists: a wait
 * whose branches have been merged reports the same thing in every case, and
 * every case still "works".
 *
 * Usage: `pnpm probe:child-wait` — exits 0 when all five cases behave, 1 with
 * the diff otherwise. No network, no server, ~2 s.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnChild, waitForAnswer, type SpawnedChild } from './child-wait.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A child that stays alive and says nothing. */
function silentChild(): SpawnedChild {
  return spawnChild('node', ['-e', 'setInterval(() => {}, 1000)'], { cwd: REPO, env: process.env });
}

/** Marker for "the wait resolved", so a case can return one string either way. */
const RESOLVED = '\u0000resolved';

/** Run the wait and return either its message or the resolved marker. */
async function message(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return RESOLVED;
  } catch (e) {
    return (e as Error).message;
  }
}

interface Case {
  name: string;
  /** How the wait must end, and what its message must contain when it throws. */
  expect: 'throws' | 'resolves';
  contains?: string[];
  run: () => Promise<string>;
}

const CASES: Case[] = [
  {
    name: 'a child that exits: the message names the exit code and its own output',
    expect: 'throws',
    contains: ['exited before answering', 'code=3', 'boom: EADDRINUSE'],
    run: async () => {
      const c = spawnChild('node', ['-e', "console.error('boom: EADDRINUSE'); process.exit(3)"], {
        cwd: REPO,
        env: process.env,
      });
      return message(
        waitForAnswer(
          c,
          { label: 'api', what: 'http://127.0.0.1:1/health', timeoutMs: 10_000, envVar: 'X' },
          async () => null,
        ),
      );
    },
  },
  {
    name: 'a child that cannot be spawned: reported as such, not as a timeout',
    expect: 'throws',
    contains: ['could not be spawned at all', 'ENOENT'],
    run: async () => {
      const c = spawnChild('definitely-not-a-binary-xyz', [], { cwd: REPO, env: process.env });
      return message(
        waitForAnswer(
          c,
          { label: 'api', what: 'http://127.0.0.1:1/health', timeoutMs: 10_000, envVar: 'X' },
          async () => null,
        ),
      );
    },
  },
  {
    name: 'a child that is alive and silent: the budget message names the override',
    expect: 'throws',
    contains: ['after 600ms', 'raise MY_TIMEOUT_MS', 'The process is still running'],
    run: async () =>
      message(
        waitForAnswer(
          silentChild(),
          { label: 'api', what: 'http://127.0.0.1:1/health', timeoutMs: 600, envVar: 'MY_TIMEOUT_MS' },
          async () => null,
        ),
      ),
  },
  {
    name: 'an answer on the third probe is returned, not waited out',
    expect: 'resolves',
    run: async () => {
      let n = 0;
      const answer = await waitForAnswer(
        silentChild(),
        { label: 'api', what: 'the third probe', timeoutMs: 10_000, envVar: 'X' },
        async () => {
          n += 1;
          return n === 3 ? `answered on probe ${n}` : null;
        },
      );
      return answer === 'answered on probe 3' ? RESOLVED : `got ${JSON.stringify(answer)}`;
    },
  },
  {
    // The regression that reached CI: a stdio server answers and *then* exits,
    // so an exited child with the answer already in the buffer is success.
    name: 'a child that answers and then exits is success, not death',
    expect: 'resolves',
    run: async () => {
      const c = spawnChild('node', ['-e', "console.log('\"tools\": []'); process.exit(0)"], {
        cwd: REPO,
        env: process.env,
      });
      await new Promise((r) => setTimeout(r, 300));
      const out = await waitForAnswer(
        c,
        { label: 'mcp', what: 'tools/list', timeoutMs: 5_000, envVar: 'X' },
        async () => (c.output().includes('"tools"') ? c.output() : null),
      );
      return out.includes('"tools"') ? RESOLVED : `got ${JSON.stringify(out)}`;
    },
  },
];

let failed = 0;
for (const c of CASES) {
  const result = await c.run();
  const problems: string[] = [];
  if (c.expect === 'resolves') {
    if (result !== RESOLVED) problems.push(result);
  } else if (result === RESOLVED) {
    problems.push('it resolved; it must throw');
  } else {
    for (const needle of c.contains ?? []) {
      if (!result.includes(needle)) {
        problems.push(`the message does not contain ${JSON.stringify(needle)}`);
      }
    }
  }
  if (problems.length === 0) {
    console.log(`  \x1b[32m✓\x1b[0m ${c.name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${c.name}`);
    for (const p of problems) console.log(`      ${p}`);
    console.log(`      got: ${result.split('\n').slice(0, 4).join('\n           ')}`);
  }
}

if (failed > 0) {
  console.log(`\n  ${failed} of ${CASES.length} case(s) did not behave`);
  process.exit(1);
}
console.log(`\n  \x1b[32mall ${CASES.length} cases behave\x1b[0m`);
process.exit(0);
