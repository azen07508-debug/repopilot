/**
 * Documentation analyzer.
 *
 * Scans the repository for required documentation artefacts. Findings include
 * a per-file evidence entry so the user can see *exactly* what is missing.
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';

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
  { id: 'doc-readme', title: 'README.md is missing or empty', files: ['README.md', 'README.rst', 'README.txt'], severity: 'high' },
  { id: 'doc-license', title: 'LICENSE is missing', files: ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'], severity: 'high' },
  { id: 'doc-contributing', title: 'CONTRIBUTING guide is missing', files: ['CONTRIBUTING.md', 'CONTRIBUTING'], severity: 'low' },
  { id: 'doc-security', title: 'SECURITY.md / security policy is missing', files: ['SECURITY.md', '.github/SECURITY.md'], severity: 'medium' },
  { id: 'doc-env-example', title: '.env.example is missing', files: ['.env.example', 'example.env', 'sample.env', '.env.sample'], severity: 'medium' },
  { id: 'doc-coc', title: 'CODE_OF_CONDUCT.md is missing', files: ['CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT'], severity: 'low' },
  { id: 'doc-changelog', title: 'CHANGELOG is missing', files: ['CHANGELOG.md', 'CHANGELOG', 'RELEASES.md'], severity: 'low' },
  { id: 'doc-api', title: 'API documentation is missing', files: ['docs/API.md', 'docs/api.md', 'API.md', 'openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json'], severity: 'medium' },
];

const SCREENSHOT_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function analyzeDocumentation(
  entries: FileEntry[],
  fileContents: Map<string, string>
): DocAnalysis {
  const findings: Finding[] = [];
  const fileSet = new Set(entries.map((e) => e.path.replace(/^\.\//, '')));

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
  let hasScreenshots = entries.some((e) => SCREENSHOT_EXT_RE.test(e.path));
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

  // README content checks
  const readmePath = findFirstFile(['README.md', 'README.rst', 'README.txt']);
  if (readmePath) {
    const content = (fileContents.get(readmePath) ?? '').trim();
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
