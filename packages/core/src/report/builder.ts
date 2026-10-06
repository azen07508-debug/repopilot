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
import { analyzeAiPatterns } from '../analyzers/ai-patterns.js';
import { analyzeHygiene } from '../analyzers/hygiene.js';
import { enrichFindings } from '../findings/enrich.js';
import { isFixturePath } from '../security/severity.js';
import { groupFindings } from './fixtures.js';
import { condenseEvidence } from './evidence-lines.js';
import { scanForSecrets, toSecretFindings } from '../security/secret-scanner.js';
import { detectPromptInjection, injectionFindingsToReport } from '../security/injection.js';
import { scoreAll, type ScoringInput } from '../scoring/score.js';
import type {
  DeploymentStep,
  Finding,
  HistoryScan,
  LaunchChecklistItem,
  Report,
  Task,
} from '../schemas/report.js';
import type { FileEntry } from '../git/files.js';
import { templateLaunchCopy, templateSummary } from './templates.js';
import { REPORT_VERSION } from '../utils/constants.js';
import { omittedSections, tierLimitations } from './tiers.js';

export interface ReportBuilderInput {
  metadata: RepoMetadata;
  entries: FileEntry[];
  /**
   * Every path in the tree, including the ones `filterFiles` dropped.
   *
   * `entries` is the filtered set: text files, under the size caps. That is
   * the right input for anything that reads content and the wrong input for
   * "does a file called X exist", because `filterFiles` removes binaries —
   * and a screenshot is a binary. Feeding existence checks the filtered set
   * is how the screenshot check became a question that could only ever be
   * answered "no".
   *
   * Defaults to `entries` when absent, so a caller that has no fuller list
   * still behaves as it did before.
   */
  allPaths?: string[];
  contents: Map<string, string>;
  truncated: boolean;
  auditMode: 'quick' | 'full';
  target: 'hackathon' | 'open_source' | 'production';
  outputLanguage: 'en' | 'zh-CN';
  includeLaunchCopy: boolean;
  /**
   * Findings from the commit-history scan. The pipeline owns that scan
   * because it needs network access; the builder only folds the results
   * into the security findings.
   */
  historyFindings?: Finding[];
  /** Scope of the history scan that produced those findings. */
  historyScan?: HistoryScan;
  /**
   * True when the content was read a file at a time because the tarball
   * could not be read (ADR D-017). The report is the same either way, so
   * this is stated in `limitations` rather than changing any finding: the
   * thing that degraded is how much of GitHub's request budget the audit
   * cost, not what it saw.
   */
  degraded?: boolean;
}

export interface ReportBuilderResult {
  report: Report;
  truncated: boolean;
}

