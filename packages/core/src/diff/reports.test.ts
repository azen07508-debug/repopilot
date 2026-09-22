/**
 * Report diff tests.
 *
 * Every case is built from two hand-made Reports. No analyzer runs and
 * no repository is fetched.
 */
import { describe, it, expect } from 'vitest';
import { computeRuleDeltas, diffReports, MAX_MOVE_DISTANCE } from './reports.js';
import { AuditDiffSchema } from '../schemas/audit-diff.js';
import type { ScoreDimension } from '../schemas/audit-diff.js';
import { makeFinding, makeReport } from '../test-utils/report-factory.js';
import type { Finding, Report } from '../schemas/report.js';

interface Rule {
  rule: string;
  delta: number;
  reason: string;
}

function score(n: number): Report['scores'] {
  return {
    overall: n,
    documentation: n,
    reproducibility: n,
    securityHygiene: n,
    deploymentReadiness: n,
    breakdown: {},
  };
}

function reportWith(
  rules: Rule[],
  dimension: ScoreDimension,
  overall: number,
  extra: Partial<Report> = {}
): Report {
  const final = 100 + rules.reduce((sum, r) => sum + r.delta, 0);
  return makeReport({
    scores: {
      ...score(overall),
      breakdown: { [dimension]: { raw: 100, rules, final } },
    },
    ...extra,
  });
}

describe('diffReports — verdict', () => {
  it('reports improved when the overall score goes up', () => {
    const before = reportWith([{ rule: 'no-ci', delta: -12, reason: 'No CI configuration' }], 'reproducibility', 60);
    const after = reportWith([], 'reproducibility', 80);
    const diff = diffReports(before, after);

    expect(diff.verdict).toBe('improved');
    expect(diff.scoreDelta).toBe(20);
    expect(AuditDiffSchema.parse(diff)).toBeTruthy();
  });

  it('reports regressed when the overall score goes down', () => {
    const before = reportWith([], 'securityHygiene', 90);
    const after = reportWith(
      [{ rule: 'severity-penalty', delta: -25, reason: 'Penalty from 1 security finding(s)' }],
      'securityHygiene',
      60
    );
    const diff = diffReports(before, after);

    expect(diff.verdict).toBe('regressed');
    expect(diff.scoreDelta).toBe(-30);
  });

  it('reports unchanged for identical reports', () => {
    const before = reportWith([{ rule: 'no-ci', delta: -12, reason: 'No CI' }], 'reproducibility', 70);
    const diff = diffReports(before, before);

    expect(diff.verdict).toBe('unchanged');
    expect(diff.scoreDelta).toBe(0);
    expect(diff.ruleDeltas).toEqual([]);
    expect(diff.resolved).toEqual([]);
    expect(diff.new).toEqual([]);
  });

  it('absorbs sub-decimal noise into unchanged', () => {
    // Scores are rounded to one decimal, so 70.04 vs 70 is not a change.
    const before = reportWith([], 'documentation', 70);
    const after = reportWith([], 'documentation', 70.04);
    const diff = diffReports(before, after);
    expect(diff.scoreDelta).toBe(0);
    expect(diff.verdict).toBe('unchanged');
  });

  it('honours an explicit epsilon band', () => {
    const before = reportWith([], 'documentation', 70);
    const after = reportWith([], 'documentation', 70.1);
    expect(diffReports(before, after).verdict).toBe('improved');
    expect(diffReports(before, after, { epsilon: 0.5 }).verdict).toBe('unchanged');
    expect(diffReports(before, after, { epsilon: 0.05 }).verdict).toBe('improved');
  });
});

describe('diffReports — score deltas', () => {
  it('computes the delta for every dimension', () => {
    const before = makeReport({
      scores: {
        overall: 50,
        documentation: 40,
        reproducibility: 50,
        securityHygiene: 60,
        deploymentReadiness: 50,
        breakdown: {},
      },
    });
    const after = makeReport({
      scores: {
        overall: 62.5,
        documentation: 55,
        reproducibility: 50,
        securityHygiene: 80,
        deploymentReadiness: 65,
        breakdown: {},
      },
    });
    const diff = diffReports(before, after);

    expect(diff.scoreDelta).toBe(12.5);
    expect(diff.dimensionDeltas).toEqual({
      documentation: 15,
      reproducibility: 0,
      securityHygiene: 20,
      deploymentReadiness: 15,
    });
  });
});

