/**
 * scripts/child-wait.ts — start a child process, wait for it to answer, and
 * say *which* way it failed when it does not.
 *
 * ## Why this is a module and not a third copy
 *
 * Two scripts in this directory start a server, wait for it to answer, and
 * kill it: `verify-release.ts` and `okx-seller-smoke.ts`. Both grew their own
 * version of the wait, and the copies drifted in the only place that matters —
 * not the happy path, which is four lines, but the failure path, which is
 * where the diagnosis lives:
 *
 *   - `verify-release.ts` grew the three-state wait below, after two separate
 *     bugs where a message named the wrong failure (a slow machine reported as
 *     a broken build; an exited child reported as "still not answering").
 *   - `okx-seller-smoke.ts` kept the original shape: a bare
 *     `waitForHealth(15_000)` with the child's stdout and stderr drained into
 *     `() => {}`. A server that died on a port clash produced
 *     `API never came up with paymentMode=okx after 15000ms` — one message
 *     that names the symptom and hides the cause.
 *
 * The rule this file encodes: **a wait that cannot say which way it failed is
 * not a diagnostic, it is a delay.** The three ways are three different
 * investigations, so they get three messages.
 *
 * ## What it does not do
 *
 * It knows nothing about this repository — no ports, no paths, no environment
 * variables of its own. `cwd` and `env` are required and supplied by the
 * caller, and every budget is passed in and named at the call site, because
 * the number that is right for a server on a cold Intel Mac is not a fact
 * about waiting in general.
 */
import { spawn, type ChildProcess } from 'node:child_process';

/** A spawned child process, plus the tail of what it has written. */
export interface SpawnedChild {
  proc: ChildProcess;
  /**
   * The child's stdout+stderr, most recent last, capped at ~20 KB.
   *
   * Captured because the failure it exists to explain is unreadable without
   * it: all three of `verify-release.ts`'s spawn sites used to discard their
   * child's output (`api.stdout.on('data', () => {})`), so a server that died
   * on a port clash or a failed migration produced only
   * `Timeout waiting for http://127.0.0.1:4099/health after 15000ms` — a
   * message that names the symptom and hides the cause. The third site, the
   * MCP server, did not even have a number in its message: it threw
   * ``no tools in response: `` with an empty string after the colon.
   */
  output(): string;
  /**
   * Set when the process could not be spawned at all — `ENOENT`, `EACCES`.
   *
   * Without this the wait cannot tell "could not start" from "has not started
   * yet": a failed spawn fires `'error'` and leaves **both** `exitCode` and
   * `signalCode` at `null`, so the loop spins out the whole budget and then
   * reports that the process is still running. It is not running. It never
   * ran. That is the same shape as the bug the rest of this file exists to
   * fix — a message that names the wrong failure.
   */
  spawnError(): Error | null;
}

/** How much of the child's output is kept. */
const CAPTURED_OUTPUT_CHARS = 20_000;

/**
 * Spawn `cmd` with **exactly** the environment given.
 *
 * It used to merge `process.env` underneath the caller's object, which looks
 * harmless and is not: a caller that passed a deliberately narrow environment
 * still got all 177 variables of the caller's shell, silently. The first
 * version of `verify-release.ts`'s MCP fix was wrong for exactly that reason —
 * it passed `{ PATH, HOME, LOG_LEVEL }` and the child still inherited
 * `NODE_OPTIONS`, so the ~20 s it was meant to remove stayed. Inheritance is
 * now something a call site asks for by writing `{ ...process.env, … }`, which
 * is visible at the point where the decision is made.
 *
 * `cwd` has no default for the same reason: the scripts here derive the
 * repository root from `__dirname` rather than from `process.cwd()`, so they
 * work from any directory, and a shared module is the wrong place to bake in
 * an assumption about where it was started.
 */
export function spawnChild(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): SpawnedChild {
  const proc = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: 'pipe',
  });

  // `stdio: 'pipe'` is three lines up, so both streams exist and the types are
  // the only thing that disagrees (`stdio` is also allowed to be `'ignore'` or
  // `'inherit'`). Draining them is not cosmetic — an undrained pipe fills and
  // blocks the child — so a change to `stdio` fails here rather than quietly
  // turning the capture into a no-op and the child into a hang that looks like
  // a slow server.
  const { stdout, stderr } = proc;
  if (!stdout || !stderr) {
    throw new Error(
      'child-wait: the child was spawned without piped stdout/stderr, so its ' +
        'output would never be captured or drained. Fix spawnChild rather than ' +
        'skipping this.',
    );
  }

  let log = '';
  let failed: Error | null = null;
  const push = (chunk: Buffer): void => {
    log = (log + chunk.toString('utf8')).slice(-CAPTURED_OUTPUT_CHARS);
  };
  proc.on('error', (err) => {
    failed = err;
  });
  stdout.on('data', push);
  stderr.on('data', push);

  return { proc, output: () => log, spawnError: () => failed };
}

/**
 * The child's last few lines, prefixed, for an error message.
 *
 * Each line is capped, because a JSON-RPC child writes its entire `tools/list`
 * payload on one line: the first version of this printed all of it, so the
 * failure report was ~12 KB of JSON whose first line — the only part that says
 * what went wrong — was buried. A report nobody reads is not a diagnostic.
 */
