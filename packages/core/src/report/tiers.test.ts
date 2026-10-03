/**
 * The tier declaration, and the property the tiers are sold on.
 *
 * R-30 was found because three places described a difference in *analysis*
 * that the code did not implement, and nothing compared them. These tests
 * are the comparison. The one that matters most is "both tiers measure the
 * same thing": it is the claim the product rests on — two buyers looking at
 * the same commit must be able to compare their scores — and it is the
 * claim that was false in spirit, because the report said otherwise.
 */
import { describe, it, expect } from 'vitest';
import { ReportBuilder } from './builder.js';
import {
  FULL_ONLY_SECTIONS,
  omittedSections,
  tierLimitations,
  type FullOnlySection,
} from './tiers.js';
import type { RepoMetadata } from '../analyzers/metadata.js';
import type { FileEntry } from '../git/files.js';
import type { Report } from '../schemas/report.js';

const metadata: RepoMetadata = {
  owner: 'okx',
  name: 'repopilot',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: '2026-01-01T00:00:00Z',
  visibility: 'public',
  archived: false,
  stars: 12,
  openIssues: 0,
  openPulls: 0,
  description: 'Test repo',
  primaryLanguage: 'TypeScript',
  url: 'https://github.com/okx/repopilot',
};

/**
 * A repository with something for every analyzer to say, so a difference
 * between the tiers would have somewhere to show up. A clean repo would
 * make the "identical scores" test pass for the wrong reason.
 */
function fixture(): { entries: FileEntry[]; contents: Map<string, string> } {
  const entries: FileEntry[] = [
    { path: 'README.md', size: 40 },
    { path: 'Dockerfile', size: 60 },
    { path: 'package.json', size: 80 },
    { path: 'src/index.ts', size: 30 },
  ];
  const contents = new Map<string, string>([
    ['README.md', '# Title\nNo install or test section here.\n'],
    ['Dockerfile', 'FROM node:20\nCMD ["node", "dist/index.js"]\n'],
    ['package.json', JSON.stringify({ name: 'r', scripts: { dev: 'node' } })],
    ['src/index.ts', 'export const x = 1;\n'],
  ]);
  return { entries, contents };
}

function build(mode: 'quick' | 'full', includeLaunchCopy: boolean): Report {
  const { entries, contents } = fixture();
  return new ReportBuilder().build({
    metadata,
    entries,
    contents,
    truncated: false,
    auditMode: mode,
    target: 'open_source',
    outputLanguage: 'en',
    includeLaunchCopy,
  }).report;
}

describe('omittedSections', () => {
  it('omits nothing for a full audit that includes the launch copy', () => {
    expect(omittedSections({ mode: 'full', includeLaunchCopy: true })).toEqual([]);
  });

  it('omits both full-only sections for a quick audit', () => {
    expect(omittedSections({ mode: 'quick', includeLaunchCopy: true })).toEqual([
      'deploymentPlan',
      'launchCopy',
    ]);
  });

  it('lets the full tier decline the launch copy and say so', () => {
    expect(omittedSections({ mode: 'full', includeLaunchCopy: false })).toEqual(['launchCopy']);
  });

  it('omits both for a quick audit whatever the launch-copy flag says', () => {
    // The flag's scope is the full tier. If it could add launch copy to a
    // quick audit, it would be a second way to choose a tier, and the two
    // would eventually disagree.
    expect(omittedSections({ mode: 'quick', includeLaunchCopy: false })).toEqual(
      omittedSections({ mode: 'quick', includeLaunchCopy: true })
    );
  });
});

