/**
 * Solidity symbols, by regex plus brace matching (D-018).
 *
 * Solidity is brace-delimited, so a block's end is found by counting braces
 * rather than by indentation. Comments and string literals are stripped
 * first: a `// {` or a `"{"` in a revert message would otherwise unbalance
 * the count and make one symbol swallow the rest of the file.
 *
 * The schema has no `modifier`, `event` or `error` kind. A modifier is
 * reported as `function` (it is called like one) and an event or error as
 * `type` (it is declared, not called). Both are documented here rather than
 * silently forced into a shape that looks exact.
 */
import { braceDepthBefore, braceEnd, finish, toLines, type Draft } from './lines.js';
import { symbolId, type Symbol as SymbolEntry } from '../../schemas/intelligence/symbol-map.js';

export const SOLIDITY_CONFIDENCE = 0.7;

const COMMENT_PREFIXES = ['//', '/*', '*'] as const;

const CONTAINER_PATTERNS: { pattern: RegExp; kind: 'contract' | 'interface' }[] = [
  { pattern: /^(?:abstract\s+)?contract\s+([A-Za-z_]\w*)/, kind: 'contract' },
  { pattern: /^library\s+([A-Za-z_]\w*)/, kind: 'contract' },
  { pattern: /^interface\s+([A-Za-z_]\w*)/, kind: 'interface' },
];

const MEMBER_PATTERNS: { pattern: RegExp; kind: Draft['kind'] }[] = [
  { pattern: /^function\s+([A-Za-z_]\w*)/, kind: 'function' },
  { pattern: /^(constructor)\s*\(/, kind: 'function' },
  { pattern: /^(fallback)\s*\(/, kind: 'function' },
  { pattern: /^(receive)\s*\(/, kind: 'function' },
  { pattern: /^modifier\s+([A-Za-z_]\w*)/, kind: 'function' },
  { pattern: /^event\s+([A-Za-z_]\w*)/, kind: 'type' },
  { pattern: /^error\s+([A-Za-z_]\w*)/, kind: 'type' },
  { pattern: /^struct\s+([A-Za-z_]\w*)/, kind: 'struct' },
  { pattern: /^enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
];

/** `uint256 public constant TOTAL = 1;` — a declaration, not a statement. */
const STATE_VARIABLE_PATTERN =
  /^(?:mapping\s*\([^)]*\)|[A-Za-z_]\w*(?:\[\])?)\s+(?:public|private|internal|external|immutable|constant|override|virtual|\s)*\s*([A-Za-z_]\w*)\s*(?:=|;)/;

const VISIBLE_OUTSIDE_PATTERN = /\b(public|external)\b/;
const CONSTANT_KEYWORD_PATTERN = /\bconstant\b/;

export function parseSolidity(path: string, content: string): SymbolEntry[] {
  const lines = toLines(content, COMMENT_PREFIXES);
  const drafts: Draft[] = [];
  const stack: { depth: number; name: string }[] = [];
  let container: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    // Leave any container whose closing brace we have passed.
    const depthHere = braceDepthBefore(lines, i);
    while (stack.length > 0 && depthHere < (stack[stack.length - 1]?.depth ?? 0)) {
      stack.pop();
    }
    const open = stack[stack.length - 1];
    container = open?.name ?? null;

    if (line.ignorable) continue;
    const trimmed = line.text.trim();

    const containerMatch = matchContainer(trimmed);
    if (containerMatch) {
      drafts.push({
        name: containerMatch.name,
        kind: containerMatch.kind,
        parent: container,
        // A contract is the unit that gets deployed; there is no narrower
        // notion of visibility at this level.
        exported: true,
        startLine: line.number,
        endLine: braceEnd(lines, i),
      });
      stack.push({ depth: depthHere + 1, name: containerMatch.name });
      container = containerMatch.name;
      continue;
    }

    const memberMatch = matchMember(trimmed);
    if (memberMatch) {
      drafts.push({
        name: memberMatch.name,
        kind: memberMatch.kind,
        parent: container,
        exported: VISIBLE_OUTSIDE_PATTERN.test(trimmed),
        startLine: line.number,
        endLine: braceEnd(lines, i),
      });
      continue;
    }

    // State variables only where they declare something about a contract:
    // directly in its body, not one brace deeper. `uint local = 1;` inside a
    // function matches the same pattern as `uint256 count;` at contract
    // level, and the only thing telling them apart is the brace depth.
    // Checking `container === null` alone did not do this — inside a
    // function the contract is still open, so locals were reported as state
    // of the deployed contract.
    if (!open || depthHere !== open.depth) continue;
    const stateVariable = STATE_VARIABLE_PATTERN.exec(trimmed);
    if (stateVariable?.[1]) {
      drafts.push({
        name: stateVariable[1],
        kind: CONSTANT_KEYWORD_PATTERN.test(trimmed) ? 'constant' : 'variable',
        parent: container,
        exported: VISIBLE_OUTSIDE_PATTERN.test(trimmed),
        startLine: line.number,
        endLine: line.number,
      });
    }
  }

  return finish(drafts, path, 'regex', SOLIDITY_CONFIDENCE, symbolId);
}

function matchContainer(trimmed: string): { name: string; kind: 'contract' | 'interface' } | null {
  for (const { pattern, kind } of CONTAINER_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) return { name: match[1], kind };
  }
  return null;
}

function matchMember(trimmed: string): { name: string; kind: Draft['kind'] } | null {
  for (const { pattern, kind } of MEMBER_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) return { name: match[1], kind };
  }
  return null;
}
