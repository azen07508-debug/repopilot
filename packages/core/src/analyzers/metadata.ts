/**
 * Repository metadata analyzer.
 *
 * Pulls high-level facts (default branch, license, last-updated, archived,
 * open issues/PRs) from the GitHub REST API. Pure read-only — never modifies
 * anything.
 */
import { Octokit } from '@octokit/rest';

export interface RepoMetadata {
  owner: string;
  name: string;
  defaultBranch: string;
  license: string | null;
  lastUpdatedAt: string | null;
  visibility: 'public';
  archived: boolean;
  stars: number;
  openIssues: number;
  openPulls: number;
  description: string | null;
  primaryLanguage: string | null;
  url: string;
}

export interface MetadataAnalyzerOptions {
  token?: string;
  userAgent?: string;
  /** Max time spent on a single Octokit call. */
  timeoutMs?: number;
}

export class MetadataAnalyzer {
  private octokit: Octokit;

  constructor(opts: MetadataAnalyzerOptions = {}) {
    this.octokit = new Octokit({
      auth: opts.token,
      userAgent: opts.userAgent ?? 'RepoPilot/0.1 (+https://github.com/OKX/repopilot)',
      request: { timeout: opts.timeoutMs ?? 30_000 },
    });
  }

  async fetch(owner: string, repo: string): Promise<RepoMetadata> {
    const { data } = await this.octokit.repos.get({ owner, repo });
    // Open issues count from `get` includes PRs in some older versions; we re-query
    // issues & pulls separately to be safe.
    let openIssues = 0;
    let openPulls = 0;
    try {
      const { data: issueData } = await this.octokit.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: 1,
      });
      // The total count is not in the response when per_page=1; rely on the
      // open_issues_count from the repo payload instead.
      openIssues = typeof data.open_issues_count === 'number' ? data.open_issues_count : 0;
    } catch {
      openIssues = 0;
    }
    try {
      const { data: pulls } = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: 1,
      });
      openPulls = Array.isArray(pulls) ? pulls.length : 0;
    } catch {
      openPulls = 0;
    }

    return {
      owner,
      name: repo,
      defaultBranch: data.default_branch,
      license: data.license?.spdx_id ?? null,
      lastUpdatedAt: data.pushed_at ?? data.updated_at ?? null,
      visibility: 'public',
      archived: !!data.archived,
      stars: data.stargazers_count ?? 0,
      openIssues,
      openPulls,
      description: data.description ?? null,
      primaryLanguage: data.language ?? null,
      url: data.html_url,
    };
  }

  /**
   * Resolve the HEAD commit SHA of a branch. Used to compute a stable
   * cache key for paid audits: a new SHA always re-runs the pipeline.
   *
   * Returns `null` on any failure (network, 404, 403) so callers can
   * fall through to the pipeline (the pipeline will surface the real
   * error to the user).
   */
  async getHeadSha(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      return typeof data?.object?.sha === 'string' ? data.object.sha : null;
    } catch {
      return null;
    }
  }
}
