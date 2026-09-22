/**
 * Fix-plan coverage across every repository fixture.
 *
 * Fixtures are read from disk and run through the analyzers directly
 * (no network). The resulting reports drive both the fix-plan builder
 * and the diff engine, so a schema change in any analyzer shows up
 * here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { REPORT_VERSION } from '../utils/constants.js';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReportBuilder } from '../report/builder.js';
import { ReportSchema } from '../schemas/report.js';
import { FixPlanSchema } from '../schemas/fix-plan.js';
import { AuditDiffSchema } from '../schemas/audit-diff.js';
import { buildFixPlanSet } from './builder.js';
import { diffReports } from '../diff/reports.js';
import type { FileEntry } from '../git/files.js';
import type { RepoMetadata } from '../analyzers/metadata.js';
import type { Report } from '../schemas/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', '..', '..', '..', 'fixtures');

const FIXTURE_NAMES = [
  'complete-project',
  'minimal',
  'no-readme',
  'prompt-injection',
  'secret-leak',
  'web3-hackathon',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function loadFixtureContents(root: string): { entries: FileEntry[]; contents: Map<string, string> } {
  const entries: FileEntry[] = [];
  const contents = new Map<string, string>();

  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      const rel = relative(root, full);
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full);
      } else {
        entries.push({ path: rel, size: stat.size });
        if (stat.size < 200_000) {
          try {
            contents.set(rel, readFileSync(full, 'utf8'));
          } catch {
            /* binary, skip */
          }
        }
      }
    }
  }
  walk(root);
  return { entries, contents };
}

function metadataFor(name: string): RepoMetadata {
  return {
    url: `https://github.com/fixture/${name}`,
    owner: 'fixture',
    name,
    defaultBranch: 'main',
    license: 'MIT',
    lastUpdatedAt: '2026-01-01T00:00:00Z',
    visibility: 'public',
    archived: false,
    stars: 0,
    openIssues: 0,
    openPulls: 0,
    description: `Fixture: ${name}`,
    primaryLanguage: 'TypeScript',
  };
}

function buildReport(name: string): Report {
  const root = join(FIXTURES, name);
  const { entries, contents } = loadFixtureContents(root);
  const result = new ReportBuilder().build({
    metadata: metadataFor(name),
    entries,
    contents,
    truncated: false,
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    includeLaunchCopy: false,
  });
  return ReportSchema.parse(result.report);
}

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

describe('fix plans across all fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`derives valid plans for the ${name} fixture`, () => {
      const report = buildReport(name);
      expect(report.reportVersion).toBe(REPORT_VERSION);

      const set = buildFixPlanSet(report, { commitSha: 'fixture-sha' });
      expect(() => FixPlanSchema.array().parse(set.plans)).not.toThrow();

      for (const plan of set.plans) {
        expect(plan.evidence.length).toBeGreaterThan(0);
        expect(['P0', 'P1', 'P2']).toContain(plan.priority);
        expect(['S', 'M', 'L']).toContain(plan.estimatedEffort);
        expect(plan.status).toBe('open');
        expect(plan.llmEnhanced).toBe(false);
        for (const section of AGENT_SECTIONS) {
          expect(plan.agentInstructions).toContain(section);
        }
      }
    });

    it(`diffs the ${name} fixture report against itself as unchanged`, () => {
      const report = buildReport(name);
      const diff = diffReports(report, report);
      expect(() => AuditDiffSchema.parse(diff)).not.toThrow();
      expect(diff.verdict).toBe('unchanged');
      expect(diff.scoreDelta).toBe(0);
      expect(diff.ruleDeltas).toEqual([]);
      expect(diff.new).toEqual([]);
      expect(diff.resolved).toEqual([]);
    });
  }

  it('covers every fixture directory that exists', () => {
    const present = readdirSync(FIXTURES).filter((name) =>
      statSync(join(FIXTURES, name)).isDirectory()
    );
    for (const name of present) {
      expect(FIXTURE_NAMES).toContain(name);
    }
    expect(present.length).toBeGreaterThanOrEqual(6);
  });
});

describe('schema boundaries', () => {
  const report = buildReport('no-readme');

  it('rejects a plan with no evidence', () => {
    const plan = buildFixPlanSet(report).plans[0];
    if (!plan) return;
    expect(FixPlanSchema.safeParse({ ...plan, evidence: [] }).success).toBe(false);
  });

  it('rejects a plan with an invalid priority', () => {
    const plan = buildFixPlanSet(report).plans[0];
    if (!plan) return;
    expect(FixPlanSchema.safeParse({ ...plan, priority: 'P9' }).success).toBe(false);
  });

  it('rejects a plan with no steps', () => {
    const plan = buildFixPlanSet(report).plans[0];
    if (!plan) return;
    expect(FixPlanSchema.safeParse({ ...plan, steps: [] }).success).toBe(false);
  });

  it('rejects an unknown verdict', () => {
    const diff = diffReports(report, report);
    expect(AuditDiffSchema.safeParse({ ...diff, verdict: 'sideways' }).success).toBe(false);
  });
});

describe('plans stay out of the report', () => {
  it('still parses a report that has no fix-plan fields', () => {
    const report = buildReport('minimal');
    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(Object.keys(report)).not.toContain('fixPlan');
    expect(() => ReportSchema.parse(report)).not.toThrow();
    expect(() => ReportSchema.parse({ ...report, fixPlan: undefined })).not.toThrow();
  });

  it('keeps every report field intact after plan derivation', () => {
    const before = buildReport('no-readme');
    buildFixPlanSet(before);
    const after = buildReport('no-readme');
    expect(after.scores).toEqual(before.scores);
    expect(after.documentationGaps).toEqual(before.documentationGaps);
    expect(after.reportVersion).toBe(REPORT_VERSION);
  });
});
