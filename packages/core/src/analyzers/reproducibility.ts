/**
 * Reproducibility analyzer.
 *
 * Static checks only. We do NOT execute any code from the audited repository.
 * The goal: tell the user "could I run this from a fresh clone?".
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';

export interface ReproAnalysis {
  findings: Finding[];
  hasLockfile: boolean;
  hasTestCommand: boolean;
  hasCI: boolean;
  hasDocker: boolean;
  hasEnvExample: boolean;
  hasInstallCommand: boolean;
  hasRunCommand: boolean;
}

const LOCKFILES: string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'requirements.txt',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
];

export function analyzeReproducibility(
  entries: FileEntry[],
  fileContents: Map<string, string>
): ReproAnalysis {
  const findings: Finding[] = [];
  const fileSet = new Set(entries.map((e) => e.path.replace(/^\.\//, '')));

  let hasLockfile = false;
  let hasCI = false;
  let hasDocker = false;
  let hasEnvExample = false;
  let hasInstallCommand = false;
  let hasRunCommand = false;
  let hasTestCommand = false;

  for (const f of LOCKFILES) {
    if (fileSet.has(f)) {
      hasLockfile = true;
      break;
    }
  }
  if (fileSet.has('.env.example') || fileSet.has('example.env') || fileSet.has('sample.env')) {
    hasEnvExample = true;
  }
  if (entries.some((e) => /^\.github\/workflows\/[^/]+\.(yml|yaml)$/i.test(e.path))) {
    hasCI = true;
  }
  if (entries.some((e) => /(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml)$/i.test(e.path))) {
    hasDocker = true;
  }

  if (!hasLockfile) {
    findings.push({
      id: 'repro-no-lockfile',
      category: 'reproducibility',
      severity: 'high',
      title: 'No lockfile detected',
      description:
        'Without a lockfile, two fresh clones can resolve different dependency versions, breaking reproducibility.',
      evidence: [
        {
          file: 'package.json (or equivalent)',
          line: null,
          reason: 'None of the common lockfiles were found: ' + LOCKFILES.join(', '),
        },
      ],
      recommendedAction:
        'Commit a lockfile (pnpm-lock.yaml / package-lock.json / poetry.lock / Cargo.lock / etc.).',
      acceptanceCriteria: ['A lockfile exists at the repository root.'],
    });
  }

  if (!hasCI) {
    findings.push({
      id: 'repro-no-ci',
      category: 'reproducibility',
      severity: 'medium',
      title: 'No CI configuration detected',
      description:
        'No GitHub Actions workflows were found. CI is the most reliable way to prove the project still builds and tests pass.',
      evidence: [
        {
          file: '.github/workflows',
          line: null,
          reason: 'No .github/workflows/*.yml file present',
        },
      ],
      recommendedAction: 'Add a GitHub Actions workflow that runs `install`, `lint`, `test`, `build`.',
      acceptanceCriteria: ['At least one workflow file exists under .github/workflows/.'],
    });
  }

  // package.json script analysis (Node projects only)
  const pkg = fileContents.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const scripts: Record<string, string> = parsed.scripts ?? {};
      hasInstallCommand = /^(npm|pnpm|yarn|bun)\s+(install|i)\b/i.test(
        Object.values(scripts).join('\n')
      ) || true; // package.json implies install via the package manager
      if (!Object.keys(scripts).length) {
        findings.push({
          id: 'repro-no-scripts',
          category: 'reproducibility',
          severity: 'medium',
          title: 'package.json has no scripts',
          description: 'Without scripts, contributors cannot run, build, or test the project consistently.',
          evidence: [{ file: 'package.json', line: null, reason: 'scripts object is empty' }],
          recommendedAction: 'Add at minimum: dev, build, start, test.',
          acceptanceCriteria: ['scripts.dev, scripts.build, scripts.test are all defined.'],
        });
      } else {
        if (!scripts.test && !scripts['test:unit']) {
          findings.push({
            id: 'repro-no-test-script',
            category: 'reproducibility',
            severity: 'medium',
            title: 'No "test" script in package.json',
            description: 'Contributors and CI cannot run the test suite without a canonical command.',
            evidence: [{ file: 'package.json', line: null, reason: 'scripts.test missing' }],
            recommendedAction: 'Add a "test" script that runs the test runner.',
            acceptanceCriteria: ['pnpm/npm/yarn test exits 0.'],
          });
        } else {
          hasTestCommand = true;
        }
        if (scripts.dev || scripts.start) {
          hasRunCommand = true;
        }
        if (!scripts.dev && !scripts.start) {
          findings.push({
            id: 'repro-no-run-script',
            category: 'reproducibility',
            severity: 'low',
            title: 'No "dev" or "start" script',
            description: 'A canonical run command is required for reviewers to test the project.',
            evidence: [{ file: 'package.json', line: null, reason: 'scripts.dev/start missing' }],
            recommendedAction: 'Add scripts.dev or scripts.start that boots the service.',
            acceptanceCriteria: ['The run command is documented in the README.'],
          });
        }
      }
    } catch {
      findings.push({
        id: 'repro-pkg-invalid',
        category: 'reproducibility',
        severity: 'high',
        title: 'package.json is not valid JSON',
        description: 'The repository will not install correctly without a valid package.json.',
        evidence: [{ file: 'package.json', line: null, reason: 'JSON.parse failed' }],
        recommendedAction: 'Fix the syntax of package.json.',
        acceptanceCriteria: ['package.json parses with JSON.parse.'],
      });
    }
  }

  // Python: requirements.txt + pyproject
  const pyReq = fileContents.get('requirements.txt');
  const pyProject = fileContents.get('pyproject.toml');
  if (pyReq || pyProject) {
    if (!pyReq && pyProject && !/\[tool\.poetry\]|\[project\]/i.test(pyProject)) {
      findings.push({
        id: 'repro-py-no-requirements',
        category: 'reproducibility',
        severity: 'low',
        title: 'pyproject.toml does not pin dependencies',
        description:
          'A pyproject.toml is present but no [project] or [tool.poetry] dependencies section was detected. Pin dependencies for reproducibility.',
        evidence: [{ file: 'pyproject.toml', line: 1, reason: 'no dependencies block found' }],
        recommendedAction: 'Declare dependencies in [project] (PEP 621) or [tool.poetry.dependencies].',
        acceptanceCriteria: ['pyproject.toml has a dependencies section with pinned versions.'],
      });
    }
  }

  if (!hasDocker) {
    findings.push({
      id: 'repro-no-docker',
      category: 'reproducibility',
      severity: 'low',
      title: 'No Dockerfile / docker-compose found',
      description: 'A Docker setup is not required but is a strong signal of deployability.',
      evidence: [{ file: 'Dockerfile', line: null, reason: 'not present' }],
      recommendedAction: 'Add a Dockerfile and (optionally) docker-compose.yml for local + production parity.',
      acceptanceCriteria: ['Dockerfile builds and the container starts.'],
    });
  }

  return {
    findings,
    hasLockfile,
    hasCI,
    hasDocker,
    hasEnvExample,
    hasInstallCommand,
    hasRunCommand,
    hasTestCommand,
  };
}
