/**
 * Python extraction.
 *
 * The assertions worth having are the ones an indentation scan gets wrong:
 * a block that ends at the next blank line instead of the next statement, a
 * `def` inside a class reported as a function, a decorator left outside the
 * function's range, and `==` read as an assignment.
 */
import { describe, it, expect } from 'vitest';
import { parsePython } from './python.js';
import { SymbolMapSchema } from '../../schemas/intelligence/symbol-map.js';

function names(source: string): string[] {
  return parsePython('a.py', source).map((s) => `${s.type} ${s.name}`);
}

describe('parsePython', () => {
  it('reports classes, functions and async functions', () => {
    const source = [
      'class Service:',
      '    pass',
      '',
      'def run():',
      '    pass',
      '',
      'async def fetch():',
      '    pass',
    ].join('\n');
    expect(names(source)).toEqual(['class Service', 'function run', 'function fetch']);
  });

  it('reports a def inside a class as a method of that class', () => {
    const source = ['class Service:', '    def start(self):', '        pass'].join('\n');
    const symbols = parsePython('a.py', source);
    const start = symbols.find((s) => s.name === 'start');
    expect(start?.type).toBe('method');
    expect(start?.parent).toBe('Service');
  });

  it('ends a block at its last statement, not at the blank line after it', () => {
    const source = ['def run():', '    a = 1', '    return a', '', '', 'def next_one():', '    pass'].join('\n');
    const symbols = parsePython('a.py', source);
    const run = symbols.find((s) => s.name === 'run');
    expect(run?.startLine).toBe(1);
    expect(run?.endLine).toBe(3);
  });

  it('ends a block at its last statement, not at a trailing comment either', () => {
    // A blank line ends the scan by indentation alone, so it proves nothing
    // about the "ignore blanks and comments" branch. A comment indented *with*
    // the body does: without the branch the range swallows it, and every
    // symbol's range drifts one line further with each comment in the file.
    const source = ['def run():', '    a = 1', '    # not a statement', 'def next_one():', '    pass'].join('\n');
    const run = parsePython('a.py', source).find((s) => s.name === 'run');
    expect(run?.endLine).toBe(2);
  });

  it('starts a decorated function at its decorator', () => {
    const source = ['@app.route("/")', '@cache', 'def handler():', '    pass'].join('\n');
    const handler = parsePython('a.py', source).find((s) => s.name === 'handler');
    expect(handler?.startLine).toBe(1);
    expect(handler?.endLine).toBe(4);
  });

  it('tells a constant from a variable, and public from private', () => {
    const source = ['MAX_SIZE = 10', 'retries = 3', '_internal = 1'].join('\n');
    const byName = new Map(parsePython('a.py', source).map((s) => [s.name, s]));
    expect(byName.get('MAX_SIZE')?.type).toBe('constant');
    expect(byName.get('MAX_SIZE')?.exported).toBe(true);
    expect(byName.get('retries')?.type).toBe('variable');
    expect(byName.get('_internal')?.exported).toBe(false);
  });

  it('does not read == as an assignment', () => {
    expect(names('if a == 1:\n    pass\n')).toEqual([]);
  });

  it('does not report assignments inside a function body', () => {
    const source = ['def run():', '    local = 1', '    return local'].join('\n');
    expect(names(source)).toEqual(['function run']);
  });

  it('reports a class attribute as belonging to the class', () => {
    const source = ['class C:', '    TIMEOUT = 30'].join('\n');
    const timeout = parsePython('a.py', source).find((s) => s.name === 'TIMEOUT');
    expect(timeout?.parent).toBe('C');
    expect(timeout?.type).toBe('constant');
  });

  it('closes a class before reporting the next top-level function', () => {
    const source = ['class C:', '    def m(self):', '        pass', '', 'def free():', '    pass'].join('\n');
    const free = parsePython('a.py', source).find((s) => s.name === 'free');
    expect(free?.parent).toBeNull();
    expect(free?.type).toBe('function');
  });

  it('carries parser provenance below full confidence', () => {
    const symbols = parsePython('a.py', 'def run():\n    pass\n');
    for (const symbol of symbols) {
      expect(symbol.parser).toBe('regex');
      expect(symbol.parserConfidence).toBeLessThan(1);
      expect(symbol.parserConfidence).toBeGreaterThan(0);
    }
  });

  it('produces output the schema accepts', () => {
    const symbols = parsePython('a.py', 'class C:\n    def m(self):\n        pass\n');
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

  it('never ends a symbol before it starts', () => {
    const source = ['class C:', '    def m(self):', '        pass', '', 'x = 1'].join('\n');
    for (const symbol of parsePython('a.py', source)) {
      expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
    }
  });
});
