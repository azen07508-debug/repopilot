/**
 * Line scanning, shared by the languages that have no parser (D-018).
 *
 * Python and Solidity both need the same two things: a line's indentation,
 * and where an indentation-delimited block ends. Doing that twice would mean
 * two subtly different answers to "does this line end the block", which is
 * exactly the kind of drift the `parser` field exists to make visible.
 */
import type { Symbol as SymbolEntry, SymbolKind } from '../../schemas/intelligence/symbol-map.js';

/** A tab counts as four columns. Python forbids mixing, so this is only ever a guess at width. */
const TAB_WIDTH = 4;

export interface Line {
  /** 1-based, matching `Symbol.startLine`. */
  number: number;
  text: string;
  /** Leading whitespace width, with tabs expanded. */
  indent: number;
  /** Blank, or a comment in the language's syntax. */
  ignorable: boolean;
}

export function toLines(content: string, commentPrefixes: readonly string[]): Line[] {
  const raw = content.split(/\r?\n/);
  return raw.map((text, index) => ({
    number: index + 1,
    text,
    indent: indentWidth(text),
    ignorable: isIgnorable(text, commentPrefixes),
  }));
}

function indentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += TAB_WIDTH;
    else break;
  }
  return width;
}

function isIgnorable(text: string, commentPrefixes: readonly string[]): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  return commentPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * The last line of the block opened at `lines[startIndex]`, whose own
 * indentation is `indent`.
 *
 * Trailing blank and comment lines are not part of the block: a `def` whose
 * body is followed by two blank lines ends at its last real statement, not
 * at the blank line before the next `def`. Getting this wrong makes every
 * symbol's range overlap its neighbour's.
 *
 * `terminator` is for languages that close a block with a keyword at the
 * same indentation — Ruby's `end`, Shell's `}`. Indentation alone would stop
 * at the last body line and leave the closing keyword outside the range,
 * which is not where a reader would say the block ends.
 */
export function blockEnd(
  lines: Line[],
  startIndex: number,
  indent: number,
  terminator?: RegExp
): number {
  let end = lines[startIndex]?.number ?? 1;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) break;
    if (line.ignorable) continue;
    if (line.indent <= indent) {
      if (terminator && line.indent === indent && terminator.test(line.text.trim())) {
        return line.number;
      }
      break;
    }
    end = line.number;
  }
  return end;
}

/** A symbol as a regex parser builds it, before the id and path are attached. */
export interface Draft {
  name: string;
  kind: SymbolKind;
  parent: string | null;
  exported: boolean;
  startLine: number;
  endLine: number;
}

/**
 * Remove comments and string literals so braces inside them are not counted.
 *
 * Deliberately naive — line-based, and it does not track block comments
 * across lines. It is good enough to keep a `revert("unbalanced {")` or a
 * `// {` from breaking every range after it, and the confidence a regex
 * parser reports already says it is not exact.
 */
export function stripNonCode(text: string, lineComment = '//'): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (lineComment !== '' && char === lineComment[0] && next === lineComment[1]) break;
    out += char;
  }
  return out;
}

/** Brace depth as of the start of `index`, so a closing brace can be attributed. */
export function braceDepthBefore(lines: { text: string }[], index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    for (const char of stripNonCode(lines[i]?.text ?? '')) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
  }
  return depth;
}

/**
 * Where the brace opened on or after `startIndex` closes.
 *
 * Falls back to the declaration's own line when nothing opens — an interface
 * method, or a field — because a range that runs to the end of the file is
 * worse than a one-line one.
 */
export function braceEnd(
  lines: { number: number; text: string }[],
  startIndex: number,
  lineComment = '//'
): number {
  const startLine = lines[startIndex]?.number ?? 1;
  let depth = 0;
  let opened = false;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) break;
    for (const char of stripNonCode(line.text, lineComment)) {
      if (char === '{') {
        depth += 1;
        opened = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) return line.number;
  }

  return startLine;
}

/**
 * Attach `id` / `path` / parser provenance.
 *
 * Kept in one place so every regex parser produces the same shape, and so
 * the id format has exactly one implementation — the schema's `symbolId()`.
 */
export function finish(
  drafts: Draft[],
  path: string,
  parser: 'regex' | 'heuristic',
  confidence: number,
  symbolId: (path: string, name: string, startLine: number) => string
): SymbolEntry[] {
  return drafts.map((draft) => ({
    id: symbolId(path, draft.name, draft.startLine),
    name: draft.name,
    type: draft.kind,
    path,
    startLine: draft.startLine,
    endLine: draft.endLine,
    parent: draft.parent,
    exported: draft.exported,
    references: 0,
    parser,
    parserConfidence: confidence,
  }));
}