describe('diffReports — rule deltas', () => {
  it('credits a rule that stopped firing', () => {
    const before = reportWith([{ rule: 'no-test-script', delta: -10, reason: 'No test script' }], 'reproducibility', 60);
    const after = reportWith([], 'reproducibility', 70);
    const delta = diffReports(before, after).ruleDeltas[0];

    expect(delta).toEqual({
      rule: 'no-test-script',
      dimension: 'reproducibility',
      before: -10,
      after: 0,
      delta: 10,
      reason: 'No test script',
    });
  });

  it('penalises a rule that started firing', () => {
    const before = reportWith([], 'deploymentReadiness', 80);
    const after = reportWith(
      [{ rule: 'no-docker', delta: -10, reason: 'No Dockerfile for prod parity' }],
      'deploymentReadiness',
      70
    );
    const delta = diffReports(before, after).ruleDeltas[0];

    expect(delta?.before).toBe(0);
    expect(delta?.after).toBe(-10);
    expect(delta?.delta).toBe(-10);
    expect(delta?.reason).toBe('No Dockerfile for prod parity');
  });

  it('omits rules whose delta did not change', () => {
    const rules = [{ rule: 'no-license', delta: -8, reason: 'LICENSE is missing' }];
    const before = reportWith(rules, 'documentation', 70);
    const after = reportWith(rules, 'documentation', 70);
    expect(diffReports(before, after).ruleDeltas).toEqual([]);
  });

  it('sorts rule deltas by absolute magnitude', () => {
    const before = reportWith(
      [
        { rule: 'no-readme', delta: -25, reason: 'README.md is missing' },
        { rule: 'no-license', delta: -8, reason: 'LICENSE is missing' },
        { rule: 'no-screenshots', delta: -1, reason: 'No screenshots in repo' },
      ],
      'documentation',
      50
    );
    const after = reportWith([], 'documentation', 90);
    const deltas = diffReports(before, after).ruleDeltas;

    expect(deltas.map((d) => d.rule)).toEqual(['no-readme', 'no-license', 'no-screenshots']);
  });

  it('computes rule deltas directly from ScoreBreakdown', () => {
    const before = reportWith([{ rule: 'no-ci', delta: -12, reason: 'No CI' }], 'reproducibility', 60);
    const after = reportWith([], 'reproducibility', 72);
    expect(computeRuleDeltas(before, after)).toHaveLength(1);
    expect(computeRuleDeltas(after, before)[0]?.delta).toBe(-12);
  });
});

