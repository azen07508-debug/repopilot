/**
 * File classification — decide what to read, what to skip, and what's "binary".
 *
 * The static analysis pipeline must:
 *   - skip anything that is not text (avoid decoding PNGs, zips, etc.),
 *   - skip files larger than the per-file cap,
 *   - skip noise directories (node_modules, .git, vendor, target, dist, ...),
 *   - prevent path traversal outside the repository root.
 */
import path from 'node:path';

const SKIP_DIR_PREFIXES = [
  '.git/',
  'node_modules/',
  'vendor/',
  'target/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.turbo/',
  'coverage/',
  '__pycache__/',
  '.venv/',
  'venv/',
  '.idea/',
  '.vscode/',
  '.gradle/',
];

const SKIP_DIR_EXACT = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage']);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2',
  '.mp3', '.mp4', '.mov', '.wav', '.flac', '.ogg', '.avi', '.mkv',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.war',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.psd', '.ai', '.sketch', '.fig',
  '.lock', '.lockb',  // pnpm lockfile binary
  '.parquet', '.arrow', '.feather',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.pyx', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.m', '.mm', '.swift',
  '.sol', '.vy', '.cairo', '.move',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql', '.proto',
  '.xml', '.csv', '.tsv',
  '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig',
  '.cfg', '.conf',
]);

const NO_EXTENSION_TEXT_FILES = new Set([
  'dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile',
  'license', 'contributing', 'readme',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.py': 'Python', '.pyx': 'Python', '.pyi': 'Python',
  '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.c': 'C', '.cc': 'C++', '.cpp': 'C++', '.cxx': 'C++', '.h': 'C', '.hpp': 'C++',
  '.m': 'Objective-C', '.mm': 'Objective-C++', '.swift': 'Swift',
  '.sol': 'Solidity', '.vy': 'Vyper', '.cairo': 'Cairo', '.move': 'Move',
  '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.md': 'Markdown', '.mdx': 'Markdown',
  '.sh': 'Shell', '.bash': 'Shell',
  '.sql': 'SQL', '.graphql': 'GraphQL', '.proto': 'Protobuf',
};

export interface FileEntry {
  /** Path relative to the repo root, using forward slashes. */
  path: string;
  /** File size in bytes (may be 0 if unknown). */
  size: number;
}

export interface FileFilterResult {
  included: FileEntry[];
  skipped: { path: string; reason: string }[];
}

export interface FileFilterOptions {
  maxFiles: number;
  maxFileBytes: number;
}

export function classifyFile(relPath: string, size: number): { kind: 'text' | 'binary' | 'ignore' } {
  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/');

  // Directory-level skip (any segment matches a known noise dir).
  for (const seg of segments.slice(0, -1)) {
    if (SKIP_DIR_EXACT.has(seg)) {
      return { kind: 'ignore' };
    }
  }
  for (const prefix of SKIP_DIR_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return { kind: 'ignore' };
    }
  }

  // Path-traversal defense: a path must not escape upward.
  if (normalized.includes('..')) {
    return { kind: 'ignore' };
  }

  const base = segments[segments.length - 1] ?? '';
  if (base.startsWith('.')) {
    // Hidden files are usually config; we still read .env.example, .gitignore.
    if (base === '.env' || base.startsWith('.env.')) {
      return { kind: 'text' };
    }
    if (base === '.gitignore' || base === '.gitattributes' || base === '.editorconfig') {
      return { kind: 'text' };
    }
    // Other hidden files: skip by default.
    return { kind: 'ignore' };
  }

  const ext = path.extname(base).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { kind: 'binary' };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { kind: 'text' };
  }
  if (NO_EXTENSION_TEXT_FILES.has(base.toLowerCase())) {
    return { kind: 'text' };
  }
  // Unknown extension: treat as text only if very small.
  if (size === 0 || size <= 4096) {
    return { kind: 'text' };
  }
  return { kind: 'binary' };
}

export function filterFiles(entries: FileEntry[], opts: FileFilterOptions): FileFilterResult {
  const included: FileEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const entry of entries) {
    const cls = classifyFile(entry.path, entry.size);
    if (cls.kind === 'ignore') {
      skipped.push({ path: entry.path, reason: 'noise-directory-or-hidden' });
      continue;
    }
    if (cls.kind === 'binary') {
      skipped.push({ path: entry.path, reason: 'binary-extension' });
      continue;
    }
    if (entry.size > opts.maxFileBytes) {
      skipped.push({ path: entry.path, reason: 'exceeds-max-file-bytes' });
      continue;
    }
    if (included.length >= opts.maxFiles) {
      skipped.push({ path: entry.path, reason: 'exceeds-max-files' });
      continue;
    }
    included.push(entry);
  }
  return { included, skipped };
}

export function detectLanguage(relPath: string): string | null {
  const ext = path.extname(relPath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] ?? null;
}
