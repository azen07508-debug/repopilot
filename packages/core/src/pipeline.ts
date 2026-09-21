/**
 * Pipeline orchestrator. Glue between:
 *   - URL parsing / host allowlist
 *   - GitHub tree + content fetcher
 *   - Analyzers + scoring
 *   - Report builder
 *
 * Callers (API, MCP) receive a `Report` they can validate with Zod and
 * return to the user.
 */
import { GitHubFetcher, parseRepoUrl, RepoFetchError, type FetchedRepo, type FileEntry } from './git/index.js';
import { filterFiles } from './git/files.js';
import { MetadataAnalyzer, type RepoMetadata } from './analyzers/metadata.js';
import { ReportBuilder } from './report/builder.js';
import {
  scanCommitsForSecrets,
  toHistoryFindings,
  type ScannedCommit,
} from './security/history-scanner.js';
import type { Finding, HistoryScan, Report } from './schemas/report.js';
import { DEFAULT_LIMITS } from './utils/constants.js';
import type { Logger } from 'pino';

export interface PipelineOptions {
  githubToken?: string;
  allowedHosts: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /**
   * How many recent commits to read for the secret-history scan.
   * 0 disables it. Each commit costs one GitHub request.
   */
  historyScanCommits?: number;
  log?: Logger;
}

export interface PipelineInput {
  repoUrl: string;
  mode: 'quick' | 'full';
  target: 'hackathon' | 'open_source' | 'production';
  outputLanguage: 'en' | 'zh-CN';
  includeLaunchCopy: boolean;
  llmProviderName: string;
  llmProviderConfigured: boolean;
}

export interface PipelineResult {
  report: Report;
  truncated: boolean;
}

export class AuditPipeline {
  private opts: Required<Omit<PipelineOptions, 'log' | 'githubToken'>> & {
    githubToken?: string;
    log?: Logger;
  };

  constructor(opts: PipelineOptions) {
    this.opts = {
      githubToken: opts.githubToken,
      allowedHosts: opts.allowedHosts,
      maxFiles: opts.maxFiles ?? DEFAULT_LIMITS.maxFiles,
      maxFileBytes: opts.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes,
      maxTotalBytes: opts.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes,
      historyScanCommits: opts.historyScanCommits ?? DEFAULT_LIMITS.historyScanCommits,
      log: opts.log,
    };
  }

  async run(input: PipelineInput): Promise<PipelineResult> {
    const parsed = parseRepoUrl(input.repoUrl, this.opts.allowedHosts);
    const metadataAnalyzer = new MetadataAnalyzer({ token: this.opts.githubToken });
    const metadata: RepoMetadata = await metadataAnalyzer.fetch(parsed.owner, parsed.repo);

    const fetcher = new GitHubFetcher(this.opts.githubToken);
    const { entries, truncated } = await fetcher.fetchTree(
      parsed.owner,
      parsed.repo,
      metadata.defaultBranch
    );

    const { included } = filterFiles(entries, {
      maxFiles: this.opts.maxFiles,
      maxFileBytes: this.opts.maxFileBytes,
    });

    const contents = await fetcher.fetchContents(parsed.owner, parsed.repo, metadata.defaultBranch, included, {
      maxFileBytes: this.opts.maxFileBytes,
      maxTotalBytes: this.opts.maxTotalBytes,
      log: (msg, meta) => this.opts.log?.debug({ msg, ...meta }, 'fetcher'),
    });

    const history = await this.scanHistory(fetcher, parsed.owner, parsed.repo, input.mode);

    const builder = new ReportBuilder();
    const { report, truncated: reportTruncated } = builder.build({
      metadata,
      entries: included as FileEntry[],
      contents,
      truncated,
      auditMode: input.mode,
      target: input.target,
      outputLanguage: input.outputLanguage,
      includeLaunchCopy: input.includeLaunchCopy,
      historyFindings: history.findings,
      historyScan: history.scan,
    });

    return { report, truncated: reportTruncated };
  }

  /**
   * Read recent commit diffs and look for credentials.
   *
   * Best-effort by design: a rate limit, a network blip or a repository
   * with no readable history must not fail an audit that otherwise
   * succeeded. Returns an empty list and logs the reason instead.
   */
  private async scanHistory(
    fetcher: GitHubFetcher,
    owner: string,
    repo: string,
    auditMode: 'quick' | 'full'
  ): Promise<{ findings: Finding[]; scan: HistoryScan }> {
    const depth = this.opts.historyScanCommits;

    if (depth <= 0) {
      return {
        findings: [],
        scan: {
          mode: 'disabled',
          requestedCommits: 0,
          scannedCommits: 0,
          complete: false,
          note: 'commit-history scanning is disabled',
        },
      };
    }

    try {
      const commits = await fetcher.listCommits(owner, repo, { limit: depth });

      const scanned: ScannedCommit[] = [];
      for (const c of commits) {
        const files = await fetcher.fetchCommitChanges(owner, repo, c.sha);
        scanned.push({ sha: c.sha, subject: c.subject, date: c.date, files });
      }

      return {
        findings: toHistoryFindings(scanCommitsForSecrets(scanned)),
        scan: {
          mode: auditMode,
          requestedCommits: depth,
          scannedCommits: commits.length,
          // Asking for more commits than exist means we reached the
          // beginning of the repository: the coverage really is complete.
          complete: commits.length < depth,
          note: null,
        },
      };
    } catch (e) {
      this.opts.log?.warn(
        { err: (e as Error).message, owner, repo },
        'commit-history secret scan skipped'
      );
      return {
        findings: [],
        scan: {
          mode: auditMode,
          requestedCommits: depth,
          scannedCommits: 0,
          complete: false,
          note: 'commit history could not be read',
        },
      };
    }
  }
}

export { RepoFetchError, parseRepoUrl, GitHubFetcher };
export type { FetchedRepo, FileEntry };
