/**
 * tarball extraction tests.
 *
 * Every archive is built by hand. No network, no filesystem, no gunzip —
 * `extractTarball` takes the archive after decompression, which is what
 * makes this path testable at all (ADR D-017: tests never reach GitHub).
 */
import { describe, it, expect } from 'vitest';
import { archiveRoot, extractTarball, stripRoot } from './tarball.js';

const BLOCK = 512;

interface HeaderOpts {
  name?: string;
  size?: number;
  typeflag?: string;
}

function header(o: HeaderOpts = {}): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.write(o.name ?? '', 0, 100, 'utf8');
  b.write('0000644\0', 100, 8, 'ascii');
  b.write('0000000\0', 108, 8, 'ascii');
  b.write('0000000\0', 116, 8, 'ascii');
  b.write(`${(o.size ?? 0).toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
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

const EOF = Buffer.alloc(BLOCK * 2);

/** An archive: an optional root directory, then the given files in order. */
function archive(root: string | null, files: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [];
  if (root !== null) parts.push(header({ name: `${root}/`, typeflag: '5' }));
  for (const [name, text] of files) {
    const body = Buffer.from(text, 'utf8');
    parts.push(header({ name: root === null ? name : `${root}/${name}`, size: body.length }), padToBlock(body));
  }
  parts.push(EOF);
  return Buffer.concat(parts);
}

const ALL_CAPS = { maxFileBytes: 100_000, maxTotalBytes: 100_000 };

describe('archiveRoot', () => {
  it('finds the single directory everything sits under', () => {
    expect(archiveRoot(['repo-main/src/a.ts', 'repo-main/README.md'])).toBe('repo-main');
  });

  it('returns empty for a flat archive', () => {
    // Stripping "src" out of these would turn `src/a.ts` into `a.ts`.
    expect(archiveRoot(['src/a.ts', 'b.ts'])).toBe('');
  });

  it('returns empty when the roots disagree', () => {
    expect(archiveRoot(['one/a.ts', 'two/b.ts'])).toBe('');
  });

  it('returns empty for no entries at all', () => {
    expect(archiveRoot([])).toBe('');
  });
});

describe('stripRoot', () => {
  it('removes the root segment', () => {
    expect(stripRoot('repo-main/src/a.ts', 'repo-main')).toBe('src/a.ts');
  });

  it('leaves a path that does not start with the root alone', () => {
    expect(stripRoot('other/src/a.ts', 'repo-main')).toBe('other/src/a.ts');
  });

  it('leaves everything alone when there is no root', () => {
    expect(stripRoot('src/a.ts', '')).toBe('src/a.ts');
  });
});

describe('extractTarball', () => {
  it('reads a file, with the archive root stripped', () => {
    const arc = archive('repo-abc1234', [
      ['README.md', '# hi'],
      ['src/index.ts', 'export const x = 1;'],
    ]);

    const r = extractTarball(arc, { wanted: new Set(['README.md', 'src/index.ts']), ...ALL_CAPS });

    expect(r.root).toBe('repo-abc1234');
    expect(r.contents.get('README.md')).toBe('# hi');
    expect(r.contents.get('src/index.ts')).toBe('export const x = 1;');
    expect(r.truncated).toBe(false);
  });

  it('leaves paths alone when the archive has no root directory', () => {
    const arc = archive(null, [['src/index.ts', 'x']]);

    const r = extractTarball(arc, { wanted: new Set(['src/index.ts']), ...ALL_CAPS });

    expect(r.root).toBe('');
    expect(r.contents.get('src/index.ts')).toBe('x');
  });

  it('does not mistake a real top-level directory for an archive wrapper', () => {
    // `src/` plus `src/a.ts`: every entry sits under one directory, which
    // is exactly what a wrapped archive looks like. Detecting the root
    // from the shape alone strips `src` and yields `a.ts` — a file that
    // does not exist in the repository. Only the wanted set, which came
    // from the real tree, can tell the two apart.
    const arc = Buffer.concat([
      header({ name: 'src/', typeflag: '5' }),
      header({ name: 'src/a.ts', size: 1 }),
      padToBlock(Buffer.from('a')),
      EOF,
    ]);

    const r = extractTarball(arc, { wanted: new Set(['src/a.ts']), ...ALL_CAPS });

    expect(r.root).toBe('');
    expect(r.contents.get('src/a.ts')).toBe('a');
  });

  it('reads only the paths it was asked for', () => {
    const arc = archive('repo-main', [
      ['src/a.ts', 'a'],
      ['src/b.ts', 'b'],
      ['vendor/huge.ts', 'c'],
    ]);

    const r = extractTarball(arc, { wanted: new Set(['src/a.ts']), ...ALL_CAPS });

    expect([...r.contents.keys()]).toEqual(['src/a.ts']);
    expect(r.totalBytes).toBe(1);
  });

  it('stops walking once every wanted path has been found', () => {
    const arc = archive('repo-main', [
      ['src/a.ts', 'a'],
      ['src/b.ts', 'b'],
      ['src/c.ts', 'c'],
    ]);

    const r = extractTarball(arc, { wanted: new Set(['src/a.ts']), ...ALL_CAPS });

    // Three regular files in the archive, one visited: the walk stopped.
    expect(r.stats.files).toBe(1);
  });

  it('never returns a directory as a file', () => {
    const arc = archive('repo-main', [['src/a.ts', 'a']]);

    const r = extractTarball(arc, { wanted: new Set(['repo-main', 'src']), ...ALL_CAPS });

    expect(r.contents.size).toBe(0);
    expect(r.missing.sort()).toEqual(['repo-main', 'src']);
  });

  it('skips a file over maxFileBytes', () => {
    const arc = archive('repo-main', [['big.ts', 'x'.repeat(200)]]);

    const r = extractTarball(arc, {
      wanted: new Set(['big.ts']),
      maxFileBytes: 50,
      maxTotalBytes: 100_000,
    });

    expect(r.contents.size).toBe(0);
    expect(r.missing).toEqual(['big.ts']);
  });

  it('stops at maxTotalBytes and says it truncated', () => {
    const arc = archive('repo-main', [
      ['a.ts', 'a'.repeat(500)],
      ['b.ts', 'b'.repeat(500)],
    ]);

    const r = extractTarball(arc, {
      wanted: new Set(['a.ts', 'b.ts']),
      maxFileBytes: 100_000,
      maxTotalBytes: 700,
    });

    // 500 fits, 500 more would not. What was read stays readable.
    expect(r.contents.get('a.ts')).toBe('a'.repeat(500));
    expect(r.contents.has('b.ts')).toBe(false);
    expect(r.truncated).toBe(true);
    expect(r.totalBytes).toBe(500);
  });

  it('reports a wanted path the archive does not contain', () => {
    const arc = archive('repo-main', [['a.ts', 'a']]);

    const r = extractTarball(arc, { wanted: new Set(['a.ts', 'gone.ts']), ...ALL_CAPS });

    expect(r.missing).toEqual(['gone.ts']);
  });

  it('reports a non-empty archive as not truncated', () => {
    const arc = archive('repo-main', [['a.ts', 'a']]);

    const r = extractTarball(arc, { wanted: new Set(['a.ts']), ...ALL_CAPS });
    expect(r.truncated).toBe(false);
    expect(r.stats.files).toBe(1);
  });

  it('counts the bytes it decoded', () => {
    const arc = archive('repo-main', [
      ['a.ts', 'a'.repeat(10)],
      ['b.ts', 'b'.repeat(7)],
    ]);

    const r = extractTarball(arc, { wanted: new Set(['a.ts', 'b.ts']), ...ALL_CAPS });
    expect(r.totalBytes).toBe(17);
  });
});
