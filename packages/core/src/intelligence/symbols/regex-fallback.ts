/**
 * Every other language, by line pattern (D-018).
 *
 * This is the last resort, and it is reported as such: `parser:
 * 'heuristic'`, confidence 0.5. It matches a line and takes the name out of
 * it. It does not know whether the match is a declaration or a call, whether
 * it is inside a macro, or whether the file is even valid — so it claims
 * less, and says so.
 *
 * Languages with no profile here produce no symbols. That is deliberate: a
 * guessed symbol is worse than a missing one, because a missing symbol sends
 * an agent to read the file and a wrong one sends it to the wrong line.
 */
import { braceDepthBefore, braceEnd, blockEnd, finish, toLines, type Draft } from './lines.js';
import { symbolId, type Symbol as SymbolEntry, type SymbolKind } from '../../schemas/intelligence/symbol-map.js';

export const HEURISTIC_CONFIDENCE = 0.5;

interface Rule {
  pattern: RegExp;
  kind: SymbolKind;
  /** Members declared inside this symbol report it as their parent. */
  container?: boolean;
}

interface Profile {
  lineComment: string;
  block: 'brace' | 'indent';
  rules: Rule[];
  /** How `exported` is decided. `capitalised` is Go's rule; `keyword` needs a modifier. */
  visibility: 'capitalised' | 'keyword' | 'always';
  /** For `block: 'indent'` languages, the keyword that closes a block. */
  terminator?: RegExp;
}

const PROFILES: Record<string, Profile> = {
  // TypeScript and JavaScript are here only as a safety net: their preferred
  // parser is the compiler API, and this profile runs when it throws. It
  // deliberately mirrors the same declarations so a fallback is a worse
  // answer, not a different one.
  TypeScript: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:export\s+)?(?:declare\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', container: true },
      { pattern: /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', container: true },
      { pattern: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum', container: true },
      { pattern: /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
      { pattern: /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
      { pattern: /^(?:export\s+)?(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'constant' },
      { pattern: /^(?:export\s+)?(?:declare\s+)?let\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
    ],
  },
  JavaScript: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', container: true },
      { pattern: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
      { pattern: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'constant' },
      { pattern: /^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
      { pattern: /^(?:export\s+)?var\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
    ],
  },
  Go: {
    lineComment: '//',
    block: 'brace',
    visibility: 'capitalised',
    rules: [
      { pattern: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: 'struct', container: true },
      { pattern: /^type\s+([A-Za-z_]\w*)\s+interface\b/, kind: 'interface', container: true },
      { pattern: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: 'function' },
      { pattern: /^const\s+([A-Za-z_]\w*)/, kind: 'constant' },
      { pattern: /^var\s+([A-Za-z_]\w*)/, kind: 'variable' },
    ],
  },
  Rust: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct', container: true },
      { pattern: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
      { pattern: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
      { pattern: /^(?:pub\s+)?const\s+([A-Za-z_]\w*)/, kind: 'constant' },
    ],
  },
  Java: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:public\s+|private\s+|protected\s+|final\s+|abstract\s+|static\s+)*class\s+([A-Za-z_]\w*)/, kind: 'class', container: true },
      { pattern: /^(?:public\s+|private\s+|protected\s+|abstract\s+)*interface\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^(?:public\s+|private\s+|protected\s+)*enum\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
      { pattern: /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|synchronized\s+|native\s+)*[A-Za-z_][\w<>\[\],.\s]*\s+([A-Za-z_]\w*)\s*\(/, kind: 'function' },
    ],
  },
  Kotlin: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:public\s+|private\s+|internal\s+|open\s+|sealed\s+|data\s+|abstract\s+|annotation\s+)*(?:class|object)\s+([A-Za-z_]\w*)/, kind: 'class', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+)*interface\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+|suspend\s+|inline\s+|operator\s+|override\s+|open\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/, kind: 'function' },
      { pattern: /^(?:public\s+|private\s+|internal\s+)*enum\s+class\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
    ],
  },
  Swift: {
    lineComment: '//',
    block: 'brace',
    visibility: 'keyword',
    rules: [
      { pattern: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|final\s+)*class\s+([A-Za-z_]\w*)/, kind: 'class', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+)*struct\s+([A-Za-z_]\w*)/, kind: 'struct', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+)*enum\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+)*protocol\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|static\s+|class\s+|override\s+|mutating\s+)*func\s+([A-Za-z_]\w*)/, kind: 'function' },
    ],
  },
  Ruby: {
    lineComment: '#',
    block: 'indent',
    visibility: 'always',
    terminator: /^end\b/,
    rules: [
      { pattern: /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, kind: 'function' },
      { pattern: /^class\s+([A-Za-z_]\w*)/, kind: 'class', container: true },
      { pattern: /^module\s+([A-Za-z_]\w*)/, kind: 'class', container: true },
      { pattern: /^([A-Z][A-Z0-9_]*)\s*=/, kind: 'constant' },
    ],
  },
  Shell: {
    lineComment: '#',
    block: 'indent',
    visibility: 'always',
    terminator: /^\}/,
    rules: [
      { pattern: /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?/, kind: 'function' },
      { pattern: /^([A-Z][A-Z0-9_]*)=/, kind: 'constant' },
    ],
  },
  Protobuf: {
    lineComment: '//',
    block: 'brace',
    visibility: 'always',
    rules: [
      { pattern: /^message\s+([A-Za-z_]\w*)/, kind: 'struct', container: true },
      { pattern: /^enum\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
      { pattern: /^service\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^rpc\s+([A-Za-z_]\w*)/, kind: 'function' },
    ],
  },
  GraphQL: {
    lineComment: '#',
    block: 'brace',
    visibility: 'always',
    rules: [
      { pattern: /^type\s+([A-Za-z_]\w*)/, kind: 'struct', container: true },
      { pattern: /^interface\s+([A-Za-z_]\w*)/, kind: 'interface', container: true },
      { pattern: /^enum\s+([A-Za-z_]\w*)/, kind: 'enum', container: true },
      { pattern: /^input\s+([A-Za-z_]\w*)/, kind: 'struct', container: true },
    ],
  },
};

