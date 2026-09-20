/**
 * Fix-plan builder tests.
 *
 * Everything here is derived from a hand-built Report. No fixture is
 * scanned and no analyzer runs.
 */
import { describe, it, expect } from 'vitest';
import { buildFixPlan, buildFixPlanSet, collectFixableFindings, polishFixPlanSet } from './builder.js';
import { FixPlanSchema, FixPlanSetSchema } from '../schemas/fix-plan.js';
import type { LLMProvider } from '../llm/provider.js';
import { NoopLLMProvider } from '../llm/noop-provider.js';
import { makeFinding, makeReport } from '../test-utils/report-factory.js';

const AGENT_SECTIONS = [
  'Repository:',
  'Commit:',
  'Finding:',
  'Evidence:',
  'Objective:',
  'Steps:',
  'Constraints:',
  'Acceptance Criteria:',
];

describe('buildFixPlan', () => {
  it('derives a plan from a single finding', () => {
    const report = makeReport({
      documentationGaps: [makeFinding({ id: 'doc-readme', severity: 'high' })],
    });
    const plan = buildFixPlan(report, 'doc-readme');

    expect(plan).not.toBeNull();
    expect(plan?.findingId).toBe('doc-readme');
    expect(plan?.priority).toBe('P0');
    expect(plan?.estimatedEffort).toBe('M');
    expect(plan?.status).toBe('open');
    expect(FixPlanSchema.parse(plan)).toBeTruthy();
  });

  it('maps severity to priority deterministically', () => {
    const report = makeReport({
      documentationGaps: [
        makeFinding({ id: 'f-critical', severity: 'critical' }),
        makeFinding({ id: 'f-high', severity: 'high' }),
        makeFinding({ id: 'f-medium', severity: 'medium' }),
        makeFinding({ id: 'f-low', severity: 'low' }),
      ],
    });
    expect(buildFixPlan(report, 'f-critical')?.priority).toBe('P0');
    expect(buildFixPlan(report, 'f-high')?.priority).toBe('P0');
    expect(buildFixPlan(report, 'f-medium')?.priority).toBe('P1');
    expect(buildFixPlan(report, 'f-low')?.priority).toBe('P2');
  });

  it('maps severity to effort deterministically', () => {
    const report = makeReport({
      securityFindings: [
        makeFinding({ id: 's-critical', severity: 'critical', category: 'security' }),
        makeFinding({ id: 's-high', severity: 'high', category: 'security' }),
        makeFinding({ id: 's-low', severity: 'low', category: 'security' }),
      ],
    });
    expect(buildFixPlan(report, 's-critical')?.estimatedEffort).toBe('L');
    expect(buildFixPlan(report, 's-high')?.estimatedEffort).toBe('M');
    expect(buildFixPlan(report, 's-low')?.estimatedEffort).toBe('S');
  });

  it('always carries at least one evidence entry copied from the finding', () => {
    const report = makeReport({
      blockers: [
        makeFinding({
          id: 'b-1',
          severity: 'critical',
          evidence: [
            { file: 'src/auth/login.ts', line: 82, reason: 'no tests cover this branch' },
            { file: 'src/auth/login.ts', line: 95, reason: 'token refresh untested' },
          ],
        }),
      ],
    });
    const plan = buildFixPlan(report, 'b-1');
    expect(plan?.evidence).toHaveLength(2);
    expect(plan?.evidence[0]?.file).toBe('src/auth/login.ts');
    expect(plan?.evidence[0]?.line).toBe(82);
  });

  it('returns null for an unknown finding id', () => {
    const report = makeReport({ documentationGaps: [makeFinding({ id: 'known' })] });
    expect(buildFixPlan(report, 'missing')).toBeNull();
  });

  it('renders agent instructions with every required section', () => {
    const report = makeReport({
      documentationGaps: [makeFinding({ id: 'doc-api', severity: 'medium' })],
    });
    const instructions = buildFixPlan(report, 'doc-api')?.agentInstructions ?? '';
    for (const section of AGENT_SECTIONS) {
      expect(instructions).toContain(section);
    }
    expect(instructions).toContain('octocat/Hello-World');
    expect(instructions).toContain('doc-api');
  });

  it('uses the supplied commit sha and falls back to unknown', () => {
    const report = makeReport({ documentationGaps: [makeFinding({ id: 'doc-api' })] });
    expect(buildFixPlan(report, 'doc-api', { commitSha: 'abc1234' })?.agentInstructions).toContain(
      'abc1234'
    );
    expect(buildFixPlan(report, 'doc-api')?.agentInstructions).toContain('unknown');
  });

  it('supplies default acceptance criteria when the finding has none', () => {
    const report = makeReport({
      documentationGaps: [makeFinding({ id: 'doc-coc', acceptanceCriteria: [] })],
    });
    const plan = buildFixPlan(report, 'doc-coc');
    expect(plan?.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(plan?.acceptanceCriteria.join(' ')).toContain('doc-coc');
  });
});

describe('collectFixableFindings', () => {
  it('deduplicates findings that appear in several lists', () => {
    const finding = makeFinding({ id: 'shared', severity: 'critical' });
    const report = makeReport({
      blockers: [finding],
      documentationGaps: [finding],
      securityFindings: [finding],
    });
    expect(collectFixableFindings(report)).toHaveLength(1);
  });
});

describe('buildFixPlanSet', () => {
  it('produces a schema-valid set ordered by severity', () => {
    const report = makeReport({
      documentationGaps: [
        makeFinding({ id: 'low-1', severity: 'low' }),
        makeFinding({ id: 'crit-1', severity: 'critical' }),
        makeFinding({ id: 'med-1', severity: 'medium' }),
      ],
    });
    const set = buildFixPlanSet(report, { commitSha: 'deadbeef' });
    expect(FixPlanSetSchema.parse(set)).toBeTruthy();
    expect(set.plans.map((p) => p.findingId)).toEqual(['crit-1', 'med-1', 'low-1']);
    expect(set.repository.commitSha).toBe('deadbeef');
    expect(set.reportVersion).toBe('1.0');
  });

  it('returns an empty plan list for a report with no findings', () => {
    const set = buildFixPlanSet(makeReport());
    expect(set.plans).toEqual([]);
    expect(FixPlanSetSchema.parse(set).plans).toEqual([]);
  });
});

describe('polishFixPlanSet', () => {
  const report = makeReport({ documentationGaps: [makeFinding({ id: 'doc-api' })] });

  it('keeps deterministic text with the noop provider', async () => {
    const set = buildFixPlanSet(report);
    const polished = await polishFixPlanSet(set, report, { llm: new NoopLLMProvider() });
    expect(polished.plans[0]?.llmEnhanced).toBe(false);
    expect(polished.plans[0]?.why).toBe(set.plans[0]?.why);
  });

  it('rewrites only the why sentence when a provider is configured', async () => {
    const polished1 = 'Polished by a provider: the docs are stale.';
    const provider: LLMProvider = {
      name: 'fake',
      isConfigured: () => true,
      generate: async () => polished1,
    };
    const set = buildFixPlanSet(report);
    const polished = await polishFixPlanSet(set, report, { llm: provider });

    expect(polished.plans[0]?.why).toBe(polished1);
    expect(polished.plans[0]?.llmEnhanced).toBe(true);
    // Everything else must be untouched.
    expect(polished.plans[0]?.priority).toBe(set.plans[0]?.priority);
    expect(polished.plans[0]?.evidence).toEqual(set.plans[0]?.evidence);
    expect(polished.plans[0]?.steps).toEqual(set.plans[0]?.steps);
  });

  it('falls back to the deterministic text when the provider throws', async () => {
    const provider: LLMProvider = {
      name: 'broken',
      isConfigured: () => true,
      generate: async () => {
        throw new Error('provider down');
      },
    };
    const set = buildFixPlanSet(report);
    const polished = await polishFixPlanSet(set, report, { llm: provider });
    expect(polished.plans[0]?.why).toBe(set.plans[0]?.why);
    expect(polished.plans[0]?.llmEnhanced).toBe(false);
  });

  it('never touches priority or evidence', async () => {
    const provider: LLMProvider = {
      name: 'fake',
      isConfigured: () => true,
      generate: async () => 'P0 override attempt',
    };
    const set = buildFixPlanSet(report);
    const polished = await polishFixPlanSet(set, report, { llm: provider });
    expect(polished.plans[0]?.priority).toBe(set.plans[0]?.priority);
    expect(polished.plans[0]?.estimatedEffort).toBe(set.plans[0]?.estimatedEffort);
  });
});
