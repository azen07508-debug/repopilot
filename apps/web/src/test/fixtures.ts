/**
 * Schema-valid fixtures for the web tests.
 *
 * Types come from `../lib/api.js` and are **type-only** imports, matching the
 * rule `lib/api.ts` documents: `@repopilot/core` depends on `@octokit/rest`,
 * which must never reach the browser bundle. Importing the real
 * `test-utils/report-factory` would pull core (and octokit) into the test
 * runtime and, worse, would let a test pass while the browser bundle's own
 * type surface drifted.
 *
 * Values mirror `packages/core/src/test-utils/report-factory.ts` so a fixture
 * here is the same report a core test would build.
 */
import type { Capabilities, Finding, Report } from '../lib/api.js';

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
      overall: 43.5,
      documentation: 40,
      reproducibility: 50,
      securityHygiene: 45,
      deploymentReadiness: 39,
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
    // Mirror of the core factory's default: this is a `quick` report with no
    // deployment plan and no launch copy, so it declares both omitted.
    // `omittedSections` is the only way to tell "the tier does not include
    // one" from "this repository has none".
    omittedSections: ['deploymentPlan', 'launchCopy'],
    launchCopy: { oneSentencePitch: '', shortDescription: '', xPost: '' },
    limitations: [],
    generatedAt: '2026-01-01T00:00:00Z',
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    analyzerProvenance: {},
  };

  return {
    ...base,
    // Derived, like the core factory: asking for a `full` report should not
    // also require remembering to clear the list.
    omittedSections:
      (overrides.auditMode ?? base.auditMode) === 'full'
        ? []
        : ['deploymentPlan', 'launchCopy'],
    ...overrides,
  };
}

export function makeCapabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    name: 'RepoPilot',
    // Deliberately not a real release string: a fixture that names the current
    // version is a second copy of it, and it goes stale on every bump.
    version: '0.0.0-fixture',
    inputs: {
      repoUrl: 'string',
      mode: 'quick | full',
      target: 'hackathon | open_source | production',
      outputLanguage: 'en | zh-CN',
    },
    outputs: { report: 'Report' },
    limits: { maxFiles: 400, maxFileBytes: 262144, maxTotalBytes: 20971520, rateLimitPerMinute: 30 },
    pricing: {
      audit: { amount: '1', currency: 'USDT' },
    },
    paymentMode: 'mock',
    ...overrides,
  };
}
