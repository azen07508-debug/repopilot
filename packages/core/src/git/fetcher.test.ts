/**
 * Fetcher tests for the tarball path (ADR D-017).
 *
 * No network. `downloadTarball` and `fetchContents` are replaced on the
 * prototype — the seams the module exposes for exactly this — so the
 * fallback can be exercised for real instead of being reasoned about.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { GitHubFetcher, RepoFetchError } from './fetcher.js';
import type { FileEntry } from './files.js';

const BLOCK = 512;

function header(o: { name: string; size: number; typeflag?: string }): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.write(o.name, 0, 100, 'utf8');
  b.write('0000644\0', 100, 8, 'ascii');
  b.write('0000000\0', 108, 8, 'ascii');
  b.write('0000000\0', 116, 8, 'ascii');
  b.write(`${o.size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  b.write('00000000000\0', 136, 12, 'ascii');
  b.write('        ', 148, 8, 'ascii');
  b.write(o.typeflag ?? '0', 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return b;
}

function padToBlock(buf: Buffer): Buffer {
  const rem = buf.length % BLOCK;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(BLOCK - rem)]);
}

/** A tar holding the given files under `root/`. */
function tarArchive(root: string, files: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [header({ name: `${root}/`, size: 0, typeflag: '5' })];
  for (const [name, text] of files) {
    const body = Buffer.from(text, 'utf8');
    parts.push(header({ name: `${root}/${name}`, size: body.length }), padToBlock(body));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** The same archive, gzipped — the shape GitHub actually sends. */
function gzArchive(root: string, files: Array<[string, string]>): Buffer {
  return gzipSync(tarArchive(root, files));
}

const fetcher = new GitHubFetcher();
const originalDownload = GitHubFetcher.prototype.downloadTarball;
const originalContents = GitHubFetcher.prototype.fetchContents;

afterEach(() => {
  GitHubFetcher.prototype.downloadTarball = originalDownload;
  GitHubFetcher.prototype.fetchContents = originalContents;
});

const CANDIDATES: FileEntry[] = [
  { path: 'README.md', size: 5 },
  { path: 'src/index.ts', size: 22 },
];

const OPTS = { maxFileBytes: 100_000, maxTotalBytes: 100_000 };

describe('fetchRepositoryContents', () => {
  it('reads the wanted files out of one archive', async () => {
    // `downloadTarball` returns the archive *decompressed*, so the stub
    // hands over the tar rather than the gzip.
    const archive = tarArchive('repo-abc1234', [
      ['README.md', '# hi'],
      ['src/index.ts', 'export const x = 1;\n'],
      ['vendor/big.ts', 'x'.repeat(4000)],
    ]);
    GitHubFetcher.prototype.downloadTarball = async () => archive;

    const r = await fetcher.fetchRepositoryContents('o', 'r', 'main', CANDIDATES, OPTS);

    expect(r.source).toBe('tarball');
    expect(r.degraded).toBe(false);
    expect(r.contents.get('README.md')).toBe('# hi');
    expect(r.contents.get('src/index.ts')).toBe('export const x = 1;\n');
    // `vendor/big.ts` was never asked for, so it was never decoded.
    expect(r.contents.has('vendor/big.ts')).toBe(false);
  });

  it('issues one download request, not one per file', async () => {
    let downloads = 0;
    GitHubFetcher.prototype.downloadTarball = async () => {
      downloads += 1;
      return tarArchive('repo-main', [
        ['README.md', '# hi'],
        ['src/index.ts', 'export const x = 1;\n'],
      ]);
    };

    await fetcher.fetchRepositoryContents('o', 'r', 'main', CANDIDATES, OPTS);
    expect(downloads).toBe(1);
  });

  it('falls back to a request per file and says so', async () => {
    let perFileCalls: string[] = [];
    GitHubFetcher.prototype.downloadTarball = async () => {
      throw new RepoFetchError('the archive is unavailable', 500);
    };
    GitHubFetcher.prototype.fetchContents = async function (
      _owner: string,
      _repo: string,
      _ref: string,
      candidates: FileEntry[]
    ) {
      perFileCalls = candidates.map((c) => c.path);
      return new Map([['README.md', 'fallback']]);
    };

    const r = await fetcher.fetchRepositoryContents('o', 'r', 'main', CANDIDATES, OPTS);

    expect(r.source).toBe('per-file');
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('unavailable');
    expect(r.contents.get('README.md')).toBe('fallback');
    // The fallback got the same file list, so the policy is unchanged.
    expect(perFileCalls).toEqual(['README.md', 'src/index.ts']);
  });

  it('falls back when the archive holds none of the listed files', async () => {
    // The archive parses fine and its root is a different tree — a ref
    // that moved, a redirect that landed elsewhere. Without this guard the
    // result is a clean, empty repository, which reads as "this repo has
    // no files" rather than "the archive was the wrong one".
    GitHubFetcher.prototype.downloadTarball = async () =>
      tarArchive('some-other-tree', [['unrelated.ts', 'x']]);
    GitHubFetcher.prototype.fetchContents = async () => new Map([['README.md', 'fallback']]);

    const r = await fetcher.fetchRepositoryContents('o', 'r', 'main', CANDIDATES, OPTS);

    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('none of the 2 file(s)');
    expect(r.contents.get('README.md')).toBe('fallback');
  });

  it('does not call the fallback for a repository with nothing to read', async () => {
    // No candidates is not a failure. Falling back here would spend the
    // request budget to fetch zero files.
    GitHubFetcher.prototype.downloadTarball = async () => tarArchive('repo-main', []);
    let fallbackRan = false;
    GitHubFetcher.prototype.fetchContents = async () => {
      fallbackRan = true;
      return new Map();
    };

    const r = await fetcher.fetchRepositoryContents('o', 'r', 'main', [], OPTS);

    expect(fallbackRan).toBe(false);
    expect(r.degraded).toBe(false);
    expect(r.contents.size).toBe(0);
  });

  it('stops the fallback from being reached when a cap made the read short', async () => {
    // A byte cap is not a failure: the files that were read are the files
    // that were asked for, just fewer of them. Falling back here would
    // spend the request budget to get the same short read.
    const archive = tarArchive('repo-main', [
      ['README.md', '# hi'],
      ['src/index.ts', 'x'.repeat(5000)],
    ]);
    GitHubFetcher.prototype.downloadTarball = async () => archive;
    let fallbackRan = false;
    GitHubFetcher.prototype.fetchContents = async () => {
      fallbackRan = true;
      return new Map();
    };

    const r = await fetcher.fetchRepositoryContents('o', 'r', 'main', CANDIDATES, {
      maxFileBytes: 100_000,
      maxTotalBytes: 100,
    });

    expect(fallbackRan).toBe(false);
    expect(r.degraded).toBe(false);
    expect(r.contents.has('README.md')).toBe(true);
  });
});

describe('downloadTarball caps (R-17)', () => {
  /**
   * The one seam that cannot be reached through the prototype is the
   * octokit call itself, so it is replaced on the instance. Everything
   * after it — the caps, the decompression, the error shape — is ours and
   * is what these tests cover.
   */
  function withArchive(data: unknown): GitHubFetcher {
    const f = new GitHubFetcher();
    const inner = f as unknown as { octokit: { repos: Record<string, unknown> } };
    inner.octokit.repos = { downloadTarballArchive: async () => ({ data }) };
    return f;
  }

  it('refuses a download over the compressed cap', async () => {
    // Zero-filled, so the allocation is lazy and costs nothing; only the
    // length check needs to run.
    const tooBig = Buffer.alloc(65 * 1024 * 1024);
    const f = withArchive(tooBig);

    await expect(f.downloadTarball('o', 'r', 'main')).rejects.toThrow(/over the .* byte cap/);
  });

  it('rejects an archive that is not actually gzip', async () => {
    const f = withArchive(Buffer.from('this is not gzip at all'));

    await expect(f.downloadTarball('o', 'r', 'main')).rejects.toThrow(/decompress/i);
  });

  it('accepts an ArrayBuffer as well as a Buffer', async () => {
    // A binary endpoint is the one place octokit's typing and its runtime
    // behaviour are easy to disagree about.
    const tar = tarArchive('repo-main', [['README.md', '# hi']]);
    const gz = gzipSync(tar);
    const asArrayBuffer: ArrayBuffer = gz.buffer.slice(
      gz.byteOffset,
      gz.byteOffset + gz.byteLength
    ) as ArrayBuffer;
    const f = withArchive(asArrayBuffer);

    expect(await f.downloadTarball('o', 'r', 'main')).toEqual(tar);
  });

  it('turns a 404 from GitHub into a RepoFetchError with that status', async () => {
    const f = new GitHubFetcher();
    const inner = f as unknown as { octokit: { repos: Record<string, unknown> } };
    inner.octokit.repos = {
      downloadTarballArchive: async () => {
        const err = new Error('Not Found') as Error & { status: number };
        err.status = 404;
        throw err;
      },
    };

    await expect(f.downloadTarball('o', 'r', 'main')).rejects.toMatchObject({ status: 404 });
  });
});
