/**
 * Grouping fixture findings for reading.
 *
 * The report keeps every fixture finding individually — the quality
 * contract counts them and the diff keys on them — so this is the only
 * thing standing between a reader and 542 rows. The tests are mostly
 * about the two ways that can go wrong: losing a finding in the fold,
 * and producing an order that changes between two runs of the same
 * input.
 */
import { describe, expect, it } from 'vitest';
import { MAX_GROUP_LINES, summarizeFixtures } from './fixtures.js';
import { makeFinding } from '../test-utils/report-factory.js';
import type { Finding } from '../schemas/report.js';

function hit(
  file: string,
  line: number,
  overrides: Partial<Finding> = {}
): Finding {
  return makeFinding({
    id: `${file}:${line}`,
    ruleId: 'SEC-SECRET-001',
    title: 'Possible credential',
    severity: 'medium',
    evidence: [{ file, line, reason: 'a key sits here' }],
    ...overrides,
  });
}

describe('summarizeFixtures', () => {
  it('returns nothing for nothing', () => {
    expect(summarizeFixtures([])).toEqual([]);
  });

  it('folds findings that share a file and a rule into one group', () => {
    const groups = summarizeFixtures([hit('tests/a.test.ts', 3), hit('tests/a.test.ts', 9)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.file).toBe('tests/a.test.ts');
    expect(groups[0]?.ruleId).toBe('SEC-SECRET-001');
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.lines).toEqual([3, 9]);
  });

  it('keeps the same file under two rules apart', () => {
    const groups = summarizeFixtures([
      hit('tests/a.test.ts', 3),
      hit('tests/a.test.ts', 4, { ruleId: 'AI-CATCH-001', title: 'Empty catch block' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.ruleId).sort()).toEqual(['AI-CATCH-001', 'SEC-SECRET-001']);
  });

  it('keeps the same rule in two files apart', () => {
    const groups = summarizeFixtures([hit('tests/a.test.ts', 3), hit('tests/b.test.ts', 3)]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.file).sort()).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  it('counts every finding even when the line list is capped', () => {
    const many = Array.from({ length: 500 }, (_, i) => hit('pnpm-lock.yaml', i + 1));
    const groups = summarizeFixtures(many);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(500);
    // The cap is the point: 500 lines would be the wall again.
    expect(groups[0]?.lines).toHaveLength(MAX_GROUP_LINES);
    expect(groups[0]?.lines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('deduplicates repeated lines but still counts the hits', () => {
    const groups = summarizeFixtures([hit('tests/a.test.ts', 7), hit('tests/a.test.ts', 7)]);

    expect(groups[0]?.lines).toEqual([7]);
    expect(groups[0]?.count).toBe(2);
  });

  it('sorts the lines ascending even when the findings are not', () => {
    const groups = summarizeFixtures([hit('tests/a.test.ts', 40), hit('tests/a.test.ts', 2)]);

    expect(groups[0]?.lines).toEqual([2, 40]);
  });

  it('reports a finding with no line in the count and not in the lines', () => {
    const groups = summarizeFixtures([
      hit('tests/a.test.ts', 1, { evidence: [{ file: 'tests/a.test.ts', line: null, reason: 'file-level' }] }),
    ]);

    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.lines).toEqual([]);
  });

  it('takes the worst severity in the group, not the first', () => {
    const groups = summarizeFixtures([
      hit('tests/a.test.ts', 1, { severity: 'low' }),
      hit('tests/a.test.ts', 2, { severity: 'critical' }),
      hit('tests/a.test.ts', 3, { severity: 'medium' }),
    ]);

    expect(groups[0]?.severity).toBe('critical');
  });

  it('groups findings that enrichment never named under an empty rule', () => {
    const groups = summarizeFixtures([hit('tests/a.test.ts', 1, { ruleId: undefined })]);

    expect(groups[0]?.ruleId).toBe('');
  });

  it('takes the group title from its first finding', () => {
    const groups = summarizeFixtures([
      hit('tests/a.test.ts', 1, { title: 'Possible credential' }),
      hit('tests/a.test.ts', 2, { title: 'Another title' }),
    ]);

    expect(groups[0]?.title).toBe('Possible credential');
  });

  it('leads with the worst group, then sorts by file and rule', () => {
    const groups = summarizeFixtures([
      hit('tests/b.test.ts', 1, { severity: 'low' }),
      hit('tests/a.test.ts', 1, { severity: 'critical' }),
      hit('tests/a.test.ts', 2, { severity: 'critical', ruleId: 'AI-CATCH-001' }),
    ]);

    expect(groups.map((g) => [g.severity, g.file, g.ruleId])).toEqual([
      ['critical', 'tests/a.test.ts', 'AI-CATCH-001'],
      ['critical', 'tests/a.test.ts', 'SEC-SECRET-001'],
      ['low', 'tests/b.test.ts', 'SEC-SECRET-001'],
    ]);
  });

  it('is order-independent, so the same report always groups the same way', () => {
    const findings = [
      hit('tests/a.test.ts', 3),
      hit('tests/b.test.ts', 1, { severity: 'low' }),
      hit('tests/a.test.ts', 9),
      hit('pnpm-lock.yaml', 100, { severity: 'low' }),
    ];

    const forward = summarizeFixtures(findings);
    const backward = summarizeFixtures([...findings].reverse());

    expect(backward).toEqual(forward);
  });

  it('does not mutate the findings it was handed', () => {
    const findings = [hit('tests/a.test.ts', 3)];
    const before = structuredClone(findings);

    summarizeFixtures(findings);

    expect(findings).toEqual(before);
  });
});
