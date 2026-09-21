/**
 * Repository hygiene rules.
 *
 * These cover gaps the older analyzers leave: whether a `.env` was
 * actually committed, whether `.gitignore` exists at all, whether the CI
 * workflows would even parse, and whether a test runner is wired up.
 *
 * Every rule reads only the file tree and the file contents the GitHub
 * API already returned. Nothing here needs a clone, a local git
 * directory, or the ability to run anything.
 *
 * The rules are deliberately narrow. Each one names a specific,
 * checkable defect and can point at the path and line that proves it —
 * a rule that cannot do that does not belong in a deterministic finding.
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';
import { slugify } from '../security/security-slug.js';

export interface HygieneAnalysis {
  findings: Finding[];
  hasGitignore: boolean;
  /** The .gitignore mentions .env in some form. */
  gitignoreIgnoresEnv: boolean;
  /** A .env file (not .env.example) is present in the tracked tree. */
  envCommitted: boolean;
  /** Number of workflow files examined. */
  workflowsChecked: number;
}

/** `.env`, `.env.local`, `.env.production` … */
const ENV_FILE = /^\.env(\.[a-z0-9]+)?$/i;
/** `.env.example`, `.env.sample` … — these are meant to be committed. */
const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist|defaults?)$/i;
const WORKFLOW = /^\.github\/workflows\/.+\.ya?ml$/i;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/i;
const TEST_DIR = /(^|\/)(__tests__|tests?)\//i;

const TEST_RUNNER_RE =
  /"(vitest|jest|mocha|ava|tape|tap|jasmine|karma|@jest\/globals|node:test)"\s*:/;

