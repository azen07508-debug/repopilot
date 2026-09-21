import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY_CONTRACT,
  QualityContractSchema,
  type QualityContract,
} from '../schemas/quality-contract.js';
import type { Finding, Report } from '../schemas/report.js';
import { makeFinding, reportWithFindings } from '../test-utils/report-factory.js';
import { collectFindings, evaluateQualityContract, findingKey } from './evaluate.js';

/** A finding that no default-contract check looks at. */
function benign(overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'REPO-README-002',
    fingerprint: 'fp-benign',
    severity: 'low',
    ...overrides,
  });
}

function withRule(ruleId: string, overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId,
    fingerprint: `fp-${ruleId}`,
    severity: 'high',
    ...overrides,
  });
}

/** A report with no findings — passes the default contract outright. */
function clean(overrides: Partial<Report> = {}): Report {
  return reportWithFindings([], overrides);
}

function section(result: ReturnType<typeof evaluateQualityContract>, id: string) {
  return result.sections.find((s) => s.id === id);
}

function checkStatus(result: ReturnType<typeof evaluateQualityContract>, checkId: string) {
  return result.sections.flatMap((s) => s.checks).find((c) => c.id === checkId)?.status;
}

describe('default contract', () => {
  it('is strict about secrets and critical findings', () => {
    expect(DEFAULT_QUALITY_CONTRACT.security.maxSecrets).toBe(0);
    expect(DEFAULT_QUALITY_CONTRACT.security.maxHistorySecrets).toBe(0);
    expect(DEFAULT_QUALITY_CONTRACT.security.maxCritical).toBe(0);
  });

  it('requires the basics', () => {
    expect(DEFAULT_QUALITY_CONTRACT.testing.required).toBe(true);
    expect(DEFAULT_QUALITY_CONTRACT.ci.required).toBe(true);
    expect(DEFAULT_QUALITY_CONTRACT.repository.readme).toBe(true);
    expect(DEFAULT_QUALITY_CONTRACT.repository.license).toBe(true);
    expect(DEFAULT_QUALITY_CONTRACT.release.build).toBe(true);
  });

  it('does not demand things reasonable projects disagree on', () => {
    expect(DEFAULT_QUALITY_CONTRACT.repository.envExample).toBe(false);
    expect(DEFAULT_QUALITY_CONTRACT.testing.contractTestsRequired).toBe(false);
  });

  it('fills every section from an empty object', () => {
    const parsed = QualityContractSchema.parse({ schemaVersion: '1.0' });
    expect(parsed.security.maxSecrets).toBe(0);
    expect(parsed.ci.required).toBe(true);
  });

  it('rejects a version it does not understand', () => {
    expect(() => QualityContractSchema.parse({ schemaVersion: '2.0' })).toThrow();
  });
});

describe('a clean report', () => {
  const result = evaluateQualityContract(clean());

  it('ships', () => {
    expect(result.status).toBe('pass');
    expect(result.ship).toBe(true);
  });

  it('counts nothing as blocking', () => {
    expect(result.blockerCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.blockingFingerprints).toEqual([]);
  });

  it('evaluates every section', () => {
    expect(result.sections.map((s) => s.id)).toEqual([
      'security',
      'testing',
      'ci',
      'repository',
      'release',
      'coverage',
    ]);
    expect(result.sections.every((s) => s.status === 'pass')).toBe(true);
  });
});

describe('security blockers', () => {
  it('blocks on a credential in the working tree', () => {
    const result = evaluateQualityContract(reportWithFindings([withRule('SEC-SECRET-001')]));
    expect(result.status).toBe('blocked');
    expect(result.ship).toBe(false);
    expect(checkStatus(result, 'security.no-secrets')).toBe('fail');
  });

  it('blocks on a credential reachable through history', () => {
    const result = evaluateQualityContract(reportWithFindings([withRule('SEC-HISTORY-001')]));
    expect(result.ship).toBe(false);
    expect(checkStatus(result, 'security.no-history-secrets')).toBe('fail');
  });

  it('blocks on any critical finding, whatever its rule', () => {
    const result = evaluateQualityContract(
      reportWithFindings([benign({ ruleId: 'WEB3-AUDIT-001', severity: 'critical' })])
    );
    expect(result.ship).toBe(false);
    expect(checkStatus(result, 'security.no-critical')).toBe('fail');
  });

  it('does not block on a medium finding', () => {
    const result = evaluateQualityContract(
      reportWithFindings([benign({ ruleId: 'SEC-INJECTION-001', severity: 'medium' })])
    );
    expect(result.ship).toBe(true);
  });

  it('names the rules behind a failure so a caller can drill in', () => {
    const result = evaluateQualityContract(reportWithFindings([withRule('SEC-SECRET-001')]));
    const check = result.sections.flatMap((s) => s.checks).find((c) => c.id === 'security.no-secrets');
    expect(check?.ruleIds).toEqual(['SEC-SECRET-001']);
  });
});

describe('repository, testing, ci and release blockers', () => {
  const cases: Array<[string, string]> = [
    ['REPO-README-001', 'repository.readme'],
    ['REPO-LICENSE-001', 'repository.license'],
    ['HACK-LICENSE-001', 'repository.license'],
    ['TEST-002', 'testing.test-script'],
    ['CI-001', 'ci.workflow'],
  ];

  for (const [ruleId, checkId] of cases) {
    it(`${ruleId} fails ${checkId} and blocks`, () => {
      const result = evaluateQualityContract(reportWithFindings([withRule(ruleId)]));
      expect(checkStatus(result, checkId)).toBe('fail');
      expect(result.ship).toBe(false);
    });
  }

  it('blocks when neither a Dockerfile nor a start script exists', () => {
    const result = evaluateQualityContract(
      reportWithFindings([withRule('BUILD-001'), withRule('BUILD-002')])
    );
    expect(checkStatus(result, 'release.build-path')).toBe('fail');
    expect(result.ship).toBe(false);
  });

  it('accepts a Dockerfile with no start script', () => {
    const result = evaluateQualityContract(reportWithFindings([withRule('BUILD-002')]));
    expect(checkStatus(result, 'release.build-path')).toBe('pass');
    expect(result.ship).toBe(true);
  });
});

