/**
 * Import extraction, per language (V0.2-f).
 *
 * This module answers one question per file: *what did this file say it
 * depends on?* It does not answer where those specifiers point — that is
 * `resolve.ts` — and it does not decide what an unresolved one means.
 *
 * TypeScript and JavaScript go through the compiler API, because a regex over
 * `import` misses `export … from`, `import x = require(…)` and dynamic
 * `import()`, and because the parser is already a dependency (D-018). Every
 * other language is a line pattern, which is the same tier and the same
 * honesty as the Symbol Map's `regex-fallback.ts`: it matches a line and takes
 * a string out of it, and it claims nothing more.
 *
 * A language with no profile here yields `null` — "no extractor", which the
 * builder reports as a gap. It never yields an empty array pretending to be
 * an answer.
 */
import ts from 'typescript';
import { scriptKindFor } from '../symbols/typescript.js';

export interface ImportRecord {
  /** The specifier as written, for the evidence line. */
  raw: string;
  /** Handed to the resolver. */
  specifier: string;
  /** 1-based line in the importing file. */
  line: number;
  /**
   * False when a miss is normal rather than a broken import.
   *
   * `from a.b import c` also tries `a.b.c`, because `c` may be a submodule. It
   * usually is not — it is a class defined in `a/b.py` — so a miss on that
   * second specifier says nothing about the repository. A caller must use this
   * for both of the things a miss can mean: it is not worth a `limitations`
   * line, and it is not evidence of an external dependency. Only a hit counts.
   */
  certain: boolean;
}

interface Profile {
  /** One record per match, first rule wins. */
  rules: readonly RegExp[];
  /** Where the specifier sits inside the match. */
  group: number;
  /**
   * Per-rule prefix, keyed by rule index.
   *
   * Rust's `mod foo;` is `self::foo`, and Ruby's `require_relative 'x'` is
   * `./x`; the syntax says so and the string does not. Applied only when the
   * specifier is not already relative, so `require_relative './x'` is left
   * alone.
   */
  prefixes?: Readonly<Record<number, string>>;
  /** For the `import ( … )` form: the line that opens a block and the one that closes it. */
  block?: { open: RegExp; close: RegExp; inner: RegExp; group: number };
}

/** Languages with a dedicated extractor rather than a line-pattern profile. */
const COMPILER_LANGUAGES = new Set(['TypeScript', 'JavaScript']);
const DEDICATED_LANGUAGES = new Set(['Python']);

export function supportsImports(language: string): boolean {
  return (
    COMPILER_LANGUAGES.has(language) || DEDICATED_LANGUAGES.has(language) || language in PROFILES
  );
}

/**
 * Every import a file declares, in source order.
 *
 * `null` means no extractor exists for this language. A parser failure throws
 * — the caller degrades, because a failure in one file must never fail the
 * whole graph (the hard rule from D-018).
 */
