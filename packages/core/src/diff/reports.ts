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
import { findingKey, ruleIdOf } from '../findings/fingerprint.js';
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
 * `findingKey` prefers the stored fingerprint and derives it when absent,
 * so an audit stored by an older build lines up with a fresh one. See
 * version-boundary.test.ts for what that buys.
 */
function findingsByKey(report: Report): Map<string, Finding> {
  const out = new Map<string, Finding>();
  for (const f of collectFixableFindings(report)) {
    out.set(findingKey(f), f);
  }
  return out;
}

/**
 * How far a finding may move and still read as the same finding.
 *
 * Inserting an import block or a paragraph shifts everything below it,
 * and reporting that as one fix plus one brand-new problem is how a team
 * learns to distrust the report. A rewrite is a different event, so the
 * distance is capped rather than unbounded.
 */
export const MAX_MOVE_DISTANCE = 50;

/**
 * Same rule, same file — the pair of findings that could be one finding.
 *
 * Grouped on the resolved rule id, not the raw field: a 1.0 finding has
 * no `ruleId`, so grouping on it would put a legacy finding and its
 * modern twin in different groups and a move across a version boundary
 * would stop being named.
 */
function ruleFile(finding: Finding): string {
  return `${ruleIdOf(finding)}::${finding.evidence[0]?.file ?? ''}`;
}

/** The evidence line, or null when there is no line to compare. */
function lineOf(finding: Finding): number | null {
  return finding.evidence[0]?.line ?? null;
}

/**
 * The findings that have a line, in line order.
 *
 * Findings without a line cannot be measured, so they are dropped here
 * rather than special-cased at every use.
 */
function positioned(findings: Finding[]): Array<{ finding: Finding; line: number }> {
  return findings
    .map((finding) => ({ finding, line: lineOf(finding) }))
    .filter((entry): entry is { finding: Finding; line: number } => entry.line !== null)
    .sort((a, b) => a.line - b.line || a.finding.id.localeCompare(b.finding.id));
}

/**
 * Findings that kept their rule and their file but changed line.
 *
 * A moved finding shows up in both the resolved and the new set, so it is
 * matched across them.
 *
 * Matching is nearest-neighbour inside a (rule, file) group, not a map
 * lookup. Three secrets at lines 10/20/30 with an insert above them
 * produce three resolved and three new findings; keying a map on
 * rule+file collapses those to a single arbitrary pair and leaves the
 * other two reported as resolved and new — which is the bug this
 * replaces. Each finding is used at most once, nearest pair first. The
 * Hungarian algorithm would be overkill for a handful of lines.
 *
 * A finding with no line on either side is not a measurement, so it
 * never pairs and stays in resolved / new where it belongs.
 */
function computeMoved(
  resolved: string[],
  fresh: string[],
  before: Map<string, Finding>,
  after: Map<string, Finding>
): AuditDiff['moved'] {
  const groups = new Map<string, { from: Finding[]; to: Finding[] }>();
  const groupFor = (key: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { from: [], to: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const key of resolved) {
    const finding = before.get(key);
    if (finding) groupFor(ruleFile(finding)).from.push(finding);
  }
  for (const key of fresh) {
    const finding = after.get(key);
    if (finding) groupFor(ruleFile(finding)).to.push(finding);
  }

  const out: AuditDiff['moved'] = [];

  for (const group of groups.values()) {
    // Both sides in line order, so the candidates for one finding are a
    // contiguous window on the other side. Without the window, a file
    // carrying hundreds of hits from a single rule costs hundreds
    // squared.
    const froms = positioned(group.from);
    const tos = positioned(group.to);

    const candidates: Array<{
      from: Finding;
      to: Finding;
      fromLine: number;
      toLine: number;
      distance: number;
    }> = [];
    let windowStart = 0;
    for (const from of froms) {
      // `froms` is ascending, so the window start never moves backwards.
      while (windowStart < tos.length) {
        const head = tos[windowStart];
        if (!head || head.line >= from.line - MAX_MOVE_DISTANCE) break;
        windowStart += 1;
      }
      for (let i = windowStart; i < tos.length; i += 1) {
        const to = tos[i];
        if (!to) break;
        if (to.line > from.line + MAX_MOVE_DISTANCE) break;
        candidates.push({
          from: from.finding,
          to: to.finding,
          fromLine: from.line,
          toLine: to.line,
          distance: Math.abs(to.line - from.line),
        });
      }
    }

    // Nearest first, ties broken on line then id so the pairing does not
    // depend on the order the analyzers happened to emit findings in.
    candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        a.fromLine - b.fromLine ||
        a.toLine - b.toLine ||
        a.from.id.localeCompare(b.from.id) ||
        a.to.id.localeCompare(b.to.id)
    );

    const pairedFrom = new Set<Finding>();
    const pairedTo = new Set<Finding>();
    for (const candidate of candidates) {
      if (pairedFrom.has(candidate.from) || pairedTo.has(candidate.to)) continue;
      pairedFrom.add(candidate.from);
      pairedTo.add(candidate.to);
      out.push({
        ruleId: ruleIdOf(candidate.from),
        file: candidate.from.evidence[0]?.file ?? '',
        fromLine: candidate.fromLine,
        toLine: candidate.toLine,
      });
    }
  }

  return out.sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.file.localeCompare(b.file) ||
      (a.fromLine ?? 0) - (b.fromLine ?? 0)
  );
}

/**
 * Diff two reports of the same repository.
 *
 * Finding classification is a plain set operation on the comparison key
 * from `findingKey` — the stored fingerprint, or the derived one for
 * reports written before fingerprints existed:
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
