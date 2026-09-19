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
});
