/**
 * End-to-end analyzer + report test using the complete-project fixture.
 *
 * Loads the fixture from disk, runs each analyzer directly, and verifies
 * the report is well-formed and contains evidence-backed findings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_VERSION } from '../utils/constants.js';
import { detectStack, stackLabels } from '../analyzers/stack.js';
import { analyzeDocumentation } from '../analyzers/documentation.js';
import { analyzeReproducibility } from '../analyzers/reproducibility.js';
import { analyzeHackathon } from '../analyzers/hackathon.js';
import { analyzeWeb3 } from '../analyzers/web3.js';
import { scanForSecrets } from '../security/secret-scanner.js';
import { detectPromptInjection } from '../security/injection.js';
import { ReportBuilder } from '../report/builder.js';
import { ReportSchema } from '../schemas/report.js';
import type { FileEntry } from '../git/files.js';
import type { FetchedRepo } from '../git/fetcher.js';
import type { RepoMetadata } from '../analyzers/metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'complete-project');

function loadFixture(): FetchedRepo {
  const entries: FileEntry[] = [];
  const contents = new Map<string, string>();
  let totalBytes = 0;
  const skipDirs = new Set(['node_modules', '.git', 'dist']);
  const skipFiles = new Set(['.DS_Store']);
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      if (skipFiles.has(name)) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      const rel = relative(FIXTURE, full);
      if (stat.isDirectory()) {
        if (skipDirs.has(name)) continue;
        walk(full);
      } else {
        entries.push({ path: rel, size: stat.size });
        if (stat.size < 200_000) {
          try {
            contents.set(rel, readFileSync(full, 'utf8'));
            totalBytes += stat.size;
          } catch {
            /* binary, skip */
          }
        }
      }
    }
  }
  walk(FIXTURE);
  return { entries, contents, totalBytes, truncated: false };
}

const repo: RepoMetadata = {
  url: 'https://github.com/fixture/complete-project',
  owner: 'fixture',
  name: 'complete-project',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: '2026-01-01T00:00:00Z',
  visibility: 'public',
  archived: false,
  stars: 0,
  openIssues: 0,
  openPulls: 0,
  description: 'Fixture: complete project',
  primaryLanguage: 'TypeScript',
};

describe('Pipeline on complete-project fixture', () => {
  it('runs all analyzers and produces a complete, evidence-backed report', () => {
    const fetched = loadFixture();
    expect(fetched.entries.length).toBeGreaterThan(0);
    expect(fetched.contents.has('README.md')).toBe(true);
    expect(fetched.contents.has('LICENSE')).toBe(true);
    expect(fetched.contents.has('package.json')).toBe(true);

    const stackSignals = detectStack(fetched.entries, fetched.contents);
    expect(stackSignals.length).toBeGreaterThan(0);
    const stack = stackLabels(stackSignals);

    const docs = analyzeDocumentation(
      fetched.entries.map((e) => e.path),
      fetched.contents
    );
    const repro = analyzeReproducibility(fetched.entries, fetched.contents);
    const web3 = analyzeWeb3(fetched.entries, fetched.contents);
    const hackathon = analyzeHackathon(
      fetched.entries.map((e) => e.path),
      fetched.contents,
      Array.from(web3.chains),
      Array.from(web3.contractAddresses)
    );
    const secretDrafts = scanForSecrets(
      Array.from(fetched.contents.entries()).map(([path, content]) => ({ path, content }))
    );
    const injection = detectPromptInjection(
      Array.from(fetched.contents.entries()).map(([path, content]) => ({ path, content }))
    );

    // The well-formed fixture should have no leaked secrets or prompt injection.
    expect(secretDrafts.length).toBe(0);
    expect(injection.length).toBe(0);

    // Assert on the analyzers' own outputs, not only on the report. This
    // file used to build a full `ScoringInput` here by hand — thirty-five
    // lines of predicates that nothing ever read. One of them asked
    // `filterFiles`' output whether a `.png` existed, which is the defect
    // that made the screenshot check unable to pass; the copy outlived the
    // fix because a second copy of a rule is not covered by fixing the
    // first. It is deleted rather than updated.
    expect(docs.hasReadme).toBe(true);
    expect(docs.hasLicense).toBe(true);
    expect(docs.hasEnvExample).toBe(true);
    expect(repro.hasCI).toBe(true);
    expect(repro.hasLockfile).toBe(false);
    expect(web3.hasContracts).toBe(false);
    // No images in this fixture, and asked of the whole tree rather than
    // the filtered set, so `false` here is an answer rather than a
    // foregone conclusion.
    expect(docs.hasScreenshots).toBe(false);
    expect(hackathon.hasScreenshots).toBe(false);

    const result = new ReportBuilder().build({
      metadata: repo,
      entries: fetched.entries,
      contents: fetched.contents,
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: true,
    });

    // Report must validate against schema
    const parsed = ReportSchema.parse(result.report);
    expect(parsed.reportVersion).toBe(REPORT_VERSION);
    // complete-project is well set up; should be at least passable
    expect(parsed.scores.overall).toBeGreaterThan(50);
    // Every finding has evidence
    for (const f of parsed.documentationGaps) expect(f.evidence.length).toBeGreaterThan(0);
    for (const f of parsed.securityFindings) expect(f.evidence.length).toBeGreaterThan(0);
  });
});
