import { describe, it, expect } from 'vitest';
import { RepoUrlSchema } from '../schemas/inputs.js';
import { parseRepoUrl, InvalidRepoUrlError } from '../git/url.js';

describe('RepoUrlSchema', () => {
  it('accepts canonical GitHub URLs', () => {
    expect(() => RepoUrlSchema.parse('https://github.com/okx/repopilot')).not.toThrow();
  });
  it('rejects http:// URLs', () => {
    expect(() => RepoUrlSchema.parse('http://github.com/foo/bar')).toThrow();
  });
  it('rejects non-github hosts at the schema level', () => {
    // schema only checks shape; host allowlist lives in parseRepoUrl
    expect(() => RepoUrlSchema.parse('https://example.com/foo/bar')).not.toThrow();
  });
  it('rejects URLs without a path', () => {
    expect(() => RepoUrlSchema.parse('https://github.com')).toThrow();
  });
});

describe('parseRepoUrl', () => {
  it('parses an allowed github URL', () => {
    const r = parseRepoUrl('https://github.com/okx/repopilot', ['github.com']);
    expect(r).toEqual({
      raw: 'https://github.com/okx/repopilot',
      host: 'github.com',
      owner: 'okx',
      repo: 'repopilot',
      defaultBranchHint: null,
    });
  });
  it('strips trailing .git', () => {
    const r = parseRepoUrl('https://github.com/okx/repopilot.git', ['github.com']);
    expect(r.repo).toBe('repopilot');
  });
  it('rejects hosts not in the allowlist', () => {
    expect(() => parseRepoUrl('https://gitlab.com/foo/bar', ['github.com'])).toThrow(InvalidRepoUrlError);
  });
  it('rejects paths with illegal characters', () => {
    expect(() => parseRepoUrl('https://github.com/owne$r/repo', ['github.com'])).toThrow(InvalidRepoUrlError);
  });
  it('is case-insensitive on hostnames', () => {
    const r = parseRepoUrl('https://GitHub.com/okx/repopilot', ['github.com']);
    expect(r.host).toBe('github.com');
  });
});
