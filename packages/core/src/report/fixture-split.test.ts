import { describe, expect, it } from 'vitest';
import type { RepoMetadata } from '../analyzers/metadata.js';
import type { FileEntry } from '../git/files.js';
import { ReportBuilder } from './builder.js';

const metadata: RepoMetadata = {
  owner: 'okx',
  name: 'repopilot',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: '2026-01-01T00:00:00Z',
  visibility: 'public',
  archived: false,
  stars: 0,
  openIssues: 0,
  openPulls: 0,
  description: null,
  primaryLanguage: null,
  url: 'https://github.com/okx/repopilot',
};

function build(entries: FileEntry[], contents: Record<string, string>) {
  return new ReportBuilder().build({
    metadata,
    entries,
    contents: new Map(Object.entries(contents)),
    truncated: false,
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    includeLaunchCopy: false,
  }).report;
}

// Assembled at runtime so the literal never appears whole in source.
const FAKE_KEY = 'AKIA' + 'Z3XJ7QW2PLK9MNV4';

describe('fixture findings are separated, not dropped', () => {
  it('files a credential found in a test file under fixtureFindings', () => {
    const report = build(
      [{ path: 'tests/a.test.ts', size: 100 }],
      { 'tests/a.test.ts': `const k = "${FAKE_KEY}";` }
    );
    expect(report.fixtureFindings.length).toBeGreaterThan(0);
    expect(report.fixtureFindings.some((f) => f.id.startsWith('secret-'))).toBe(true);
    // ...and it is NOT in the main report.
    expect(report.securityFindings.some((f) => f.id.startsWith('secret-'))).toBe(false);
  });

  it('keeps a credential in ordinary source in the main report', () => {
    const report = build(
      [{ path: 'src/config.ts', size: 100 }],
      { 'src/config.ts': `const k = "${FAKE_KEY}";` }
    );
    expect(report.securityFindings.some((f) => f.id.startsWith('secret-'))).toBe(true);
  });

  it('keeps a README gap in the main report, not in fixtures', () => {
    // Regression: treating documents as fixtures filed this under
    // "not important" because its evidence file is README.md.
    const report = build([{ path: 'src/index.ts', size: 50 }], { 'src/index.ts': 'x' });
    expect(report.documentationGaps.some((f) => f.id === 'doc-readme')).toBe(true);
    expect(report.fixtureFindings.some((f) => f.id === 'doc-readme')).toBe(false);
  });

  it('keeps a LICENSE gap in the main report', () => {
    const report = build([{ path: 'src/index.ts', size: 50 }], { 'src/index.ts': 'x' });
    expect(report.documentationGaps.some((f) => f.id === 'doc-license')).toBe(true);
  });

  it('files an AI-pattern hit in a test file under fixtureFindings', () => {
    const report = build(
      [{ path: 'src/x.test.ts', size: 100 }],
      { 'src/x.test.ts': 'try { y(); } catch (e) {}\n' }
    );
    expect(report.fixtureFindings.some((f) => (f.ruleId ?? '') === 'AI-CATCH-001')).toBe(true);
    expect(report.qualityFindings.some((f) => (f.ruleId ?? '') === 'AI-CATCH-001')).toBe(false);
  });

  it('never loses a finding: everything lands somewhere', () => {
    const report = build(
      [{ path: 'tests/a.test.ts', size: 100 }],
      { 'tests/a.test.ts': `const k = "${FAKE_KEY}";` }
    );
    const total =
      report.blockers.length +
      report.documentationGaps.length +
      report.securityFindings.length +
      report.qualityFindings.length +
      report.fixtureFindings.length;
    expect(total).toBeGreaterThan(0);
  });

  it('reports no fixtures for a repository with none', () => {
    const report = build(
      [{ path: 'src/index.ts', size: 50 }],
      { 'src/index.ts': 'export const x = 1;' }
    );
    expect(report.fixtureFindings).toEqual([]);
    expect(report.fixtureSummary).toEqual([]);
  });
});

describe('the fixture summary describes the fixture list', () => {
  it('summarises what was filed, losing nothing', () => {
    const report = build(
      [
        { path: 'tests/a.test.ts', size: 100 },
        { path: 'tests/b.test.ts', size: 100 },
      ],
      {
        'tests/a.test.ts': `const k = "${FAKE_KEY}";`,
        'tests/b.test.ts': `const k = "${FAKE_KEY}";`,
      }
    );

    expect(report.fixtureFindings.length).toBeGreaterThan(0);
    const summed = report.fixtureSummary.reduce((n, g) => n + g.count, 0);
    expect(summed).toBe(report.fixtureFindings.length);
    // One group per (file, rule) pair, so a two-file scan is two groups
    // even though both files trip the same rule.
    expect(new Set(report.fixtureSummary.map((g) => g.file)).size).toBe(2);
  });

  it('collapses a file that trips the same rule over and over', () => {
    // The shape that motivated the summary: many hits, one file, one
    // rule. Thirty AWS-shaped keys rather than thirty high-entropy
    // strings, because the explicit patterns are what fire reliably —
    // the entropy heuristic wants H >= 4.0 and a repeated filler string
    // does not reach it.
    //
    // `AKIA` plus exactly sixteen characters: the pattern is anchored on
    // a word boundary, so a longer tail stops matching altogether.
    //
    // Asserted on the secret group rather than on the whole summary,
    // because thirty near-identical assignments also trip the
    // duplication rule — which is the point of a summary: the reader
    // gets one row per rule instead of one row per hit.
    const key = (n: number) => `AKIA${n.toString(36).toUpperCase().padStart(4, 'Q')}Z3XJ7QW2PLK9`;
    const lines = Array.from(
      { length: 30 },
      (_, i) => `const k${i} = "${key(i + 1)}";`
    ).join('\n');
    const report = build([{ path: 'tests/big.test.ts', size: lines.length }], {
      'tests/big.test.ts': lines,
    });

    const secrets = report.fixtureSummary.find((g) => g.ruleId === 'SEC-SECRET-001');
    expect(secrets?.file).toBe('tests/big.test.ts');
    expect(secrets?.count).toBe(30);
    // The line list is capped, so the group stays readable even though
    // all thirty lines are distinct.
    expect(secrets?.lines.length).toBeLessThan(30);
    expect(report.fixtureSummary.length).toBeLessThan(report.fixtureFindings.length);
  });

  it('is empty when there are no fixtures, rather than absent', () => {
    const report = build([{ path: 'src/index.ts', size: 50 }], { 'src/index.ts': 'x' });
    expect(report.fixtureSummary).toEqual([]);
  });
});
