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
import {
  ENV_EXAMPLE_FILENAMES,
  LICENSE_FILENAMES,
  README_FILENAMES,
} from './utils/paths.js';

/**
 * Where the runner reads a repository from.
 *
 * `FreeCheckRunner` used to build `GitHubFetcher` and `MetadataAnalyzer` inline,
 * which left the product's own entry point as the one part of it no test could
 * drive. `free-check.test.ts` worked around that by re-implementing the five
 * matching rules inside the test body — so it asserted on its own copy of the
 * logic and would have stayed green through any change to the real one. This
 * is the seam that makes those assertions mean something.
 *
 * It is also the seam that lets the MCP server exercise the tool, and the HTTP
 * route keep its current behaviour, without either of them standing up GitHub.
 */
export interface FreeCheckSource {
  /** Repository metadata. Never fatal: a `null` yields a report without stars. */
  metadata(owner: string, repo: string): Promise<RepoMetadata | null>;
  /** The tree at a ref. A throw here reaches the caller unchanged. */
  tree(owner: string, repo: string, ref: string): Promise<FileEntry[]>;
}

export interface FreeCheckOptions {
  githubToken?: string;
  allowedHosts: string[];
  /** Max time per network call. */
  networkTimeoutMs?: number;
  /** The seam a test drives instead of the network. */
  source?: FreeCheckSource;
}

/**
 * The real source: one metadata call, one tree call, and no file contents.
 *
 * Nothing here downloads a file, which is why there is no `maxFileBytes` or
 * `maxTotalBytes` to pass. Both used to exist on `FreeCheckOptions` — carried
 * over from the audit config, defaulted, stored on the instance, and never read
 * by `run()`. `apps/api` was passing `maxFiles: Math.min(200, cfg.MAX_FILES)`
 * into a field that had no effect, so `MAX_FILES` silently did nothing here.
 * They are gone rather than implemented: bounding the tree by truncating it
 * would turn a cut-off listing into `has-readme: FAIL` on a repository that has
 * a README, and a false negative is the one failure this entry point has
 * already been bitten by (see the shared-lists comment above).
 */
export function createGitHubSource(opts: {
  githubToken?: string;
  networkTimeoutMs?: number;
}): FreeCheckSource {
  return {
    metadata: (owner, repo) =>
      new MetadataAnalyzer({
        token: opts.githubToken,
        timeoutMs: opts.networkTimeoutMs,
      }).fetch(owner, repo),
    tree: async (owner, repo, ref) => {
      const fetcher = new GitHubFetcher(opts.githubToken);
      const { entries } = await fetcher.fetchTree(owner, repo, ref);
      return entries;
    },
  };
}

interface CheckResult {
  id: string;
  title: string;
  passed: boolean;
  evidence: string | null;
}

// Shared with the full audit. Two separate lists is how this entry point
// came to report `has-readme: PASS` on a repository whose paid audit
// reported "README.md is missing or empty" as its top blocker.
const README_NAMES = new Set(README_FILENAMES);

const LICENSE_NAMES = new Set(LICENSE_FILENAMES);

const ENV_EXAMPLE_NAMES = new Set(ENV_EXAMPLE_FILENAMES);

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
  private opts: Required<Omit<FreeCheckOptions, 'githubToken' | 'source'>> & {
    githubToken?: string;
  };
  private readonly source: FreeCheckSource;

  constructor(opts: FreeCheckOptions) {
    this.opts = {
      githubToken: opts.githubToken,
      allowedHosts: opts.allowedHosts,
      networkTimeoutMs: opts.networkTimeoutMs ?? 15_000,
    };
    this.source =
      opts.source ??
      createGitHubSource({
        githubToken: opts.githubToken,
        networkTimeoutMs: this.opts.networkTimeoutMs,
      });
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
      metadata = await this.source.metadata(parsed.owner, parsed.repo);
    } catch {
      metadata = null;
    }

    // 3. Fetch a slim tree. Hard failures here are propagated so the route
    //    can surface 404 / 403 / 429 / 502 to the caller.
    const entries: FileEntry[] = await this.source.tree(
      parsed.owner,
      parsed.repo,
      metadata?.defaultBranch ?? 'main',
    );

    // 4. Stack detection.
    const stackSignals = detectStack(entries, new Map());
    const stack = buildStack(stackSignals);

    // 5. Five critical presence checks.
    const readme = findFirstByNames(entries, README_NAMES);
    const license = findFirstByNames(entries, LICENSE_NAMES);
    const envExample = findFirstByNames(entries, ENV_EXAMPLE_NAMES);
    const lockfile = findAny(entries, LOCKFILE_PATTERNS);
    const ci = findAny(entries, CI_PATTERNS);

    // The README and LICENSE lookups match a basename anywhere in the tree, so
    // "at the repository root" was wrong in both failure messages — a
    // repository with `docs/README.md` passes this check, and a repository with
    // no README at all was being told to look in a place the check never
    // restricted itself to. The sentence an agent reads has to describe the
    // check that produced it.
    const checks: CheckResult[] = [
      makeCheck('has-readme', 'README present', readme, 'No README anywhere in the repository'),
      makeCheck(
        'has-license',
        'License file present',
        license,
        'No LICENSE file anywhere in the repository',
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
