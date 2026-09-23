/**
 * A minimal, read-only tar reader.
 *
 * `GET /repos/{owner}/{repo}/tarball/{ref}` returns a gzipped POSIX ustar
 * archive. We want exactly two things from it: the path of each regular
 * file, and its bytes. Nothing is executed (D-007 forbids running
 * repository code, and reading an archive is not running it) and nothing
 * is written here — this module is pure, and takes the archive *after*
 * gunzipping so it can be tested with a hand-built buffer.
 *
 * Why not a tar dependency: `@repopilot/core` ships octokit, pino and zod
 * and nothing else (D-018 rejected tree-sitter partly to keep it that
 * way), and the format we actually receive is narrow. What it is *not* is
 * trivial, though. Measured against a real 12,577-entry GitHub archive
 * (`nodejs/node` v0.12.0):
 *
 *   - 11,579 regular files, 994 directories
 *   - 192 entries whose path does not fit the 100-byte name field and is
 *     split across `prefix` + `name`
 *   - one `x` pax extended header, carrying `path=` for a 130-character
 *     path (the header's own name is `<sha>.paxheader`)
 *   - two symlinks
 *   - one `g` pax global header, whose body is `comment=<commit sha>`
 *
 * A reader that ignored `prefix` and the pax `path=` record would have
 * mis-addressed 193 of those 12,577 entries. That is the whole reason this
 * file exists rather than four lines of `name = header[0..100]`.
 */

/** Every tar block is 512 bytes. */
const BLOCK = 512;

export interface TarEntry {
  /**
   * Path as it appears in the archive, still including the top-level
   * `<repo>-<ref>/` directory. Callers strip that themselves, because only
   * they know what the archive's root is.
   */
  path: string;
  /** Declared size in bytes. */
  size: number;
  /**
   * File contents, as a view onto the source buffer — not a copy. Valid
   * only as long as the buffer passed to `walkTar` is alive.
   */
  bytes: Buffer;
}

/** What `walkTar` saw, so callers can tell "nothing matched" from "nothing there". */
export interface TarStats {
  /** Regular-file entries visited. */
  files: number;
  /** Directory entries skipped. */
  directories: number;
  /**
   * Entries skipped because they are not regular files or directories —
   * symlinks, hard links, device nodes, fifos. Reported rather than
   * silently dropped: an archive full of them is worth noticing.
   */
  skippedSpecial: number;
  /** `x` pax extended headers applied to the following entry. */
  paxHeaders: number;
  /**
   * True when the archive ended before its declared last block — a
   * truncated download. Anything already visited stays valid, so a caller
   * can choose to use a partial result or fall back.
   */
  truncated: boolean;
}

export interface WalkOptions {
  /** Stop after this many regular-file entries have been visited. */
  maxFiles?: number;
}

/**
 * Visit every regular file in a gunzipped tar archive, in archive order.
 *
 * `visit` may return `false` to stop the walk early — the intended use is
 * to stop once every path the caller wanted has been found, which avoids
 * paging through the rest of a large archive.
 *
 * Directories and special entries are never passed to `visit`. Symlinks in
 * particular are skipped rather than resolved: this reader has no business
 * following a link a repository author chose, and the caller writes files
 * under a root it controls.
 */
export function walkTar(
  archive: Buffer,
  visit: (entry: TarEntry) => boolean | void,
  opts: WalkOptions = {}
): TarStats {
  const stats: TarStats = {
    files: 0,
    directories: 0,
    skippedSpecial: 0,
    paxHeaders: 0,
    truncated: false,
  };
  const maxFiles = opts.maxFiles ?? Number.POSITIVE_INFINITY;

  // pax and GNU extensions describe the entry that *follows* them.
  let pendingPath: string | null = null;
  let pendingSize: number | null = null;
  let pendingLongName: string | null = null;

  let pos = 0;
  let ended = false;

  while (pos + BLOCK <= archive.length) {
    if (isZeroBlock(archive, pos)) {
      // A zero block is the end-of-archive marker. Real archives pad with
      // two; one is enough to stop, and tolerating a missing second block
      // keeps a merely-trimmed archive readable.
      ended = true;
      break;
    }

    const typeflag = String.fromCharCode(archive[pos + 156] ?? 0);
    const declaredSize = readNumeric(archive, pos + 124, 12);
    const bodyStart = pos + BLOCK;
    const bodyEnd = bodyStart + declaredSize;

    if (bodyEnd > archive.length) {
      // The header promised more bytes than the archive holds.
      stats.truncated = true;
      break;
    }

    const isDescriptor =
      typeflag === 'x' || typeflag === 'X' || typeflag === 'g' || typeflag === 'L' || typeflag === 'K';

    // How far to step to reach the next header. For a regular file this
    // must be the *effective* size, not the header's: when a pax `size=`
    // record disagrees with the header, stepping by the header value lands
    // mid-payload and the next "header" is read out of file contents.
    let bodySize = declaredSize;

    if (typeflag === 'x' || typeflag === 'X') {
      const records = parsePaxRecords(archive.subarray(bodyStart, bodyEnd));
      if (records.path !== undefined) pendingPath = records.path;
      if (records.size !== undefined) pendingSize = records.size;
      stats.paxHeaders += 1;
    } else if (typeflag === 'L') {
      // GNU long name: the body is the name of the next entry, NUL-padded.
      pendingLongName = readCString(archive.subarray(bodyStart, bodyEnd));
    } else if (typeflag === 'g' || typeflag === 'K') {
      // `g` is archive-wide (GitHub puts `comment=<sha>` in it) and `K` is a
      // long link name. Neither changes a path we care about.
    } else if (typeflag === '5' || (typeflag === '\0' && nameEndsWithSlash(archive, pos))) {
      // The trailing-slash case is the pre-ustar format, which has no
      // typeflag at all and marks directories in the name instead.
      stats.directories += 1;
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      const path = pendingLongName ?? pendingPath ?? joinPrefix(archive, pos);
      const size = pendingSize ?? declaredSize;
      bodySize = size;
      // A pax `size=` record can disagree with the header; trust the
      // descriptor, but never read past what the archive actually holds.
      const contentEnd = Math.min(bodyStart + size, archive.length);
      if (contentEnd < bodyStart + size) stats.truncated = true;

      stats.files += 1;
      if (stats.files <= maxFiles) {
        const stop = visit({
          path,
          size: contentEnd - bodyStart,
          bytes: archive.subarray(bodyStart, contentEnd),
        });
        if (stop === false) return stats;
      }
    } else {
      stats.skippedSpecial += 1;
    }

    // A descriptor applies to exactly one following entry, so clear it once
    // a real entry has been consumed.
    if (!isDescriptor) {
      pendingPath = null;
      pendingSize = null;
      pendingLongName = null;
    }

    pos = bodyStart + Math.ceil(bodySize / BLOCK) * BLOCK;
  }

  // Out of bytes without ever seeing the end-of-archive marker, and what is
  // left is not zero padding: the archive was cut short. A trailing zero
  // block means we stopped where the archive intended us to.
  if (!ended && !allZero(archive, pos)) stats.truncated = true;

  return stats;
}

