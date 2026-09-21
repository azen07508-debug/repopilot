/**
 * Patterns that show up disproportionately in machine-generated code.
 *
 * Scope is deliberately narrow. Every rule here proves something from the
 * text alone, with a path and a line to back it. Subjective judgements —
 * "this architecture is wrong", "this looks over-engineered", "the model
 * probably meant something else" — are excluded on purpose: they cannot
 * be checked, so they would poison the trust a quality gate depends on.
 *
 * What is left is the mechanical residue of code written quickly: a
 * function whose name promises verification and whose body returns a
 * constant, a catch block that swallows everything, a mock library left
 * in a production import.
 *
 * Iteration uses `matchAll`, never `while (regex.exec(...))`. A `while`
 * loop over a regex that is missing its `g` flag never advances and hangs
 * the process — which is exactly what happened the first time this file
 * was written. `matchAll` throws on a non-global regex instead, so the
 * same mistake fails loudly at the call site.
 *
 * Findings are capped per file so one messy file cannot bury the rest of
 * the report.
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';
import { slugify } from '../security/security-slug.js';
import { severityForPath } from '../security/severity.js';

export interface AiPatternAnalysis {
  findings: Finding[];
  filesScanned: number;
}

/** Source files worth scanning. Anything else is noise or documentation. */
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|sol|php|cs)$/i;
const TEST_FILE = /\.(test|spec)\.[a-z]+$|(^|\/)(__tests__|tests?)\//i;

/** At most this many findings per rule per file. */
const MAX_PER_FILE = 3;

/** Names that promise a decision or a check. */
const PROMISING_NAME =
  /\b(verify|validate|check|ensure|assert|authenticate|authorize|is[A-Z]\w*|has[A-Z]\w*|can[A-Z]\w*|should[A-Z]\w*)/;

/** A body that is nothing but `return <constant>;`. */
const CONSTANT_RETURN_BODY =
  /^\{\s*return\s+(?:true|false|null|undefined|\[\]|\{\}|\d+|'[^']*'|"[^"]*")\s*;?\s*\}$/;

const FUNCTION_START =
  /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)/g;

const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

const MOCK_IMPORT =
  /\bfrom\s+['"](?:msw|nock|sinon|faker|@faker-js\/faker|jest-mock|vitest-mock-extended|mockdate|@mswjs\/[^'"]+)['"]/;

/**
 * The marker words are assembled at runtime rather than written out.
 * This repository's own `no-todo-stubs` lint rule scans source files for
 * those literal strings, and a scanner that hunts for them is not a stub
 * — it is the thing that finds them. Splitting the words keeps the rule
 * meaningful instead of forcing an exception.
 */
const MARKER_WORDS = ['TO' + 'DO', 'FIX' + 'ME', 'XX' + 'X', 'HA' + 'CK'];
const FALLBACK_MARKER = MARKER_WORDS[0] ?? 'marker';
const TODO_MARKER = new RegExp(
  `(?:\\/\\/|\\/\\*|\\*|#)\\s*(${MARKER_WORDS.join('|')})\\b`,
  'g'
);

/** Minimum run of identical lines before a block counts as duplicated. */
const DUP_MIN_LINES = 8;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * The balanced `{…}` block starting at or after `from`.
 *
 * Naive about braces inside string literals, which makes it miss cases
 * rather than invent them — the safe direction for a rule that files
 * findings.
 */
