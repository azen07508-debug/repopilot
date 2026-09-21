import { describe, expect, it } from 'vitest';
import type { Finding } from '../schemas/report.js';
import { makeFinding, reportWithFindings } from '../test-utils/report-factory.js';
import {
  MAX_FIX_PLANS,
  buildFixPlanSet,
  collectFixableFindings,
  selectFixPlanCandidates,
} from './builder.js';

/** A distinct finding at a given file. */
function at(file: string, overrides: Partial<Finding> = {}): Finding {
  const severity = overrides.severity ?? 'high';
  return makeFinding({
    id: `f-${file}-${severity}-${overrides.fingerprint ?? 'x'}`,
    ruleId: 'SEC-SECRET-001',
    fingerprint: overrides.fingerprint ?? `fp-${file}`,
    severity,
    evidence: [{ file, line: 1, reason: 'r' }],
    ...overrides,
  });
}

/** The real case: many hits of one rule in one file. */
function lockfileHits(n: number): Finding[] {
  return Array.from({ length: n }, (_, i) =>
    makeFinding({
      id: `secret-${i}`,
      ruleId: 'SEC-SECRET-001',
      fingerprint: `fp-${i}`,
      severity: 'medium',
      evidence: [{ file: 'pnpm-lock.yaml', line: i + 1, reason: 'integrity hash' }],
    })
  );
}

describe('fix plan explosion', () => {
  it('does not generate one plan per finding', () => {
    // A real audit produced 554 plans, 500 of them from one lockfile.
    const report = reportWithFindings(lockfileHits(500));
    expect(buildFixPlanSet(report).plans.length).toBeLessThanOrEqual(MAX_FIX_PLANS);
  });

  it('caps at MAX_FIX_PLANS even when every finding is in its own file', () => {
    const findings = Array.from({ length: 100 }, (_, i) => at(`src/f${i}.ts`));
    expect(buildFixPlanSet(reportWithFindings(findings)).plans.length).toBe(MAX_FIX_PLANS);
  });

  it('groups findings that share a rule and a file', () => {
    expect(selectFixPlanCandidates(reportWithFindings(lockfileHits(50)))).toHaveLength(1);
  });

  it('keeps a separate plan for a genuinely different file', () => {
    const report = reportWithFindings([
      ...lockfileHits(20),
      at('src/config.ts', { fingerprint: 'fp-config' }),
    ]);
    expect(selectFixPlanCandidates(report)).toHaveLength(2);
  });

  it('keeps the most severe representative of a group', () => {
    const report = reportWithFindings([
      at('src/a.ts', { severity: 'low', fingerprint: 'fp-a-low' }),
      at('src/a.ts', { severity: 'critical', fingerprint: 'fp-a-crit' }),
    ]);
    const candidates = selectFixPlanCandidates(report);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.severity).toBe('critical');
  });

  it('sorts by severity before capping, so a critical is never dropped', () => {
    const findings = [
      ...Array.from({ length: 30 }, (_, i) =>
        at(`src/low${i}.ts`, { severity: 'low', fingerprint: `fp-low${i}` })
      ),
      at('src/crit.ts', { severity: 'critical', fingerprint: 'fp-crit' }),
    ];
    const candidates = selectFixPlanCandidates(reportWithFindings(findings));
    // The critical one sorts last in insertion order but must survive.
    expect(candidates[0]?.severity).toBe('critical');
    expect(candidates).toHaveLength(MAX_FIX_PLANS);
  });

  it('leaves collectFixableFindings complete, because the diff relies on it', () => {
    const report = reportWithFindings(lockfileHits(500));
    expect(collectFixableFindings(report)).toHaveLength(500);
  });

  it('handles a report with no findings', () => {
    const plans = buildFixPlanSet(reportWithFindings([])).plans;
    expect(plans).toHaveLength(0);
  });

  it('produces one plan per selected candidate', () => {
    const report = reportWithFindings([...lockfileHits(30), at('src/x.ts', { fingerprint: 'fp-x' })]);
    const candidates = selectFixPlanCandidates(report);
    expect(buildFixPlanSet(report).plans.length).toBe(candidates.length);
  });
});