/** True when every byte from `offset` on is zero — including "there are none". */
function allZero(buf: Buffer, offset: number): boolean {
  for (let i = Math.max(offset, 0); i < buf.length; i += 1) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/** Pre-ustar archives mark a directory with a trailing slash instead of a typeflag. */
function nameEndsWithSlash(buf: Buffer, headerOffset: number): boolean {
  return readField(buf, headerOffset, 100).endsWith('/');
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i += 1) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/** NUL-terminated string at a fixed field, decoded as UTF-8. */
function readField(buf: Buffer, offset: number, length: number): string {
  return readCString(buf.subarray(offset, offset + length));
}

/**
 * The string up to the first NUL.
 *
 * Cutting at the *first* NUL rather than trimming trailing ones matters: a
 * well-formed archive zero-fills the rest of the field, but a hostile one
 * can put anything after the terminator, and none of it is part of the
 * name.
 */
function readCString(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.toString('utf8', 0, end === -1 ? buf.length : end);
}

/**
 * A numeric header field.
 *
 * POSIX stores these as octal ASCII, space- or NUL-padded. GNU's base-256
 * form — used when a value will not fit, and marked by the high bit of the
 * first byte — is also handled, because "it will not fit" is exactly the
 * case a large repository produces.
 */
function readNumeric(buf: Buffer, offset: number, length: number): number {
  const first = buf[offset];
  if (first !== undefined && (first & 0x80) !== 0) {
    let value = first & 0x7f;
    for (let i = 1; i < length; i += 1) {
      value = value * 256 + (buf[offset + i] ?? 0);
    }
    return value;
  }
  const text = buf.toString('ascii', offset, offset + length).replace(/\0/g, '').trim();
  if (text.length === 0) return 0;
  const value = parseInt(text, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Join the ustar `prefix` and `name` fields.
 *
 * `prefix` exists so a path longer than 100 bytes can still be stored: the
 * directory part goes in `prefix` and the rest in `name`. 192 entries in
 * the reference archive rely on this.
 */
function joinPrefix(buf: Buffer, headerOffset: number): string {
  const name = readField(buf, headerOffset, 100);
  const prefix = readField(buf, headerOffset + 345, 155);
  if (prefix.length === 0) return name;
  if (name.length === 0) return prefix;
  return `${prefix}/${name}`;
}

/**
 * Parse the `key=value` records of a pax extended header.
 *
 * Each record is `<decimal length><space><key>=<value><newline>`, where the
 * length covers the whole record including its own digits. Only `path` and
 * `size` are meaningful to us; the rest (`mtime`, `uid`, `uname`, …) is
 * ignored.
 */
function parsePaxRecords(body: Buffer): { path?: string; size?: number } {
  const out: { path?: string; size?: number } = {};
  let i = 0;

  while (i < body.length) {
    let space = i;
    while (space < body.length && body[space] !== 0x20) space += 1;
    if (space >= body.length) break;

    const recordLength = Number(body.toString('ascii', i, space));
    if (!Number.isFinite(recordLength) || recordLength <= 0) break;

    const recordEnd = i + recordLength;
    if (recordEnd > body.length) break;

    const record = body.toString('utf8', space + 1, recordEnd);
    const equals = record.indexOf('=');
    if (equals > 0) {
      const key = record.slice(0, equals);
      const value = record.slice(equals + 1).replace(/\n$/, '');
      if (key === 'path') out.path = value;
      else if (key === 'size') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) out.size = parsed;
      }
    }

    i = recordEnd;
  }

  return out;
}
