import { describe, expect, it } from 'vitest';
import {
  addedLines,
  scanCommitsForSecrets,
  toHistoryFindings,
  type ScannedCommit,
} from './history-scanner.js';

// Built at runtime rather than written as literals: GitHub's push
// protection rejects committed test fixtures that look like live keys.
//
// Deliberately NOT the AWS docs' own AKIA…EXAMPLE value — the scanner
// ignores anything containing "example", so it would be filtered out
// before ever reaching an assertion.
const FAKE_AWS_KEY = 'AKIA' + 'Z3XJ7QW2PLK9MNV4';
const FAKE_GITHUB_PAT = 'ghp_' + 'a1b2c3d4'.repeat(5);

function commit(overrides: Partial<ScannedCommit> = {}): ScannedCommit {
  return {
    sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    subject: 'add config',
    date: '2026-01-01T00:00:00Z',
    files: [],
    ...overrides,
  };
}

function patchFor(added: string, startLine = 1): string {
  return [
    `@@ -${startLine},1 +${startLine},2 @@`,
    ' const existing = true;',
    `+const key = "${added}";`,
  ].join('\n');
}

describe('addedLines', () => {
  it('returns added lines with their number in the new file', () => {
    const patch = ['@@ -10,3 +10,4 @@', ' ctx', '+first', '+second', ' ctx'].join('\n');
    expect(addedLines(patch)).toEqual([
      { line: 11, text: 'first' },
      { line: 12, text: 'second' },
    ]);
  });

  it('does not advance the counter on a removed line', () => {
    const patch = ['@@ -1,3 +1,2 @@', ' ctx', '-gone', '+added', ' tail'].join('\n');
    // ctx=1, -gone does not consume a new-file line, +added=2, tail=3
    expect(addedLines(patch)).toEqual([{ line: 2, text: 'added' }]);
  });

  it('tracks multiple hunks independently', () => {
    const patch = [
      '@@ -1,1 +1,2 @@',
      '+one',
      '@@ -50,1 +51,2 @@',
      '+fifty-one',
    ].join('\n');
    expect(addedLines(patch)).toEqual([
      { line: 1, text: 'one' },
      { line: 51, text: 'fifty-one' },
    ]);
  });

  it('ignores file headers and the no-newline marker', () => {
    const patch = [
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,1 +1,2 @@',
      '+real',
      '\\ No newline at end of file',
    ].join('\n');
    expect(addedLines(patch)).toEqual([{ line: 1, text: 'real' }]);
  });

  it('returns nothing for a patch with no additions', () => {
    expect(addedLines(['@@ -1,2 +1,1 @@', ' ctx', '-removed'].join('\n'))).toEqual([]);
  });
});