describe('diffReports — finding classification', () => {
  // Fingerprints are what the diff compares on. These stand in for the
  // ones ReportBuilder assigns.
  const resolved = makeFinding({ id: 'gone', fingerprint: 'fp-gone' });
  const persistentFinding = makeFinding({
    id: 'stays',
    severity: 'medium',
    fingerprint: 'fp-stays',
  });
  const fresh = makeFinding({ id: 'appeared', fingerprint: 'fp-appeared' });

  const before = makeReport({
    documentationGaps: [resolved, persistentFinding],
  });
  const after = makeReport({
    documentationGaps: [persistentFinding, fresh],
  });

  it('classifies by finding fingerprint', () => {
    const diff = diffReports(before, after);
    expect(diff.resolved).toEqual(['fp-gone']);
    expect(diff.new).toEqual(['fp-appeared']);
    expect(diff.persistent).toEqual(['fp-stays']);
  });

  it('falls back to rule and location for reports written before fingerprints', () => {
    const legacyBefore = makeReport({ documentationGaps: [makeFinding({ id: 'gone' })] });
    const legacyAfter = makeReport({ documentationGaps: [] });
    // The fallback key is `rule::file:line`, so an old audit still
    // compares against a new one instead of reading as fully resolved.
    expect(diffReports(legacyBefore, legacyAfter).resolved).toEqual(['gone::src/index.ts:12']);
  });

  it('names a finding that moved, instead of leaving the caller to guess', () => {
    const at = (line: number) =>
      makeReport({
        documentationGaps: [
          makeFinding({
            id: 'secret-x',
            ruleId: 'SEC-SECRET-001',
            fingerprint: `fp-line-${line}`,
            evidence: [{ file: 'src/a.ts', line, reason: 'r' }],
          }),
        ],
      });

    const diff = diffReports(at(10), at(20));
    expect(diff.moved).toEqual([
      { ruleId: 'SEC-SECRET-001', file: 'src/a.ts', fromLine: 10, toLine: 20 },
    ]);
    // The two sets are unchanged by the pairing — see the note in the
    // 'moved matching' block below.
    expect(diff.resolved).toEqual(['fp-line-10']);
    expect(diff.new).toEqual(['fp-line-20']);
  });

  it('does not call a genuinely deleted finding moved', () => {
    const beforeReport = makeReport({
      documentationGaps: [
        makeFinding({
          id: 'secret-x',
          ruleId: 'SEC-SECRET-001',
          fingerprint: 'fp-a',
          evidence: [{ file: 'src/a.ts', line: 10, reason: 'r' }],
        }),
      ],
    });
    const diff = diffReports(beforeReport, makeReport({ documentationGaps: [] }));
    expect(diff.resolved).toEqual(['fp-a']);
    expect(diff.moved).toEqual([]);
  });

  it('handles reports with no findings at all', () => {
    const diff = diffReports(makeReport(), makeReport());
    expect(diff.resolved).toEqual([]);
    expect(diff.new).toEqual([]);
    expect(diff.persistent).toEqual([]);
    expect(diff.verdict).toBe('unchanged');
  });

  it('treats a finding that only changed severity as persistent', () => {
    const beforeReport = makeReport({
      documentationGaps: [makeFinding({ id: 'x', severity: 'high', fingerprint: 'fp-x' })],
    });
    const afterReport = makeReport({
      documentationGaps: [makeFinding({ id: 'x', severity: 'low', fingerprint: 'fp-x' })],
    });
    const diff = diffReports(beforeReport, afterReport);
    expect(diff.persistent).toEqual(['fp-x']);
    expect(diff.resolved).toEqual([]);
    expect(diff.new).toEqual([]);
  });
});

