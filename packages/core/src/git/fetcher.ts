/**
 * GitHub repository fetcher.
 *
 * The fetcher NEVER executes code from the repository. It only:
 *   - lists the file tree via the Git Trees API,
 *   - downloads blob content for the files it actually needs to read.
 *
 * Files larger than `maxFileBytes` are skipped, binary files are skipped,
 * noise directories are skipped. Everything else is returned as text.
 */
import { Octokit } from '@octokit/rest';
import type { FileEntry } from './files.js';
import { classifyFile } from './files.js';

export interface FetchOptions {
  token?: string;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  userAgent?: string;
  /** Force listing the whole tree even if it's huge. */
  force?: boolean;
  /** Logger */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface FetchedRepo {
  entries: FileEntry[];
  contents: Map<string, string>;
  /** Total bytes actually downloaded. */
  totalBytes: number;
  /** Truncated if the tree was too big and we did not get the full repo. */
  truncated: boolean;
}

export class GitHubFetcher {
  private octokit: Octokit;

  constructor(token?: string, userAgent = 'RepoPilot/0.1') {
    this.octokit = new Octokit({
      auth: token,
      userAgent,
      request: { timeout: 30_000 },
    });
  }

  async fetchTree(owner: string, repo: string, ref: string): Promise<{ entries: FileEntry[]; truncated: boolean }> {
    try {
      const { data } = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: ref,
        recursive: 'true',
      });
      const entries: FileEntry[] = [];
      let truncated = data.truncated;
      for (const item of data.tree) {
        if (item.type !== 'blob' || !item.path) continue;
        entries.push({ path: item.path, size: item.size ?? 0 });
      }
      return { entries, truncated };
    } catch (e) {
      // Private repos / missing trees / rate-limits fall through to a 404.
      const err = e as { status?: number };
      if (err.status === 404) {
        throw new RepoFetchError(`Repository not found or not accessible: ${owner}/${repo}`, 404);
      }
      if (err.status === 403) {
        throw new RepoFetchError(
          `Rate-limited or forbidden while listing ${owner}/${repo}. Set GITHUB_TOKEN to raise the limit.`,
          403
        );
      }
      throw new RepoFetchError(`Failed to list tree for ${owner}/${repo}: ${(e as Error).message ?? e}`, 500);
    }
  }

  async fetchContents(
    owner: string,
    repo: string,
    ref: string,
    candidates: FileEntry[],
    opts: { maxFileBytes: number; maxTotalBytes: number; log?: FetchOptions['log'] }
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let total = 0;
    for (const entry of candidates) {
      if (total + entry.size > opts.maxTotalBytes) {
        opts.log?.('skip due to total bytes cap', { path: entry.path });
        continue;
      }
      if (entry.size > opts.maxFileBytes) {
        opts.log?.('skip large file', { path: entry.path, size: entry.size });
        continue;
      }
      const cls = classifyFile(entry.path, entry.size);
      if (cls.kind !== 'text') {
        opts.log?.('skip non-text', { path: entry.path, kind: cls.kind });
        continue;
      }
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path: entry.path,
          ref,
        });
        if (Array.isArray(data) || data.type !== 'file') continue;
        const content = (data as { content?: string; encoding?: string }).content;
        if (typeof content !== 'string') continue;
        const encoding = (data as { encoding?: string }).encoding ?? 'base64';
        if (encoding !== 'base64') continue;
        const buf = Buffer.from(content, 'base64');
        if (buf.length === 0) continue;
        // UTF-8 safety: replace invalid bytes.
        const text = buf.toString('utf8').replace(/\uFFFD/g, '?');
        out.set(entry.path, text);
        total += buf.length;
      } catch (e) {
        opts.log?.('skip file (fetch error)', { path: entry.path, error: (e as Error).message });
      }
    }
    return out;
  }
}

export class RepoFetchError extends Error {
  readonly code = 'REPO_FETCH_ERROR' as const;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RepoFetchError';
    this.status = status;
  }
}
