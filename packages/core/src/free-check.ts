/**
 * FreeCheck — the no-payment entry point.
 *
 * Performs a deterministic, lightweight subset of the audit pipeline:
 *   1. URL validity (host allowlist, owner/repo shape).
 *   2. Repository metadata (Octokit fetch; never executes repo code).
 *   3. Stack detection (filename + content heuristics).
 *   4. Five critical presence checks (README, LICENSE, .env.example,
 *      lockfile, CI).
 *   5. A pass/fail score out of 100.
 *
 * No LLM, no payment, no DB writes, no x402, no state. Safe to call from
 * any origin with rate limiting.
 */
import {
  parseRepoUrl,
  GitHubFetcher,
  type FileEntry,
} from './git/index.js';
import {
  MetadataAnalyzer,
  type RepoMetadata,
} from './analyzers/metadata.js';
import { detectStack, type StackSignal } from './analyzers/stack.js';
import {
  FreeCheckReportSchema,
  type FreeCheckReport,
  type FreeCheckInput,
} from './schemas/index.js';
import type { ParsedRepoUrl } from './git/url.js';

export interface FreeCheckOptions {
  githubToken?: string;
  allowedHosts: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** Max time per network call. */
  networkTimeoutMs?: number;
}

interface CheckResult {
  id: string;
  title: string;
  passed: boolean;
  evidence: string | null;
}

const CRITICAL_FILENAMES = new Set([
  'README.md',
  'README.markdown',
  'README.rst',
  'README',
  'readme.md',
]);

const LICENSE_FILENAMES = new Set([
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
]);

const ENV_EXAMPLE_FILENAMES = new Set(['.env.example', 'env.example']);

const LOCKFILE_PATTERNS: RegExp[] = [
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)bun\.lockb?$/i,
  /(^|\/)Pipfile\.lock$/i,
  /(^|\/)poetry\.lock$/i,
  /(^|\/)Cargo\.lock$/i,
  /(^|\/)go\.sum$/i,
  /(^|\/)composer\.lock$/i,
];

const CI_PATTERNS: RegExp[] = [
  /^\.github\/workflows\/[^/]+\.(yml|yaml)$/i,
  /^\.circleci\/config\.(yml|yaml)$/i,
  /^\.gitlab-ci\.yml$/i,
  /^\.travis\.yml$/i,
  /^\.drone\.yml$/i,
  /^\.buildkite\/pipeline\.yml$/i,
  /^\Jenkinsfile$/i,
  /^\azure-pipelines\.yml$/i,
];

function findFirstByNames(entries: FileEntry[], names: Set<string>): FileEntry | null {
  let match: FileEntry | null = null;
  for (const e of entries) {
    const base = e.path.split('/').pop()!;
    if (names.has(base)) {
      if (!match || e.path.length < match.path.length) match = e;
    }
  }
  return match;
}

function findAny(entries: FileEntry[], patterns: RegExp[]): FileEntry | null {
  for (const e of entries) {
    for (const p of patterns) {
      if (p.test(e.path)) return e;
    }
  }
  return null;
}

function makeCheck(id: string, title: string, evidence: FileEntry | null, fallback: string): CheckResult {
  if (!evidence) {
    return { id, title, passed: false, evidence: fallback };
  }
  return {
    id,
    title,
    passed: true,
    evidence: `${evidence.path} found`,
  };
}

function buildStack(signals: StackSignal[]): {
  languages: string[];
  frameworks: string[];
  runtimes: string[];
} {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const runtimes = new Set<string>();
  for (const s of signals) {
    if (s.confidence < 0.5) continue;
    switch (s.key) {
      case 'typescript':
        languages.add('TypeScript');
        break;
      case 'node':
        runtimes.add('Node.js');
        languages.add('JavaScript');
        break;
      case 'python':
        languages.add('Python');
        break;
      case 'rust':
        languages.add('Rust');
        break;
      case 'solidity':
        languages.add('Solidity');
        break;
      case 'react':
        frameworks.add('React');
        break;
      case 'nextjs':
        frameworks.add('Next.js');
        break;
      case 'vite':
        frameworks.add('Vite');
        break;
      case 'vue':
        frameworks.add('Vue');
        break;
      case 'svelte':
        frameworks.add('Svelte');
        break;
      case 'docker':
        frameworks.add('Docker');
        break;
      case 'github-actions':
        frameworks.add('GitHub Actions');
        break;
      case 'hardhat':
        frameworks.add('Hardhat');
        break;
      case 'foundry':
        frameworks.add('Foundry');
        break;
      case 'postgresql':
        frameworks.add('PostgreSQL');
        break;
      case 'mongodb':
        frameworks.add('MongoDB');
        break;
      case 'redis':
        frameworks.add('Redis');
        break;
    }
  }
  return {
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    runtimes: [...runtimes].sort(),
  };
}

