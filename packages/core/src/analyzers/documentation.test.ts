import { describe, it, expect } from 'vitest';
import { analyzeDocumentation } from './documentation.js';
import { analyzeHackathon } from './hackathon.js';
import { classifyFile, filterFiles } from '../git/files.js';
import { LICENSE_FILENAMES, README_FILENAMES } from '../utils/paths.js';

/**
 * Existence checks must be asked of the whole tree, not of the filtered set.
 *
 * These tests exist because the screenshot check used to be handed the
 * output of `filterFiles`, which removes binaries — and a screenshot is a
 * binary. The check was written correctly and could never succeed. Nothing
 * failed, nothing was red; the report simply said "no image files in repo"
 * about a repository with four of them.
 *
 * The first test below reproduces the pipeline shape exactly (classify →
 * filter → analyze) so that the two halves cannot drift apart again.
 */
describe('documentation existence checks', () => {
  it('sees a screenshot that the file filter removed', () => {
    // The real repopilot tree, as the self-audit saw it.
    const tree = [
      { path: 'screenshots/okx-seller-smoke-fullpage.png', size: 543_750 },
      { path: 'screenshots/mcp-audit-octocat-Hello-World-full.png', size: 166_853 },
      { path: 'docs/brand/hero.png', size: 900_000 },
      { path: 'README.md', size: 9_000 },
    ];

    // Half one: the filter really does drop them.
    const { included, skipped } = filterFiles(tree, { maxFiles: 2000, maxFileBytes: 1_048_576 });
    expect(included.map((e) => e.path)).toEqual(['README.md']);
    expect(skipped.filter((s) => s.reason === 'binary-extension')).toHaveLength(3);

    // Half two: the analyzer must still see them, because it is given the
    // unfiltered paths.
    const allPaths = tree.map((e) => e.path);
    const doc = analyzeDocumentation(allPaths, new Map([['README.md', '# x'.repeat(400)]]));
    expect(doc.hasScreenshots).toBe(true);
  });

  it('would fail if handed only the filtered set (the old bug)', () => {
    // Same tree, same filter — but the analyzer is given `included`.
    // This is the shape that produced "no image files in repo".
    const tree = [{ path: 'docs/brand/hero.png', size: 900_000 }];
    const { included } = filterFiles(tree, { maxFiles: 2000, maxFileBytes: 1_048_576 });
    const doc = analyzeDocumentation(
      included.map((e) => e.path),
      new Map()
    );
    expect(doc.hasScreenshots).toBe(false);
  });

  it('reports a README that exists but was too large to read, without calling it empty', () => {
    // Existence comes from the tree; content comes from `fileContents`.
    // A README over the per-file cap is present but unreadable, and must
    // not be reported as "0 characters long".
    const doc = analyzeDocumentation(['README.md'], new Map());
    expect(doc.hasReadme).toBe(true);
    expect(doc.findings.map((f) => f.id)).not.toContain('doc-readme');
    expect(doc.findings.map((f) => f.id)).not.toContain('doc-readme-short');
  });

  it('still reports a README that is genuinely absent', () => {
    const doc = analyzeDocumentation(['src/index.ts'], new Map());
    expect(doc.hasReadme).toBe(false);
    expect(doc.findings.map((f) => f.id)).toContain('doc-readme');
  });
});

describe('hackathon existence checks', () => {
  it('sees a screenshot that the file filter removed', () => {
    const allPaths = ['docs/brand/hero.png', 'README.md'];
    const hack = analyzeHackathon(allPaths, new Map(), [], []);
    expect(hack.hasScreenshots).toBe(true);
    expect(hack.findings.map((f) => f.id)).not.toContain('hack-no-screenshots');
  });

  it('still reports a repository with no images at all', () => {
    const hack = analyzeHackathon(['README.md', 'src/index.ts'], new Map(), [], []);
    expect(hack.hasScreenshots).toBe(false);
    expect(hack.findings.map((f) => f.id)).toContain('hack-no-screenshots');
  });

  it('sees an extensionless LICENSE', () => {
    const hack = analyzeHackathon(['LICENSE'], new Map(), [], []);
    expect(hack.hasLicense).toBe(true);
  });
});

describe('the filter/analyzer split is deliberate', () => {
  it('classifyFile calls a png binary — that is why existence needs its own list', () => {
    // If this ever changes, the two halves of the pipeline can be
    // reconsidered together. Until then, existence checks get `allPaths`.
    expect(classifyFile('docs/brand/hero.png', 900_000).kind).toBe('binary');
    expect(classifyFile('docs/brand/hero.svg', 900).kind).toBe('text');
  });
});

/**
 * One repository, two entry points, one answer.
 *
 * The free check and the paid audit carried separate README name lists and
 * separate license name lists. On `octocat/Hello-World` — a repository
 * whose entire contents are one file called `README` — the free check said
 * `has-readme: PASS` while the audit reported `[high] README.md is missing
 * or empty` as its top blocker and scored documentation 5.5.
 *
 * The lists now live in `utils/paths.ts` and both import them. These tests
 * pin the constant and the audit's behaviour against it; the free check
 * builds its lookup set from the same constant, so there is no second list
 * left to drift.
 */
describe('shared document name lists', () => {
  it('accepts a bare README, like octocat/Hello-World has', () => {
    expect(README_FILENAMES).toContain('README');
    const doc = analyzeDocumentation(['README'], new Map());
    expect(doc.hasReadme).toBe(true);
    expect(doc.findings.map((f) => f.id)).not.toContain('doc-readme');
  });

  it('accepts every README spelling either entry point accepted before', () => {
    // The union, so unifying did not make either entry point stricter.
    for (const name of ['README.md', 'README.markdown', 'README.rst', 'README.txt', 'README']) {
      expect(README_FILENAMES).toContain(name);
      expect(analyzeDocumentation([name], new Map()).hasReadme).toBe(true);
    }
  });

  it('accepts COPYING and LICENCE, which the two lists used to disagree about', () => {
    for (const name of ['LICENSE', 'LICENCE', 'COPYING']) {
      expect(LICENSE_FILENAMES).toContain(name);
      expect(analyzeDocumentation([name], new Map()).hasLicense).toBe(true);
    }
  });

  it('still reports a repository that has no README at all', () => {
    expect(analyzeDocumentation(['src/index.ts'], new Map()).hasReadme).toBe(false);
  });
});
