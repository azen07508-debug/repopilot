/**
 * Fix Plan builder.
 *
 * Pure functions: `Report` in, `FixPlan` / `FixPlanSet` out. Nothing in
 * this file reads the network, touches the filesystem, or runs an
 * analyzer. The plan is a derivation of findings that already exist.
 *
 * Determinism rules:
 *   - `priority` comes from severity (critical|high → P0, medium → P1, low → P2).
 *   - `estimatedEffort` comes from severity (critical → L, high → M, else S).
 *   - `evidence` is copied from the finding, never invented.
 *   - `steps` / `testsToAdd` / `acceptanceCriteria` / `risks` come from
 *     `templateFixPlan()`.
 *   - An LLM may only rewrite the `why` sentence, and only through the
 *     separate `polishFixPlanSet()` step.
 */
import type { Evidence, Finding, Report } from '../schemas/report.js';
import type { LLMProvider } from '../llm/provider.js';
import { effortForSeverity, planIdFor, priorityForSeverity } from '../schemas/fix-plan.js';
import type { FixPlan, FixPlanSet } from '../schemas/fix-plan.js';
import { renderAgentInstructions, templateFixPlan } from './template.js';

export interface FixPlanOptions {
  /** Commit the report was produced from. Unknown when deriving from a bare report. */
  commitSha?: string | null;
}

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Every fixable finding in a report, deduplicated by id.
 *
 * `blockers` is a severity-filtered subset of the other lists, so a plain
 * concatenation would produce duplicates.
 */
export function collectFixableFindings(report: Report): Finding[] {
  const byId = new Map<string, Finding>();
  for (const f of [
    ...report.blockers,
    ...report.documentationGaps,
    ...report.securityFindings,
  ]) {
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  return [...byId.values()].sort((a, b) => {
    const delta = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

/** Fallback used only when a caller passes a finding that violates D-008. */
function ensureEvidence(finding: Finding, report: Report): Evidence[] {
  if (finding.evidence.length > 0) return finding.evidence;
  return [
    {
      file: `${report.repository.owner}/${report.repository.name}`,
      line: null,
      reason: `Finding "${finding.id}" was reported without file-level evidence.`,
    },
  ];
}

/**
 * Build the fix plan for one finding.
 *
 * Returns null when the finding id is not present in the report, so a
 * caller can distinguish "no such finding" from "plan produced".
 */
export function buildFixPlan(
  report: Report,
  findingId: string,
  opts: FixPlanOptions = {}
): FixPlan | null {
  const finding = collectFixableFindings(report).find((f) => f.id === findingId);
  if (!finding) return null;

  const evidence = ensureEvidence(finding, report);
  const template = templateFixPlan({
    finding: { ...finding, evidence },
    repository: {
      owner: report.repository.owner,
      name: report.repository.name,
      url: report.repository.url,
    },
    commitSha: opts.commitSha ?? null,
    primaryLanguage: report.repository.primaryLanguage,
  });

  const agentInstructions = renderAgentInstructions({
    repository: {
      owner: report.repository.owner,
      name: report.repository.name,
      url: report.repository.url,
    },
    commitSha: opts.commitSha ?? null,
    finding: { ...finding, evidence },
    template,
  });

  return {
    schemaVersion: '1.0',
    planId: planIdFor(finding.id),
    findingId: finding.id,
    priority: priorityForSeverity(finding.severity),
    status: 'open',
    title: finding.title,
    why: template.why,
    evidence,
    steps: template.steps,
    testsToAdd: template.testsToAdd,
    acceptanceCriteria: template.acceptanceCriteria,
    estimatedEffort: effortForSeverity(finding.severity),
    risks: template.risks,
    agentInstructions,
    llmEnhanced: false,
  };
}

/**
 * Hard ceiling on generated plans.
 *
 * A report can legitimately carry hundreds of findings; an agent API that
 * returns one plan per finding is unusable at that scale. A real run
 * produced 554 plans, 500 of them from integrity hashes in a single
 * lockfile.
 */
export const MAX_FIX_PLANS = 20;

/**
 * The findings worth a fix plan, in the order they should be worked on.
 *
 * `collectFixableFindings` answers "every finding this report has" and is
 * what the report diff uses, where completeness is the point. This
 * answers a different question — "what should someone do next" — and is
 * grouped and capped.
 *
 * The order of operations matters. Deduplicate and sort BEFORE capping,
 * or the cap keeps whichever twenty happened to come first.
 */
export function selectFixPlanCandidates(report: Report): Finding[] {
  const groups = new Map<string, Finding>();

  for (const finding of collectFixableFindings(report)) {
    const key = fixPlanGroupKey(finding);
    const existing = groups.get(key);
    // Keep the most severe representative of each group.
    if (!existing || SEVERITY_WEIGHT[finding.severity] > SEVERITY_WEIGHT[existing.severity]) {
      groups.set(key, finding);
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      const delta = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    })
    .slice(0, MAX_FIX_PLANS);
}

/**
 * Two findings share a key when they describe the same problem in the
 * same place: same rule, same file.
 *
 * Five hundred integrity hashes in one lockfile are one thing to fix, not
 * five hundred. The file is part of the key so a genuine second location
 * still gets its own plan.
 */
export function fixPlanGroupKey(finding: Finding): string {
  return `${finding.ruleId ?? finding.id}::${finding.evidence[0]?.file ?? '?'}`;
}

/** Build every fix plan for a report, ordered by priority then severity. */
export function buildFixPlanSet(report: Report, opts: FixPlanOptions = {}): FixPlanSet {
  const plans: FixPlan[] = [];
  for (const finding of selectFixPlanCandidates(report)) {
    const plan = buildFixPlan(report, finding.id, opts);
    if (plan) plans.push(plan);
  }
  return {
    schemaVersion: '1.0',
    repository: {
      owner: report.repository.owner,
      name: report.repository.name,
      url: report.repository.url,
      commitSha: opts.commitSha ?? null,
    },
    generatedAt: new Date().toISOString(),
    reportVersion: report.reportVersion,
    plans,
  };
}

export interface PolishOptions {
  llm: LLMProvider;
  language?: 'en' | 'zh-CN';
}

/**
 * Optionally let an LLM rewrite the `why` sentence of each plan.
 *
 * This is the ONLY place an LLM touches a fix plan. Scores, priorities,
 * evidence, steps and acceptance criteria are never sent to it. If the
 * provider is not configured (the `NoopLLMProvider` default) or returns
 * null, the deterministic text is kept and `llmEnhanced` stays false.
 */
export async function polishFixPlanSet(
  set: FixPlanSet,
  report: Report,
  opts: PolishOptions
): Promise<FixPlanSet> {
  const { llm } = opts;
  if (!llm.isConfigured()) return set;

  const language = opts.language ?? report.outputLanguage;
  const plans: FixPlan[] = [];

  for (const plan of set.plans) {
    let why = plan.why;
    let enhanced = false;
    try {
      const polished = await llm.generate({
        report,
        task: 'polish',
        language,
        maxTokens: 120,
      });
      const text = polished?.trim();
      if (text) {
        why = text.slice(0, 400);
        enhanced = true;
      }
    } catch {
      // A failed polish must never break plan generation.
    }
    plans.push({ ...plan, why, llmEnhanced: enhanced });
  }

  return { ...set, plans };
}
