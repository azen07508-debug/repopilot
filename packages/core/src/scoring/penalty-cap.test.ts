/**
 * The per-`(file, rule)` cap on the severity penalty (ADR D-022, R-22).
 *
 * The penalty used to be a flat sum over every finding. That holds until a
 * single generated file produces hundreds of hits: a lockfile is mostly
 * `sha512-` integrity digests, which are high-entropy by construction and
 * so match the generic secret heuristic. `severityForPath` downgrades those
 * to `low` rather than dropping them, so they stay in `securityFindings` —
 * 400 of them at 1.5 points each is 600 against a base of 100.
 *
 * Measured before the cap: a repository whose only files were a lockfile, a
 * README, a LICENSE and a one-line source file lost 25 overall points and
 * scored 0 on `securityHygiene`.
 */
import { describe, it, expect } from 'vitest';
import { scoreAll, scoreSecurityHygiene, type ScoringInput } from './score.js';
import type { Finding, Severity } from '../schemas/report.js';

/**
 * A finding shaped like a real secret hit: `secret-<kind>-<line>-<file>`,
 * with no `ruleId`, so the rule id has to be resolved. That is the shape
 * that arrives from the scanner before enrichment.
 */
function finding(file: string, line: number, severity: Severity, ruleId?: string): Finding {
  const base: Finding = {
    id: `secret-generic_high_entropy-${line}-${file.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    category: 'security',
    severity,
    title: 'High-entropy string',
    description: 'Looks like a credential',
    evidence: [{ file, line, reason: 'high entropy' }],
    recommendedAction: 'Move it to a secret store',
    acceptanceCriteria: [],
  };
  return ruleId === undefined ? base : { ...base, ruleId };
}

/** A repository that is otherwise perfect, so only the penalty moves. */
function input(securityFindings: Finding[]): ScoringInput {
  return {
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
    securityFindings,
    documentationFindings: [],
    reproducibilityFindings: [],
    deploymentFindings: [],
    web3Findings: [],
    hackathonFindings: [],
  };
}

function penaltyOf(findings: Finding[]): number {
  const breakdown = scoreSecurityHygiene(input(findings));
  return breakdown.rules.find((r) => r.rule === 'severity-penalty')?.delta ?? 0;
}

function lockfile(count: number): Finding[] {
  return Array.from({ length: count }, (_, i) => finding('pnpm-lock.yaml', i + 1, 'low'));
}

describe('the severity penalty is capped per (file, rule)', () => {
  it('a lockfile cannot zero security hygiene', () => {
    // 3 × 1.5, not 400 × 1.5.
    expect(penaltyOf(lockfile(400))).toBe(-4.5);
    expect(scoreSecurityHygiene(input(lockfile(400))).final).toBe(95.5);
  });

  it('a lockfile no longer costs the overall score 25 points', () => {
    const withLockfile = scoreAll(input(lockfile(400)), { target: 'open_source' });
    const without = scoreAll(input([]), { target: 'open_source' });

    expect(without.overall - withLockfile.overall).toBeLessThan(2);
    expect(withLockfile.securityHygiene).toBeGreaterThan(90);
  });

  it('breadth is still punished in full', () => {
    // Forty files, one hit each: forty distinct pairs, so nothing is capped.
    const spread = Array.from({ length: 40 }, (_, i) => finding(`src/f${i}.ts`, 1, 'low'));
    expect(penaltyOf(spread)).toBe(-60);
    expect(scoreSecurityHygiene(input(spread)).final).toBe(40);
  });

  it('keeps the worst hits inside a capped pair', () => {
    const mixed = [
      finding('src/a.ts', 1, 'critical'),
      ...Array.from({ length: 10 }, (_, i) => finding('src/a.ts', i + 2, 'low')),
    ];
    // The critical hit and the two next-worst, not the critical hit and ten lows.
    expect(penaltyOf(mixed)).toBe(-28);
  });

  it('counts three per pair, and no more', () => {
    const three = Array.from({ length: 3 }, (_, i) => finding('src/a.ts', i + 1, 'low'));
    const four = Array.from({ length: 4 }, (_, i) => finding('src/a.ts', i + 1, 'low'));
    expect(penaltyOf(three)).toBe(-4.5);
    expect(penaltyOf(four)).toBe(-4.5);
  });

  it('treats two rules in one file as two pairs', () => {
    const twoRules = [
      ...Array.from({ length: 5 }, (_, i) => finding('src/a.ts', i + 1, 'low', 'SEC-SECRET-001')),
      ...Array.from({ length: 5 }, (_, i) => finding('src/a.ts', i + 6, 'low', 'SEC-INJECTION-001')),
    ];
    expect(penaltyOf(twoRules)).toBe(-9);
  });

  it('groups by resolved rule id, not by the id that embeds the line', () => {
    // The shape a real scanner emits. Keying on `id` would give every hit a
    // group of its own and the cap would never apply to the case it exists for.
    const hits = lockfile(50);
    expect(new Set(hits.map((f) => f.id)).size).toBe(50);
    expect(penaltyOf(hits)).toBe(-4.5);
  });

  it('says why the penalty is smaller than the count', () => {
    const capped = scoreSecurityHygiene(input(lockfile(400))).rules.find(
      (r) => r.rule === 'severity-penalty'
    );
    expect(capped?.reason).toContain('at most 3 counted per file and rule');

    // A single finding is not capped, so its reason is unchanged.
    const single = scoreSecurityHygiene(input([finding('src/a.ts', 1, 'critical')])).rules.find(
      (r) => r.rule === 'severity-penalty'
    );
    expect(single?.reason).toBe('Penalty from 1 security finding(s)');
    expect(single?.delta).toBe(-25);
  });
});
