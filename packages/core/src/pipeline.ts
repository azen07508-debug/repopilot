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
import type { Report } from './schemas/report.js';
import { DEFAULT_LIMITS } from './utils/constants.js';
import type { Logger } from 'pino';

export interface PipelineOptions {
  githubToken?: string;
  allowedHosts: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
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
    });

    return { report, truncated: reportTruncated };
  }
}

export { RepoFetchError, parseRepoUrl, GitHubFetcher };
export type { FetchedRepo, FileEntry };
