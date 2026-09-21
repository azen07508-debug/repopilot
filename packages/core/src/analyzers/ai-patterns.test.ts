import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../git/files.js';
import { analyzeAiPatterns, duplicateRuns } from './ai-patterns.js';

function file(path: string, size = 100): FileEntry {
  return { path, size };
}

function scan(files: Record<string, string>) {
  const entries = Object.keys(files).map((p) => file(p));
  return analyzeAiPatterns(entries, new Map(Object.entries(files)));
}

function ids(files: Record<string, string>): string[] {
  return scan(files).findings.map((f) => f.id);
}

describe('placeholder returns', () => {
  it('flags a function named like a check whose body returns a constant', () => {
    const result = scan({
      'src/payment.ts': 'export function verifyPayment(id: string) {\n  return true;\n}\n',
    });
    const finding = result.findings.find((f) => f.id.startsWith('ai-placeholder-return'));
    expect(finding?.severity).toBe('high');
    expect(finding?.title).toContain('verifyPayment');
    expect(finding?.evidence[0]?.line).toBe(1);
  });

  it('flags the arrow-function form', () => {
    const found = ids({
      'src/auth.ts': 'const isValid = (token: string) => {\n  return false;\n};\n',
    });
    expect(found.some((id) => id.startsWith('ai-placeholder-return'))).toBe(true);
  });

  it('does not flag a name that promises nothing', () => {
    expect(ids({ 'src/x.ts': 'export function getName() {\n  return "x";\n}\n' })).not.toContain(
      expect.stringContaining('ai-placeholder-return')
    );
  });

  it('does not flag a body that actually does something', () => {
    const found = ids({
      'src/x.ts': 'export function verifyPayment(id: string) {\n  const row = lookup(id);\n  return row !== null;\n}\n',
    });
    expect(found.some((id) => id.startsWith('ai-placeholder-return'))).toBe(false);
  });
});

describe('empty catch blocks', () => {
  it('flags one', () => {
    const result = scan({ 'src/x.ts': 'try {\n  risky();\n} catch (e) {}\n' });
    const finding = result.findings.find((f) => f.id.startsWith('ai-empty-catch'));
    expect(finding?.severity).toBe('medium');
  });

  it('flags a catch with no binding', () => {
    expect(ids({ 'src/x.ts': 'try { risky(); } catch {}\n' })).toContain(
      'ai-empty-catch-src-x-ts-1'
    );
  });

  it('does not flag a catch that handles the error', () => {
    const found = ids({ 'src/x.ts': 'try { risky(); } catch (e) { log(e); }\n' });
    expect(found.some((id) => id.startsWith('ai-empty-catch'))).toBe(false);
  });
});

describe('mock libraries outside tests', () => {
  it('flags a mock imported from production source', () => {
    const result = scan({
      'src/api.ts': "import { setupServer } from 'msw';\n",
    });
    const finding = result.findings.find((f) => f.id.startsWith('ai-mock-in-production'));
    expect(finding?.severity).toBe('medium');
  });

  it('does not flag a mock inside a test file', () => {
    const found = ids({ 'src/api.test.ts': "import { setupServer } from 'msw';\n" });
    expect(found.some((id) => id.startsWith('ai-mock-in-production'))).toBe(false);
  });

  it('does not flag a mock under __tests__', () => {
    const found = ids({ 'src/__tests__/api.ts': "import nock from 'nock';\n" });
    expect(found.some((id) => id.startsWith('ai-mock-in-production'))).toBe(false);
  });
});

describe('TODO markers', () => {
  it('flags one in source', () => {
    const result = scan({ 'src/x.ts': 'export function run() {\n  // TODO: handle retries\n}\n' });
    const finding = result.findings.find((f) => f.id.startsWith('ai-todo-in-implementation'));
    expect(finding?.severity).toBe('low');
    expect(finding?.evidence[0]?.line).toBe(2);
  });

  it('flags FIXME too', () => {
    expect(ids({ 'src/x.ts': '// FIXME later\n' })).toContain(
      'ai-todo-in-implementation-src-x-ts-1'
    );
  });

  it('ignores files that are not source', () => {
    expect(ids({ 'README.md': '// TODO: not code\n' })).toEqual([]);
  });
});

describe('duplicate blocks', () => {
  const block = Array.from({ length: 8 }, (_, i) => `  const value${i} = compute(${i});`).join('\n');

  it('finds a repeated run', () => {
    const found = ids({ 'src/x.ts': `${block}\n\nsomethingElse();\n\n${block}\n` });
    expect(found.some((id) => id.startsWith('ai-duplicated-block'))).toBe(true);
  });

  it('ignores short runs', () => {
    const short = 'const a = 1;\nconst b = 2;';
    expect(ids({ 'src/x.ts': `${short}\n\nother();\n\n${short}\n` })).toEqual([]);
  });

  it('ignores runs that are mostly whitespace', () => {
    const blank = Array.from({ length: 8 }, () => '  ').join('\n');
    expect(ids({ 'src/x.ts': `${blank}\nx();\n${blank}\n` })).toEqual([]);
  });

  it('reports each run once', () => {
    const runs = duplicateRuns(`${block}\n${block}\n${block}`.split('\n'));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThan(3);
  });
});

describe('limits and evidence', () => {
  it('caps findings per rule per file', () => {
    const many = Array.from({ length: 10 }, (_, i) => `// TODO: item ${i}`).join('\n');
    const found = ids({ 'src/x.ts': many });
    expect(found.filter((id) => id.startsWith('ai-todo-in-implementation')).length).toBeLessThanOrEqual(3);
  });

  it('only scans source files', () => {
    const result = scan({ 'notes.txt': '// TODO: x\n' });
    expect(result.filesScanned).toBe(0);
  });

  it('gives every finding a path, a line and a reason', () => {
    const result = scan({
      'src/x.ts': '// TODO: a\ntry { y(); } catch (e) {}\n',
    });
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.evidence[0]?.file).toBe('src/x.ts');
      expect(f.evidence[0]?.line).toBeGreaterThan(0);
      expect(f.evidence[0]?.reason.length).toBeGreaterThan(0);
      expect(f.evidence[0]?.source).toBe('text_match');
    }
  });

  it('marks everything as meta, so it stays out of the launch score', () => {
    const result = scan({ 'src/x.ts': '// TODO: a\n' });
    expect(result.findings.every((f) => f.category === 'meta')).toBe(true);
  });
});
