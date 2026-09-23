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
import { gunzip as gunzipCb } from 'node:zlib';
import { Octokit } from '@octokit/rest';
import type { FileEntry } from './files.js';
import { classifyFile } from './files.js';
import { extractTarball } from './tarball.js';

/**
 * Caps that only the tarball path needs (R-17).
 *
 * The per-file path is bounded by `maxTotalBytes` as it goes, one file at
 * a time. The tarball path is bounded only after the whole archive is in
 * memory, so it needs two numbers the other path does not: how big the
 * download may be, and how big it may get once decompressed. The second
 * matters more than it looks — gzip can expand a small file enormously,
 * and `maxOutputLength` is what stops a pathological archive from
 * becoming a gigabyte of RAM.
 */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;

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

export interface CommitRef {
  sha: string;
  /** First line of the commit message. */
  subject: string;
  /** ISO timestamp, or null when GitHub omits it. */
  date: string | null;
  url: string;
}

/**
 * What `fetchRepositoryContents` returns.
 *
 * `degraded` is the point of the type: a caller has to be able to tell
 * "read in one request" from "fell back to one request per file", because
 * the fallback is the state where the 60 requests/hour limit still bites.
 */
export interface RepositoryContents {
  contents: Map<string, string>;
  source: 'tarball' | 'per-file';
  /** True when the tarball path failed and `fetchContents` ran instead. */
  degraded: boolean;
  /** Why the tarball path failed, when it did. */
  reason?: string;
}

export interface CommitFileChange {
  filename: string;
  /** added | modified | removed | renamed | copied | changed | unchanged */
  status: string;
  /**
   * Unified diff, or null when GitHub omits it — binary files and diffs
   * above the size limit come back without one.
   */
  patch: string | null;
  additions: number;
  deletions: number;
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

  /**
   * Read repository content in one request instead of one request per file.
   *
   * ADR D-017. `fetchContents` costs a request per file and
   * `DEFAULT_LIMITS.maxFiles` is 2000, which is past the anonymous budget
   * before a full audit finishes (R-03). A tarball is a single request.
   *
   * The per-file path is the fallback, not the alternative: a repo GitHub
   * will not serve an archive for (private, enormous, temporarily broken)
   * still gets audited, and the result says which path was taken.
   *
   * The text/binary/ignore policy is identical on both paths, because
   * `candidates` was already decided by `filterFiles` and the tarball path
   * reads exactly those paths out of the archive.
   */
  async fetchRepositoryContents(
    owner: string,
    repo: string,
    ref: string,
    candidates: FileEntry[],
    opts: { maxFileBytes: number; maxTotalBytes: number; log?: FetchOptions['log'] }
  ): Promise<RepositoryContents> {
    const wanted = new Set(candidates.map((e) => e.path));

    try {
      const archive = await this.downloadTarball(owner, repo, ref);
      const extracted = extractTarball(archive, {
        wanted,
        maxFileBytes: opts.maxFileBytes,
        maxTotalBytes: opts.maxTotalBytes,
        log: opts.log,
      });

      // Nothing was asked for, or nothing came back. The first is fine;
      // the second is not, and it is the failure this path can hide best:
      // an archive whose root does not match the tree (a ref that moved,
      // a redirect that landed somewhere else) parses perfectly and yields
      // an empty repository. That reads as "this repo has no files" far
      // more convincingly than an error would.
      if (wanted.size > 0 && extracted.contents.size === 0) {
        throw new RepoFetchError(
          `The archive for ${owner}/${repo}@${ref} contained none of the ${wanted.size} file(s) listed by the tree.`,
          500
        );
      }

      // R-17 wants these on the record: a silent change in how much of a
      // repository was actually read is the failure this path can hide.
      opts.log?.('read repository contents from a tarball', {
        fileCount: extracted.contents.size,
        extractedBytes: extracted.totalBytes,
        archiveRoot: extracted.root,
        missing: extracted.missing.length,
        truncated: extracted.truncated,
        files: extracted.stats.files,
      });

      return { contents: extracted.contents, source: 'tarball', degraded: false };
    } catch (e) {
      const reason = (e as Error).message ?? String(e);
      opts.log?.('tarball path failed, falling back to a request per file', {
        reason,
        wanted: wanted.size,
      });
      const contents = await this.fetchContents(owner, repo, ref, candidates, opts);
      return { contents, source: 'per-file', degraded: true, reason };
    }
  }

