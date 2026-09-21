import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../git/files.js';
import { analyzeHygiene } from './hygiene.js';

function file(path: string, size = 100): FileEntry {
  return { path, size };
}

function run(entries: FileEntry[], contents: Record<string, string> = {}) {
  return analyzeHygiene(entries, new Map(Object.entries(contents)));
}

function ids(entries: FileEntry[], contents: Record<string, string> = {}): string[] {
  return run(entries, contents).findings.map((f) => f.id);
}

describe('committed .env', () => {
  it('flags a .env in the tracked tree as critical', () => {
    const result = run([file('.env'), file('README.md')], { '.env': 'SECRET=1' });
    const finding = result.findings.find((f) => f.id.startsWith('env-committed'));
    expect(finding?.severity).toBe('critical');
    expect(finding?.evidence[0]?.file).toBe('.env');
    // Being listed at all proves it is tracked.
    expect(finding?.evidence[0]?.reason).toContain('tracked');
    expect(result.envCommitted).toBe(true);
  });

  it('flags a nested .env too', () => {
    expect(ids([file('apps/api/.env')])).toContain('env-committed-apps-api-env');
  });

  it('does not flag .env.example', () => {
    const result = run([file('.env.example'), file('.gitignore')], {
      '.gitignore': '.env\n',
    });
    expect(result.envCommitted).toBe(false);
    expect(result.findings.filter((f) => f.id.startsWith('env-committed'))).toEqual([]);
  });

  it('does not flag .env.sample', () => {
    expect(ids([file('.env.sample'), file('.gitignore')], { '.gitignore': '.env\n' })).not.toContain(
      'env-not-ignored'
    );
  });
});

describe('.env not ignored', () => {
  it('warns when nothing excludes .env', () => {
    const result = run([file('.gitignore'), file('README.md')], { '.gitignore': 'node_modules\n' });
    const finding = result.findings.find((f) => f.id === 'env-not-ignored');
    expect(finding?.severity).toBe('medium');
    expect(finding?.evidence[0]?.reason).toContain('no entry matching .env');
  });

  it('stays quiet when .gitignore covers it', () => {
    const result = run([file('.gitignore')], { '.gitignore': 'node_modules\n.env\n' });
    expect(result.gitignoreIgnoresEnv).toBe(true);
    expect(ids([file('.gitignore')], { '.gitignore': 'node_modules\n.env\n' })).not.toContain(
      'env-not-ignored'
    );
  });

  it('accepts a wildcard form', () => {
    expect(run([file('.gitignore')], { '.gitignore': '.env*\n' }).gitignoreIgnoresEnv).toBe(true);
    expect(run([file('.gitignore')], { '.gitignore': '*.env\n' }).gitignoreIgnoresEnv).toBe(true);
  });

  it('does not also report env-not-ignored when a .env is already committed', () => {
    // The committed file is the bigger problem; two findings for one
    // situation would be noise.
    const found = ids([file('.env'), file('.gitignore')], { '.gitignore': 'node_modules\n' });
    expect(found.some((id) => id.startsWith('env-committed'))).toBe(true);
    expect(found).not.toContain('env-not-ignored');
  });
});

describe('.gitignore missing', () => {
  it('reports it', () => {
    const finding = run([file('README.md')]).findings.find((f) => f.id === 'repo-no-gitignore');
    expect(finding?.severity).toBe('low');
  });

  it('does not report it when the file exists', () => {
    expect(ids([file('.gitignore')], { '.gitignore': '.env\n' })).not.toContain('repo-no-gitignore');
  });
});

describe('CI workflows', () => {
  it('reports an empty workflow', () => {
    const found = ids([file('.github/workflows/ci.yml')], { '.github/workflows/ci.yml': '   \n' });
    expect(found.some((id) => id.startsWith('ci-workflow-invalid'))).toBe(true);
  });

  it('reports a workflow with no trigger', () => {
    const found = ids([file('.github/workflows/ci.yml')], {
      '.github/workflows/ci.yml': 'jobs:\n  test:\n    runs-on: ubuntu-latest\n',
    });
    expect(found.some((id) => id.startsWith('ci-workflow-invalid'))).toBe(true);
  });

  it('reports a workflow with no jobs', () => {
    const found = ids([file('.github/workflows/ci.yml')], {
      '.github/workflows/ci.yml': 'on: push\n',
    });
    expect(found.some((id) => id.startsWith('ci-workflow-invalid'))).toBe(true);
  });

  it('accepts a well-formed workflow', () => {
    const found = ids([file('.github/workflows/ci.yml')], {
      '.github/workflows/ci.yml': 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
    });
    expect(found.some((id) => id.startsWith('ci-workflow-invalid'))).toBe(false);
  });

  it('says nothing about a workflow it could not read', () => {
    // Present in the tree but not fetched: guessing would be worse.
    expect(ids([file('.github/workflows/ci.yml')])).not.toContain('ci-workflow-invalid-ci-yml');
  });
});

describe('test runner', () => {
  it('reports test files with no runner declared', () => {
    const found = ids(
      [file('src/a.test.ts'), file('package.json')],
      { 'package.json': JSON.stringify({ name: 'x' }) }
    );
    expect(found).toContain('test-no-runner');
  });

  it('stays quiet when a runner is declared', () => {
    const found = ids([file('src/a.test.ts'), file('package.json')], {
      'package.json': JSON.stringify({ devDependencies: { vitest: '^2' } }),
    });
    expect(found).not.toContain('test-no-runner');
  });

  it('accepts pytest through pyproject', () => {
    const found = ids([file('tests/test_a.py'), file('pyproject.toml')], {
      'pyproject.toml': '[tool.pytest.ini_options]\n',
    });
    expect(found).not.toContain('test-no-runner');
  });

  it('accepts a conftest.py', () => {
    expect(ids([file('tests/test_a.py'), file('conftest.py')])).not.toContain('test-no-runner');
  });

  it('says nothing when there are no tests at all', () => {
    expect(ids([file('src/index.ts')])).not.toContain('test-no-runner');
  });
});

describe('evidence', () => {
  it('names a source on every finding', () => {
    const result = run([file('.env'), file('README.md')]);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.evidence[0]?.source).toBeDefined();
      expect(f.evidence[0]?.reason.length).toBeGreaterThan(0);
    }
  });

  it('carries a path on every finding', () => {
    const result = run([file('.env'), file('README.md')]);
    for (const f of result.findings) {
      expect(f.evidence[0]?.file).toBeTruthy();
    }
  });
});
