/**
 * Comparing a report written by an older build against a fresh one.
 *
 * 1.1 added `ruleId` and `fingerprint` to every finding while keeping 1.0
 * parseable, so an audit stored before the bump still loads. Loading is
 * only half of it: the diff has to be able to line an old finding up with
 * its new self. If the two sides key findings differently, the first
 * comparison after an upgrade reads as "everything fixed, everything
 * brand new" — the most alarming thing a re-audit can say, and the least
 * likely to be true.
 *
 * The scenario is reachable: `ReportSchema` accepts 1.0 on purpose, and
 * reports are stored, so a base audit written by an older build is a
 * normal input to `GET /audits/:jobId/diff`.
 */
import { describe, it, expect } from 'vitest';
import { makeFinding, makeReport } from '../test-utils/report-factory.js';
import { enrichFinding } from '../findings/enrich.js';
import { diffReports } from './reports.js';
import type { Finding } from '../schemas/report.js';

/** A finding as a 1.1 build writes it: enriched, so it has an identity. */
function currentFinding(id: string, file: string, line: number): Finding {
  return enrichFinding(
    makeFinding({ id, evidence: [{ file, line, reason: 'a key sits here' }] })
  );
}

/**
 * The same finding as a 1.0 build wrote it.
 *
 * 1.0 had no `ruleId` and no `fingerprint`; the slug in `id` was the only
 * name a finding had. `source` did not exist either — it was added in 1.1
 * alongside the rest, and enrichment fills it.
 */
function legacyFinding(id: string, file: string, line: number): Finding {
  const { ruleId, fingerprint, confidence, verification, ...rest } = currentFinding(id, file, line);
  return {
    ...rest,
    evidence: rest.evidence.map(({ source, ...e }) => e),
  } as Finding;
}

const SAME_ID = 'doc-license';

describe('diffReports across a report version boundary', () => {
  it('reads an unchanged finding as persistent, not as fixed plus brand new', () => {
    const before = makeReport({
      reportVersion: '1.0',
      documentationGaps: [legacyFinding(SAME_ID, 'LICENSE', 1)],
    });
    const after = makeReport({
      reportVersion: '1.1',
      documentationGaps: [currentFinding(SAME_ID, 'LICENSE', 1)],
    });

    const diff = diffReports(before, after);

    expect(diff.resolved).toEqual([]);
    expect(diff.new).toEqual([]);
    expect(diff.persistent).toHaveLength(1);
  });

  it('still reports a legacy finding that is genuinely gone', () => {
    const before = makeReport({
      reportVersion: '1.0',
      documentationGaps: [legacyFinding(SAME_ID, 'LICENSE', 1)],
    });
    const after = makeReport({ reportVersion: '1.1', documentationGaps: [] });

    const diff = diffReports(before, after);

    expect(diff.resolved).toHaveLength(1);
    expect(diff.new).toEqual([]);
  });

  it('still reports a finding that only the new audit found', () => {
    const before = makeReport({ reportVersion: '1.0', documentationGaps: [] });
    const after = makeReport({
      reportVersion: '1.1',
      documentationGaps: [currentFinding(SAME_ID, 'LICENSE', 1)],
    });

    const diff = diffReports(before, after);

    expect(diff.resolved).toEqual([]);
    expect(diff.new).toHaveLength(1);
  });

  it('does not treat a legacy finding at a different line as the same one', () => {
    const before = makeReport({
      reportVersion: '1.0',
      documentationGaps: [legacyFinding(SAME_ID, 'LICENSE', 1)],
    });
    const after = makeReport({
      reportVersion: '1.1',
      documentationGaps: [currentFinding(SAME_ID, 'LICENSE', 40)],
    });

    const diff = diffReports(before, after);

    expect(diff.persistent).toEqual([]);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.new).toHaveLength(1);
  });

  it('still names a move across the boundary, instead of splitting it in two', () => {
    // `moved` groups candidates by rule and file. Grouping on the raw
    // `ruleId` field puts a legacy finding (slug only) and its modern twin
    // (public id) in different groups, so the one annotation that explains
    // "this shifted" goes quiet exactly when the two sides disagree about
    // what to call the rule.
    const before = makeReport({
      reportVersion: '1.0',
      documentationGaps: [legacyFinding(SAME_ID, 'LICENSE', 1)],
    });
    const after = makeReport({
      reportVersion: '1.1',
      documentationGaps: [currentFinding(SAME_ID, 'LICENSE', 12)],
    });

    const diff = diffReports(before, after);

    expect(diff.moved).toEqual([
      { ruleId: 'REPO-LICENSE-001', file: 'LICENSE', fromLine: 1, toLine: 12 },
    ]);
  });
});