const MAX_REPORTED_LINE = 400;

function lastOutput(text: string): string {
  const lines = text.trimEnd().split('\n').slice(-25);
  if (lines.length === 1 && lines[0] === '') return '    (the process wrote nothing)';
  return lines
    .map((l) =>
      l.length > MAX_REPORTED_LINE ? `${l.slice(0, MAX_REPORTED_LINE)}… (+${l.length - MAX_REPORTED_LINE} chars)` : l,
    )
    .map((l) => `    | ${l}`)
    .join('\n');
}

/**
 * Why the child will never answer `what`, or `null` while it still might.
 *
 * Two of the three failure modes are permanent, and both used to be reported
 * as "still not answering" — the message for the one case where waiting longer
 * could help. A spawn failure leaves **both** `exitCode` and `signalCode` at
 * `null` (see `spawnError`), and an exited child will not come back; in each
 * case the child's own output is the whole diagnosis and the budget is just
 * time spent not reading it.
 *
 * Note what this does **not** mean: an exited child is not necessarily an
 * unhelpful one. A stdio server is *supposed* to answer and then exit when its
 * stdin closes, so a caller must check whether the answer already arrived
 * before asking this — see `waitForAnswer`, where getting that order wrong
 * made a step fail in CI against a server that had answered correctly.
 */
function whyItWillNeverAnswer(c: SpawnedChild, label: string, what: string): string | null {
  const spawnError = c.spawnError();
  if (spawnError) return `${label} could not be spawned at all: ${spawnError.message}`;
  if (c.proc.exitCode !== null || c.proc.signalCode !== null) {
    return (
      `${label} exited before answering ${what} ` +
      `(code=${c.proc.exitCode ?? 'null'}, signal=${c.proc.signalCode ?? 'null'})\n` +
      lastOutput(c.output())
    );
  }
  return null;
}

/**
 * How long between attempts.
 *
 * `verify-release.ts` used 250 ms for its HTTP wait and 200 ms for its output
 * wait, and the two numbers were never a decision — they are both roundings of
 * "often enough that a two-second startup does not look slow, rare enough that
 * the wait is not a busy loop". The cost of an attempt is one `fetch` against
 * a loopback port, or one regex over a 20 KB string. One number, so there is
 * one thing to reason about.
 */
const POLL_INTERVAL_MS = 200;

/** The three ways `waitForAnswer` can end, and what the caller must supply. */
export interface WaitForAnswerOptions {
  /** What is being started, for the message: `api`, `mcp server`. */
  label: string;
  /**
   * What the child is expected to answer, for the message.
   *
   * Phrased as the claim being waited on rather than as the URL alone, so a
   * timeout can be read literally: a server that is up but answering the wrong
   * thing has not "not answered", it has "not answered *that*", and the
   * difference is the whole investigation.
   */
  what: string;
  /** The wall-clock budget in milliseconds. A budget, not a measurement. */
  timeoutMs: number;
  /**
   * The environment variable that overrides `timeoutMs`, named in the timeout
   * message so the reader is told what to raise rather than left to search.
   */
  envVar: string;
}

/**
 * Poll `probe` until it returns a value, or explain why it never will.
 *
 * Three failure modes get three messages, because they need three responses:
 *
 *   - **The child could not be spawned.** Report it immediately; it will never
 *     answer, and the error is the whole diagnosis.
 *   - **The child exited.** Report its exit code and its own output, now. It
 *     will never answer, so waiting out the budget first only delays the news,
 *     and the output is the whole diagnosis.
 *   - **The child is alive and silent.** Report the elapsed time, the budget,
 *     the override, and the output so far. That is a slow machine or a hang.
 *     The old single message read like the second case, which is why a slow
 *     machine looked like a broken build.
 *
 * The answer is checked **before** liveness, and that order is the point. A
 * stdio server answers and then exits when its stdin closes, so
 * `exitCode === 0` alongside the answer already in the buffer is success, not
 * death. Checking liveness first made `verify-release.ts`'s MCP step fail in
 * CI against a server that had answered correctly: the child finished inside a
 * single poll interval, so the loop's first look saw an exited process and a
 * perfectly good `tools/list` in the same buffer, and reported the former. It
 * passed locally only because that machine was slow enough to lose the race —
 * which is why the bug reached CI at all.
 *
 * `probe` is the caller's, because what counts as an answer differs: an HTTP
 * status, a pattern in the output, a JSON field. It returns `null` for "not
 * yet" and must not throw for a transient failure — a refused connection is
 * not an error, it is the state being waited on.
 */
export async function waitForAnswer<T>(
  c: SpawnedChild,
  opts: WaitForAnswerOptions,
  probe: () => Promise<T | null>,
): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < opts.timeoutMs) {
    const answer = await probe();
    if (answer !== null) return answer;
    const dead = whyItWillNeverAnswer(c, opts.label, opts.what);
    if (dead) throw new Error(dead);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `${opts.label} was still not answering ${opts.what} after ${opts.timeoutMs}ms. ` +
      `This is a startup budget, not a check on the server — on a slower machine or a ` +
      `cold cache, raise ${opts.envVar}. The process is still running. ` +
      `Output so far:\n${lastOutput(c.output())}`,
  );
}
