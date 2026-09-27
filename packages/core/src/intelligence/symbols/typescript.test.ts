/**
 * TypeScript / JavaScript extraction.
 *
 * The assertions that matter here are the ones a plausible implementation
 * gets wrong: line numbers that are 0-based, `exported` read from
 * `getCombinedModifierFlags` (which needs parents we deliberately do not
 * set), JSX parsed as TypeScript, and declarations inside function bodies
 * reported as if they were part of the file's surface.
 */
import { describe, it, expect } from 'vitest';
import { MAX_SYMBOLS_PER_FILE, parseTypeScript, scriptKindFor } from './typescript.js';
import { SymbolMapSchema, symbolId } from '../../schemas/intelligence/symbol-map.js';

function parse(path: string, content: string) {
  return parseTypeScript(path, content);
}

function names(path: string, content: string): string[] {
  return parse(path, content).symbols.map((s) => `${s.type} ${s.name}`);
}

describe('parseTypeScript', () => {
  it('reports each declaration kind', () => {
    const source = [
      'export function run(): void {}',
      'export class Service {}',
      'export interface Options {}',
      'export type Id = string;',
      'export enum Mode { A, B }',
      'export const LIMIT = 10;',
      'let counter = 0;',
    ].join('\n');

    expect(names('src/a.ts', source)).toEqual([
      'function run',
      'class Service',
      'interface Options',
      'type Id',
      'enum Mode',
      'constant LIMIT',
      'variable counter',
    ]);
  });

  it('produces output the schema accepts, with ids in the documented format', () => {
    const { symbols } = parse('src/a.ts', 'export function run(): void {}\n');
    const first = symbols[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.id).toBe(symbolId('src/a.ts', 'run', 1));
    expect(() =>
      SymbolMapSchema.parse({
        schemaVersion: '1.0',
        symbols,
        languageCoverage: [],
        degraded: false,
        failures: [],
      })
    ).not.toThrow();
  });

  it('marks exports, including a default export', () => {
    const source = [
      'export function a(): void {}',
      'export default function b(): void {}',
      'function c(): void {}',
    ].join('\n');
    const byName = new Map(parse('src/a.ts', source).symbols.map((s) => [s.name, s]));
    expect(byName.get('a')?.exported).toBe(true);
    expect(byName.get('b')?.exported).toBe(true);
    expect(byName.get('c')?.exported).toBe(false);
  });

  it('numbers lines from one, and never ends before it starts', () => {
    const source = 'const a = 1;\n\n\nfunction b() {\n  return 1;\n}\n';
    const { symbols } = parse('src/a.ts', source);
    const a = symbols.find((s) => s.name === 'a');
    const b = symbols.find((s) => s.name === 'b');
    expect(a?.startLine).toBe(1);
    expect(a?.endLine).toBe(1);
    // `function b` opens on line 4 and closes on line 6.
    expect(b?.startLine).toBe(4);
    expect(b?.endLine).toBe(6);
    for (const symbol of symbols) expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
  });

  it('gives class members the class as their parent', () => {
    const source = [
      'export class Service {',
      '  private ready = false;',
      '  start(): void {}',
      '}',
    ].join('\n');
    const { symbols } = parse('src/a.ts', source);
    const start = symbols.find((s) => s.name === 'start');
    const ready = symbols.find((s) => s.name === 'ready');
    expect(start?.parent).toBe('Service');
    expect(start?.type).toBe('method');
    expect(ready?.parent).toBe('Service');
    expect(ready?.type).toBe('variable');
  });

  it('gives namespace members the namespace as their parent', () => {
    const source = ['export namespace Math2 {', '  export function add(): void {}', '}'].join('\n');
    const { symbols } = parse('src/a.ts', source);
    expect(symbols.find((s) => s.name === 'add')?.parent).toBe('Math2');
  });

  it('reports an arrow function bound to a const as a function, not a constant', () => {
    const source = 'export const handler = () => 1;\nexport const LIMIT = 10;\n';
    const byName = new Map(parse('src/a.ts', source).symbols.map((s) => [s.name, s]));
    expect(byName.get('handler')?.type).toBe('function');
    expect(byName.get('LIMIT')?.type).toBe('constant');
  });

  it('handles several declarations in one statement', () => {
    expect(names('src/a.ts', 'const a = 1, b = 2;\n')).toEqual(['constant a', 'constant b']);
  });

  it('does not report declarations that live inside a function body', () => {
    const source = [
      'export function outer(): void {',
      '  function inner(): void {}',
      '  const local = 1;',
      '}',
    ].join('\n');
    expect(names('src/a.ts', source)).toEqual(['function outer']);
  });

  it('parses a .tsx file as TSX rather than TypeScript', () => {
    const source = 'export function Widget() {\n  return <div className="x" />;\n}\n';
    const { symbols } = parse('src/Widget.tsx', source);
    expect(symbols.map((s) => s.name)).toEqual(['Widget']);
  });

  it('skips a computed property name instead of inventing one', () => {
    const source = 'export class C {\n  [Symbol.iterator](): void {}\n}\n';
    const { symbols } = parse('src/a.ts', source);
    expect(symbols.map((s) => s.name)).toEqual(['C']);
  });

  it('skips destructuring instead of guessing the bound names', () => {
    expect(names('src/a.ts', 'const { a, b } = obj;\n')).toEqual([]);
  });

  it('caps the list and says it did', () => {
    const source = Array.from(
      { length: MAX_SYMBOLS_PER_FILE + 5 },
      (_, i) => `export const v${i} = ${i};`
    ).join('\n');
    const result = parse('src/a.ts', source);
    expect(result.symbols).toHaveLength(MAX_SYMBOLS_PER_FILE);
    expect(result.truncated).toBe(true);
  });

  it('caps a list that arrives in a single statement, and still says it did', () => {
    // `const a = 1, b = 2;` is one node with many declarators, so the cap is
    // reached *inside* the statement rather than between two of them. A cap
    // check that only runs per statement lets this through unreported.
    const declarators = Array.from(
      { length: MAX_SYMBOLS_PER_FILE + 5 },
      (_, i) => `v${i} = ${i}`
    ).join(', ');
    const result = parse('src/a.ts', `export const ${declarators};`);
    expect(result.symbols).toHaveLength(MAX_SYMBOLS_PER_FILE);
    expect(result.truncated).toBe(true);
  });

  it('reports the cap when a container is reached with the cap already full', () => {
    // A namespace contributes no symbol of its own — the schema has no
    // `namespace` kind — so its declaration is a node that yields nothing
    // while still holding declarations. A cap check that returns instead of
    // descending therefore drops the whole namespace, and `truncated` stays
    // false: an incomplete surface reported as a complete one.
    const filler = Array.from(
      { length: MAX_SYMBOLS_PER_FILE },
      (_, i) => `v${i} = ${i}`
    ).join(', ');
    const source = `export const ${filler};\nexport namespace N {\n  export const overflow = 1;\n}\n`;

    const result = parse('src/a.ts', source);
    expect(result.symbols).toHaveLength(MAX_SYMBOLS_PER_FILE);
    expect(result.symbols.some((s) => s.name === 'overflow')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it('does not claim truncation for a file that is exactly at the cap', () => {
    const source = Array.from(
      { length: MAX_SYMBOLS_PER_FILE },
      (_, i) => `export const v${i} = ${i};`
    ).join('\n');
    const result = parse('src/a.ts', source);
    expect(result.symbols).toHaveLength(MAX_SYMBOLS_PER_FILE);
    expect(result.truncated).toBe(false);
  });

  it('picks the script kind from the extension', () => {
    // Asserted by relation, not by enum value: the numbers are TypeScript
    // internals, and a test that hard-codes them breaks on an upgrade
    // without anything actually being wrong.
    expect(scriptKindFor('a.tsx')).not.toBe(scriptKindFor('a.ts'));
    expect(scriptKindFor('a.jsx')).not.toBe(scriptKindFor('a.js'));
    expect(scriptKindFor('a.js')).toBe(scriptKindFor('a.mjs'));
    expect(scriptKindFor('a.js')).toBe(scriptKindFor('a.cjs'));
    expect(new Set(['a.ts', 'a.js', 'a.tsx', 'a.jsx'].map(scriptKindFor)).size).toBe(4);
  });

  it('is deterministic regardless of nothing — same input, same output', () => {
    const source = 'export function a(): void {}\nexport class B {}\n';
    expect(parse('src/a.ts', source)).toEqual(parse('src/a.ts', source));
  });
});
