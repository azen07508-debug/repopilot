/**
 * Deterministic template tests. No LLM is involved in any of these.
 */
import { describe, it, expect } from 'vitest';
import { deriveTestPath, renderAgentInstructions, templateFixPlan } from './template.js';
import type { FixPlanTemplateInput } from './template.js';
import { makeFinding } from '../test-utils/report-factory.js';

const repository = { owner: 'octocat', name: 'Hello-World', url: 'https://github.com/octocat/Hello-World' };

function input(overrides: Partial<FixPlanTemplateInput> = {}): FixPlanTemplateInput {
  return {
    finding: makeFinding({
      id: 'repro-no-test-script',
      category: 'reproducibility',
      severity: 'high',
      recommendedAction: 'Add a test script to package.json.',
      acceptanceCriteria: ['pnpm test exits 0.'],
      evidence: [{ file: 'package.json', line: 8, reason: 'scripts.test is missing' }],
    }),
    repository,
    commitSha: 'abc1234',
    primaryLanguage: 'TypeScript',
    ...overrides,
  };
}

describe('templateFixPlan', () => {
  it('produces deterministic why, steps, criteria and risks', () => {
    const template = templateFixPlan(input());
    expect(template.why).toContain('Test finding');
    expect(template.steps[0]?.action).toBe('Add a test script to package.json.');
    expect(template.steps[0]?.target).toBe('package.json');
    expect(template.acceptanceCriteria).toEqual(['pnpm test exits 0.']);
    expect(template.risks[0]).toContain('Build and CI configuration');
  });

  it('derives a test path from the evidence file', () => {
    expect(templateFixPlan(input()).testsToAdd).toEqual(['tests/repro/package.test.ts']);
  });

  it('falls back to a generic criterion when the finding has none', () => {
    const template = templateFixPlan(
      input({ finding: makeFinding({ id: 'doc-changelog', acceptanceCriteria: [] }) })
    );
    expect(template.acceptanceCriteria[0]).toContain('doc-changelog');
  });

  it('uses the category-specific risk wording', () => {
    const securityRisk = templateFixPlan(
      input({ finding: makeFinding({ id: 'sec-1', category: 'security' }) })
    ).risks[0];
    const docRisk = templateFixPlan(
      input({ finding: makeFinding({ id: 'doc-1', category: 'documentation' }) })
    ).risks[0];
    expect(securityRisk).toContain('Security-sensitive');
    expect(docRisk).toContain('Documentation-only');
  });

  it('truncates an overlong why instead of emitting a paragraph', () => {
    const long = 'x'.repeat(600);
    const template = templateFixPlan(
      input({ finding: makeFinding({ id: 'long', description: long }) })
    );
    expect(template.why.length).toBeLessThanOrEqual(260);
  });
});

describe('deriveTestPath', () => {
  it('returns null when there is no evidence file', () => {
    expect(deriveTestPath(makeFinding({ evidence: [{ file: '', line: null, reason: 'x' }] }), 'TypeScript')).toBeNull();
  });

  it('adapts to the primary language', () => {
    const finding = makeFinding({
      category: 'reproducibility',
      evidence: [{ file: 'src/main.py', line: 1, reason: 'x' }],
    });
    expect(deriveTestPath(finding, 'Python')).toBe('tests/repro/test_main.py');
    expect(deriveTestPath(finding, 'TypeScript')).toBe('tests/repro/main.test.ts');
  });

  it('uses the foundry layout for Solidity', () => {
    const finding = makeFinding({
      category: 'web3',
      evidence: [{ file: 'contracts/Vault.sol', line: 1, reason: 'x' }],
    });
    expect(deriveTestPath(finding, 'Solidity')).toBe('test/Vault.t.sol');
  });
});

describe('renderAgentInstructions', () => {
  it('renders all eight sections in order', () => {
    const template = templateFixPlan(input());
    const text = renderAgentInstructions({
      repository,
      commitSha: 'abc1234',
      finding: input().finding,
      template,
    });
    const order = ['Repository:', 'Commit:', 'Finding:', 'Evidence:', 'Objective:', 'Steps:', 'Constraints:', 'Acceptance Criteria:'];
    let cursor = -1;
    for (const section of order) {
      const at = text.indexOf(section);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('renders evidence as file:line with its reason', () => {
    const template = templateFixPlan(input());
    const text = renderAgentInstructions({
      repository,
      commitSha: 'abc1234',
      finding: input().finding,
      template,
    });
    expect(text).toContain('package.json:8 — scripts.test is missing');
  });

  it('lists the constraints an agent must respect', () => {
    const template = templateFixPlan(input());
    const text = renderAgentInstructions({
      repository,
      commitSha: 'abc1234',
      finding: input().finding,
      template,
    });
    expect(text).toContain('Do not modify files unrelated to this finding.');
    expect(text).toContain('Add or update tests that cover the change.');
    expect(text).toContain('do not run scripts from the audited repository');
  });
});