export class ReportBuilder {
  build(input: ReportBuilderInput): ReportBuilderResult {
    const stackSignals = detectStack(input.entries, input.contents);
    const labels = stackLabels(stackSignals);
    // Existence checks get the unfiltered tree; content checks get
    // `contents`. See `ReportBuilderInput.allPaths`.
    const allPaths = input.allPaths ?? input.entries.map((e) => e.path);
    const doc = analyzeDocumentation(allPaths, input.contents);
    const repro = analyzeReproducibility(input.entries, input.contents);
    const web3 = analyzeWeb3(input.entries, input.contents);
    const hackathon = analyzeHackathon(
      allPaths,
      input.contents,
      web3.chains,
      web3.contractAddresses
    );
    const secretDrafts = scanForSecrets(
      [...input.contents.entries()].map(([p, c]) => ({ path: p, content: c }))
    );
    const secretFindings = toSecretFindings(secretDrafts);
    const hygiene = analyzeHygiene(input.entries, input.contents);
    const aiPatterns = analyzeAiPatterns(input.entries, input.contents);
    const injectionFindings = injectionFindingsToReport(
      detectPromptInjection(
        [...input.contents.entries()].map(([p, c]) => ({ path: p, content: c }))
      )
    );

    // Enrich once, at the source. Every downstream consumer — fix plans,
    // diffs, the quality contract, MCP — reads findings from here, so
    // this is the single place a finding acquires its ruleId, confidence,
    // verification and fingerprint.
    //
    // Every set is then split by where the finding lives. A finding in a
    // test file or a fixture is still real — it just does not get a vote
    // on the release by default. Dropping it would hide a genuine
    // credential committed into a test suite; leaving it in drowns the
    // report, which a real run demonstrated with 542 of them.
    //
    // Lockfiles and documents are handled one layer down, in
    // `severityForPath`, which downgrades rather than moves them. A
    // document is a poor fit for this split: a missing README is a real
    // repository gap whose evidence file happens to be `README.md`, and
    // filing that here would quietly drop it from the main report.
    const fixtureFindings: Finding[] = [];
    const split = (list: Finding[]): Finding[] =>
      list.filter((f) => {
        if (isFixturePath(f.evidence[0]?.file ?? '')) {
          fixtureFindings.push(f);
          return false;
        }
        return true;
      });

    const docFindings = split(enrichFindings(doc.findings));
    const allReproFindings = split(enrichFindings(repro.findings));
    const web3Findings = split(enrichFindings(web3.findings));
    const hackathonFindings = split(enrichFindings(hackathon.findings));
    const securityFindings = split(
      enrichFindings([
        ...secretFindings,
        ...injectionFindings,
        ...(input.historyFindings ?? []),
        ...hygiene.findings.filter((f) => f.category === 'security'),
      ])
    );
    // Code hygiene, not launch readiness: kept out of the score but still
    // visible to the quality contract.
    const qualityFindings = split(enrichFindings(aiPatterns.findings));

    // Categorize findings.
    const documentationGaps = docFindings;
    const deploymentFindings = [
      ...allReproFindings.filter((f) =>
        ['repro-no-ci', 'repro-no-docker', 'repro-no-env-example', 'repro-no-test-script', 'repro-no-run-script', 'repro-no-scripts'].includes(
          f.id
        )
      ),
      ...web3Findings.filter((f) => f.id.startsWith('web3-')),
    ];
    const reproFindings = [
      ...allReproFindings.filter((f) => !deploymentFindings.some((d) => d.id === f.id)),
      // The non-security hygiene rules (missing .gitignore, a workflow
      // that cannot run, no test runner) are reproducibility concerns.
      ...split(enrichFindings(hygiene.findings.filter((f) => f.category !== 'security'))),
    ];

    // Every split has run by now, so `fixtureFindings` is complete.
    // Grouped here rather than at render time because the web bundle
    // cannot call into core — see report/fixtures.ts.
    const fixtureSummary = groupFindings(fixtureFindings);

    const blockers = collectBlockers(
      docFindings,
      allReproFindings,
      securityFindings,
      deploymentFindings,
      web3Findings,
      hackathonFindings
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
      web3Findings,
      hackathonFindings,
    };

    const scores = scoreAll(scoring, { target: input.target });

    // The tier, resolved once. Both the report's `omittedSections` and its
    // prose about itself come from this one value, so they cannot disagree.
    const tier = { mode: input.auditMode, includeLaunchCopy: input.includeLaunchCopy };
    const omitted = omittedSections(tier);

    const recommendedTasks = buildRecommendedTasks(blockers, web3, hackathon);
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
      qualityFindings,
      fixtureFindings,
      fixtureSummary,
      historyScan: input.historyScan,
      deploymentPlan,
      recommendedTasks,
      launchChecklist,
      omittedSections: omitted,
      launchCopy: { oneSentencePitch: '', shortDescription: '', xPost: '' },
      limitations: buildLimitations(
        input.truncated,
        tier,
        web3,
        input.historyScan,
        input.degraded ?? false
      ),
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

    // Resolve the copy. Both come from the templates; there is no decorator
    // to apply first (R-38).
    const summary = templateSummary(baseReport);
    // Read the omission off the declaration rather than re-deriving it from
    // the two flags. One question, one answer.
    const launchCopy = omitted.includes('launchCopy')
      ? { oneSentencePitch: '', shortDescription: '', xPost: '' }
      : templateLaunchCopy(baseReport);

    return {
      report: { ...baseReport, summary, launchCopy },
      truncated: input.truncated,
    };
  }
}