describe('diffReports — moved matching', () => {
  const RULE = 'SEC-SECRET-001';
  const FILE = 'src/a.ts';

  function secret(line: number | null): Finding {
    const id = `${RULE}:${line ?? 'none'}`;
    return makeFinding({
      id,
      ruleId: RULE,
      fingerprint: `fp:${id}`,
      evidence: [{ file: FILE, line, reason: 'secret in source' }],
    });
  }

  function reportOf(findings: Finding[]): Report {
    return makeReport({ securityFindings: findings });
  }

  it('pairs every hit when a block of them shifts together', () => {
    const before = [secret(10), secret(20), secret(30)];
    const after = [secret(15), secret(25), secret(35)];
    const diff = diffReports(reportOf(before), reportOf(after));

    expect(diff.moved).toEqual([
      { ruleId: RULE, file: FILE, fromLine: 10, toLine: 15 },
      { ruleId: RULE, file: FILE, fromLine: 20, toLine: 25 },
      { ruleId: RULE, file: FILE, fromLine: 30, toLine: 35 },
    ]);
    // `moved` is an annotation over the two sets, not a third bucket: a
    // shifted hit still has a different fingerprint, so it is listed as
    // resolved and as new as well. Consumers that want "actually gone"
    // subtract `moved`. Pinned here so the contract is not a surprise.
    expect(diff.resolved).toEqual(before.map((f) => f.fingerprint));
    expect(diff.new).toEqual(after.map((f) => f.fingerprint));
  });

  it('pairs nearest first rather than in sorted order', () => {
    // Zipping the two sorted lists would give 10→18 and 20→25, which
    // invents a 15-line jump where a 2-line one is right there.
    const diff = diffReports(reportOf([secret(10), secret(20)]), reportOf([secret(18), secret(25)]));

    expect(diff.moved).toEqual([
      { ruleId: RULE, file: FILE, fromLine: 10, toLine: 25 },
      { ruleId: RULE, file: FILE, fromLine: 20, toLine: 18 },
    ]);
  });

  it('refuses to call a distant hit a move', () => {
    const before = reportOf([secret(10)]);
    const after = reportOf([secret(10 + MAX_MOVE_DISTANCE + 1)]);
    const diff = diffReports(before, after);

    expect(diff.moved).toEqual([]);
    expect(diff.resolved).toEqual(['fp:SEC-SECRET-001:10']);
    expect(diff.new).toEqual([`fp:SEC-SECRET-001:${10 + MAX_MOVE_DISTANCE + 1}`]);
  });

  it('still calls a hit inside the distance a move', () => {
    const diff = diffReports(reportOf([secret(10)]), reportOf([secret(10 + MAX_MOVE_DISTANCE)]));
    expect(diff.moved).toEqual([
      { ruleId: RULE, file: FILE, fromLine: 10, toLine: 10 + MAX_MOVE_DISTANCE },
    ]);
  });

  it('leaves the unpaired extras in resolved when fewer hits came back', () => {
    const diff = diffReports(reportOf([secret(10), secret(12)]), reportOf([secret(30)]));

    // 12→30 is the shorter jump, so it is the one that counts as moved.
    // 10 has no counterpart left and stays a plain resolution.
    expect(diff.moved).toEqual([{ ruleId: RULE, file: FILE, fromLine: 12, toLine: 30 }]);
    expect(diff.resolved).toEqual(['fp:SEC-SECRET-001:10', 'fp:SEC-SECRET-001:12']);
    expect(diff.new).toEqual(['fp:SEC-SECRET-001:30']);
  });

  it('never pairs a hit that has no line to compare', () => {
    const before = reportOf([secret(null)]);
    const after = reportOf([{ ...secret(null), fingerprint: 'fp:other' }]);
    const diff = diffReports(before, after);

    expect(diff.moved).toEqual([]);
    expect(diff.resolved).toEqual(['fp:SEC-SECRET-001:none']);
    expect(diff.new).toEqual(['fp:other']);
  });

  it('keeps the pairing correct when a whole file of hits shifts', () => {
    const lines = Array.from({ length: 60 }, (_, i) => (i + 1) * 10);
    const diff = diffReports(
      reportOf(lines.map((line) => secret(line))),
      reportOf(lines.map((line) => secret(line + 1)))
    );

    // Exact equality, in order: one pair per hit, each matched to its own
    // shifted line. A pairing that reused a hit or let the sliding window
    // skip one would fail here.
    expect(diff.moved).toEqual(
      lines.map((line) => ({ ruleId: RULE, file: FILE, fromLine: line, toLine: line + 1 }))
    );
    expect(() => AuditDiffSchema.parse(diff)).not.toThrow();
  });
});

describe('diffReports — refs', () => {
  it('carries job ids and commit shas into the refs', () => {
    const before = reportWith([], 'documentation', 70, { generatedAt: '2026-01-01T00:00:00Z' });
    const after = reportWith([], 'documentation', 75, { generatedAt: '2026-01-02T00:00:00Z' });
    const diff = diffReports(before, after, {
      baseJobId: 'job_a',
      headJobId: 'job_b',
      baseCommitSha: 'aaa111',
      headCommitSha: 'bbb222',
    });

    expect(diff.base).toEqual({
      jobId: 'job_a',
      commitSha: 'aaa111',
      generatedAt: '2026-01-01T00:00:00Z',
      overall: 70,
    });
    expect(diff.head).toEqual({
      jobId: 'job_b',
      commitSha: 'bbb222',
      generatedAt: '2026-01-02T00:00:00Z',
      overall: 75,
    });
  });

  it('defaults refs to null when no ids are supplied', () => {
    const diff = diffReports(reportWith([], 'documentation', 70), reportWith([], 'documentation', 70));
    expect(diff.base.jobId).toBeNull();
    expect(diff.head.commitSha).toBeNull();
  });
});
