/**
 * Quality contract evaluation.
 *
 * A pure function of a Report: no network, no LLM, and no clock beyond
 * the timestamp stamped on the result.
 *
 * The decision rule is blunt, and stated in exactly one place:
 *
 *   any check fails         -> blocked,            ship = false
 *   no failures, a warning  -> pass_with_warnings, ship = true
 *   everything passes       -> pass,               ship = true
 *
 * A warning never blocks. That is the point of having two levels: a
 * project should be able to ship with a visible, documented caveat — but
 * never with a live credential.
 */
import type { Finding, Report } from '../schemas/report.js';
import {
  CONTRACT_VERSION,
  DEFAULT_QUALITY_CONTRACT,
  type ContractCheck,
  type ContractSection,
  type ContractStatus,
  type QualityContract,
  type QualityContractResult,
} from '../schemas/quality-contract.js';
import { findingKey, ruleIdOf } from '../findings/fingerprint.js';
import { isFixturePath } from '../security/severity.js';

/**
 * Every finding in the report, deduplicated.
 *
 * The three arrays overlap — `blockers` is largely a subset of the
 * others — so counting them raw would double-count and inflate every
 * number a caller sees. Fingerprint is the identity we compare on, with
 * a fallback for reports written before it existed.
 */
export function collectFindings(report: Report): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of [
    ...report.blockers,
    ...report.documentationGaps,
    ...report.securityFindings,
    ...report.qualityFindings,
    // Fixture findings are collected so `security.scanFixtures` can opt
    // them into the gate. The default policy filters them back out.
    ...report.fixtureFindings,
  ]) {
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// Defined in findings/fingerprint.ts; re-exported so callers that already
// import it from here keep working.
export { findingKey };

/**
 * The findings a rule produced.
 *
 * Matched on the resolved rule id, not the raw field. `ruleId` did not
 * exist in 1.0, so filtering on it finds nothing in a stored report and
 * every requirement phrased as "is this rule's finding present?" answers
 * `present` — including the ones that mean the opposite, like "a CI
 * workflow runs install and test".
 */
function byRule(findings: Finding[], ...ruleIds: string[]): Finding[] {
  const wanted = new Set(ruleIds);
  return findings.filter((f) => wanted.has(ruleIdOf(f)));
}

function check(
  section: string,
  id: string,
  requirement: string,
  observed: string,
  ok: boolean,
  ruleIds: string[] = []
): ContractCheck {
  return { id, section, requirement, observed, status: ok ? 'pass' : 'fail', ruleIds };
}

function statusOf(checks: ContractCheck[]): ContractStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function securitySection(findings: Finding[], c: QualityContract): ContractSection {
  // Fixture paths — test files, sample apps, documents — downgrade their
  // findings to medium, so counting only critical and high means a fake
  // key in a scanner's own test suite does not block a ship while a real
  // key in source still does. A contract can opt back in with
  // `security.scanFixtures`.
  const counts = (f: Finding): boolean => {
    // Strict mode: every credential counts, wherever it lives and whatever
    // severity the scanner downgraded it to.
    if (c.security.scanFixtures) return true;
    // Default: a fixture path is out of scope, and a downgraded finding
    // does not block.
    if (isFixturePath(f.evidence[0]?.file ?? '')) return false;
    return f.severity === 'critical' || f.severity === 'high';
  };

  const secrets = byRule(findings, 'SEC-SECRET-001').filter(counts);
  const historySecrets = byRule(findings, 'SEC-HISTORY-001').filter(counts);
  const critical = findings.filter((f) => f.severity === 'critical');

  const checks: ContractCheck[] = [
    check(
      'security',
      'security.no-secrets',
      `at most ${count(c.security.maxSecrets, 'credential')} in the working tree`,
      secrets.length === 0 ? 'none found' : `${count(secrets.length, 'credential')} found`,
      secrets.length <= c.security.maxSecrets,
      ['SEC-SECRET-001']
    ),
    check(
      'security',
      'security.no-history-secrets',
      `at most ${count(c.security.maxHistorySecrets, 'credential')} reachable through history`,
      historySecrets.length === 0
        ? 'none found'
        : `${count(historySecrets.length, 'credential')} found`,
      historySecrets.length <= c.security.maxHistorySecrets,
      ['SEC-HISTORY-001']
    ),
    check(
      'security',
      'security.no-critical',
      `at most ${count(c.security.maxCritical, 'critical finding')}`,
      critical.length === 0 ? 'none found' : `${count(critical.length, 'critical finding')} found`,
      critical.length <= c.security.maxCritical,
      [...new Set(critical.map(ruleIdOf))].sort()
    ),
  ];

  return { id: 'security', status: statusOf(checks), checks };
}

function testingSection(findings: Finding[], c: QualityContract): ContractSection {
  const checks: ContractCheck[] = [];

  if (c.testing.required) {
    const missing = byRule(findings, 'TEST-002');
    checks.push(
      check(
        'testing',
        'testing.test-script',
        'a test command is declared',
        missing.length === 0 ? 'declared' : 'not declared',
        missing.length === 0,
        ['TEST-002']
      )
    );
  }

  if (c.testing.contractTestsRequired) {
    const missing = byRule(findings, 'TEST-003');
    checks.push(
      check(
        'testing',
        'testing.contract-tests',
        'contracts are covered by tests',
        missing.length === 0 ? 'covered' : 'not covered',
        missing.length === 0,
        ['TEST-003']
      )
    );
  }

  return { id: 'testing', status: statusOf(checks), checks };
}

function ciSection(findings: Finding[], c: QualityContract): ContractSection {
  const checks: ContractCheck[] = [];

  if (c.ci.required) {
    const missing = byRule(findings, 'CI-001');
    checks.push(
      check(
        'ci',
        'ci.workflow',
        'a CI workflow runs install and test',
        missing.length === 0 ? 'present' : 'missing',
        missing.length === 0,
        ['CI-001']
      )
    );
  }

  return { id: 'ci', status: statusOf(checks), checks };
}

function repositorySection(findings: Finding[], c: QualityContract): ContractSection {
  const checks: ContractCheck[] = [];

  if (c.repository.readme) {
    const missing = byRule(findings, 'REPO-README-001');
    checks.push(
      check(
        'repository',
        'repository.readme',
        'a README is present',
        missing.length === 0 ? 'present' : 'missing',
        missing.length === 0,
        ['REPO-README-001']
      )
    );
  }

  if (c.repository.license) {
    // The hackathon analyzer reports a missing LICENSE under its own id,
    // so both have to count or the contract depends on the target.
    const missing = byRule(findings, 'REPO-LICENSE-001', 'HACK-LICENSE-001');
    checks.push(
      check(
        'repository',
        'repository.license',
        'a LICENSE is present',
        missing.length === 0 ? 'present' : 'missing',
        missing.length === 0,
        ['REPO-LICENSE-001', 'HACK-LICENSE-001']
      )
    );
  }

  if (c.repository.envExample) {
    const missing = byRule(findings, 'REPO-ENVEXAMPLE-001');
    checks.push(
      check(
        'repository',
        'repository.env-example',
        '.env.example is present',
        missing.length === 0 ? 'present' : 'missing',
        missing.length === 0,
        ['REPO-ENVEXAMPLE-001']
      )
    );
  }

  return { id: 'repository', status: statusOf(checks), checks };
}

function releaseSection(findings: Finding[], c: QualityContract): ContractSection {
  const checks: ContractCheck[] = [];

  if (c.release.build) {
    const noDocker = byRule(findings, 'BUILD-001');
    const noRunScript = byRule(findings, 'BUILD-002');
    // Either path counts. A project that ships a Dockerfile and no
    // `start` script is fine, and so is the reverse.
    const ok = noDocker.length === 0 || noRunScript.length === 0;
    checks.push(
      check(
        'release',
        'release.build-path',
        'a production build path exists (Dockerfile or a start script)',
        ok ? 'present' : 'neither a Dockerfile nor a start script',
        ok,
        ['BUILD-001', 'BUILD-002']
      )
    );
  }

  return { id: 'release', status: statusOf(checks), checks };
}

/**
 * How much of the repository the audit actually saw.
 *
 * A truncated tree means some files were never read, so "no secrets
 * found" is a weaker statement than it appears. That is a warning rather
 * than a failure: the project is not at fault, the analysis is partial.
 * Silently reporting `pass` here would be the dishonest option.
 */
function coverageSection(report: Report): ContractSection {
  const partial = report.limitations.some((l) => /truncat/i.test(l));
  const checks: ContractCheck[] = partial
    ? [
        {
          id: 'coverage.partial-tree',
          section: 'coverage',
          requirement: 'the whole repository tree was analysed',
          observed: 'the listing was truncated, so some files were not read',
          status: 'warn',
          ruleIds: [],
        },
      ]
    : [];
  return { id: 'coverage', status: statusOf(checks), checks };
}

export function evaluateQualityContract(
  report: Report,
  contract: QualityContract = DEFAULT_QUALITY_CONTRACT
): QualityContractResult {
  const findings = collectFindings(report);

  const sections: ContractSection[] = [
    securitySection(findings, contract),
    testingSection(findings, contract),
    ciSection(findings, contract),
    repositorySection(findings, contract),
    releaseSection(findings, contract),
    coverageSection(report),
  ];

  const allChecks = sections.flatMap((s) => s.checks);
  const failing = allChecks.filter((c) => c.status === 'fail');
  const warning = allChecks.filter((c) => c.status === 'warn');

  // Every finding behind a failing check, so re-audit can ask "are the
  // blockers gone?" by fingerprint rather than by re-deriving the rules.
  const blockingRuleIds = new Set(failing.flatMap((c) => c.ruleIds));
  const blockingFingerprints = [
    ...new Set(
      findings.filter((f) => blockingRuleIds.has(ruleIdOf(f))).map((f) => findingKey(f))
    ),
  ].sort();

  const blocked = failing.length > 0;

  return {
    schemaVersion: CONTRACT_VERSION,
    status: blocked ? 'blocked' : warning.length > 0 ? 'pass_with_warnings' : 'pass',
    ship: !blocked,
    blockerCount: failing.length,
    warningCount: warning.length,
    sections,
    blockingFingerprints,
    evaluatedAt: new Date().toISOString(),
  };
}
