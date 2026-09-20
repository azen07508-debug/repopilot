/**
 * Deterministic fix-plan templates.
 *
 * These produce the full plan text with no LLM involved. When an LLM
 * provider is configured it may only rewrite the `why` sentence; steps,
 * tests, acceptance criteria and risks always come from here so the plan
 * stays reproducible and auditable.
 */
import type { Finding } from '../schemas/report.js';
import type { FixStep } from '../schemas/fix-plan.js';

export interface FixPlanTemplateInput {
  finding: Finding;
  repository: { owner: string; name: string; url: string };
  commitSha: string | null;
  primaryLanguage: string | null;
}

export interface FixPlanTemplate {
  why: string;
  steps: FixStep[];
  testsToAdd: string[];
  acceptanceCriteria: string[];
  risks: string[];
}

const CATEGORY_RISK: Record<Finding['category'], string> = {
  documentation: 'Documentation-only change; verify that referenced paths still exist after the edit.',
  reproducibility: 'Build and CI configuration is shared; a wrong change breaks every environment at once.',
  security: 'Security-sensitive surface; a partial fix can leave the original exposure in place.',
  deployment: 'Deployment steps are order-dependent; validate in a staging environment first.',
  web3: 'On-chain behaviour is irreversible; prefer an additive change over a migration.',
  hackathon: 'Submission metadata is read by judges; keep the wording factual.',
  meta: 'Low-risk change; still confirm the reported evidence no longer applies.',
};

const CATEGORY_TEST_HINT: Record<Finding['category'], string> = {
  documentation: 'docs',
  reproducibility: 'repro',
  security: 'security',
  deployment: 'deploy',
  web3: 'contracts',
  hackathon: 'submission',
  meta: 'general',
};

function firstSentence(text: string, maxLength = 240): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return boundary > 60 ? `${cut.slice(0, boundary + 1)}` : `${cut}...`;
}

/** Derive a plausible test file path from the first evidence file. */
export function deriveTestPath(finding: Finding, primaryLanguage: string | null): string | null {
  const source = finding.evidence[0]?.file;
  if (!source) return null;
  const segments = source.split('/');
  const base = segments[segments.length - 1] ?? '';
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  if (!stem) return null;
  const ext = primaryLanguage === 'Python' ? 'py' : primaryLanguage === 'Solidity' ? 'sol' : 'ts';
  const area = CATEGORY_TEST_HINT[finding.category];
  return ext === 'sol'
    ? `test/${stem}.t.${ext}`
    : ext === 'py'
      ? `tests/${area}/test_${stem}.py`
      : `tests/${area}/${stem}.test.${ext}`;
}

/**
 * Build the deterministic parts of a fix plan.
 *
 * Never throws: a finding always carries evidence (D-008), and every
 * optional input degrades to a sensible default.
 */
export function templateFixPlan(input: FixPlanTemplateInput): FixPlanTemplate {
  const { finding, primaryLanguage } = input;

  const why = firstSentence(
    `${finding.title}. ${finding.description}`.trim()
  );

  const primaryTarget = finding.evidence[0]?.file ?? null;

  const steps: FixStep[] = [];
  steps.push({
    order: 1,
    action: finding.recommendedAction,
    target: primaryTarget,
  });
  if (finding.acceptanceCriteria.length > 0) {
    finding.acceptanceCriteria.forEach((criterion, index) => {
      steps.push({ order: index + 2, action: criterion, target: primaryTarget });
    });
  } else {
    steps.push({
      order: 2,
      action: `Confirm the evidence at ${primaryTarget ?? 'the affected files'} no longer applies.`,
      target: primaryTarget,
    });
  }

  const derivedTest = deriveTestPath(finding, primaryLanguage);
  const testsToAdd = derivedTest ? [derivedTest] : [];

  const acceptanceCriteria = finding.acceptanceCriteria.length
    ? [...finding.acceptanceCriteria]
    : [`The finding "${finding.id}" no longer appears in a fresh RepoPilot audit.`];

  const risks = [CATEGORY_RISK[finding.category]];

  return { why, steps, testsToAdd, acceptanceCriteria, risks };
}

export interface AgentInstructionsInput {
  repository: { owner: string; name: string; url: string };
  commitSha: string | null;
  finding: Finding;
  template: FixPlanTemplate;
}

/**
 * Render instructions that can be handed directly to a coding agent
 * (Codex, Claude Code, OpenCode).
 *
 * Fixed eight-section layout: Repository / Commit / Finding / Evidence /
 * Objective / Steps / Constraints / Acceptance Criteria.
 */
export function renderAgentInstructions(input: AgentInstructionsInput): string {
  const { repository, commitSha, finding, template } = input;
  const lines: string[] = [];

  lines.push('Repository:');
  lines.push(`  ${repository.owner}/${repository.name}`);
  lines.push(`  ${repository.url}`);
  lines.push('');

  lines.push('Commit:');
  lines.push(`  ${commitSha ?? 'unknown (resolve the current HEAD before editing)'}`);
  lines.push('');

  lines.push('Finding:');
  lines.push(`  [${finding.severity}] ${finding.title}`);
  lines.push(`  id: ${finding.id}`);
  lines.push(`  category: ${finding.category}`);
  lines.push('');

  lines.push('Evidence:');
  for (const e of finding.evidence) {
    lines.push(`  - ${e.file}${e.line ? `:${e.line}` : ''} — ${e.reason}`);
  }
  lines.push('');

  lines.push('Objective:');
  lines.push(`  ${template.why}`);
  lines.push('');

  lines.push('Steps:');
  for (const step of template.steps) {
    lines.push(`  ${step.order}. ${step.action}${step.target ? ` (${step.target})` : ''}`);
  }
  if (template.testsToAdd.length > 0) {
    for (const test of template.testsToAdd) {
      lines.push(`  ${template.steps.length + 1}. Add a test at ${test}`);
    }
  }
  lines.push('');

  lines.push('Constraints:');
  lines.push('  - Do not modify files unrelated to this finding.');
  lines.push('  - Preserve the existing architecture and public interfaces.');
  lines.push('  - Add or update tests that cover the change.');
  lines.push('  - Explain every file you changed and why.');
  lines.push('  - Static analysis only: do not run scripts from the audited repository.');
  lines.push('');

  lines.push('Acceptance Criteria:');
  for (const criterion of template.acceptanceCriteria) {
    lines.push(`  - ${criterion}`);
  }
  for (const risk of template.risks) {
    lines.push(`  - Watch out: ${risk}`);
  }

  return lines.join('\n');
}
