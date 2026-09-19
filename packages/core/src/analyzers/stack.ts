/**
 * Stack / language detector.
 *
 * Detection is purely based on the *contents* of the file tree (filenames and
 * top-of-file tokens), never on `npm install` or any other execution. Each
 * detection produces a confidence-weighted signal; the final `detectedStack`
 * is the union of high-confidence signals.
 */
import type { FileEntry } from '../git/files.js';
import { detectLanguage } from '../git/files.js';

export type StackKey =
  | 'node'
  | 'typescript'
  | 'python'
  | 'rust'
  | 'solidity'
  | 'foundry'
  | 'hardhat'
  | 'react'
  | 'nextjs'
  | 'vite'
  | 'vue'
  | 'svelte'
  | 'docker'
  | 'github-actions'
  | 'postgresql'
  | 'redis'
  | 'mongodb'
  | 'railway'
  | 'render'
  | 'vercel'
  | 'fly';

export interface StackSignal {
  key: StackKey;
  /** Human-friendly label. */
  label: string;
  confidence: number; // 0..1
  evidence: { file: string; line: number | null; reason: string }[];
}

const PATH_PATTERNS: { key: StackKey; label: string; match: RegExp; confidence: number }[] = [
  { key: 'docker', label: 'Docker', match: /(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml)$/i, confidence: 0.95 },
  { key: 'github-actions', label: 'GitHub Actions', match: /^\.github\/workflows\/[^/]+\.(yml|yaml)$/i, confidence: 0.95 },
  { key: 'foundry', label: 'Foundry', match: /(^|\/)(foundry\.toml|lib\/forge-std|test\/.*\.sol)$/i, confidence: 0.7 },
  { key: 'hardhat', label: 'Hardhat', match: /(^|\/)(hardhat\.config\.(js|ts|cjs|mjs))$/i, confidence: 0.95 },
  { key: 'nextjs', label: 'Next.js', match: /(^|\/)(next\.config\.(js|ts|mjs|cjs))$/i, confidence: 0.95 },
  { key: 'vite', label: 'Vite', match: /(^|\/)(vite\.config\.(js|ts|mjs|cjs))$/i, confidence: 0.95 },
  { key: 'python', label: 'Python', match: /(^|\/)(requirements[^/]*|pyproject\.toml|setup\.py|setup\.cfg|Pipfile)$/i, confidence: 0.9 },
  { key: 'rust', label: 'Rust', match: /(^|\/)(Cargo\.(toml|lock))$/i, confidence: 0.95 },
  { key: 'node', label: 'Node.js', match: /(^|\/)package\.json$/, confidence: 0.95 },
];

export function detectStack(entries: FileEntry[], fileContents: Map<string, string>): StackSignal[] {
  const signals = new Map<StackKey, StackSignal>();

  function bump(key: StackKey, label: string, conf: number, ev: { file: string; line: number | null; reason: string }) {
    const cur = signals.get(key);
    if (cur) {
      cur.confidence = Math.max(cur.confidence, conf);
      cur.evidence.push(ev);
    } else {
      signals.set(key, { key, label, confidence: conf, evidence: [ev] });
    }
  }

  for (const entry of entries) {
    for (const p of PATH_PATTERNS) {
      if (p.match.test(entry.path)) {
        bump(p.key, p.label, p.confidence, {
          file: entry.path,
          line: null,
          reason: `Path matches ${p.label} pattern`,
        });
      }
    }
    const lang = detectLanguage(entry.path);
    if (lang === 'TypeScript') {
      bump('typescript', 'TypeScript', 0.95, {
        file: entry.path,
        line: null,
        reason: 'TypeScript file extension',
      });
    }
    if (lang === 'Solidity') {
      bump('solidity', 'Solidity', 0.95, {
        file: entry.path,
        line: null,
        reason: 'Solidity file extension',
      });
    }
    if (lang === 'JavaScript' || lang === 'TypeScript') {
      bump('node', 'Node.js', 0.6, {
        file: entry.path,
        line: null,
        reason: 'JS/TS source file',
      });
    }
  }

  // Content-based detection
  const pkg = fileContents.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const allDeps = {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      };
      if (allDeps.react) {
        bump('react', 'React', 0.95, { file: 'package.json', line: null, reason: 'react dependency' });
      }
      if (allDeps.next) {
        bump('nextjs', 'Next.js', 0.98, { file: 'package.json', line: null, reason: 'next dependency' });
      }
      if (allDeps.vite) {
        bump('vite', 'Vite', 0.98, { file: 'package.json', line: null, reason: 'vite dependency' });
      }
      if (allDeps.vue) {
        bump('vue', 'Vue', 0.95, { file: 'package.json', line: null, reason: 'vue dependency' });
      }
      if (allDeps['svelte']) {
        bump('svelte', 'Svelte', 0.95, { file: 'package.json', line: null, reason: 'svelte dependency' });
      }
      if (allDeps['hardhat']) {
        bump('hardhat', 'Hardhat', 0.98, { file: 'package.json', line: null, reason: 'hardhat dependency' });
      }
      if (allDeps.pg || allDeps['pg-hstore'] || allDeps.postgres) {
        bump('postgresql', 'PostgreSQL', 0.8, { file: 'package.json', line: null, reason: 'PostgreSQL client dependency' });
      }
      if (allDeps.redis || allDeps.ioredis) {
        bump('redis', 'Redis', 0.8, { file: 'package.json', line: null, reason: 'Redis client dependency' });
      }
      if (allDeps.mongodb) {
        bump('mongodb', 'MongoDB', 0.8, { file: 'package.json', line: null, reason: 'mongodb driver' });
      }
      // Deployment platform hints (scripts)
      const scripts = parsed.scripts ?? {};
      if (typeof scripts.deploy === 'string' && /railway|render|fly|vercel/i.test(scripts.deploy)) {
        // weak signal; only records if path already matches.
      }
    } catch {
      // ignore malformed package.json
    }
  }

  // python / docker / foundry via pyproject or foundry.toml content
  const foundry = fileContents.get('foundry.toml');
  if (foundry) {
    bump('foundry', 'Foundry', 0.98, { file: 'foundry.toml', line: 1, reason: 'foundry.toml present' });
  }

  const pyproject = fileContents.get('pyproject.toml');
  if (pyproject) {
    bump('python', 'Python', 0.95, { file: 'pyproject.toml', line: 1, reason: 'pyproject.toml present' });
  }

  // Deployment platform detection via known config files.
  const fileNames = new Set(entries.map((e) => e.path.split('/').pop() ?? ''));
  if (fileNames.has('railway.toml') || fileNames.has('railway.json')) {
    bump('railway', 'Railway', 0.95, { file: 'railway.toml', line: null, reason: 'Railway config present' });
  }
  if (fileNames.has('render.yaml')) {
    bump('render', 'Render', 0.95, { file: 'render.yaml', line: null, reason: 'render.yaml present' });
  }
  if (fileNames.has('vercel.json')) {
    bump('vercel', 'Vercel', 0.9, { file: 'vercel.json', line: null, reason: 'vercel.json present' });
  }
  if (fileNames.has('fly.toml')) {
    bump('fly', 'Fly.io', 0.95, { file: 'fly.toml', line: null, reason: 'fly.toml present' });
  }

  return [...signals.values()].sort((a, b) => b.confidence - a.confidence);
}

export function stackLabels(signals: StackSignal[]): string[] {
  return signals.filter((s) => s.confidence >= 0.5).map((s) => s.label);
}
