import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY_CONTRACT,
  QualityContractSchema,
  type QualityContract,
} from '../schemas/quality-contract.js';
import type { Finding, Report } from '../schemas/report.js';
import { enrichFinding } from '../findings/enrich.js';
import { findingFingerprint } from '../findings/fingerprint.js';
import { ruleFor } from '../findings/rule-registry.js';
import { makeFinding, makeReport, reportWithFindings } from '../test-utils/report-factory.js';
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

  it('ignores fixtures by default, but can be told to count them', () => {
    // A credential under a fixture path, already downgraded by the
    // scanner — which is what every finding in a test suite looks like.
    const report = reportWithFindings([
      makeFinding({
        ruleId: 'SEC-SECRET-001',
        fingerprint: 'fp-fixture',
        severity: 'medium',
        evidence: [{ file: 'tests/a.test.ts', line: 1, reason: 'r' }],
      }),
    ]);

    // Default: out of scope, so it does not block.
    expect(evaluateQualityContract(report).ship).toBe(true);

    // Strict: the same finding blocks, even though it was downgraded.
    const strict: QualityContract = QualityContractSchema.parse({
      schemaVersion: '1.0',
      security: { scanFixtures: true },
    });
    expect(evaluateQualityContract(report, strict).ship).toBe(false);
  });

  it('still blocks a credential in ordinary source', () => {
    const report = reportWithFindings([
      makeFinding({
        ruleId: 'SEC-SECRET-001',
        fingerprint: 'fp-src',
        severity: 'critical',
        evidence: [{ file: 'src/config.ts', line: 3, reason: 'r' }],
      }),
    ]);
    expect(evaluateQualityContract(report).ship).toBe(false);
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

  it('derives the key an enriched finding would carry, when a report predates fingerprints', () => {
    const evidence = [{ file: 'a.ts', line: 3, reason: 'r' }];
    // A legacy finding carries only the slug — `repro-no-ci` is what the
    // registry maps to CI-001, so the derivation has to go through that
    // same registry. Deriving anything else puts a stored report and a
    // fresh one in different key spaces, and a gate comparison between
    // them reports every blocker as resolved and every one as new.
    const legacy = makeFinding({ id: 'repro-no-ci', fingerprint: undefined, evidence });
    const enriched = enrichFinding(makeFinding({ id: 'repro-no-ci', evidence }));

    expect(findingKey(legacy)).toBe(findingKey(enriched));
    expect(findingKey(legacy)).toBe(
      findingFingerprint({ ruleId: ruleFor('repro-no-ci').ruleId, evidence })
    );
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

  it('decides from findings, not from the score', () => {
    // The architecture claim is Finding -> Contract -> SHIP/BLOCK, with the
    // score advisory only. These two assertions are what keeps it that way:
    // a credential blocks no matter how good the score is, and a clean
    // report ships no matter how poor it is.
    const withCredential = reportWithFindings([
      makeFinding({
        ruleId: 'SEC-SECRET-001',
        fingerprint: 'fp-live',
        severity: 'critical',
        evidence: [{ file: 'src/config.ts', line: 3, reason: 'live key' }],
      }),
    ]);
    expect(evaluateQualityContract(withCredential).ship).toBe(false);

    const clean = reportWithFindings([]);
    expect(evaluateQualityContract(clean).ship).toBe(true);
  });

  it('reaches the same verdict regardless of what the score says', () => {
    // Same findings, wildly different scores: the verdict must not move.
    const findings = [withRule('CI-001')];
    const low = makeReport({
      scores: { ...makeReport().scores, overall: 5, reproducibility: 0 },
      documentationGaps: findings,
    });
    const high = makeReport({
      scores: { ...makeReport().scores, overall: 99, reproducibility: 100 },
      documentationGaps: findings,
    });
    expect(evaluateQualityContract(low).status).toBe(evaluateQualityContract(high).status);
    expect(evaluateQualityContract(low).ship).toBe(false);
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