export function analyzeHygiene(
  entries: FileEntry[],
  contents: Map<string, string>
): HygieneAnalysis {
  const findings: Finding[] = [];
  const paths = entries.map((e) => e.path);
  const rootPaths = paths.filter((p) => !p.includes('/'));

  // ---- .gitignore ------------------------------------------------------
  const gitignorePath = rootPaths.find((p) => p.toLowerCase() === '.gitignore');
  const hasGitignore = Boolean(gitignorePath);
  const gitignoreText = gitignorePath ? contents.get(gitignorePath) ?? '' : '';
  const gitignoreIgnoresEnv = gitignoreText
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\/+$/, ''))
    .some((l) => l === '.env' || l === '.env*' || l.startsWith('.env') || l === '*.env');

  // ---- a committed .env ------------------------------------------------
  const committedEnv = paths.filter((p) => {
    const base = p.split('/').pop() ?? '';
    return ENV_FILE.test(base) && !ENV_TEMPLATE.test(base);
  });
  const envCommitted = committedEnv.length > 0;

  if (envCommitted) {
    // Being in the tree at all proves it is tracked: GitHub does not list
    // ignored files. That is the strongest form of this evidence.
    findings.push({
      id: `env-committed-${slugify(committedEnv[0] ?? 'env')}`,
      category: 'security',
      severity: 'critical',
      title: 'A .env file is committed to the repository',
      description:
        `${committedEnv.length === 1 ? 'A .env file is' : `${committedEnv.length} .env files are`} ` +
        'present in the tracked tree. GitHub does not list ignored files, so its presence proves ' +
        'it is committed — and whatever it contains is public.',
      evidence: committedEnv.map((p) => ({
        file: p,
        line: null,
        reason: 'present in the tracked tree, which means it is committed',
        source: 'file_tree' as const,
      })),
      recommendedAction:
        'Treat every value in the file as exposed: rotate them all. Then remove the file from ' +
        'the working tree, add `.env` to .gitignore, commit a `.env.example` with empty values, ' +
        'and purge the file from history.',
      acceptanceCriteria: [
        'No .env file is present in the tracked tree.',
        '`.env` appears in .gitignore.',
        'Every credential the file contained has been rotated.',
      ],
    });
  } else if (!gitignoreIgnoresEnv) {
    // Nothing is exposed today, but the next `git add .` will do it.
    findings.push({
      id: 'env-not-ignored',
      category: 'security',
      severity: 'medium',
      title: '.env is not ignored',
      description:
        'No .env file is committed right now, but .gitignore does not exclude one either. ' +
        'The next time someone creates a local .env and runs `git add .`, its contents are ' +
        'published.',
      evidence: [
        {
          file: hasGitignore ? gitignorePath ?? '.gitignore' : '.gitignore',
          line: null,
          reason: hasGitignore
            ? 'no entry matching .env'
            : 'no .gitignore file exists',
          source: hasGitignore ? ('text_match' as const) : ('file_tree' as const),
        },
      ],
      recommendedAction: 'Add `.env` (and `.env.local`) to .gitignore, and commit a `.env.example`.',
      acceptanceCriteria: ['.gitignore contains a `.env` entry.'],
    });
  }

  // ---- .gitignore missing ----------------------------------------------
  if (!hasGitignore) {
    findings.push({
      id: 'repo-no-gitignore',
      category: 'reproducibility',
      severity: 'low',
      title: '.gitignore is missing',
      description:
        'Without a .gitignore, build output, editor state and local secrets all become ' +
        'candidates for the next commit.',
      evidence: [
        {
          file: '.gitignore',
          line: null,
          reason: 'no .gitignore at the repository root',
          source: 'file_tree' as const,
        },
      ],
      recommendedAction: 'Add a .gitignore covering dependencies, build output, and .env files.',
      acceptanceCriteria: ['.gitignore exists at the repository root.'],
    });
  }

  // ---- CI workflows ----------------------------------------------------
  const workflows = paths.filter((p) => WORKFLOW.test(p));
  for (const wf of workflows) {
    const text = contents.get(wf);
    // Not fetched means we cannot judge it; saying nothing beats guessing.
    if (text === undefined) continue;

    const problems: string[] = [];
    if (text.trim().length === 0) {
      problems.push('the file is empty');
    } else {
      if (!/^on\s*:/m.test(text)) problems.push('no `on:` trigger is declared');
      if (!/^jobs\s*:/m.test(text)) problems.push('no `jobs:` block is declared');
    }
    if (problems.length === 0) continue;

    findings.push({
      id: `ci-workflow-invalid-${slugify(wf)}`,
      category: 'reproducibility',
      severity: 'high',
      title: 'A CI workflow would not run',
      description:
        `${wf} ${problems.join(' and ')}. GitHub Actions would either refuse to parse it or ` +
        'parse it into a workflow that never triggers.',
      evidence: [
        {
          file: wf,
          line: null,
          reason: problems.join('; '),
          source: 'workflow' as const,
        },
      ],
      recommendedAction:
        'Give the workflow an `on:` trigger and at least one job. Running `actionlint` locally ' +
        'catches this class of mistake.',
      acceptanceCriteria: ['The workflow declares both `on:` and `jobs:`.'],
    });
  }

  // ---- test runner -----------------------------------------------------
  const hasTestFiles = paths.some((p) => TEST_FILE.test(p) || TEST_DIR.test(p));
  if (hasTestFiles) {
    const manifest = contents.get('package.json') ?? '';
    const pyproject = contents.get('pyproject.toml') ?? '';
    const hasRunner =
      TEST_RUNNER_RE.test(manifest) ||
      pyproject.includes('pytest') ||
      paths.some((p) => /(^|\/)(pytest\.ini|tox\.ini|conftest\.py)$/i.test(p));

    if (!hasRunner) {
      findings.push({
        id: 'test-no-runner',
        category: 'reproducibility',
        severity: 'medium',
        title: 'Test files exist but no test runner is declared',
        description:
          'The repository contains test files, but nothing declares a runner to execute them. ' +
          'Tests that nothing runs are documentation, not verification.',
        evidence: [
          {
            file: paths.find((p) => TEST_FILE.test(p) || TEST_DIR.test(p)) ?? '(test files)',
            line: null,
            reason: 'test files present, but no vitest/jest/mocha/pytest dependency found',
            source: 'dependency_manifest' as const,
          },
        ],
        recommendedAction: 'Declare the test runner as a dependency and wire it to `scripts.test`.',
        acceptanceCriteria: ['A test runner is listed in the dependencies and is invoked by a script.'],
      });
    }
  }

  return {
    findings,
    hasGitignore,
    gitignoreIgnoresEnv,
    envCommitted,
    workflowsChecked: workflows.length,
  };
}
