import { describe, it, expect } from 'vitest';
import { ReportBuilder } from '../report/builder.js';
import type { RepoMetadata } from '../analyzers/metadata.js';
import type { FileEntry } from '../git/files.js';

function entry(path: string, size = 50): FileEntry {
  return { path, size };
}

const baseMetadata: RepoMetadata = {
  owner: 'okx',
  name: 'repopilot',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: '2026-01-01T00:00:00Z',
  visibility: 'public',
  archived: false,
  stars: 12,
  openIssues: 0,
  openPulls: 0,
  description: 'Test repo',
  primaryLanguage: 'TypeScript',
  url: 'https://github.com/okx/repopilot',
};

describe('ReportBuilder', () => {
  it('builds a complete report for a clean repo', () => {
    const entries: FileEntry[] = [
      entry('README.md'),
      entry('LICENSE'),
      entry('.env.example'),
      entry('.github/workflows/ci.yml'),
      entry('Dockerfile'),
      entry('package.json'),
      entry('pnpm-lock.yaml'),
      entry('src/index.ts'),
      entry('src/utils/logger.ts'),
      entry('docs/screenshot.png'),
    ];
    const contents = new Map<string, string>([
      ['README.md', '# Title\n## Install\n`pnpm install`\n## Run\n`pnpm dev`\n## Test\n`pnpm test`\nDemo: https://demo.example.com\n'],
      ['LICENSE', 'MIT License\n\nCopyright (c) 2026\n'],
      ['.env.example', 'API_KEY=\n'],
      ['.github/workflows/ci.yml', 'name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'],
      ['Dockerfile', 'FROM node:20\nCMD ["node", "dist/index.js"]\n'],
      ['package.json', JSON.stringify({ name: 'r', scripts: { dev: 'node', test: 'node test', start: 'node' } })],
      ['pnpm-lock.yaml', 'lockfileVersion: 9\n'],
      ['src/index.ts', 'export const x = 1;\n'],
      ['src/utils/logger.ts', 'export const y = 2;\n'],
    ]);
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries,
      contents,
      truncated: false,
      auditMode: 'full',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: true,
    });
    expect(r.report.repository.owner).toBe('okx');
    expect(r.report.detectedStack).toContain('TypeScript');
    expect(r.report.detectedStack).toContain('Node.js');
    expect(r.report.detectedStack).toContain('Docker');
    expect(r.report.detectedStack).toContain('GitHub Actions');
    expect(r.report.scores.overall).toBeGreaterThan(80);
    expect(r.report.launchCopy.oneSentencePitch.length).toBeGreaterThan(0);
    expect(r.report.summary.length).toBeGreaterThan(0);
    expect(r.report.blockers).toEqual([]);
  });

  it('flags missing README as a documentation gap', () => {
    const entries = [entry('package.json'), entry('LICENSE')];
    const contents = new Map<string, string>([
      ['package.json', JSON.stringify({ name: 'r' })],
      ['LICENSE', 'MIT\n'],
    ]);
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries,
      contents,
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: false,
    });
    expect(r.report.documentationGaps.some((f) => f.id === 'doc-readme')).toBe(true);
  });

  it('does NOT include the actual secret value in the report', () => {
    const secret = 'sk_live_aaaaaaaaaaaaaaaaaaaaaa';
    const entries = [entry('README.md'), entry('package.json')];
    const contents = new Map<string, string>([
      ['README.md', '# Title\n'],
      ['package.json', `module.exports = { KEY: "${secret}" };\n`],
    ]);
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries,
      contents,
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: false,
    });
    const json = JSON.stringify(r.report);
    expect(json.includes(secret)).toBe(false);
    expect(json.includes('sk_live_')).toBe(false);
  });

  it('produces a complete report even with no LLM configured', () => {
    const entries = [entry('README.md'), entry('LICENSE'), entry('package.json')];
    const contents = new Map<string, string>([
      ['README.md', '# Title\n## Install\npnpm install\n## Test\npnpm test\nDemo: https://demo.example.com\n'],
      ['LICENSE', 'MIT\n'],
      ['package.json', JSON.stringify({ scripts: { test: 'echo' } })],
    ]);
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries,
      contents,
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: true,
    });
    expect(r.report.summary).not.toBe('');
    expect(r.report.launchCopy.oneSentencePitch).not.toBe('');
  });

  it('produces Chinese summary when language is zh-CN', () => {
    const entries = [entry('README.md'), entry('package.json')];
    const contents = new Map<string, string>([
      ['README.md', '# 标题\n'],
      ['package.json', JSON.stringify({ scripts: { test: 'echo' } })],
    ]);
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries,
      contents,
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'zh-CN',
      includeLaunchCopy: true,
    });
    // Chinese characters present somewhere in summary
    expect(/[\u4e00-\u9fa5]/.test(r.report.summary)).toBe(true);
  });
});
