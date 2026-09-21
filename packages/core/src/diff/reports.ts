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
import type { Finding, Report } from '../schemas/report.js';
import type {
  AuditDiff,
  AuditRef,
  DimensionDeltas,
  RuleDelta,
  ScoreDimension,
} from '../schemas/audit-diff.js';
import { SCORE_DIMENSIONS } from '../schemas/audit-diff.js';
import { findingKey } from '../findings/fingerprint.js';
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

/**
 * Findings keyed by their comparison identity.
 *
 * `findingKey` prefers the fingerprint and falls back to rule + location
 * for reports written before fingerprints existed, so an old audit can
 * still be compared against a new one.
 */
function findingsByKey(report: Report): Map<string, Finding> {
  const out = new Map<string, Finding>();
  for (const f of collectFixableFindings(report)) {
    out.set(findingKey(f), f);
  }
  return out;
}

/**
 * Findings that kept their rule and their file but changed line.
 *
 * A moved finding shows up in both the resolved and the new set, so it is
 * matched across them. Without this step, shifting a secret ten lines
 * down would read as one fix plus one brand-new problem — which is how a
 * team learns to distrust the report.
 */
function computeMoved(
  resolved: string[],
  fresh: string[],
  before: Map<string, Finding>,
  after: Map<string, Finding>
): AuditDiff['moved'] {
  const ruleFile = (f: Finding) => `${f.ruleId ?? f.id}::${f.evidence[0]?.file ?? ''}`;

  const freshByRuleFile = new Map<string, Finding>();
  for (const key of fresh) {
    const f = after.get(key);
    if (f) freshByRuleFile.set(ruleFile(f), f);
  }

  const out: AuditDiff['moved'] = [];
  for (const key of resolved) {
    const f = before.get(key);
    if (!f) continue;
    const other = freshByRuleFile.get(ruleFile(f));
    if (!other) continue;
    out.push({
      ruleId: f.ruleId ?? f.id,
      file: f.evidence[0]?.file ?? '',
      fromLine: f.evidence[0]?.line ?? null,
      toLine: other.evidence[0]?.line ?? null,
    });
  }

  return out.sort(
    (a, b) => a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file)
  );
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

  const beforeFindings = findingsByKey(before);
  const afterFindings = findingsByKey(after);

  const resolved = [...beforeFindings.keys()]
    .filter((k) => !afterFindings.has(k))
    .sort((a, b) => a.localeCompare(b));
  const fresh = [...afterFindings.keys()]
    .filter((k) => !beforeFindings.has(k))
    .sort((a, b) => a.localeCompare(b));
  const persistent = [...afterFindings.keys()]
    .filter((k) => beforeFindings.has(k))
    .sort((a, b) => a.localeCompare(b));

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
    moved: computeMoved(resolved, fresh, beforeFindings, afterFindings),
    verdict,
  };
}