describe('scanCommitsForSecrets', () => {
  it('finds a credential on an added line', () => {
    const hits = scanCommitsForSecrets([
      commit({ files: [{ filename: 'src/config.ts', patch: patchFor(FAKE_AWS_KEY) }] }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('aws_access_key');
    expect(hits[0]?.severity).toBe('critical');
    expect(hits[0]?.file).toBe('src/config.ts');
  });

  it('does not scan context lines', () => {
    // The secret is unchanged context, so this commit did not introduce it.
    const patch = ['@@ -1,2 +1,2 @@', ` const key = "${FAKE_AWS_KEY}";`, ' const other = 1;'].join('\n');
    const hits = scanCommitsForSecrets([
      commit({ files: [{ filename: 'src/config.ts', patch }] }),
    ]);
    expect(hits).toEqual([]);
  });

  it('never returns the matched value', () => {
    const hits = scanCommitsForSecrets([
      commit({ files: [{ filename: 'src/config.ts', patch: patchFor(FAKE_AWS_KEY) }] }),
    ]);
    const serialised = JSON.stringify(hits);
    expect(serialised).not.toContain(FAKE_AWS_KEY);
    // Nor any fragment long enough to be useful.
    expect(serialised).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('deduplicates the same credential across commits and keeps the earliest', () => {
    const newer = commit({
      sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      subject: 'tidy config',
      date: '2026-03-01T00:00:00Z',
      files: [{ filename: 'src/config.ts', patch: patchFor(FAKE_AWS_KEY, 40) }],
    });
    const older = commit({
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subject: 'add config',
      date: '2026-01-01T00:00:00Z',
      files: [{ filename: 'src/config.ts', patch: patchFor(FAKE_AWS_KEY, 1) }],
    });

    const hits = scanCommitsForSecrets([newer, older]);
    expect(hits).toHaveLength(1);
    // The introducing commit is the one a responder needs.
    expect(hits[0]?.commitSha.startsWith('aaaaaaa')).toBe(true);
    expect(hits[0]?.commitSubject).toBe('add config');
  });

  it('reports the same credential in different files separately', () => {
    const hits = scanCommitsForSecrets([
      commit({
        files: [
          { filename: 'src/a.ts', patch: patchFor(FAKE_AWS_KEY) },
          { filename: 'src/b.ts', patch: patchFor(FAKE_AWS_KEY) },
        ],
      }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it('skips files with no patch', () => {
    const hits = scanCommitsForSecrets([commit({ files: [{ filename: 'logo.png', patch: null }] })]);
    expect(hits).toEqual([]);
  });

  it('skips the entropy heuristic for placeholder files but keeps explicit patterns', () => {
    const highEntropy = 'Zx9Qm2Wp7Lr4Tn6Yb8Vc3Kd5Hs1Jf0Ga';
    const allowlisted = scanCommitsForSecrets([
      commit({ files: [{ filename: '.env.example', patch: patchFor(highEntropy) }] }),
    ]);
    expect(allowlisted).toEqual([]);

    const real = scanCommitsForSecrets([
      commit({ files: [{ filename: '.env', patch: patchFor(highEntropy) }] }),
    ]);
    expect(real).toHaveLength(1);
  });

  it('finds a GitHub token', () => {
    const hits = scanCommitsForSecrets([
      commit({ files: [{ filename: 'ci.yml', patch: patchFor(FAKE_GITHUB_PAT) }] }),
    ]);
    expect(hits[0]?.kind).toBe('github_pat');
  });
});

describe('toHistoryFindings', () => {
  const hits = scanCommitsForSecrets([
    commit({
      sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      subject: 'add config',
      files: [{ filename: 'src/config.ts', patch: patchFor(FAKE_AWS_KEY) }],
    }),
  ]);

  it('builds an id that carries the rule, short sha and file', () => {
    const findings = toHistoryFindings(hits);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('secret-history-aws_access_key-a1b2c3d-src-config-ts');
  });

  it('declares git_history as the evidence source', () => {
    const findings = toHistoryFindings(hits);
    expect(findings[0]?.evidence[0]?.source).toBe('git_history');
  });

  it('names the introducing commit in the evidence reason', () => {
    const findings = toHistoryFindings(hits);
    const reason = findings[0]?.evidence[0]?.reason ?? '';
    expect(reason).toContain('a1b2c3d');
    expect(reason).toContain('add config');
  });

  it('recommends rotation before history rewriting', () => {
    const findings = toHistoryFindings(hits);
    const action = findings[0]?.recommendedAction ?? '';
    expect(action).toContain('Rotate');
    // Rewriting history is destructive; the plan has to say so.
    expect(action).toContain('force-push');
  });

  it('never leaks the secret into any finding field', () => {
    const findings = toHistoryFindings(hits);
    const serialised = JSON.stringify(findings);
    expect(serialised).not.toContain(FAKE_AWS_KEY);
    expect(serialised).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('is deterministic: the same hits yield the same ids', () => {
    const a = toHistoryFindings(hits).map((f) => f.id);
    const b = toHistoryFindings(hits).map((f) => f.id);
    expect(a).toEqual(b);
  });

  it('collapses duplicate hits to one finding', () => {
    const duplicated = [...hits, ...hits];
    expect(toHistoryFindings(duplicated)).toHaveLength(1);
  });

  it('returns nothing for no hits', () => {
    expect(toHistoryFindings([])).toEqual([]);
  });
});
