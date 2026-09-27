/**
 * Python symbols, by regex over indentation (D-018).
 *
 * No parser, so this reports what a line scan can defend: `class`, `def`,
 * `async def`, and module- or class-level assignment. Function bodies are
 * skipped — a local variable is not part of a declaration surface — and a
 * block's end comes from indentation, not from a brace.
 *
 * `exported` is the `_`-prefix convention, since Python has no export
 * keyword. It is a heuristic and is reported as one: every symbol here
 * carries `parser: 'regex'` with a confidence below 1.
 */
import { blockEnd, finish, toLines, type Draft, type Line } from './lines.js';
import { symbolId, type Symbol as SymbolEntry } from '../../schemas/intelligence/symbol-map.js';

export const PYTHON_CONFIDENCE = 0.75;

const COMMENT_PREFIXES = ['#'] as const;

const CLASS_PATTERN = /^class\s+([A-Za-z_]\w*)/;
const DEF_PATTERN = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/;
const DECORATOR_PATTERN = /^@/;
/** `NAME = ...`, `NAME: int = ...` — but not `NAME == ...`. */
const ASSIGNMENT_PATTERN = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/;

/** `MAX_SIZE` and `MAX2` are constants; `maxSize` is not. */
const CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

interface Block {
  indent: number;
  kind: 'class' | 'function';
  name: string;
}

export function parsePython(path: string, content: string): SymbolEntry[] {
  const lines = toLines(content, COMMENT_PREFIXES);
  const drafts: Draft[] = [];
  const stack: Block[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.ignorable) continue;

    // Close every block this line is no longer inside.
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= line.indent) {
      stack.pop();
    }

    const trimmed = line.text.trim();
    const enclosingClass = innermostClass(stack);
    const startLine = decoratorStart(lines, i, line.indent);

    const classMatch = CLASS_PATTERN.exec(trimmed);
    if (classMatch?.[1]) {
      const name = classMatch[1];
      drafts.push({
        name,
        kind: 'class',
        parent: enclosingClass,
        exported: isPublic(name),
        startLine,
        endLine: blockEnd(lines, i, line.indent),
      });
      stack.push({ indent: line.indent, kind: 'class', name });
      continue;
    }

    const defMatch = DEF_PATTERN.exec(trimmed);
    if (defMatch?.[1]) {
      const name = defMatch[1];
      const inClass = enclosingClass !== null;
      drafts.push({
        name,
        // A `def` at class level is a method; anywhere else it is a function.
        kind: inClass ? 'method' : 'function',
        parent: enclosingClass,
        exported: isPublic(name),
        startLine,
        endLine: blockEnd(lines, i, line.indent),
      });
      stack.push({ indent: line.indent, kind: 'function', name });
      continue;
    }

    // Assignments only where they declare something about the module or the
    // class — never inside a function body.
    if (stack.some((block) => block.kind === 'function')) continue;

    const assignment = ASSIGNMENT_PATTERN.exec(trimmed);
    if (assignment?.[1]) {
      const name = assignment[1];
      drafts.push({
        name,
        kind: CONSTANT_PATTERN.test(name) ? 'constant' : 'variable',
        parent: enclosingClass,
        exported: isPublic(name),
        startLine: line.number,
        endLine: line.number,
      });
    }
  }

  return finish(drafts, path, 'regex', PYTHON_CONFIDENCE, symbolId);
}

function innermostClass(stack: Block[]): string | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const block = stack[i];
    if (block?.kind === 'class') return block.name;
  }
  return null;
}

/**
 * Walk back over decorator lines so a decorated function's range starts at
 * its `@decorator`, which is where a reader would say it starts.
 */
function decoratorStart(lines: Line[], index: number, indent: number): number {
  let start = lines[index]?.number ?? 1;
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) break;
    if (line.ignorable) continue;
    if (line.indent !== indent) break;
    if (!DECORATOR_PATTERN.test(line.text.trim())) break;
    start = line.number;
  }
  return start;
}

function isPublic(name: string): boolean {
  return !name.startsWith('_');
}
