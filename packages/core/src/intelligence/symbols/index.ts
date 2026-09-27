/**
 * Symbol Map — language routing and safe degradation (D-018).
 *
 * The hard rule from the schema: **a parser failure in one language must
 * never fail the whole audit.** Everything in here follows from it. Each
 * file is parsed inside its own `try`, a failure falls back to the line
 * scanner, and a failure of *that* becomes a `failures` entry and the loop
 * continues. `buildSymbolMap` does not throw for bad input; it reports.
 *
 * What it does not do: invent symbols for a language it has no extractor
 * for. Those languages are named in `failures` with their file count, so a
 * partial map announces itself instead of looking complete.
 */
import { classifyFile, detectLanguage, type FileEntry } from '../../git/files.js';
import { isProgrammingLanguage } from '../languages.js';
import { DEFAULT_MAX_FILE_BYTES } from '../limits.js';
import { compareStrings } from '../order.js';
import {
  SYMBOL_MAP_SCHEMA_VERSION,
  SymbolMapSchema,
  type LanguageCoverage,
  type ParserKind,
  type Symbol as SymbolEntry,
  type SymbolMap,
} from '../../schemas/intelligence/symbol-map.js';
import { parsePython } from './python.js';
import { parseSolidity } from './solidity.js';
import { parseTypeScript } from './typescript.js';
import { parseWithHeuristics, supportsHeuristics } from './regex-fallback.js';

/** The artifact is cached and shipped to agents, so it is capped like every other one. */
export const MAX_SYMBOLS = 20000;

/** One line per language is enough to say "this part of the map is missing". */
const MAX_FAILURES = 50;

export interface SymbolMapInput {
  entries: FileEntry[];
  contents: Map<string, string>;
  maxFileBytes?: number;
  /** Injectable so the cap can be tested without building 20 000 declarations. */
  maxSymbols?: number;
}

export function buildSymbolMap(input: SymbolMapInput): SymbolMap {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxSymbols = input.maxSymbols ?? MAX_SYMBOLS;

  const symbols: SymbolEntry[] = [];
  const coverage = new Map<string, LanguageCoverage>();
  const failures: { language: string; reason: string }[] = [];
  const oversizeByLanguage = new Map<string, number>();
  const unsupported = new Map<string, number>();
  let truncated = false;

  // Sorted so the result does not depend on the order the tree was listed in.
  for (const entry of [...input.entries].sort((a, b) => compareStrings(a.path, b.path))) {
    if (classifyFile(entry.path, entry.size).kind !== 'text') continue;

    const language = detectLanguage(entry.path);
    if (!language || !isProgrammingLanguage(language)) continue;

    const content = input.contents.get(entry.path);
    // No content means the fetch never brought this file back. That is the
    // caller's degradation to report, not this builder's.
    if (content === undefined) continue;

    if (entry.size > maxFileBytes) {
      oversizeByLanguage.set(language, (oversizeByLanguage.get(language) ?? 0) + 1);
      continue;
    }

    const parsed = parseFile(entry.path, content, language);
    if (parsed === null) {
      unsupported.set(language, (unsupported.get(language) ?? 0) + 1);
      continue;
    }

    const existing = coverage.get(language);
    if (existing) {
      existing.fileCount += 1;
      existing.degraded = existing.degraded || parsed.degraded;
    } else {
      coverage.set(language, {
        language,
        fileCount: 1,
        parser: parsed.parser,
        degraded: parsed.degraded,
      });
    }

    if (parsed.degraded) {
      failures.push({ language, reason: parsed.reason });
    }

    for (const symbol of parsed.symbols) {
      if (symbols.length >= maxSymbols) {
        truncated = true;
        break;
      }
      symbols.push(symbol);
    }
  }

  for (const [language, count] of oversizeByLanguage) {
    failures.push({
      language,
      reason:
        `${count} file(s) exceeded the ${maxFileBytes}-byte limit and were not parsed (R-18).`,
    });
  }
  for (const [language, count] of unsupported) {
    failures.push({
      language,
      reason: `No extractor is implemented for ${language}; ${count} file(s) produced no symbols.`,
    });
  }
  if (truncated) {
    failures.push({
      language: 'any',
      reason: `The symbol list is capped at ${maxSymbols}; the map covers only part of the repository.`,
    });
  }

  symbols.sort(
    (a, b) =>
      compareStrings(a.path, b.path) ||
      a.startLine - b.startLine ||
      compareStrings(a.name, b.name)
  );

  const reportedFailures = failures.slice(0, MAX_FAILURES);

  // Validated at the boundary, like every other artifact: a builder that can
  // emit a shape the schema rejects is a builder whose return type is a lie.
  return SymbolMapSchema.parse({
    schemaVersion: SYMBOL_MAP_SCHEMA_VERSION,
    languageCoverage: [...coverage.values()].sort((a, b) => compareStrings(a.language, b.language)),
    symbols,
    degraded: reportedFailures.length > 0,
    failures: reportedFailures,
  });
}

interface ParsedFile {
  symbols: SymbolEntry[];
  parser: ParserKind;
  degraded: boolean;
  reason: string;
}

/**
 * Parse one file, and never throw.
 *
 * `null` means no extractor exists for this language — distinct from an
 * extractor that ran and failed, which is a `degraded` result.
 */
function parseFile(path: string, content: string, language: string): ParsedFile | null {
  const preferred = preferredParserFor(language);
  if (preferred === null) return null;

  if (preferred === 'typescript-compiler') {
    try {
      return {
        symbols: parseTypeScript(path, content).symbols,
        parser: 'typescript-compiler',
        degraded: false,
        reason: '',
      };
    } catch (error) {
      // The compiler API is the only parser here with a failure mode that is
      // not just "a regex did not match": a stack overflow on deeply nested
      // input, or a syntax error the parser refuses. Both degrade rather
      // than propagate.
      const reason = describe(error);
      try {
        return {
          symbols: parseWithHeuristics(path, content, language),
          parser: 'heuristic',
          degraded: true,
          reason: `The TypeScript compiler API failed on this language (${reason}); symbols came from the line scanner instead.`,
        };
      } catch {
        return {
          symbols: [],
          parser: 'heuristic',
          degraded: true,
          reason: `Both the TypeScript compiler API and the line scanner failed (${reason}).`,
        };
      }
    }
  }

  const run = preferred === 'regex' ? regexParserFor(language) : null;
  try {
    return {
      symbols: run ? run(path, content) : parseWithHeuristics(path, content, language),
      parser: preferred,
      degraded: false,
      reason: '',
    };
  } catch (error) {
    return {
      symbols: [],
      parser: preferred,
      degraded: true,
      reason: `The ${preferred} parser failed on this language (${describe(error)}).`,
    };
  }
}

/**
 * The parser a language *should* be read with, per D-018.
 *
 * `null` means no extractor is implemented — the language is reported in
 * `failures` rather than quietly producing nothing.
 */
function preferredParserFor(language: string): ParserKind | null {
  if (language === 'TypeScript' || language === 'JavaScript') return 'typescript-compiler';
  if (language === 'Python' || language === 'Solidity') return 'regex';
  if (supportsHeuristics(language)) return 'heuristic';
  return null;
}

function regexParserFor(language: string): ((path: string, content: string) => SymbolEntry[]) | null {
  if (language === 'Python') return parsePython;
  if (language === 'Solidity') return parseSolidity;
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
