import { describe, it, expect } from 'vitest';
import { classifyFile, filterFiles, detectLanguage } from '../git/files.js';

describe('classifyFile', () => {
  it('treats .ts as text', () => {
    expect(classifyFile('src/index.ts', 100).kind).toBe('text');
  });
  it('treats .png as binary', () => {
    expect(classifyFile('assets/logo.png', 100).kind).toBe('binary');
  });
  it('skips node_modules', () => {
    expect(classifyFile('node_modules/foo/index.js', 100).kind).toBe('ignore');
  });
  it('skips .git directory', () => {
    expect(classifyFile('.git/HEAD', 100).kind).toBe('ignore');
  });
  it('allows .env.example', () => {
    expect(classifyFile('.env.example', 100).kind).toBe('text');
  });
  it('blocks .env (not example)', () => {
    expect(classifyFile('.env', 100).kind).toBe('text'); // still text; analyzer handles masking
  });
  it('skips path traversal', () => {
    expect(classifyFile('../secrets.txt', 100).kind).toBe('ignore');
  });
  it('skips hidden files (non-config)', () => {
    expect(classifyFile('.secret-key', 100).kind).toBe('ignore');
  });
  it('treats Dockerfile (no ext) as text', () => {
    expect(classifyFile('Dockerfile', 100).kind).toBe('text');
  });
  it('treats Makefile as text', () => {
    expect(classifyFile('Makefile', 100).kind).toBe('text');
  });
});

describe('filterFiles', () => {
  it('enforces maxFiles', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts`, size: 10 }));
    const r = filterFiles(entries, { maxFiles: 2, maxFileBytes: 1000 });
    expect(r.included).toHaveLength(2);
    expect(r.skipped).toHaveLength(3);
  });
  it('enforces maxFileBytes', () => {
    const r = filterFiles([{ path: 'big.ts', size: 2000 }], { maxFiles: 100, maxFileBytes: 1000 });
    expect(r.included).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe('exceeds-max-file-bytes');
  });
  it('skips binary files', () => {
    const r = filterFiles([{ path: 'logo.png', size: 100 }], { maxFiles: 100, maxFileBytes: 1000 });
    expect(r.skipped[0]?.reason).toBe('binary-extension');
  });
});

describe('detectLanguage', () => {
  it('detects TypeScript', () => expect(detectLanguage('foo.ts')).toBe('TypeScript'));
  it('detects Solidity', () => expect(detectLanguage('Foo.sol')).toBe('Solidity'));
  it('detects Python', () => expect(detectLanguage('foo.py')).toBe('Python'));
  it('returns null for unknown', () => expect(detectLanguage('foo.xyz')).toBeNull());
});
