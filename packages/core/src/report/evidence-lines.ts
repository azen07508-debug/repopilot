/**
 * Launch-checklist evidence, condensed to lines a person can read.
 *
 * A checklist row carries `evidence: string[]`. For the rows backed by a
 * boolean that is one hand-written phrase, and for two of them it was
 * not: `check-secrets` and `check-blockers` mapped every finding to its
 * title. On the self-audit that produced one line holding 639 titles,
 * which a terminal wraps into roughly forty rows and an agent reads as
 * noise. The row's own verdict — "no committed credentials: failed" —
 * was the only part that survived the wall it was buried in.
 *
 * The fix is not to truncate. Truncation drops the one detail that
 * matters: which file, and how many hits. Counting is what makes the row
 * actionable — `High-entropy string ×557 in pnpm-lock.yaml` says "one
 * file, one rule, go look at it", where 557 separate titles say nothing
 * and "and 557 more" says less.
 *
 * So evidence is folded by (file, rule) through the same grouping the
 * fixture summary uses, and capped. The cap is on *groups*, not findings,
 * and the remainder is reported as a count so a reader can always tell a
 * short list from a clipped one. This is the same contract as
 * `fixtureSummary`: a group's count is the truth, the list is a view.
 */
import type { FixtureGroup, Finding } from '../schemas/report.js';
import { groupFindings } from './fixtures.js';

/**
 * How many groups a checklist row lists before summarising the rest.
 *
 * Five is about where a single evidence line stops being scannable in a
 * terminal, and it is enough for the realistic case: a repository with
 * more than five distinct (file, rule) pairs behind one row has a
 * systemic problem, and the first five are severity-ordered, so they are
 * the ones worth naming. The tail is counted rather than dropped.
 */
export const MAX_EVIDENCE_GROUPS = 5;

function describe(group: FixtureGroup): string {
  const where = group.file ? ` in ${group.file}` : '';
  // `×1` is noise: a group of one is just the finding, and the reader
  // does not need a multiplication sign to see that.
  const times = group.count > 1 ? ` ×${group.count}` : '';
  return `${group.title}${times}${where}`;
}

/**
 * One evidence line per (file, rule) group, worst severity first.
 *
 * Returns `[]` for no findings, so a caller can use the result directly
 * as the `evidence` array of a passing row.
 */
export function condenseEvidence(
  findings: Finding[],
  max = MAX_EVIDENCE_GROUPS
): string[] {
  if (findings.length === 0) return [];

  const groups = groupFindings(findings);
  const lines = groups.slice(0, max).map(describe);

  const hidden = groups.slice(max);
  if (hidden.length > 0) {
    const hiddenFindings = hidden.reduce((sum, group) => sum + group.count, 0);
    // Both numbers: the count of groups says how much shape is missing,
    // the count of findings says how much volume. One without the other
    // reads as either "a few" or "a lot" and is wrong either way.
    lines.push(
      `+${hidden.length} more rule/file group${hidden.length === 1 ? '' : 's'} (${hiddenFindings} findings)`
    );
  }

  return lines;
}
