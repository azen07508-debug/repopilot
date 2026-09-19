/**
 * Report builder — orchestrates every analyzer, computes scores, builds the
 * launch copy, and returns a `Report` that is fully Zod-validatable.
 *
 * This module is the only place where `Report` is constructed. Everything
 * downstream consumes the validated output.
 */
import type { RepoMetadata } from '../analyzers/metadata.js';
import { analyzeDocumentation, type DocAnalysis } from '../analyzers/documentation.js';
import { analyzeReproducibility, type ReproAnalysis } from '../analyzers/reproducibility.js';
import { detectStack, stackLabels, type StackSignal } from '../analyzers/stack.js';
import { analyzeWeb3, type Web3Analysis } from '../analyzers/web3.js';
import { analyzeHackathon, type HackathonAnalysis } from '../analyzers/hackathon.js';
import { scanForSecrets, toSecretFindings } from '../security/secret-scanner.js';
import { detectPromptInjection, injectionFindingsToReport } from '../security/injection.js';
import { scoreAll, type ScoringInput } from '../scoring/score.js';
import type {
  DeploymentStep,
  Finding,
  LaunchChecklistItem,
  Report,
  Task,
} from '../schemas/report.js';
import type { FileEntry } from '../git/files.js';
import type { LLMProvider } from '../llm/provider.js';
import { templateLaunchCopy, templateSummary } from '../llm/templates.js';
import { REPORT_VERSION } from '../utils/constants.js';

export interface ReportBuilderInput {
  metadata: RepoMetadata;
  entries: FileEntry[];
  contents: Map<string, string>;
  truncated: boolean;
  auditMode: 'quick' | 'full';
  target: 'hackathon' | 'open_source' | 'production';
  outputLanguage: 'en' | 'zh-CN';
  includeLaunchCopy: boolean;
  llm?: LLMProvider;
}

export interface ReportBuilderResult {
  report: Report;
  truncated: boolean;
}

