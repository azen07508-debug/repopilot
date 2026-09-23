/**
 * tar reader tests.
 *
 * Every archive is built by hand — no fixture on disk, no gunzip, no
 * network — so each case names one property of the format and asserts it
 * against real bytes.
 *
 * The cases here are the ones a plausible simplification would break:
 * advancing by the header's size instead of the effective size, ignoring
 * the pre-ustar trailing-slash directory marker, trimming trailing NULs
 * instead of cutting at the first, and dropping the trailing-partial-block
 * truncation check. Each was verified by reintroducing the defect into a
 * copy of the reader and confirming the corresponding test fails.
 */
import { describe, it, expect } from 'vitest';
import { walkTar, type TarStats } from './tar.js';

const BLOCK = 512;

interface HeaderOpts {
  name?: string;
  prefix?: string;
  size?: number;
  typeflag?: string;
  /** Raw 12-byte size field, for the GNU base-256 form. */
  sizeField?: Buffer;
  /** Raw 100-byte name field, to put bytes after the terminator. */
  nameField?: Buffer;
}

/** One 512-byte ustar header, with a valid checksum. */
function header(o: HeaderOpts = {}): Buffer {
  const b = Buffer.alloc(BLOCK);
  if (o.nameField) o.nameField.copy(b, 0);
  else b.write(o.name ?? '', 0, 100, 'utf8');
  b.write('0000644\0', 100, 8, 'ascii'); // mode
  b.write('0000000\0', 108, 8, 'ascii'); // uid
  b.write('0000000\0', 116, 8, 'ascii'); // gid
  if (o.sizeField) o.sizeField.copy(b, 124);
  else b.write(`${(o.size ?? 0).toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  b.write('00000000000\0', 136, 12, 'ascii'); // mtime
  b.write('        ', 148, 8, 'ascii'); // checksum, filled below
  b.write(o.typeflag ?? '0', 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  if (o.prefix) b.write(o.prefix, 345, 155, 'utf8');

  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return b;
}

/** Zero-pad to a whole number of blocks. */
function padToBlock(buf: Buffer): Buffer {
  const rem = buf.length % BLOCK;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(BLOCK - rem)]);
}

/** A pax record: `<decimal length><space><key>=<value><newline>`. */
function pax(key: string, value: string): Buffer {
  const body = `${key}=${value}\n`;
  let len = body.length + 2;
  for (let i = 0; i < 10; i += 1) {
    const candidate = `${len} ${body}`;
    if (candidate.length === len) return Buffer.from(candidate, 'utf8');
    len = candidate.length;
  }
  throw new Error('a pax record length has no fixed point');
}

/** A pax extended header block followed by its body. */
function paxEntry(name: string, records: Buffer): Buffer {
  return Buffer.concat([
    header({ name, typeflag: 'x', size: records.length }),
    padToBlock(records),
  ]);
}

function walk(archive: Buffer, maxFiles?: number): { paths: string[]; stats: TarStats } {
  const paths: string[] = [];
  const stats = walkTar(
    archive,
    (entry) => {
      paths.push(entry.path);
    },
    maxFiles === undefined ? {} : { maxFiles }
  );
  return { paths, stats };
}

/** The two end-of-archive zero blocks. */
const EOF = Buffer.alloc(BLOCK * 2);

describe('walkTar — entry addressing', () => {
  it('steps over a payload the pax header sized differently from the header', () => {
    // The header says 0 bytes and the pax record says 1024. Stepping by
    // the header value walks the payload block by block instead of over
    // it — and because a mis-read block parses to size 0, the walk creeps
    // one block at a time and re-syncs, so the paths still come out right.
    // `skippedSpecial` is what shows the payload was handed to the entry
    // loop, which is why this test asserts on it.
    const archive = Buffer.concat([
      paxEntry('0000.paxheader', pax('size', '1024')),
      header({ name: 'big.bin', size: 0 }),
      Buffer.alloc(1024, 0x41),
      header({ name: 'after.txt', size: 3 }),
      padToBlock(Buffer.from('end')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['big.bin', 'after.txt']);
    expect(stats.skippedSpecial).toBe(0);
  });

  it('does not let a payload that parses as a size swallow the next entry', () => {
    // The same disagreement, but the payload carries octal digits at the
    // offset the size field occupies. Now the creep is not self-correcting:
    // the bogus header claims 4095 bytes and the walk jumps past
    // `after.txt`, reporting a truncated archive that is not truncated.
    const payload = Buffer.alloc(1024, 0x41);
    payload.write('00000007777\0', 124, 12, 'ascii');

    const archive = Buffer.concat([
      paxEntry('0000.paxheader', pax('size', '1024')),
      header({ name: 'big.bin', size: 0 }),
      payload,
      header({ name: 'after.txt', size: 3 }),
      padToBlock(Buffer.from('end')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['big.bin', 'after.txt']);
    expect(stats.truncated).toBe(false);
  });

  it('prefers the pax path= record over the header name', () => {
    const longPath = `src/${'x'.repeat(120)}.ts`;
    const archive = Buffer.concat([
      paxEntry('0000.paxheader', pax('path', longPath)),
      header({ name: 'short.ts', size: 2 }),
      padToBlock(Buffer.from('hi')),
      EOF,
    ]);

    expect(walk(archive).paths).toEqual([longPath]);
  });

  it('joins the ustar prefix and name fields', () => {
    const archive = Buffer.concat([
      header({ name: 'deep.txt', prefix: 'a/b/c', size: 2 }),
      padToBlock(Buffer.from('hi')),
      EOF,
    ]);

    expect(walk(archive).paths).toEqual(['a/b/c/deep.txt']);
  });

  it('handles a name that uses the whole 100-byte field', () => {
    const name = 'n'.repeat(100);
    const archive = Buffer.concat([header({ name, size: 1 }), padToBlock(Buffer.from('x')), EOF]);

    expect(walk(archive).paths).toEqual([name]);
  });
});

describe('walkTar — entry classification', () => {
  it('reads a pre-ustar directory as a directory, not a file named "dir/"', () => {
    // The pre-ustar format has no typeflag at all and marks a directory
    // with a trailing slash in the name instead.
    const archive = Buffer.concat([
      header({ name: 'dir/', typeflag: '\0', size: 0 }),
      header({ name: 'dir/f.txt', size: 5 }),
      padToBlock(Buffer.from('hello')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['dir/f.txt']);
    expect(stats.directories).toBe(1);
    expect(stats.files).toBe(1);
  });

  it('reads a typeflag-5 directory as a directory', () => {
    const archive = Buffer.concat([
      header({ name: 'dir/', typeflag: '5', size: 0 }),
      header({ name: 'dir/f.txt', size: 1 }),
      padToBlock(Buffer.from('x')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['dir/f.txt']);
    expect(stats.directories).toBe(1);
  });

  it('skips a symlink rather than following it', () => {
    const archive = Buffer.concat([
      header({ name: 'link.ts', typeflag: '2', size: 0 }),
      header({ name: 'real.ts', size: 1 }),
      padToBlock(Buffer.from('x')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['real.ts']);
    expect(stats.skippedSpecial).toBe(1);
  });

  it('stops a name at the first NUL, not at the last', () => {
    const nameField = Buffer.alloc(100);
    nameField.write('abc', 0, 'utf8');
    nameField.write('garbage', 4, 'utf8');

    const archive = Buffer.concat([header({ nameField, size: 3 }), padToBlock(Buffer.from('xyz')), EOF]);
    expect(walk(archive).paths).toEqual(['abc']);
  });
});

describe('walkTar — truncation', () => {
  it('reports a trailing partial block as truncated', () => {
    const archive = Buffer.concat([header({ name: 'a.txt', size: 0 }), Buffer.alloc(100, 0x42)]);

    expect(walk(archive).stats.truncated).toBe(true);
  });

  it('reports a declared size that runs past the end as truncated', () => {
    const archive = Buffer.concat([header({ name: 'a.txt', size: 1024 }), Buffer.alloc(BLOCK, 0x42)]);

    expect(walk(archive).stats.truncated).toBe(true);
  });

  it('does not report a well-formed archive as truncated', () => {
    const archive = Buffer.concat([
      header({ name: 'a.txt', size: 2 }),
      padToBlock(Buffer.from('hi')),
      EOF,
    ]);

    expect(walk(archive).stats.truncated).toBe(false);
  });

  it('keeps what it already visited when it stops early', () => {
    const archive = Buffer.concat([
      header({ name: 'a.txt', size: 2 }),
      padToBlock(Buffer.from('hi')),
      Buffer.alloc(100, 0x42),
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['a.txt']);
    expect(stats.truncated).toBe(true);
  });
});

describe('walkTar — numeric fields', () => {
  it('decodes a GNU base-256 size field and advances by it', () => {
    const sizeField = Buffer.alloc(12);
    sizeField[0] = 0x80;
    sizeField[10] = 0x02;
    sizeField[11] = 0xbc; // 700

    const archive = Buffer.concat([
      header({ name: 'b.bin', sizeField }),
      padToBlock(Buffer.alloc(700, 0x43)),
      header({ name: 'z.txt', size: 2 }),
      padToBlock(Buffer.from('hi')),
      EOF,
    ]);

    const { paths, stats } = walk(archive);
    expect(paths).toEqual(['b.bin', 'z.txt']);
    expect(stats.files).toBe(2);
  });

  it('gives the visitor a view of exactly the declared bytes', () => {
    const seen: number[] = [];
    const archive = Buffer.concat([
      header({ name: 'a.txt', size: 5 }),
      padToBlock(Buffer.from('hello')),
      EOF,
    ]);

    walkTar(archive, (entry) => {
      seen.push(entry.size, entry.bytes.length);
    });

    expect(seen).toEqual([5, 5]);
  });
});

describe('walkTar — visitor control', () => {
  it('stops the walk when the visitor returns false', () => {
    const archive = Buffer.concat([
      header({ name: 'a.txt', size: 1 }),
      padToBlock(Buffer.from('a')),
      header({ name: 'b.txt', size: 1 }),
      padToBlock(Buffer.from('b')),
      EOF,
    ]);

    const paths: string[] = [];
    const stats = walkTar(archive, (entry) => {
      paths.push(entry.path);
      return false;
    });

    expect(paths).toEqual(['a.txt']);
    expect(stats.files).toBe(1);
  });

  it('visits at most maxFiles entries', () => {
    const archive = Buffer.concat([
      header({ name: 'a.txt', size: 1 }),
      padToBlock(Buffer.from('a')),
      header({ name: 'b.txt', size: 1 }),
      padToBlock(Buffer.from('b')),
      EOF,
    ]);

    expect(walk(archive, 1).paths).toEqual(['a.txt']);
  });
});