describe('custom contracts', () => {
  it('lets a project tolerate a known credential', () => {
    const relaxed: QualityContract = QualityContractSchema.parse({
      schemaVersion: '1.0',
      security: { maxSecrets: 1 },
    });
    const report = reportWithFindings([withRule('SEC-SECRET-001')]);
    expect(evaluateQualityContract(report, relaxed).ship).toBe(true);
    // The default still blocks it.
    expect(evaluateQualityContract(report).ship).toBe(false);
  });

  it('skips a section that is turned off', () => {
    const noCi: QualityContract = QualityContractSchema.parse({
      schemaVersion: '1.0',
      ci: { required: false },
    });
    const result = evaluateQualityContract(reportWithFindings([withRule('CI-001')]), noCi);
    expect(section(result, 'ci')?.checks).toEqual([]);
    expect(section(result, 'ci')?.status).toBe('pass');
    expect(result.ship).toBe(true);
  });

  it('can demand an env example', () => {
    const strict: QualityContract = QualityContractSchema.parse({
      schemaVersion: '1.0',
      repository: { envExample: true },
    });
    const report = reportWithFindings([withRule('REPO-ENVEXAMPLE-001')]);
    expect(evaluateQualityContract(report, strict).ship).toBe(false);
    expect(evaluateQualityContract(report).ship).toBe(true);
  });

  it('can demand contract tests', () => {
    const strict: QualityContract = QualityContractSchema.parse({
      schemaVersion: '1.0',
      testing: { contractTestsRequired: true },
    });
    const report = reportWithFindings([withRule('TEST-003')]);
    expect(evaluateQualityContract(report, strict).ship).toBe(false);
    expect(evaluateQualityContract(report).ship).toBe(true);
  });
});

describe('warnings', () => {
  it('warns, but still ships, when the tree was truncated', () => {
    const result = evaluateQualityContract(
      clean({
        limitations: [
          'Static analysis only.',
          'The repository tree is large; the listing was truncated. Some files were not analyzed.',
        ],
      })
    );
    expect(result.status).toBe('pass_with_warnings');
    expect(result.ship).toBe(true);
    expect(result.blockerCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(checkStatus(result, 'coverage.partial-tree')).toBe('warn');
  });

  it('a failure outranks a warning', () => {
    const result = evaluateQualityContract(
      reportWithFindings([withRule('CI-001')], {
        limitations: ['The repository tree is large; the listing was truncated.'],
      })
    );
    expect(result.status).toBe('blocked');
    expect(section(result, 'coverage')?.status).toBe('warn');
  });

  it('does not warn on a complete tree', () => {
    expect(checkStatus(evaluateQualityContract(clean()), 'coverage.partial-tree')).toBeUndefined();
  });
});

describe('blockingFingerprints', () => {
  it('carries the fingerprints of the findings that blocked', () => {
    const result = evaluateQualityContract(
      reportWithFindings([withRule('CI-001'), benign(), withRule('REPO-README-001')])
    );
    expect(result.blockingFingerprints).toEqual(['fp-CI-001', 'fp-REPO-README-001']);
  });

  it('excludes findings that did not block', () => {
    const result = evaluateQualityContract(reportWithFindings([benign()]));
    expect(result.blockingFingerprints).toEqual([]);
  });
});

describe('finding collection', () => {
  it('deduplicates across the report arrays', () => {
    // The same finding appears as both a blocker and a documentation gap.
    const f = withRule('CI-001');
    const report = clean({ blockers: [f], documentationGaps: [f], securityFindings: [f] });
    expect(collectFindings(report)).toHaveLength(1);
  });

  it('falls back to rule and location when a report predates fingerprints', () => {
    const legacy = makeFinding({
      ruleId: 'CI-001',
      fingerprint: undefined,
      evidence: [{ file: 'a.ts', line: 3, reason: 'r' }],
    });
    expect(findingKey(legacy)).toBe('CI-001::a.ts:3');
  });

  it('counts distinct findings separately', () => {
    const a = withRule('SEC-SECRET-001', { fingerprint: 'fp-a' });
    const b = withRule('SEC-SECRET-001', { fingerprint: 'fp-b' });
    const result = evaluateQualityContract(reportWithFindings([a, b]));
    expect(checkStatus(result, 'security.no-secrets')).toBe('fail');
    expect(result.blockingFingerprints).toEqual(['fp-a', 'fp-b']);
  });
});

describe('the result is a decision, not an opinion', () => {
  it('agrees with itself across runs', () => {
    const report = reportWithFindings([withRule('CI-001')]);
    const a = evaluateQualityContract(report);
    const b = evaluateQualityContract(report);
    expect({ ...a, evaluatedAt: '' }).toEqual({ ...b, evaluatedAt: '' });
  });

  it('keeps ship and status consistent', () => {
    const blocked = evaluateQualityContract(reportWithFindings([withRule('CI-001')]));
    expect(blocked.status === 'blocked').toBe(!blocked.ship);

    const warned = evaluateQualityContract(
      clean({ limitations: ['the listing was truncated'] })
    );
    expect(warned.status === 'pass_with_warnings').toBe(warned.ship);
  });
});