export class ReportBuilder {
  build(input: ReportBuilderInput): ReportBuilderResult {
    const stackSignals = detectStack(input.entries, input.contents);
    const labels = stackLabels(stackSignals);
    const doc = analyzeDocumentation(input.entries, input.contents);
    const repro = analyzeReproducibility(input.entries, input.contents);
    const web3 = analyzeWeb3(input.entries, input.contents);
    const hackathon = analyzeHackathon(input.entries, input.contents, web3.chains, web3.contractAddresses);
    const secretDrafts = scanForSecrets(
      [...input.contents.entries()].map(([p, c]) => ({ path: p, content: c }))
    );
    const secretFindings = toSecretFindings(secretDrafts);
    const injectionFindings = injectionFindingsToReport(
      detectPromptInjection(
        [...input.contents.entries()].map(([p, c]) => ({ path: p, content: c }))
      )
    );

    // Categorize findings.
    const documentationGaps = doc.findings;
    const securityFindings = [...secretFindings, ...injectionFindings];
    const deploymentFindings = [
      ...repro.findings.filter((f) =>
        ['repro-no-ci', 'repro-no-docker', 'repro-no-env-example', 'repro-no-test-script', 'repro-no-run-script', 'repro-no-scripts'].includes(
          f.id
        )
      ),
      ...web3.findings.filter((f) => f.id.startsWith('web3-')),
    ];
    const reproFindings = repro.findings.filter(
      (f) => !deploymentFindings.some((d) => d.id === f.id)
    );

    const blockers = collectBlockers(
      doc.findings,
      repro.findings,
      securityFindings,
      deploymentFindings,
      web3.findings,
      hackathon.findings
    );

    const scoring: ScoringInput = {
      hasReadme: doc.hasReadme,
      hasLicense: doc.hasLicense,
      hasContributing: doc.hasContributing,
      hasSecurityPolicy: doc.hasSecurityPolicy,
      hasEnvExample: doc.hasEnvExample,
      hasApiDocs: doc.hasApiDocs,
      hasScreenshots: doc.hasScreenshots,
      hasDemoUrl: doc.hasDemoUrl,
      hasLockfile: repro.hasLockfile,
      hasCI: repro.hasCI,
      hasDocker: repro.hasDocker,
      hasTestCommand: repro.hasTestCommand,
      hasRunCommand: repro.hasRunCommand,
      hasContracts: web3.hasContracts,
      hasDeployScripts: web3.hasDeployScripts,
      hasContractTests: web3.hasContractTests,
      hasAuditNote: web3.hasAuditNote,
      hasContractAddresses: web3.hasContractAddresses,
      hasHackathonDemoUrl: hackathon.hasDemoUrl,
      hasHackathonDemoVideo: hackathon.hasDemoVideo,
      hasHackathonArchitecture: hackathon.hasArchitecture,
      hasHackathonLicense: hackathon.hasLicense,
      hasHackathonNetwork: hackathon.hasNetwork,
      securityFindings,
      documentationFindings: documentationGaps,
      reproducibilityFindings: reproFindings,
      deploymentFindings,
      web3Findings: web3.findings,
      hackathonFindings: hackathon.findings,
    };

    const scores = scoreAll(scoring, { target: input.target });

    const recommendedTasks = buildRecommendedTasks(blockers, web3, hackathon, input.auditMode);
    const deploymentPlan = buildDeploymentPlan(input.auditMode, hasAny(input.contents, /dockerfile|docker-compose/i));
    const launchChecklist = buildLaunchChecklist(
      doc,
      repro,
      web3,
      hackathon,
      secretFindings,
      blockers
    );

    const baseReport: Report = {
      reportVersion: REPORT_VERSION,
      repository: {
        url: input.metadata.url,
        owner: input.metadata.owner,
        name: input.metadata.name,
        defaultBranch: input.metadata.defaultBranch,
        license: input.metadata.license,
        lastUpdatedAt: input.metadata.lastUpdatedAt,
        visibility: 'public',
        archived: input.metadata.archived,
        stars: input.metadata.stars,
        openIssues: input.metadata.openIssues,
        openPulls: input.metadata.openPulls,
        description: input.metadata.description,
        primaryLanguage: input.metadata.primaryLanguage,
      },
      summary: '',
      detectedStack: labels,
      scores,
      blockers,
      documentationGaps,
      securityFindings,
      deploymentPlan,
      recommendedTasks,
      launchChecklist,
      launchCopy: { oneSentencePitch: '', shortDescription: '', xPost: '' },
      limitations: buildLimitations(input.truncated, input.auditMode, web3),
      generatedAt: new Date().toISOString(),
      auditMode: input.auditMode,
      target: input.target,
      outputLanguage: input.outputLanguage,
      analyzerProvenance: buildProvenance({
        doc,
        repro,
        web3,
        hackathon,
        stack: stackSignals,
      }),
    };

    // Resolve LLM-decorated fields.
    const summary = templateSummary(baseReport);
    const launchCopy = input.includeLaunchCopy
      ? templateLaunchCopy(baseReport)
      : { oneSentencePitch: '', shortDescription: '', xPost: '' };

    return {
      report: { ...baseReport, summary, launchCopy },
      truncated: input.truncated,
    };
  }
}

function buildProvenance(input: {
  doc: DocAnalysis;
  repro: ReproAnalysis;
  web3: Web3Analysis;
  hackathon: HackathonAnalysis;
  stack: StackSignal[];
}): Record<string, string> {
  return {
    'analyzers.documentation': 'static-file-presence + section-extraction',
    'analyzers.reproducibility': 'static-file-presence + package-scripts',
    'analyzers.secret': 'regex-patterns + entropy-heuristic',
    'analyzers.injection': 'keyword-matcher + invisible-unicode-detector',
    'analyzers.stack': 'filename + extension + manifest-keyword',
    'analyzers.web3': 'path-pattern + content-keyword',
    'analyzers.hackathon': 'readme-content + url-classifier',
    'analyzers.scoring': 'deterministic-rule-engine',
    'analyzers.llm': 'optional; disabled by default',
    'detectedStackKeys': input.stack.map((s) => `${s.key}:${s.confidence.toFixed(2)}`).join(','),
  };
}