/**
 * Which analyzer produced which part of the report.
 *
 * Every key here names an analyzer that ran. `'analyzers.llm'` used to be in
 * this map — `'optional; disabled by default'` — which was a claim about a
 * component rather than about an analyzer: no LLM analyzer has ever existed in
 * this repository, and the entry told every buyer of every report that one was
 * installed and switched off. It is gone, along with the rest of the unwired
 * LLM surface (R-38). Removing a key from a map that consumers read is a shape
 * change, so `REPORT_VERSION` moved to 1.3 with it.
 */
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
    'analyzers.hygiene': 'file-tree + gitignore-parse + workflow-shape',
    'analyzers.ai-patterns': 'regex + brace-balanced body inspection',
    'analyzers.scoring': 'deterministic-rule-engine',
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
  hackathon: HackathonAnalysis
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
  // Both tiers recommend this. It used to be `full`-only, which made the
  // recommended-task list a tier difference — it is not one: the tasks are
  // remediation for findings, and both tiers carry the findings.
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
  return out;
}

/**
 * The deployment plan — a `full`-tier section, so `quick` gets none.
 *
 * Returning `[]` rather than a shortened plan is the point: `omittedSections`
 * on the report says the plan was not included, and a reader that wants to
 * know whether this repository *has* a deployment story reads that field,
 * not the length of this array. A shortened plan would make the two
 * questions indistinguishable.
 */
function buildDeploymentPlan(mode: 'quick' | 'full', hasDocker: boolean): DeploymentStep[] {
  if (mode !== 'full') return [];
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
  // Steps 4 and 5 are part of the plan the `full` tier sells. They used to
  // be gated on the mode *inside* a plan both tiers received, which is how
  // the tier difference ended up as two rows rather than a section.
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
      // Condensed, not enumerated: a real self-audit put 639 titles on
      // this one line. The full list is still in `securityFindings`.
      evidence: condenseEvidence(security),
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
    evidence: condenseEvidence(blockers),
  });
  return list;
}

function buildLimitations(
  truncated: boolean,
  tier: { mode: 'quick' | 'full'; includeLaunchCopy: boolean },
  web3: Web3Analysis,
  historyScan?: HistoryScan,
  degraded?: boolean
): string[] {
  const out: string[] = [
    'Static analysis only — repository code is NEVER executed by RepoPilot.',
    'No formal security audit is performed; secret detection is best-effort.',
    // This read "LLM is optional; without one, the report uses deterministic
    // templates." There is no "without one" any more (R-38), and the sentence
    // implied a buyer could get a model-written report by configuring
    // something. Saying it as a property rather than as a fallback is both
    // shorter and the thing that is actually true.
    'No model writes any part of this report; every sentence is generated from deterministic templates.',
  ];

  // The scope of the history scan belongs in plain sight, not buried in
  // metadata. "No secrets in history" with no stated scope reads as "all
  // of history", which may be false.
  if (historyScan) {
    if (historyScan.scannedCommits === 0) {
      out.push(`Commit history was not scanned${historyScan.note ? `: ${historyScan.note}` : ''}.`);
    } else if (!historyScan.complete) {
      out.push(
        `Commit history was scanned for the most recent ${historyScan.scannedCommits} ` +
          'commits only; older history was not examined.'
      );
    }
  }
  if (truncated) {
    out.push('The repository tree is large; the listing was truncated. Some files were not analyzed.');
  }
  if (degraded) {
    out.push(
      'The repository archive could not be read, so files were fetched one at a time. ' +
        'The analysis is the same; the audit used far more of the GitHub request budget.'
    );
  }
  // Generated from the tier declaration, never written here. The sentence
  // this replaces said a quick audit "skips some of the deeper
  // reproducibility heuristics" — nothing was skipped, and no test pinned
  // the claim. See report/tiers.ts and RISKS.md R-30.
  out.push(...tierLimitations(tier));
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
