/**
 * Report factory for tests.
 *
 * Pure TypeScript: no filesystem, no network, no analyzer. Tests use
 * these helpers to build schema-valid reports without scanning anything.
 */
import type { Finding, Report } from '../schemas/report.js';
import { ReportSchema } from '../schemas/report.js';
import { summarizeFixtures } from '../report/fixtures.js';

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'test-finding',
    category: 'documentation',
    severity: 'high',
    title: 'Test finding',
    description: 'A finding used in tests.',
    evidence: [{ file: 'src/index.ts', line: 12, reason: 'evidence for the test finding' }],
    recommendedAction: 'Fix the test finding.',
    acceptanceCriteria: ['The finding no longer appears.'],
    ...overrides,
  };
}

export function makeReport(overrides: Partial<Report> = {}): Report {
  const base: Report = {
    reportVersion: '1.0',
    repository: {
      url: 'https://github.com/octocat/Hello-World',
      owner: 'octocat',
      name: 'Hello-World',
      defaultBranch: 'master',
      license: 'MIT',
      lastUpdatedAt: '2026-01-01T00:00:00Z',
      visibility: 'public',
      archived: false,
      stars: 10,
      openIssues: 1,
      openPulls: 2,
      description: 'Fixture report',
      primaryLanguage: 'TypeScript',
    },
    summary: 'A test report.',
    detectedStack: ['TypeScript'],
    scores: {
      overall: 60,
      documentation: 60,
      reproducibility: 60,
      securityHygiene: 60,
      deploymentReadiness: 60,
      breakdown: {},
    },
    blockers: [],
    documentationGaps: [],
    securityFindings: [],
    qualityFindings: [],
    fixtureFindings: [],
    fixtureSummary: [],
    deploymentPlan: [],
    recommendedTasks: [],
    launchChecklist: [],
    launchCopy: { oneSentencePitch: '', shortDescription: '', xPost: '' },
    limitations: [],
    generatedAt: '2026-01-01T00:00:00Z',
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    analyzerProvenance: {},
  };

  // Derived rather than defaulted, so a test cannot build a report whose
  // summary silently disagrees with its list by setting only one of the
  // two. An explicit `fixtureSummary` override still wins, for the test
  // that needs them to disagree.
  return ReportSchema.parse({
    ...base,
    fixtureSummary: summarizeFixtures(overrides.fixtureFindings ?? base.fixtureFindings),
    ...overrides,
  });
}

/** A report carrying the given findings as documentation gaps. */
export function reportWithFindings(findings: Finding[], overrides: Partial<Report> = {}): Report {
  return makeReport({ documentationGaps: findings, ...overrides });
}
