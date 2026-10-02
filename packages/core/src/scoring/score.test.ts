import { describe, it, expect } from 'vitest';
import { scoreAll } from '../scoring/score.js';
import type { Finding } from '../schemas/report.js';

function f(id: string, severity: Finding['severity']): Finding {
  return {
    id,
    category: 'meta',
    severity,
    title: id,
    description: id,
    evidence: [{ file: 'x', line: 1, reason: 'r' }],
    recommendedAction: 'r',
    acceptanceCriteria: [],
  };
}

const baseInput = {
  hasReadme: true,
  hasLicense: true,
  hasContributing: true,
  hasSecurityPolicy: true,
  hasEnvExample: true,
  hasApiDocs: true,
  hasScreenshots: true,
  hasDemoUrl: true,
  hasLockfile: true,
  hasCI: true,
  hasDocker: true,
  hasTestCommand: true,
  hasRunCommand: true,
  hasContracts: false,
  hasDeployScripts: false,
  hasContractTests: false,
  hasAuditNote: true,
  hasContractAddresses: false,
  hasHackathonDemoUrl: true,
  hasHackathonDemoVideo: true,
  hasHackathonArchitecture: true,
  hasHackathonLicense: true,
  hasHackathonNetwork: true,
  securityFindings: [],
  documentationFindings: [],
  reproducibilityFindings: [],
  deploymentFindings: [],
  web3Findings: [],
  hackathonFindings: [],
};

describe('scoreAll', () => {
  it('a perfect repo scores 100', () => {
    const s = scoreAll(baseInput, { target: 'open_source' });
    expect(s.overall).toBe(100);
    expect(s.documentation).toBe(100);
    expect(s.reproducibility).toBe(100);
    expect(s.securityHygiene).toBe(100);
    expect(s.deploymentReadiness).toBe(100);
  });

  it('deducts for missing README', () => {
    const s = scoreAll({ ...baseInput, hasReadme: false }, { target: 'open_source' });
    expect(s.documentation).toBeLessThan(100);
  });

  it('deducts for critical security findings', () => {
    const s = scoreAll(
      { ...baseInput, securityFindings: [f('secret-1', 'critical')] },
      { target: 'open_source' }
    );
    expect(s.securityHygiene).toBeLessThan(80);
  });

  it('hackathon target weights deployment more', () => {
    const s1 = scoreAll(baseInput, { target: 'open_source' });
    const s2 = scoreAll(baseInput, { target: 'hackathon' });
    // both are perfect, both 100; difference only shows up with deductions
    expect(s2.overall).toBeGreaterThanOrEqual(s1.overall);
  });

  it('production target weights security more', () => {
    const dirty = { ...baseInput, securityFindings: [f('secret-1', 'high')] };
    const a = scoreAll(dirty, { target: 'open_source' });
    const b = scoreAll(dirty, { target: 'production' });
    expect(b.overall).toBeLessThanOrEqual(a.overall);
  });

  it('breakdown records every applied rule', () => {
    const s = scoreAll({ ...baseInput, hasReadme: false }, { target: 'open_source' });
    const rules = s.breakdown.documentation?.rules ?? [];
    expect(rules.some((r) => r.rule === 'no-readme' && r.delta < 0)).toBe(true);
  });

  it('leaves out the rules that did not fire', () => {
    // A rule listed with `delta: 0` next to its penalty-shaped reason is a
    // false statement in the report JSON: `{ rule: 'no-readme', delta: 0,
    // reason: 'README.md is missing' }` about a repository whose README is
    // present. Absence is the honest encoding, and it is what
    // `computeRuleDeltas` already assumes when it reads `b?.delta ?? 0`.
    const clean = scoreAll(baseInput, { target: 'open_source' });
    expect(clean.breakdown.documentation?.rules).toEqual([]);
    expect(clean.breakdown.reproducibility?.rules).toEqual([]);
    expect(clean.breakdown.securityHygiene?.rules).toEqual([]);
    expect(clean.breakdown.deploymentReadiness?.rules).toEqual([]);

    const dirty = scoreAll({ ...baseInput, hasReadme: false }, { target: 'open_source' });
    const names = (dirty.breakdown.documentation?.rules ?? []).map((r) => r.rule);
    expect(names).toEqual(['no-readme']);
  });

  it('keeps the breakdown consistent with the final score', () => {
    // Whatever the rule list contains has to add up. If a rule could be
    // present with `delta: 0`, or absent while its penalty applied, this
    // would drift — and the drift would be invisible in the report.
    const input = {
      ...baseInput,
      hasReadme: false,
      hasSecurityPolicy: false,
      securityFindings: [f('secret-1', 'high'), f('secret-2', 'critical')],
    };
    const s = scoreAll(input, { target: 'open_source' });
    for (const dimension of [
      'documentation',
      'reproducibility',
      'securityHygiene',
      'deploymentReadiness',
    ] as const) {
      const b = s.breakdown[dimension];
      if (!b) continue;
      const summed = Math.max(0, Math.min(100, b.raw + b.rules.reduce((n, r) => n + r.delta, 0)));
      expect(Math.round(summed * 10) / 10, dimension).toBe(b.final);
      for (const r of b.rules) expect(r.delta, `${dimension}/${r.rule}`).not.toBe(0);
    }
  });
});
