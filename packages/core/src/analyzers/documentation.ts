/**
 * Documentation analyzer.
 *
 * Scans the repository for required documentation artefacts. Findings include
 * a per-file evidence entry so the user can see *exactly* what is missing.
 *
 * Takes PATHS, not `FileEntry[]`, and that distinction is the whole point.
 * The pipeline hands this function every path in the tree, including the
 * ones `filterFiles` dropped for being binary or oversized — because this
 * analyzer only ever asks "is there a file called X". Passing the filtered
 * set instead is how the screenshot check became unable to ever pass: it
 * asked a list with no `.png` in it whether a `.png` existed.
 *
 * Content questions are answered from `fileContents`, which only holds the
 * files that were actually read.
 */
import type { Finding } from '../schemas/report.js';
import { ENV_EXAMPLE_FILENAMES, LICENSE_FILENAMES, README_FILENAMES } from '../utils/paths.js';

export interface DocAnalysis {
  findings: Finding[];
  hasReadme: boolean;
  hasLicense: boolean;
  hasContributing: boolean;
  hasSecurityPolicy: boolean;
  hasEnvExample: boolean;
  hasCodeOfConduct: boolean;
  hasChangelog: boolean;
  hasApiDocs: boolean;
  hasScreenshots: boolean;
  hasDemoUrl: boolean;
}

const REQUIRED_DOCS: { id: string; title: string; files: string[]; severity: 'critical' | 'high' | 'medium' | 'low' }[] = [
  // The README, license and env-template name lists are shared with the
  // free check. They used to be two lists, and the two entry points
  // disagreed about the same repository because of it.
  { id: 'doc-readme', title: 'README is missing or empty', files: [...README_FILENAMES], severity: 'high' },
  { id: 'doc-license', title: 'LICENSE is missing', files: [...LICENSE_FILENAMES], severity: 'high' },
  { id: 'doc-contributing', title: 'CONTRIBUTING guide is missing', files: ['CONTRIBUTING.md', 'CONTRIBUTING'], severity: 'low' },
  { id: 'doc-security', title: 'SECURITY.md / security policy is missing', files: ['SECURITY.md', '.github/SECURITY.md'], severity: 'medium' },
  { id: 'doc-env-example', title: '.env.example is missing', files: [...ENV_EXAMPLE_FILENAMES], severity: 'medium' },
  { id: 'doc-coc', title: 'CODE_OF_CONDUCT.md is missing', files: ['CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT'], severity: 'low' },
  { id: 'doc-changelog', title: 'CHANGELOG is missing', files: ['CHANGELOG.md', 'CHANGELOG', 'RELEASES.md'], severity: 'low' },
  { id: 'doc-api', title: 'API documentation is missing', files: ['docs/API.md', 'docs/api.md', 'API.md', 'openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json'], severity: 'medium' },
];

