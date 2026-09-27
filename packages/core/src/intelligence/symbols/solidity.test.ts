/**
 * Solidity extraction.
 *
 * The range assertions are the point: Solidity blocks are brace-delimited,
 * so a scanner that counts braces without stripping comments and strings
 * lets a `revert("unbalanced {")` or a `// }` swallow the rest of the file,
 * and every symbol after it gets the wrong `endLine`.
 */
import { describe, it, expect } from 'vitest';
import { parseSolidity } from './solidity.js';
import { SymbolMapSchema } from '../../schemas/intelligence/symbol-map.js';

function names(source: string): string[] {
  return parseSolidity('C.sol', source).map((s) => `${s.type} ${s.name}`);
}

describe('parseSolidity', () => {
  it('reports a contract, its functions and its state', () => {
    const source = [
      'pragma solidity ^0.8.0;',
      '',
      'contract Counter {',
      '    uint256 public count;',
      '    uint256 private secret;',
      '    uint256 public constant MAX = 100;',
      '',
      '    function increment() public {',
      '        count += 1;',
      '    }',
      '}',
    ].join('\n');

    expect(names(source)).toEqual([
      'contract Counter',
      'variable count',
      'variable secret',
      'constant MAX',
      'function increment',
    ]);
  });

  it('reports interface and library declarations', () => {
    const source = ['interface IThing {', '    function go() external;', '}', '', 'library Math {', '}'].join('\n');
    expect(names(source)).toEqual(['interface IThing', 'function go', 'contract Math']);
  });

  it('gives members the enclosing contract as their parent', () => {
    const source = ['contract C {', '    function f() public {}', '}'].join('\n');
    expect(parseSolidity('C.sol', source).find((s) => s.name === 'f')?.parent).toBe('C');
  });

  it('does not report a local variable as contract state', () => {
    // `uint local = 1;` inside a function body matches the state-variable
    // pattern exactly as `uint256 count;` does at contract level. The only
    // thing telling them apart is whether a contract is open, so the guard
    // has to be pinned: without it the map reports the implementation's
    // locals as if they were part of the deployed contract.
    const source = [
      'contract C {',
      '    function f() public {',
      '        uint local = 1;',
      '    }',
      '}',
    ].join('\n');
    expect(names(source)).toEqual(['contract C', 'function f']);
  });

  it('marks a contract as exported, and spans its body', () => {
    // A contract is the unit that gets deployed: it is the one declaration
    // where "visible outside" needs no modifier to be true. Its range is
    // brace-matched like a member's, not reduced to its own line.
    const source = ['contract Counter {', '    uint256 count;', '}', 'library Math {', '}'].join('\n');
    const symbols = parseSolidity('C.sol', source);
    const counter = symbols.find((s) => s.name === 'Counter');
    const math = symbols.find((s) => s.name === 'Math');
    expect(counter?.exported).toBe(true);
    expect(counter?.startLine).toBe(1);
    expect(counter?.endLine).toBe(3);
    expect(math?.endLine).toBe(5);
  });

  it('reports modifiers, constructors and events', () => {
    const source = [
      'contract C {',
      '    event Done(address who);',
      '    modifier onlyOwner() { _; }',
      '    constructor() {}',
      '    function f() public {}',
      '}',
    ].join('\n');
    expect(names(source)).toEqual([
      'contract C',
      'type Done',
      'function onlyOwner',
      'function constructor',
      'function f',
    ]);
  });

  it('reports structs and enums', () => {
    const source = ['contract C {', '    struct Point { uint x; }', '    enum Mode { A, B }', '}'].join('\n');
    expect(names(source)).toEqual(['contract C', 'struct Point', 'enum Mode']);
  });

  it('spans a function from its declaration to its closing brace', () => {
    const source = [
      'contract C {',
      '    function f() public {',
      '        uint x = 1;',
      '        uint y = 2;',
      '    }',
      '}',
    ].join('\n');
    const f = parseSolidity('C.sol', source).find((s) => s.name === 'f');
    expect(f?.startLine).toBe(2);
    expect(f?.endLine).toBe(5);
  });

  it('is not unbalanced by a brace inside a string or a comment', () => {
    const source = [
      'contract C {',
      '    function f() public {',
      '        revert("unbalanced {");',
      '    }',
      '    function g() public {',
      '    }',
      '}',
    ].join('\n');
    const symbols = parseSolidity('C.sol', source);
    expect(symbols.find((s) => s.name === 'f')?.endLine).toBe(4);
    expect(symbols.find((s) => s.name === 'g')?.endLine).toBe(6);
  });

  it('ignores a closing brace written in a line comment', () => {
    const source = [
      'contract C {',
      '    function f() public { // }',
      '        uint x = 1;',
      '    }',
      '}',
    ].join('\n');
    const f = parseSolidity('C.sol', source).find((s) => s.name === 'f');
    expect(f?.endLine).toBe(4);
  });

  it('gives a bodiless interface function a one-line range', () => {
    const source = ['interface I {', '    function go() external;', '}'].join('\n');
    const go = parseSolidity('I.sol', source).find((s) => s.name === 'go');
    expect(go?.startLine).toBe(2);
    expect(go?.endLine).toBe(2);
  });

  it('reads visibility for exported-ness', () => {
    const source = [
      'contract C {',
      '    uint256 public a;',
      '    uint256 internal b;',
      '    function open_() public {}',
      '    function shut() internal {}',
      '}',
    ].join('\n');
    const byName = new Map(parseSolidity('C.sol', source).map((s) => [s.name, s]));
    expect(byName.get('a')?.exported).toBe(true);
    expect(byName.get('b')?.exported).toBe(false);
    expect(byName.get('open_')?.exported).toBe(true);
    expect(byName.get('shut')?.exported).toBe(false);
  });

  it('carries regex provenance', () => {
    for (const symbol of parseSolidity('C.sol', 'contract C {}')) {
      expect(symbol.parser).toBe('regex');
      expect(symbol.parserConfidence).toBeLessThan(1);
    }
  });

  it('produces output the schema accepts, and never inverts a range', () => {
    const source = ['contract C {', '    function f() public {', '    }', '}'].join('\n');
    const symbols = parseSolidity('C.sol', source);
    for (const symbol of symbols) {
      expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
    }
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
});