describe('tierLimitations is generated from the declaration', () => {
  it('says nothing when nothing is omitted', () => {
    expect(tierLimitations({ mode: 'full', includeLaunchCopy: true })).toEqual([]);
  });

  it('names every omitted section', () => {
    const lines = tierLimitations({ mode: 'quick', includeLaunchCopy: true });
    expect(lines).toHaveLength(1);
    for (const section of FULL_ONLY_SECTIONS) {
      expect(lines[0]).toContain(section);
    }
  });

  it('describes a full audit that declined the copy without blaming the tier', () => {
    const lines = tierLimitations({ mode: 'full', includeLaunchCopy: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('launchCopy');
    // "Quick audits omit this" would be true and misleading here.
    expect(lines[0]).not.toContain('quick');
  });
});

describe('a tier changes what the report carries, not what it measured', () => {
  it('produces identical scores in both tiers', () => {
    const quick = build('quick', true);
    const full = build('full', true);

    expect(quick.scores).toEqual(full.scores);
    expect(quick.scores.overall).toBe(full.scores.overall);
  });

  it('produces identical findings in both tiers', () => {
    const quick = build('quick', true);
    const full = build('full', true);

    // Every finding list, because "the score is the same" would still hold
    // if a tier quietly dropped the findings the score is computed from.
    expect(quick.blockers).toEqual(full.blockers);
    expect(quick.documentationGaps).toEqual(full.documentationGaps);
    expect(quick.securityFindings).toEqual(full.securityFindings);
    expect(quick.qualityFindings).toEqual(full.qualityFindings);
    expect(quick.fixtureFindings).toEqual(full.fixtureFindings);
    expect(quick.recommendedTasks).toEqual(full.recommendedTasks);
    expect(quick.launchChecklist).toEqual(full.launchChecklist);
    expect(quick.detectedStack).toEqual(full.detectedStack);
    expect(quick.historyScan).toEqual(full.historyScan);
  });

  it('carries the launch materials in full and not in quick', () => {
    const quick = build('quick', true);
    const full = build('full', true);

    expect(full.omittedSections).toEqual([]);
    expect(full.deploymentPlan.length).toBeGreaterThan(0);
    expect(full.launchCopy.oneSentencePitch.length).toBeGreaterThan(0);

    expect(quick.omittedSections).toEqual(['deploymentPlan', 'launchCopy']);
    expect(quick.deploymentPlan).toEqual([]);
    expect(quick.launchCopy.oneSentencePitch).toBe('');
  });

  it('never claims an analysis was thinned', () => {
    // The sentence this replaced: "Quick scan skips some of the deeper
    // reproducibility heuristics." Nothing was skipped. No test pinned it,
    // so it survived until R-30.
    for (const mode of ['quick', 'full'] as const) {
      for (const line of build(mode, true).limitations) {
        expect(line).not.toMatch(/skip|deeper|thinner/i);
      }
    }
  });
});

describe('the declaration cannot disagree with the report it describes', () => {
  /** Read a named section off a report, for the consistency check. */
  function sectionOf(report: Report, name: FullOnlySection): unknown {
    return report[name];
  }

  function isEmpty(section: unknown): boolean {
    if (Array.isArray(section)) return section.length === 0;
    if (section !== null && typeof section === 'object') {
      return Object.values(section as Record<string, unknown>).every((v) => v === '');
    }
    return false;
  }

  it('every declared omission is actually empty, in every tier', () => {
    for (const mode of ['quick', 'full'] as const) {
      for (const includeLaunchCopy of [true, false]) {
        const report = build(mode, includeLaunchCopy);
        for (const name of report.omittedSections as FullOnlySection[]) {
          expect(
            isEmpty(sectionOf(report, name)),
            `${mode}/${includeLaunchCopy} declares ${name} omitted but it is not empty`
          ).toBe(true);
        }
      }
    }
  });

  it('every section that is empty is declared, in every tier', () => {
    // The other direction, and the one that catches a section quietly
    // emptied without being declared — which is how `launchCopy` was
    // represented before this batch: empty strings, undeclared.
    for (const mode of ['quick', 'full'] as const) {
      for (const includeLaunchCopy of [true, false]) {
        const report = build(mode, includeLaunchCopy);
        const declared = new Set<string>(report.omittedSections);
        for (const name of FULL_ONLY_SECTIONS) {
          if (isEmpty(sectionOf(report, name))) {
            expect(
              declared.has(name),
              `${mode}/${includeLaunchCopy} has an empty ${name} but does not declare it`
            ).toBe(true);
          }
        }
      }
    }
  });
});