const SCREENSHOT_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function analyzeDocumentation(
  allPaths: readonly string[],
  fileContents: Map<string, string>
): DocAnalysis {
  const findings: Finding[] = [];
  const fileSet = new Set(allPaths.map((p) => p.replace(/^\.\//, '')));

  function findFirstFile(paths: string[]): string | null {
    for (const p of paths) {
      if (fileSet.has(p)) return p;
    }
    return null;
  }

  let hasReadme = false;
  let hasLicense = false;
  let hasContributing = false;
  let hasSecurityPolicy = false;
  let hasEnvExample = false;
  let hasCodeOfConduct = false;
  let hasChangelog = false;
  let hasApiDocs = false;
  let hasScreenshots = allPaths.some((p) => SCREENSHOT_EXT_RE.test(p));
  let hasDemoUrl = false;

  for (const req of REQUIRED_DOCS) {
    const present = findFirstFile(req.files);
    if (present) {
      switch (req.id) {
        case 'doc-readme':
          hasReadme = true;
          break;
        case 'doc-license':
          hasLicense = true;
          break;
        case 'doc-contributing':
          hasContributing = true;
          break;
        case 'doc-security':
          hasSecurityPolicy = true;
          break;
        case 'doc-env-example':
          hasEnvExample = true;
          break;
        case 'doc-coc':
          hasCodeOfConduct = true;
          break;
        case 'doc-changelog':
          hasChangelog = true;
          break;
        case 'doc-api':
          hasApiDocs = true;
          break;
      }
    } else if (req.severity !== 'low' || true) {
      // report every missing doc, including 'low' severity ones (kept as 'low')
      findings.push({
        id: req.id,
        category: 'documentation',
        severity: req.severity,
        title: req.title,
        description: `RepoPilot did not find any of: ${req.files.join(', ')}.`,
        evidence: [
          {
            file: req.files[0] ?? '(repo root)',
            line: null,
            reason: 'No matching file in the repository tree',
          },
        ],
        recommendedAction: `Add ${req.files[0] ?? 'a documentation file'} at the repository root.`,
        acceptanceCriteria: [`File ${req.files[0] ?? ''} is present in the repository root.`],
      });
    }
  }

  // README content checks.
  //
  // Existence is answered from the full tree, but the content has to
  // actually be in hand. A README that exists and was skipped — over the
  // per-file cap, or dropped by a total-bytes cap — must not be reported as
  // "0 characters long"; that would trade one wrong answer for another.
  const readmePath = findFirstFile([...README_FILENAMES]);
  const readmeContent = readmePath ? fileContents.get(readmePath) : undefined;
  if (readmePath && readmeContent !== undefined) {
    const content = readmeContent.trim();
    if (content.length < 200) {
      findings.push({
        id: 'doc-readme-short',
        category: 'documentation',
        severity: 'medium',
        title: 'README is too short to onboard a contributor',
        description: `README is only ${content.length} characters. A launch-ready README typically needs install steps, env setup, run command, test command, and a short pitch.`,
        evidence: [{ file: readmePath, line: 1, reason: `README length = ${content.length} chars` }],
        recommendedAction: 'Expand the README with: one-sentence pitch, install, env setup, run, test, deploy, demo link.',
        acceptanceCriteria: [
          'README ≥ 600 chars',
          'Contains install, run, and test sections',
        ],
      });
    } else {
      // Section checks
      const sections = extractSections(content);
      const requiredSections = [
        { id: 'install', patterns: [/^#{1,3}\s.*(install|installation|setup|getting started)/im, /\b(pnpm|npm|yarn|bun)\s+(install|i)\b/i] },
        { id: 'env', patterns: [/^#{1,3}\s.*(environment|env\s*var|configuration|config)/im, /\.env\b/i] },
        { id: 'run', patterns: [/^#{1,3}\s.*(run|usage|quickstart|start)/im, /\bpnpm\s+(dev|start)\b/i, /\bnpm\s+(run\s+)?(dev|start)\b/i] },
        { id: 'test', patterns: [/^#{1,3}\s.*(test|testing)/im, /\b(pnpm|npm|yarn)\s+test\b/i] },
      ];
      for (const sec of requiredSections) {
        if (!sec.patterns.some((p) => p.test(content))) {
          findings.push({
            id: `doc-readme-section-${sec.id}`,
            category: 'documentation',
            severity: 'low',
            title: `README is missing a "${sec.id}" section`,
            description: `Launch-ready READMEs explain how to ${sec.id}.`,
            evidence: [{ file: readmePath, line: 1, reason: 'No matching heading or reference found' }],
            recommendedAction: `Add a "${sec.id}" section to the README.`,
            acceptanceCriteria: [`README contains a ${sec.id} section.`],
          });
        }
      }
    }

    // Demo URL detection
    if (/\bhttps?:\/\/[^\s)]+/i.test(content)) {
      hasDemoUrl = true;
    }
  }

  return {
    findings,
    hasReadme,
    hasLicense,
    hasContributing,
    hasSecurityPolicy,
    hasEnvExample,
    hasCodeOfConduct,
    hasChangelog,
    hasApiDocs,
    hasScreenshots,
    hasDemoUrl,
  };
}

function extractSections(content: string): string[] {
  const out: string[] = [];
  const re = /^#{1,3}\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push((m[1] ?? '').trim());
  }
  return out;
}