function collectBlockers(
  doc: Finding[],
  repro: Finding[],
  sec: Finding[],
  deploy: Finding[],
  web3: Finding[],
  hack: Finding[]
): Finding[] {
  const all = [...doc, ...repro, ...sec, ...deploy, ...web3, ...hack];
  return all
    .filter((f) => f.severity === 'critical' || f.severity === 'high')
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .slice(0, 25);
}

function severityWeight(s: 'critical' | 'high' | 'medium' | 'low'): number {
  return s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function buildRecommendedTasks(
  blockers: Finding[],
  web3: Web3Analysis,
  hackathon: HackathonAnalysis,
  mode: 'quick' | 'full'
): Task[] {
  const out: Task[] = [];
  for (const f of blockers) {
    out.push({
      id: `task-${f.id}`,
      title: `Resolve: ${f.title}`,
      effort: f.severity === 'critical' ? 'L' : f.severity === 'high' ? 'M' : 'S',
      description: f.description,
      relatedFindings: [f.id],
      acceptanceCriteria: f.acceptanceCriteria.length
        ? f.acceptanceCriteria
        : [`Evidence for "${f.id}" no longer present in the repository tree.`],
    });
    if (out.length >= 12) break;
  }
  if (web3.hasContracts && !web3.hasContractTests) {
    out.push({
      id: 'task-add-contract-tests',
      title: 'Add Foundry or Hardhat contract tests',
      effort: 'L',
      description: 'Without contract tests, on-chain behavior is not verified.',
      relatedFindings: web3.findings.filter((f) => f.id === 'web3-no-contract-tests').map((f) => f.id),
      acceptanceCriteria: ['forge test (or npx hardhat test) exits 0.'],
    });
  }
  if (mode === 'full') {
    if (!hackathon.hasDemoUrl) {
      out.push({
        id: 'task-add-demo-url',
        title: 'Deploy a preview and link the demo URL in the README',
        effort: 'M',
        description: 'Add a reachable demo URL at the top of the README.',
        relatedFindings: ['hack-no-demo'],
        acceptanceCriteria: ['A live URL is reachable and returns 2xx.'],
      });
    }
  }
  return out;
}

function buildDeploymentPlan(mode: 'quick' | 'full', hasDocker: boolean): DeploymentStep[] {
  const steps: DeploymentStep[] = [
    {
      order: 1,
      title: 'Prepare environment',
      description: 'Create a `.env` from `.env.example` and confirm Node/pnpm versions match CI.',
      commands: ['cp .env.example .env'],
      prerequisites: ['Node 20+', 'pnpm 9+'],
      acceptanceCriteria: ['pnpm install completes without errors on a fresh clone.'],
    },
    {
      order: 2,
      title: 'Run the test suite',
      description: 'Run tests and lint to confirm the code is in a green state.',
      commands: ['pnpm install', 'pnpm test', 'pnpm lint'],
      prerequisites: ['.env populated'],
      acceptanceCriteria: ['All tests pass; lint exits 0.'],
    },
  ];
  if (hasDocker) {
    steps.push({
      order: 3,
      title: 'Build and run with Docker',
      description: 'Use the provided Dockerfile to build a production image.',
      commands: ['docker build -t repopilot-audited .', 'docker run --rm -p 3000:3000 repopilot-audited'],
      prerequisites: ['Docker installed'],
      acceptanceCriteria: ['Container starts and the healthcheck endpoint returns 200.'],
    });
  } else {
    steps.push({
      order: 3,
      title: 'Provision a production host',
      description:
        'Choose a host (Railway, Render, Fly.io, a plain VPS). Add a Dockerfile if you need production parity.',
      commands: [],
      prerequisites: ['A managed Postgres or a SQLite-backed volume'],
      acceptanceCriteria: ['Service responds on a public URL.'],
    });
  }
  if (mode === 'full') {
    steps.push({
      order: 4,
      title: 'Configure reverse proxy + TLS',
      description: 'Terminate TLS in front of the service. Caddy / nginx / Cloudflare all work.',
      commands: [],
      prerequisites: ['A domain name'],
      acceptanceCriteria: ['HTTPS works; HSTS header is set.'],
    });
    steps.push({
      order: 5,
      title: 'Set up observability',
      description: 'Wire logs, error tracking, and uptime checks.',
      commands: [],
      prerequisites: ['An observability account (e.g. Better Stack, Sentry, Grafana Cloud)'],
      acceptanceCriteria: ['A test request appears in the log stream.'],
    });
  }
  return steps;
}

function buildLaunchChecklist(
  doc: DocAnalysis,
  repro: ReproAnalysis,
  web3: Web3Analysis,
  hackathon: HackathonAnalysis,
  security: Finding[],
  blockers: Finding[]
): LaunchChecklistItem[] {
  const list: LaunchChecklistItem[] = [
    {
      id: 'check-readme',
      title: 'README explains install + run + test',
      done: doc.hasReadme,
      evidence: doc.hasReadme ? ['README.md present'] : ['README.md missing'],
    },
    {
      id: 'check-license',
      title: 'LICENSE present at the repository root',
      done: doc.hasLicense,
      evidence: doc.hasLicense ? ['LICENSE present'] : ['LICENSE missing'],
    },
    {
      id: 'check-env',
      title: '.env.example present and complete',
      done: doc.hasEnvExample,
      evidence: doc.hasEnvExample ? ['.env.example present'] : ['.env.example missing'],
    },
    {
      id: 'check-lockfile',
      title: 'Lockfile committed',
      done: repro.hasLockfile,
      evidence: repro.hasLockfile ? ['lockfile found'] : ['no lockfile found'],
    },
    {
      id: 'check-ci',
      title: 'CI runs install + test on every push',
      done: repro.hasCI,
      evidence: repro.hasCI ? ['.github/workflows/*.yml present'] : ['no CI config'],
    },
    {
      id: 'check-tests',
      title: 'Test script exits 0',
      done: repro.hasTestCommand,
      evidence: repro.hasTestCommand ? ['scripts.test defined'] : ['scripts.test missing'],
    },
    {
      id: 'check-secrets',
      title: 'No committed credentials',
      done: security.length === 0,
      evidence: security.length === 0 ? [] : security.map((s) => s.title),
    },
  ];
  if (web3.hasContracts) {
    list.push({
      id: 'check-contracts-tested',
      title: 'Contracts covered by tests (Foundry / Hardhat)',
      done: web3.hasContractTests,
      evidence: web3.hasContractTests ? ['contract tests found'] : ['no contract tests'],
    });
  }
  if (hackathon.hasScreenshots !== undefined) {
    list.push({
      id: 'check-screenshots',
      title: 'At least one screenshot or diagram',
      done: hackathon.hasScreenshots,
      evidence: hackathon.hasScreenshots ? ['image files in repo'] : ['no image files in repo'],
    });
  }
  list.push({
    id: 'check-blockers',
    title: 'Zero critical/high blockers',
    done: blockers.length === 0,
    evidence: blockers.length === 0 ? [] : blockers.map((b) => b.title),
  });
  return list;
}

function buildLimitations(
  truncated: boolean,
  mode: 'quick' | 'full',
  web3: Web3Analysis
): string[] {
  const out: string[] = [
    'Static analysis only — repository code is NEVER executed by RepoPilot.',
    'No formal security audit is performed; secret detection is best-effort.',
    'LLM is optional; without one, the report uses deterministic templates.',
  ];
  if (truncated) {
    out.push('The repository tree is large; the listing was truncated. Some files were not analyzed.');
  }
  if (mode === 'quick') {
    out.push('Quick scan skips some of the deeper reproducibility heuristics.');
  }
  if (web3.hasContracts) {
    out.push('Web3 analyzer checks engineering completeness only; it does NOT audit contract code.');
  }
  return out;
}

function hasAny(contents: Map<string, string>, re: RegExp): boolean {
  for (const k of contents.keys()) {
    if (re.test(k)) return true;
  }
  return false;
}
