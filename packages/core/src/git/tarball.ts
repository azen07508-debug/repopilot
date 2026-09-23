/**
 * Repository content, read out of one tarball instead of one request per
 * file.
 *
 * ADR D-017. `fetchContents` issues a `repos.getContent` request per
 * file, and `DEFAULT_LIMITS.maxFiles` is 2000 — past the 60 requests/hour
 * anonymous limit before a full audit finishes (R-03). A tarball is one
 * request for the whole tree.
 *
 * This module is the pure half: it takes the archive *after* gunzipping
 * and returns text. No network, no filesystem, no `spawn` — D-007 forbids
 * executing repository code, and neither gunzipping nor reading an
 * archive is execution. That is also what makes it testable: the tests
 * build archives by hand rather than reaching GitHub.
 *
 * The text/binary/ignore policy is not reimplemented here. The caller
 * passes the set of paths it wants, which it already decided with
 * `filterFiles` and `classifyFile`, so the two paths agree by
 * construction.
 */
import type { TarEntry, TarStats } from './tar.js';
import { walkTar } from './tar.js';

export interface TarballExtractOptions {
  /**
   * Repository-relative paths to keep. Everything else in the archive is
   * ignored. The caller decided these with `filterFiles`.
   */
  wanted: ReadonlySet<string>;
  maxFileBytes: number;
  maxTotalBytes: number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface TarballExtractResult {
  contents: Map<string, string>;
  /** Bytes actually decoded. */
  totalBytes: number;
  /**
   * The directory actually stripped from every path, or '' when none was.
   * Absent for a flat archive, and for one whose entries do not agree on a
   * root — either way, no segment was eaten out of a real path.
   */
  root: string;
  /** Wanted paths the archive did not contain. */
  missing: string[];
  /** True when a byte cap, or a truncated archive, stopped the read. */
  truncated: boolean;
  /** What the reader saw, so callers can tell empty from not-there. */
  stats: TarStats;
}

export function extractTarball(
  archive: Buffer,
  opts: TarballExtractOptions
): TarballExtractResult {
  const { wanted, maxFileBytes, maxTotalBytes, log } = opts;

  // Pass one: work out how the archive's paths map onto repository-relative
  // ones. GitHub wraps the tree in a single directory and only it knows
  // what that directory is called, so it is derived from the archive.
  //
  // Derived, then *checked against* `wanted`, because the shape of the
  // archive alone cannot settle it. `src/` + `src/a.ts` is a flat archive
  // and `repo/src/a.ts` is a wrapped one, and from the paths alone the two
  // are identical: in both cases every entry sits under one directory.
  // The tree the caller already listed is the authority — strip only when
  // stripping matches strictly more of it.
  //
  // Paths only, no content: the walk still has to step over every payload
  // to reach the next header, but nothing is read.
  const seen: string[] = [];
  const first = walkTar(archive, (entry) => {
    seen.push(entry.path);
  });
  const derived = archiveRoot(seen);

  let strippedMatches = 0;
  let asIsMatches = 0;
  for (const p of seen) {
    if (wanted.has(p)) asIsMatches += 1;
    const rel = stripRoot(p, derived);
    if (rel !== p && wanted.has(rel)) strippedMatches += 1;
  }
  const strip = derived !== '' && strippedMatches > asIsMatches;
  const root = strip ? derived : '';

  // Pass two: read the wanted paths. Decode-and-copy happens here only,
  // so nothing but the wanted files is ever materialised as text.
  const contents = new Map<string, string>();
  let total = 0;
  let truncated = first.truncated;

  const second = walkTar(archive, (entry: TarEntry) => {
    const rel = strip ? stripRoot(entry.path, derived) : entry.path;
    if (rel === '' || !wanted.has(rel)) return;

    if (entry.bytes.length > maxFileBytes) {
      log?.('skip large file', { path: rel, size: entry.bytes.length });
      return;
    }
    if (total + entry.bytes.length > maxTotalBytes) {
      // The cap is the reason to stop, not an error: what has been read so
      // far is still what a caller asked for, just not all of it.
      truncated = true;
      log?.('stop: total bytes cap reached', { path: rel, total });
      return false;
    }

    contents.set(rel, decodeText(entry.bytes));
    total += entry.bytes.length;

    // Everything the caller asked for has been found; the rest of the
    // archive is not worth walking.
    if (contents.size >= wanted.size) return false;
    return;
  });

  if (second.truncated) truncated = true;

  const missing: string[] = [];
  for (const path of wanted) {
    if (!contents.has(path)) missing.push(path);
  }

  return {
    contents,
    totalBytes: total,
    root,
    missing,
    truncated,
    stats: second,
  };
}

/**
 * The first segment every entry shares, or '' when there isn't one.
 *
 * An entry with no `/` at all means the archive is flat, and two different
 * first segments mean it has no single root. Either way there is nothing
 * to strip.
 *
 * This is a *candidate*, not a decision. It names a directory in both a
 * wrapped archive (`repo/src/a.ts`) and a flat one (`src/` +
 * `src/a.ts`), and only the caller's tree can tell those apart — see
 * `extractTarball`.
 */
export function archiveRoot(paths: readonly string[]): string {
  let root = '';
  for (const p of paths) {
    const slash = p.indexOf('/');
    if (slash <= 0) return '';
    const segment = p.slice(0, slash);
    if (root === '') root = segment;
    else if (segment !== root) return '';
  }
  return root;
}

export function stripRoot(path: string, root: string): string {
  if (root === '') return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** UTF-8, with invalid bytes replaced rather than dropped. */
function decodeText(bytes: Buffer): string {
  return bytes.toString('utf8').replace(/\uFFFD/g, '?');
}