export function supportsHeuristics(language: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROFILES, language);
}

export function parseWithHeuristics(
  path: string,
  content: string,
  language: string
): SymbolEntry[] {
  const profile = PROFILES[language];
  if (!profile) return [];

  const lines = toLines(content, profile.lineComment === '' ? [] : [profile.lineComment]);
  const drafts: Draft[] = [];
  const stack: { depth: number; name: string }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.ignorable) continue;

    if (profile.block === 'brace') {
      const depthHere = braceDepthBefore(lines, i);
      while (stack.length > 0 && depthHere < (stack[stack.length - 1]?.depth ?? 0)) stack.pop();
    } else {
      while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? -1) >= line.indent) stack.pop();
    }

    const parent = stack[stack.length - 1]?.name ?? null;
    const trimmed = line.text.trim();

    for (const rule of profile.rules) {
      const match = rule.pattern.exec(trimmed);
      if (!match?.[1]) continue;

      const name = match[1];
      drafts.push({
        name,
        kind: rule.kind,
        parent,
        exported: isExported(profile.visibility, trimmed, name),
        startLine: line.number,
        endLine:
          profile.block === 'brace'
            ? braceEnd(lines, i, profile.lineComment)
            : blockEnd(lines, i, line.indent, profile.terminator),
      });

      if (rule.container) {
        const depth =
          profile.block === 'brace'
            ? braceDepthBefore(lines, i) + 1
            : line.indent + 1;
        stack.push({ depth, name });
      }
      break;
    }
  }

  return finish(drafts, path, 'heuristic', HEURISTIC_CONFIDENCE, symbolId);
}

/**
 * Visibility, per language, and honestly guessed.
 *
 * Go exports by capitalisation; Rust, Java, Kotlin and Swift need a keyword;
 * Ruby and Shell have no declaration-level visibility to read, so everything
 * is reported as exported rather than as nothing.
 */
function isExported(visibility: Profile['visibility'], trimmed: string, name: string): boolean {
  if (visibility === 'capitalised') return /^[A-Z]/.test(name);
  if (visibility === 'keyword') return /^(?:pub\b|public\b|export\b|open\b)/.test(trimmed);
  return true;
}
