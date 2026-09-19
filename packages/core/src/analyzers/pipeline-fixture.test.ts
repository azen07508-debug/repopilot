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
import { detectStack, stackLabels } from '../analyzers/stack.js';
import { analyzeDocumentation } from '../analyzers/documentation.js';
import { analyzeReproducibility } from '../analyzers/reproducibility.js';
import { analyzeHackathon } from '../analyzers/hackathon.js';
import { analyzeWeb3 } from '../analyzers/web3.js';
import { scanForSecrets, toSecretFindings } from '../security/secret-scanner.js';
import type { ScoringInput } from '../scoring/score.js';
import { detectPromptInjection, injectionFindingsToReport } from '../security/injection.js';
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

function hasFile(entries: FileEntry[], re: RegExp): boolean {
  return entries.some((e) => re.test(e.path));
}

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

    const docs = analyzeDocumentation(fetched.entries, fetched.contents);
    const repro = analyzeReproducibility(fetched.entries, fetched.contents);
    const web3 = analyzeWeb3(fetched.entries, fetched.contents);
    const hackathon = analyzeHackathon(
      fetched.entries,
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

    const findings = [
      ...docs.findings,
      ...repro.findings,
      ...hackathon.findings,
      ...web3.findings,
      ...toSecretFindings(secretDrafts),
      ...injectionFindingsToReport(injection),
    ];

    // Derive scoring input from the fixture contents
    const scoringInput: ScoringInput = {
      hasReadme: hasFile(fetched.entries, /(^|\/)README(\.md)?$/i),
      hasLicense: hasFile(fetched.entries, /(^|\/)(LICENSE|LICENSE\.md|LICENSE\.txt|COPYING)$/i),
      hasContributing: hasFile(fetched.entries, /(^|\/)CONTRIBUTING(\.md)?$/i),
      hasSecurityPolicy: hasFile(fetched.entries, /(^|\/)(SECURITY|SECURITY\.md)$/i),
      hasEnvExample: hasFile(fetched.entries, /(^|\/)\.env\.example$/i),
      hasApiDocs: hasFile(fetched.entries, /\/(api|openapi|swagger)/i),
      hasScreenshots: hasFile(fetched.entries, /\.(png|jpe?g|gif|webp|svg)$/i),
      hasDemoUrl: false,
      hasLockfile: hasFile(fetched.entries, /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/),
      hasCI: hasFile(fetched.entries, /\.github\/(workflows|actions)/),
      hasDocker: hasFile(fetched.entries, /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/i),
      hasTestCommand: false,
      hasRunCommand: false,
      hasContracts: web3.findings.some((f) => /contract/i.test(f.title)),
      hasDeployScripts: web3.findings.some((f) => /deploy/i.test(f.title)),
      hasContractTests: web3.findings.some((f) => /test/i.test(f.title)),
      hasAuditNote: false,
      hasContractAddresses: web3.contractAddresses.length > 0,
      hasHackathonDemoUrl: hackathon.findings.some((f) => /demo url/i.test(f.title)),
      hasHackathonDemoVideo: hackathon.findings.some((f) => /video/i.test(f.title)),
      hasHackathonArchitecture: hackathon.findings.some((f) => /architecture/i.test(f.title)),
      hasHackathonLicense: hasFile(fetched.entries, /(^|\/)(LICENSE|LICENSE\.md)$/i),
      hasHackathonNetwork: web3.chains.length > 0,
      documentationFindings: docs.findings,
      reproducibilityFindings: repro.findings,
      securityFindings: toSecretFindings(secretDrafts),
      web3Findings: web3.findings,
      hackathonFindings: hackathon.findings,
      deploymentFindings: [
        ...repro.findings,
        ...web3.findings,
        ...hackathon.findings,
      ],
    };

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
    expect(parsed.reportVersion).toBe('1.0');
    // complete-project is well set up; should be at least passable
    expect(parsed.scores.overall).toBeGreaterThan(50);
    // Every finding has evidence
    for (const f of parsed.documentationGaps) expect(f.evidence.length).toBeGreaterThan(0);
    for (const f of parsed.securityFindings) expect(f.evidence.length).toBeGreaterThan(0);
  });
});