export function extractImports(
  path: string,
  content: string,
  language: string
): ImportRecord[] | null {
  if (COMPILER_LANGUAGES.has(language)) return extractWithCompiler(path, content);
  if (language === 'Python') return sortRecords(extractPython(content));

  const profile = PROFILES[language];
  if (!profile) return null;

  return sortRecords(extractByRules(content, profile));
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript
// ---------------------------------------------------------------------------

function extractWithCompiler(path: string, content: string): ImportRecord[] {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path)
  );

  const out: ImportRecord[] = [];

  const record = (specifier: ts.StringLiteral): void => {
    out.push({
      raw: specifier.text,
      specifier: specifier.text,
      line: sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1,
      certain: true,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && argument !== undefined && ts.isStringLiteral(argument)) {
        record(argument);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sortRecords(out);
}

// ---------------------------------------------------------------------------
// Line-pattern profiles
// ---------------------------------------------------------------------------

const PROFILES: Record<string, Profile> = {
  Solidity: {
    rules: [/^import\b[^"']*["']([^"']+)["']/],
    group: 1,
  },
  Go: {
    rules: [/^import\s+(?:[\w.]+\s+)?"([^"]+)"/],
    group: 1,
    block: {
      open: /^import\s*\(/,
      close: /^\s*\)/,
      inner: /(?:[\w.]+\s+)?"([^"]+)"/,
      group: 1,
    },
  },
  Rust: {
    rules: [
      /^use\s+([\w:]+)/,
      /^pub\s+use\s+([\w:]+)/,
      /^(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/,
      /^extern\s+crate\s+([A-Za-z_]\w*)/,
    ],
    group: 1,
    // `mod foo;` declares a module of this crate, and Rust spells that
    // `self::foo`. Reading it as a bare specifier would file it as an
    // external crate, which is the opposite of what it is.
    prefixes: { 2: 'self::' },
  },
  Java: {
    rules: [/^import\s+(?:static\s+)?([\w.]+)/],
    group: 1,
  },
  Kotlin: {
    rules: [/^import\s+([\w.]+)/],
    group: 1,
  },
  Ruby: {
    rules: [
      /^require_relative\s+['"]([^'"]+)['"]/,
      /^require\s+['"]([^'"]+)['"]/,
      /^load\s+['"]([^'"]+)['"]/,
    ],
    group: 1,
    // `require_relative` and `load` are relative by definition; plain
    // `require` is a gem or a stdlib file, so it stays bare and resolves as
    // an external dependency.
    prefixes: { 0: './', 2: './' },
  },
  Shell: {
    // `. lib.sh` searches `PATH`, not the working directory, so a specifier
    // without `./` or `/` is left bare and reported as external rather than
    // guessed at as a sibling file.
    rules: [/^(?:\.|source)\s+(\S+)/],
    group: 1,
  },
  Protobuf: {
    rules: [/^import\s+(?:public\s+|weak\s+)?["']([^"']+)["']/],
    group: 1,
  },
  GraphQL: {
    rules: [/^#import\s+["']([^"']+)["']/],
    group: 1,
  },
};

function extractByRules(content: string, profile: Profile): ImportRecord[] {
  const lines = content.split(/\r?\n/);
  const out: ImportRecord[] = [];
  let inBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    const line = index + 1;

    if (profile.block) {
      if (inBlock) {
        if (profile.block.close.test(text)) {
          inBlock = false;
          continue;
        }
        const inner = profile.block.inner.exec(text);
        const specifier = inner?.[profile.block.group];
        if (specifier !== undefined) out.push(record(specifier, specifier, line));
        continue;
      }
      if (profile.block.open.test(text)) {
        inBlock = true;
        continue;
      }
    }

    for (let rule = 0; rule < profile.rules.length; rule += 1) {
      const match = profile.rules[rule]?.exec(text.trim());
      const specifier = match?.[profile.group];
      if (specifier === undefined) continue;

      const prefix = profile.prefixes?.[rule] ?? '';
      const applied = prefix !== '' && !isAlreadyRelative(specifier) ? `${prefix}${specifier}` : specifier;
      out.push(record(specifier, applied, line));
      break;
    }
  }

  return out;
}

function isAlreadyRelative(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

function record(raw: string, specifier: string, line: number): ImportRecord {
  return { raw, specifier, line, certain: true };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PY_FROM = /^from\s+([.\w]+)\s+import\s+(.*)$/;
const PY_IMPORT = /^import\s+(.+)$/;

/**
 * Python, where `from X import a, b` is one statement that can depend on two
 * different things: the module `X`, and — when `a` happens to be a submodule
 * rather than a name defined in `X` — the module `X.a`.
 *
 * Both are emitted. `X` is certain, `X.a` is not, and the resolver drops
 * whichever does not exist. Emitting only `X` would miss `from . import
 * models`, which is how most Python projects reach their own modules.
 */
function extractPython(content: string): ImportRecord[] {
  const lines = content.split(/\r?\n/);
  const out: ImportRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    const line = index + 1;

    const from = PY_FROM.exec(text.trim());
    if (from?.[1] !== undefined) {
      const module = from[1];
      out.push(record(module, module, line));
      for (const name of collectImportedNames(from[2] ?? '', lines, index)) {
        out.push({ raw: `${module} ${name}`, specifier: joinPython(module, name), line, certain: false });
      }
      continue;
    }

    const direct = PY_IMPORT.exec(text.trim());
    if (direct?.[1] !== undefined) {
      for (const part of direct[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
        if (name !== '') out.push(record(name, name, line));
      }
    }
  }

  return out;
}

/**
 * The names on the right of `from X import …`, including the parenthesised
 * multi-line form, and without the `as` aliases.
 */
function collectImportedNames(first: string, lines: string[], startIndex: number): string[] {
  let body = first.trim();
  if (body.startsWith('(') && !body.includes(')')) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const text = lines[index] ?? '';
      body += ` ${text}`;
      if (text.includes(')')) break;
    }
  }

  return body
    .replace(/[()]/g, ' ')
    .split(',')
    .map((part) => (part.split(/\s+as\s+/)[0] ?? '').trim())
    .filter((name) => name !== '');
}

/**
 * `X` + `name`. A module path that is all dots already ends in the separator —
 * `from . import x` is `.x`, not `..x`.
 */
function joinPython(module: string, name: string): string {
  if (module.endsWith('.')) return `${module}${name}`;
  return `${module}.${name}`;
}

// ---------------------------------------------------------------------------

function sortRecords(records: ImportRecord[]): ImportRecord[] {
  return [...records].sort(
    (a, b) => a.line - b.line || (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0)
  );
}
