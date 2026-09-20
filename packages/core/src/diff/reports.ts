/**
 * Report diffing.
 *
 * Pure function: two `Report` documents in, an `AuditDiff` out. No
 * analyzer runs, no repository is fetched, no pipeline is invoked.
 *
 * The useful property: because `ScoreBreakdown` records every applied
 * rule with its delta and reason, a score change can be attributed rule
 * by rule. `ruleDeltas` answers "why did the score move" without asking
 * an LLM to guess.
 */
import type { Report } from '../schemas/report.js';
import type {
  AuditDiff,
  AuditRef,
  DimensionDeltas,
  RuleDelta,
  ScoreDimension,
} from '../schemas/audit-diff.js';
import { SCORE_DIMENSIONS } from '../schemas/audit-diff.js';
import { collectFixableFindings } from '../fixplan/builder.js';

export interface DiffOptions {
  baseJobId?: string | null;
  headJobId?: string | null;
  baseCommitSha?: string | null;
  headCommitSha?: string | null;
  /**
   * Score changes inside this band count as unchanged.
   *
   * Defaults to 0 because scores are already rounded to one decimal
   * place, so floating-point noise is absorbed before the comparison.
   */
  epsilon?: number;
}

const DEFAULT_EPSILON = 0;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toRef(report: Report, jobId: string | null, commitSha: string | null): AuditRef {
  return {
    jobId,
    commitSha,
    generatedAt: report.generatedAt,
    overall: report.scores.overall,
  };
}

/**
 * Compare the applied scoring rules of two reports, dimension by
 * dimension. A rule that did not fire in one report contributes 0 there,
 * so a rule disappearing from the breakdown shows up as a real delta.
 */
export function computeRuleDeltas(before: Report, after: Report): RuleDelta[] {
  const out: RuleDelta[] = [];

  for (const dimension of SCORE_DIMENSIONS) {
    const beforeRules = new Map(
      (before.scores.breakdown[dimension]?.rules ?? []).map((r) => [r.rule, r])
    );
    const afterRules = new Map(
      (after.scores.breakdown[dimension]?.rules ?? []).map((r) => [r.rule, r])
    );
    const names = new Set<string>([...beforeRules.keys(), ...afterRules.keys()]);

    for (const rule of [...names].sort()) {
      const b = beforeRules.get(rule);
      const a = afterRules.get(rule);
      const beforeDelta = b?.delta ?? 0;
      const afterDelta = a?.delta ?? 0;
      const delta = round1(afterDelta - beforeDelta);
      if (delta === 0) continue;
      out.push({
        rule,
        dimension,
        before: beforeDelta,
        after: afterDelta,
        delta,
        reason: a?.reason ?? b?.reason ?? '',
      });
    }
  }

  return out.sort((x, y) => {
    const byMagnitude = Math.abs(y.delta) - Math.abs(x.delta);
    return byMagnitude !== 0 ? byMagnitude : x.rule.localeCompare(y.rule);
  });
}

function findingIds(report: Report): string[] {
  return collectFixableFindings(report)
    .map((f) => f.id)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Diff two reports of the same repository.
 *
 * Finding classification is a plain set operation on `finding.id`:
 *   base ∩ head = persistent, base - head = resolved, head - base = new.
 */
export function diffReports(before: Report, after: Report, opts: DiffOptions = {}): AuditDiff {
  const epsilon = opts.epsilon ?? DEFAULT_EPSILON;

  const scoreDelta = round1(after.scores.overall - before.scores.overall);

  const dimensionDeltas: DimensionDeltas = {
    documentation: round1(after.scores.documentation - before.scores.documentation),
    reproducibility: round1(after.scores.reproducibility - before.scores.reproducibility),
    securityHygiene: round1(after.scores.securityHygiene - before.scores.securityHygiene),
    deploymentReadiness: round1(
      after.scores.deploymentReadiness - before.scores.deploymentReadiness
    ),
  };

  const beforeIds = new Set(findingIds(before));
  const afterIds = new Set(findingIds(after));

  const resolved = [...beforeIds].filter((id) => !afterIds.has(id)).sort((a, b) => a.localeCompare(b));
  const fresh = [...afterIds].filter((id) => !beforeIds.has(id)).sort((a, b) => a.localeCompare(b));
  const persistent = [...afterIds].filter((id) => beforeIds.has(id)).sort((a, b) => a.localeCompare(b));

  const verdict =
    scoreDelta > epsilon ? 'improved' : scoreDelta < -epsilon ? 'regressed' : 'unchanged';

  return {
    schemaVersion: '1.0',
    base: toRef(before, opts.baseJobId ?? null, opts.baseCommitSha ?? null),
    head: toRef(after, opts.headJobId ?? null, opts.headCommitSha ?? null),
    scoreDelta,
    dimensionDeltas,
    ruleDeltas: computeRuleDeltas(before, after),
    resolved,
    new: fresh,
    persistent,
    verdict,
  };
}