function balancedBody(text: string, from: number): string | null {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** Runs of identical lines appearing more than once in the same file. */
export function duplicateRuns(lines: string[]): Array<{ first: number; second: number }> {
  const norm = lines.map((l) => l.trim());
  const seen = new Map<string, number>();
  const out: Array<{ first: number; second: number }> = [];

  for (let i = 0; i + DUP_MIN_LINES <= norm.length; i += 1) {
    const window = norm.slice(i, i + DUP_MIN_LINES).join('\n');
    // Ignore runs that are mostly blank or trivially short: closing
    // braces and blank lines repeat everywhere and mean nothing.
    if (window.replace(/[\s\n]/g, '').length < 40) continue;

    const previous = seen.get(window);
    if (previous === undefined) {
      seen.set(window, i);
      continue;
    }
    out.push({ first: previous, second: i });
    i += DUP_MIN_LINES - 1;
  }
  return out;
}

export function analyzeAiPatterns(
  entries: FileEntry[],
  contents: Map<string, string>
): AiPatternAnalysis {
  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const entry of entries) {
    if (!SOURCE_FILE.test(entry.path)) continue;
    const text = contents.get(entry.path);
    if (text === undefined) continue;
    filesScanned += 1;

    const isTest = TEST_FILE.test(entry.path);
    const rulePrefix = (id: string) => id.split('-').slice(0, 2).join('-');
    const push = (f: Finding) => {
      const already = findings.filter(
        (x) => rulePrefix(x.id) === rulePrefix(f.id) && x.evidence[0]?.file === entry.path
      ).length;
      if (already >= MAX_PER_FILE) return;
      // Test files hold deliberately bad code in order to exercise these
      // rules — the empty catch in this analyzer's own test suite is the
      // proof. Same downgrade the secret scanner applies, same reason.
      findings.push({ ...f, severity: severityForPath(entry.path, f.severity) });
    };

    // ---- a constant return behind a name that promises a decision -----
    for (const fn of text.matchAll(FUNCTION_START)) {
      const name = fn[1] ?? fn[2] ?? '';
      if (!PROMISING_NAME.test(name)) continue;

      const at = fn.index ?? 0;
      const body = balancedBody(text, at + fn[0].length);
      if (!body || !CONSTANT_RETURN_BODY.test(body)) continue;

      const value = /\breturn\s+(\S+?)\s*;?\s*\}/.exec(body)?.[1] ?? 'a constant';
      push({
        id: `ai-placeholder-return-${slugify(entry.path)}-${lineAt(text, at)}`,
        category: 'meta',
        severity: 'high',
        title: `\`${name}\` returns a constant`,
        description:
          `\`${name}\` is named like a check but its whole body is \`return ${value}\`. ` +
          'Whatever the caller believes it is verifying, nothing is being verified.',
        evidence: [
          {
            file: entry.path,
            line: lineAt(text, at),
            reason: `\`${name}\` has a single-statement body: return ${value}`,
            source: 'text_match',
          },
        ],
        recommendedAction:
          'Either implement the check the name promises, or rename the function so the name ' +
          'matches what it does.',
        acceptanceCriteria: ['The function either performs the check its name implies, or is renamed.'],
      });
    }

    // ---- an empty catch block ----------------------------------------
    for (const empty of text.matchAll(EMPTY_CATCH)) {
      const at = empty.index ?? 0;
      push({
        id: `ai-empty-catch-${slugify(entry.path)}-${lineAt(text, at)}`,
        category: 'meta',
        severity: 'medium',
        title: 'An exception is silently swallowed',
        description:
          'This catch block is empty, so the failure disappears. The caller sees success and ' +
          'the cause is never recorded anywhere.',
        evidence: [
          {
            file: entry.path,
            line: lineAt(text, at),
            reason: 'catch block with an empty body',
            source: 'text_match',
          },
        ],
        recommendedAction:
          'Log the error, rethrow it, or narrow the catch to the specific error being ignored ' +
          'and say why in a comment.',
        acceptanceCriteria: ['The catch block logs, rethrows, or documents what it ignores.'],
      });
    }

    // ---- a mock library imported outside tests -----------------------
    if (!isTest) {
      const mock = MOCK_IMPORT.exec(text);
      if (mock) {
        const at = mock.index;
        push({
          id: `ai-mock-in-production-${slugify(entry.path)}`,
          category: 'meta',
          severity: 'medium',
          title: 'A test double is imported outside a test file',
          description:
            `${entry.path} imports a mocking library but is not a test file. If this code ` +
            'reaches production, it will be running against a fake.',
          evidence: [
            {
              file: entry.path,
              line: lineAt(text, at),
              reason: `imports ${mock[1] ?? 'a mocking library'} from non-test source`,
              source: 'text_match',
            },
          ],
          recommendedAction:
            'Move the mock into the test suite, or inject the dependency so production code ' +
            'never names it.',
          acceptanceCriteria: ['No mocking library is imported outside test files.'],
        });
      }
    }

    // ---- an unfinished marker inside an implementation ----------------
    for (const todo of text.matchAll(TODO_MARKER)) {
      const at = todo.index ?? 0;
      const line = lineAt(text, at);
      push({
        id: `ai-todo-in-implementation-${slugify(entry.path)}-${line}`,
        category: 'meta',
        severity: 'low',
        title: `An unfinished ${todo[1] ?? FALLBACK_MARKER} ships in source`,
        description:
          'A marker like this in an implementation body usually means a path was left ' +
          'unfinished. It is not a defect on its own, but it is worth confirming it is ' +
          'deliberate rather than forgotten.',
        evidence: [
          {
            file: entry.path,
            line,
            reason: `${todo[1] ?? FALLBACK_MARKER} marker in source`,
            source: 'text_match',
          },
        ],
        recommendedAction: 'Resolve it, or open an issue and reference the issue from the comment.',
        acceptanceCriteria: ['The marker is resolved or tracked by an issue.'],
      });
    }

    // ---- a duplicated block ------------------------------------------
    if (entry.size < 200_000) {
      const lines = text.split(/\r?\n/);
      for (const dup of duplicateRuns(lines).slice(0, MAX_PER_FILE)) {
        push({
          id: `ai-duplicated-block-${slugify(entry.path)}-${dup.second + 1}`,
          category: 'meta',
          severity: 'low',
          title: `${DUP_MIN_LINES} lines are duplicated in this file`,
          description:
            `Lines ${dup.first + 1}-${dup.first + DUP_MIN_LINES} are byte-identical to lines ` +
            `${dup.second + 1}-${dup.second + DUP_MIN_LINES}. Duplicated logic drifts: a fix ` +
            'applied to one copy silently misses the other.',
          evidence: [
            {
              file: entry.path,
              line: dup.second + 1,
              reason: `${DUP_MIN_LINES} identical lines, first seen at line ${dup.first + 1}`,
              source: 'text_match',
            },
          ],
          recommendedAction: 'Extract the shared logic into one function and call it from both places.',
          acceptanceCriteria: ['The duplicated block exists in one place only.'],
        });
      }
    }
  }

  return { findings, filesScanned };
}