  /**
   * Download and decompress the archive for a ref.
   *
   * Decompressed in-process with `node:zlib`. Nothing is spawned — D-007
   * forbids executing repository code, and gunzipping is not execution —
   * and nothing is written to disk, which is what keeps R-17's
   * disk-exhaustion risk off this path entirely.
   *
   * Public so a test can replace it. It is the seam between "talk to
   * GitHub" and "read the bytes", and it is the only one on this path:
   * `fetchRepositoryContents` has to be exercised without a network, and
   * stubbing the constructor's Octokit would mean building a fake for the
   * whole client.
   */
  async downloadTarball(owner: string, repo: string, ref: string): Promise<Buffer> {
    let raw: unknown;
    try {
      const res = await this.octokit.repos.downloadTarballArchive({ owner, repo, ref });
      raw = res.data;
    } catch (e) {
      throw this.toFetchError(e, `Failed to download the archive for ${owner}/${repo}@${ref}`);
    }

    const archive = toBuffer(raw, `the archive for ${owner}/${repo}@${ref}`);
    if (archive.length > MAX_ARCHIVE_BYTES) {
      throw new RepoFetchError(
        `The archive for ${owner}/${repo}@${ref} is ${archive.length} bytes, over the ${MAX_ARCHIVE_BYTES} byte cap.`,
        500
      );
    }

    try {
      return await gunzipAsync(archive, { maxOutputLength: MAX_EXTRACTED_BYTES });
    } catch (e) {
      throw new RepoFetchError(
        `Failed to decompress the archive for ${owner}/${repo}@${ref}: ${(e as Error).message ?? e}`,
        500
      );
    }
  }

  /**
   * List the most recent commits.
   *
   * Deliberately bounded and non-recursive: reading one commit's diff
   * costs one further request, and anonymous access is 60 requests/hour
   * for the whole IP. The caller picks the depth; this method never walks
   * history on its own.
   */
  async listCommits(
    owner: string,
    repo: string,
    opts: { limit: number; since?: string }
  ): Promise<CommitRef[]> {
    const perPage = Math.min(Math.max(opts.limit, 1), 100);
    try {
      const { data } = await this.octokit.repos.listCommits({
        owner,
        repo,
        per_page: perPage,
        ...(opts.since ? { since: opts.since } : {}),
      });
      return data.map((c) => ({
        sha: c.sha,
        subject: (c.commit.message ?? '').split('\n')[0] ?? '',
        date: c.commit.author?.date ?? null,
        url: c.html_url,
      }));
    } catch (e) {
      throw this.toFetchError(e, `Failed to list commits for ${owner}/${repo}`);
    }
  }

  /**
   * Read the file changes and diffs of a single commit.
   *
   * Returns an empty array when GitHub omits `files` (it does for some
   * merge commits) rather than throwing: a missing diff is not an error,
   * it is simply no evidence.
   */
  async fetchCommitChanges(
    owner: string,
    repo: string,
    sha: string
  ): Promise<CommitFileChange[]> {
    try {
      const { data } = await this.octokit.repos.getCommit({ owner, repo, ref: sha });
      const files = (data as { files?: Array<Record<string, unknown>> }).files ?? [];
      return files.map((f) => ({
        filename: String(f['filename'] ?? ''),
        status: String(f['status'] ?? 'modified'),
        patch: typeof f['patch'] === 'string' ? f['patch'] : null,
        additions: typeof f['additions'] === 'number' ? f['additions'] : 0,
        deletions: typeof f['deletions'] === 'number' ? f['deletions'] : 0,
      }));
    } catch (e) {
      throw this.toFetchError(e, `Failed to read commit ${sha} of ${owner}/${repo}`);
    }
  }

  private toFetchError(e: unknown, fallback: string): RepoFetchError {
    const status = (e as { status?: number }).status;
    if (status === 404) {
      return new RepoFetchError(`${fallback}: not found or not accessible.`, 404);
    }
    if (status === 403) {
      return new RepoFetchError(
        `${fallback}: rate-limited or forbidden. Set GITHUB_TOKEN to raise the limit.`,
        403
      );
    }
    return new RepoFetchError(`${fallback}: ${(e as Error).message ?? String(e)}`, 500);
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

/**
 * Gunzip without blocking the event loop.
 *
 * `node:zlib/promises` has no typings in the `@types/node` this package
 * pins, and `gunzipSync` would hold the loop for the length of a whole
 * archive — on a box running more than one audit at a time, that is
 * everyone's latency, not just this job's.
 */
function gunzipAsync(data: Buffer, options: { maxOutputLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzipCb(data, options, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/**
 * The bytes of a binary response, whatever shape octokit handed them over
 * in.
 *
 * Not a defensive reflex: a binary endpoint is the one place octokit's
 * typing and its runtime behaviour are easy to disagree about, and a
 * wrong guess here fails as "the archive is corrupt" three frames away
 * from where the guess was made.
 */
function toBuffer(raw: unknown, what: string): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  throw new RepoFetchError(`Unexpected response type for ${what}.`, 500);
}
