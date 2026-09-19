import { describe, it, expect } from 'vitest';
import { ReportSchema } from '../schemas/report.js';
import { ReportBuilder } from '../report/builder.js';
import type { RepoMetadata } from '../analyzers/metadata.js';
import type { FileEntry } from '../git/files.js';

const baseMetadata: RepoMetadata = {
  owner: 'okx',
  name: 'repopilot',
  defaultBranch: 'main',
  license: 'MIT',
  lastUpdatedAt: '2026-01-01T00:00:00Z',
  visibility: 'public',
  archived: false,
  stars: 0,
  openIssues: 0,
  openPulls: 0,
  description: 'Test',
  primaryLanguage: 'TypeScript',
  url: 'https://github.com/okx/repopilot',
};

describe('Report schema', () => {
  it('accepts the output of a clean report', () => {
    const r = new ReportBuilder().build({
      metadata: baseMetadata,
      entries: [{ path: 'README.md', size: 50 }],
      contents: new Map([['README.md', '# Title\n']]),
      truncated: false,
      auditMode: 'quick',
      target: 'open_source',
      outputLanguage: 'en',
      includeLaunchCopy: true,
    });
    const result = ReportSchema.safeParse(r.report);
    expect(result.success).toBe(true);
  });
});
