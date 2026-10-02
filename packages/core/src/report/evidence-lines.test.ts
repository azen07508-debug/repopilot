/**
 * Condensing checklist evidence.
 *
 * The defect these tests pin down is a shape, not a number: the row
 * carried one string per finding, so a 639-finding audit produced a
 * single line holding 639 titles. Every assertion here is about what a
 * reader can learn from the line — how many hits, in which file — which
 * is the information truncation would have thrown away.
 */
import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_GROUPS, condenseEvidence } from './evidence-lines.js';
import { makeFinding } from '../test-utils/report-factory.js';
import type { Finding } from '../schemas/report.js';

function hit(
  file: string,
  overrides: Partial<Finding> = {}
): Finding {
  return makeFinding({
    id: `${file}:${overrides.title ?? 'x'}`,
    ruleId: 'SEC-SECRET-001',
    title: 'High-entropy string (possible secret)',
    severity: 'medium',
    evidence: [{ file, line: 1, reason: 'a high-entropy run sits here' }],
    ...overrides,
  });
}

describe('condenseEvidence', () => {
  it('returns nothing when there is nothing to say', () => {
    expect(condenseEvidence([])).toEqual([]);
  });

  it('does not annotate a lone finding with a count', () => {
    const lines = condenseEvidence([hit('src/config.ts')]);
    expect(lines).toEqual(['High-entropy string (possible secret) in src/config.ts']);
  });

  it('folds repeated hits in one file under one rule into a count', () => {
    const lines = condenseEvidence([
      hit('pnpm-lock.yaml'),
      hit('pnpm-lock.yaml'),
      hit('pnpm-lock.yaml'),
    ]);
    expect(lines).toEqual(['High-entropy string (possible secret) ×3 in pnpm-lock.yaml']);
  });

  it('keeps the same rule in two files apart', () => {
    const lines = condenseEvidence([hit('a.ts'), hit('b.ts'), hit('b.ts')]);
    expect(lines).toHaveLength(2);
    expect(lines).toContain('High-entropy string (possible secret) ×2 in b.ts');
    expect(lines).toContain('High-entropy string (possible secret) in a.ts');
  });

  it('keeps two rules in one file apart', () => {
    const lines = condenseEvidence([
      hit('src/config.ts', { ruleId: 'SEC-SECRET-001' }),
      hit('src/config.ts', { ruleId: 'SEC-SECRET-002', title: 'Possible seed phrase' }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('leads with the worst group', () => {
    const lines = condenseEvidence([
      hit('low.ts', { severity: 'low' }),
      hit('critical.ts', { severity: 'critical' }),
      hit('medium.ts', { severity: 'medium' }),
    ]);
    expect(lines[0]).toContain('critical.ts');
    expect(lines[1]).toContain('medium.ts');
    expect(lines[2]).toContain('low.ts');
  });

  it('omits the file when the finding does not name one', () => {
    const lines = condenseEvidence([
      makeFinding({ evidence: [{ file: '', line: 0, reason: 'repo-level' }] }),
    ]);
    expect(lines).toEqual(['Test finding']);
    expect(lines[0]).not.toContain(' in ');
  });

  it('caps the list and counts what it hid', () => {
    const findings = Array.from({ length: 7 }, (_, i) => hit(`file-${i}.ts`));
    const lines = condenseEvidence(findings);

    expect(lines).toHaveLength(MAX_EVIDENCE_GROUPS + 1);
    expect(lines[MAX_EVIDENCE_GROUPS]).toBe('+2 more rule/file groups (2 findings)');
  });

  it('reports the true finding count of the hidden groups, not the group count', () => {
    // Five groups are listed, then one more group holding 557 hits. The
    // whole point of the line is that 557 is legible and 557 titles are
    // not, so the summary must carry the volume, not just the shape.
    const findings = [
      ...Array.from({ length: 5 }, (_, i) => hit(`file-${i}.ts`)),
      ...Array.from({ length: 557 }, () => hit('pnpm-lock.yaml')),
    ];
    const lines = condenseEvidence(findings);

    expect(lines).toHaveLength(MAX_EVIDENCE_GROUPS + 1);
    expect(lines[MAX_EVIDENCE_GROUPS]).toBe('+1 more rule/file group (557 findings)');
  });

  it('adds no summary line when everything fits', () => {
    const findings = Array.from({ length: MAX_EVIDENCE_GROUPS }, (_, i) =>
      hit(`file-${i}.ts`)
    );
    const lines = condenseEvidence(findings);
    expect(lines).toHaveLength(MAX_EVIDENCE_GROUPS);
    expect(lines.some((l) => l.startsWith('+'))).toBe(false);
  });

  it('honours a smaller cap', () => {
    const findings = [hit('a.ts'), hit('b.ts'), hit('c.ts')];
    const lines = condenseEvidence(findings, 1);
    expect(lines).toEqual([
      'High-entropy string (possible secret) in a.ts',
      '+2 more rule/file groups (2 findings)',
    ]);
  });

  it('is stable when the same findings arrive in another order', () => {
    const findings = [
      hit('b.ts', { severity: 'low' }),
      hit('a.ts', { severity: 'critical' }),
      hit('a.ts', { severity: 'critical' }),
      hit('c.ts'),
      hit('d.ts'),
      hit('e.ts'),
      hit('f.ts'),
    ];
    expect(condenseEvidence(findings)).toEqual(condenseEvidence([...findings].reverse()));
  });

  it('cannot grow past the cap plus one summary line', () => {
    // The property the row depends on. Anything unbounded here puts the
    // wall back, whatever the grouping does.
    const findings = Array.from({ length: 500 }, (_, i) =>
      hit(`dir${i % 40}/file.ts`, { ruleId: `SEC-${i % 13}` })
    );
    const lines = condenseEvidence(findings);
    expect(lines.length).toBeLessThanOrEqual(MAX_EVIDENCE_GROUPS + 1);
  });
});