export class FreeCheckRunner {
  private opts: Required<Omit<FreeCheckOptions, 'githubToken'>> & {
    githubToken?: string;
  };

  constructor(opts: FreeCheckOptions) {
    this.opts = {
      githubToken: opts.githubToken,
      allowedHosts: opts.allowedHosts,
      maxFiles: opts.maxFiles ?? 200,
      maxFileBytes: opts.maxFileBytes ?? 262_144, // 256 KB per file
      maxTotalBytes: opts.maxTotalBytes ?? 5_242_880, // 5 MB total
      networkTimeoutMs: opts.networkTimeoutMs ?? 15_000,
    };
  }

  async run(input: FreeCheckInput): Promise<FreeCheckReport> {
    const parsed: ParsedRepoUrl = parseRepoUrl(input.repoUrl, this.opts.allowedHosts);
    const generatedAt = new Date().toISOString();

    // 1. URL is valid by virtue of parseRepoUrl succeeding.
    const baseReport: FreeCheckReport = FreeCheckReportSchema.parse({
      reportVersion: '1.0',
      kind: 'free-check',
      repository: {
        url: input.repoUrl,
        host: parsed.host,
        owner: parsed.owner,
        name: parsed.repo,
        valid: true,
      },
      metadata: null,
      stack: null,
      checks: [],
      score: { value: 0, passed: 0, total: 5 },
      generatedAt,
    });

    // 2. Fetch metadata. A failure here is non-fatal: the report can still
    //    be useful without stars/description, so long as the tree is reachable.
    let metadata: RepoMetadata | null = null;
    try {
      const meta = new MetadataAnalyzer({
        token: this.opts.githubToken,
        timeoutMs: this.opts.networkTimeoutMs,
      });
      metadata = await meta.fetch(parsed.owner, parsed.repo);
    } catch {
      metadata = null;
    }

    // 3. Fetch a slim tree. Hard failures here are propagated so the route
    //    can surface 404 / 403 / 429 / 502 to the caller.
    const fetcher = new GitHubFetcher(this.opts.githubToken);
    const tree = await fetcher.fetchTree(
      parsed.owner,
      parsed.repo,
      metadata?.defaultBranch ?? parsed.defaultBranchHint ?? 'main',
    );
    const entries: FileEntry[] = tree.entries;

    // 4. Stack detection.
    const stackSignals = detectStack(entries, new Map());
    const stack = buildStack(stackSignals);

    // 5. Five critical presence checks.
    const readme = findFirstByNames(entries, CRITICAL_FILENAMES);
    const license = findFirstByNames(entries, LICENSE_FILENAMES);
    const envExample = findFirstByNames(entries, ENV_EXAMPLE_FILENAMES);
    const lockfile = findAny(entries, LOCKFILE_PATTERNS);
    const ci = findAny(entries, CI_PATTERNS);

    const checks: CheckResult[] = [
      makeCheck(
        'has-readme',
        'README present',
        readme,
        'No README at the repository root',
      ),
      makeCheck(
        'has-license',
        'License file present',
        license,
        'No LICENSE file at the repository root',
      ),
      makeCheck(
        'has-env-example',
        '.env.example present',
        envExample,
        'No .env.example (env vars must be documented)',
      ),
      makeCheck(
        'has-lockfile',
        'Dependency lockfile present',
        lockfile,
        'No lockfile (reproducibility is at risk)',
      ),
      makeCheck(
        'has-ci',
        'CI configuration present',
        ci,
        'No CI configuration (.github/workflows, etc.)',
      ),
    ];

    const passed = checks.filter((c) => c.passed).length;
    const value = Math.round((passed / checks.length) * 100);

    return FreeCheckReportSchema.parse({
      ...baseReport,
      metadata: metadata
        ? {
            description: metadata.description,
            defaultBranch: metadata.defaultBranch,
            stars: metadata.stars,
            language: metadata.primaryLanguage,
            topics: [],
          }
        : null,
      stack: {
        languages: stack.languages,
        frameworks: stack.frameworks,
        runtimes: stack.runtimes,
      },
      checks,
      score: { value, passed, total: checks.length },
      generatedAt,
    });
  }
}
