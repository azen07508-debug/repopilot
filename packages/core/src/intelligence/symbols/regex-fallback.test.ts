/**
 * The line scanner behind every language without a parser (D-018).
 *
 * The two things worth pinning: it claims less than the real parsers do
 * (`parser: 'heuristic'`, confidence 0.5), and it returns *nothing* for a
 * language it has no profile for. A guessed symbol is worse than a missing
 * one — a missing symbol sends an agent to read the file, a wrong one sends
 * it to the wrong line.
 */
import { describe, it, expect } from 'vitest';
import { HEURISTIC_CONFIDENCE, parseWithHeuristics, supportsHeuristics } from './regex-fallback.js';

function names(source: string, language: string): string[] {
  return parseWithHeuristics('a', source, language).map((s) => `${s.type} ${s.name}`);
}

describe('parseWithHeuristics', () => {
  it('reads Go types, functions and constants', () => {
    const source = [
      'package main',
      '',
      'type Server struct {',
      '\tPort int',
      '}',
      '',
      'type Reader interface {',
      '\tRead() error',
      '}',
      '',
      'func New() *Server {',
      '\treturn nil',
      '}',
      '',
      'func (s *Server) Start() error {',
      '\treturn nil',
      '}',
      '',
      'const MaxRetries = 3',
    ].join('\n');

    expect(names(source, 'Go')).toEqual([
      'struct Server',
      'interface Reader',
      'function New',
      'function Start',
      'constant MaxRetries',
    ]);
  });

  it('reads Go exported-ness from capitalisation', () => {
    const source = 'func Exported() {}\nfunc unexported() {}';
    const byName = new Map(parseWithHeuristics('a', source, 'Go').map((s) => [s.name, s]));
    expect(byName.get('Exported')?.exported).toBe(true);
    expect(byName.get('unexported')?.exported).toBe(false);
  });

  it('reads Rust items, and needs a keyword for exported-ness', () => {
    const source = [
      'pub struct Config {',
      '    pub port: u16,',
      '}',
      '',
      'pub enum Mode {',
      '    Fast,',
      '}',
      '',
      'fn private_helper() {}',
      '',
      'pub fn run() {}',
    ].join('\n');

    expect(names(source, 'Rust')).toEqual([
      'struct Config',
      'enum Mode',
      'function private_helper',
      'function run',
    ]);
    const byName = new Map(parseWithHeuristics('a', source, 'Rust').map((s) => [s.name, s]));
    expect(byName.get('run')?.exported).toBe(true);
    expect(byName.get('private_helper')?.exported).toBe(false);
  });

  it('reads Ruby methods and classes, ending a block by indentation', () => {
    const source = ['class Thing', '  def call', '    @x = 1', '  end', '', '  def other', '  end', 'end'].join('\n');
    const symbols = parseWithHeuristics('a.rb', source, 'Ruby');
    expect(symbols.map((s) => `${s.type} ${s.name}`)).toEqual([
      'class Thing',
      'function call',
      'function other',
    ]);
    const call = symbols.find((s) => s.name === 'call');
    expect(call?.parent).toBe('Thing');
    expect(call?.startLine).toBe(2);
    expect(call?.endLine).toBe(4);
  });

  it('reads shell functions and upper-case constants', () => {
    const source = ['deploy() {', '  echo hi', '}', '', 'REGION=us-east-1'].join('\n');
    expect(names(source, 'Shell')).toEqual(['function deploy', 'constant REGION']);
  });

  it('reads Kotlin classes and functions', () => {
    const source = ['class Repo {', '    fun save(): Boolean {', '        return true', '    }', '}'].join('\n');
    expect(names(source, 'Kotlin')).toEqual(['class Repo', 'function save']);
  });

  it('reads protobuf messages and services', () => {
    const source = ['message Point {', '  int32 x = 1;', '}', '', 'service Api {', '  rpc Get(Point) returns (Point);', '}'].join('\n');
    expect(names(source, 'Protobuf')).toEqual(['struct Point', 'interface Api', 'function Get']);
  });

  it('is the safety net for TypeScript, mirroring what the compiler API reports', () => {
    const source = [
      'export interface Options {}',
      'export class Service {}',
      'export function run() {}',
      'export const LIMIT = 1;',
    ].join('\n');
    expect(names(source, 'TypeScript')).toEqual([
      'interface Options',
      'class Service',
      'function run',
      'constant LIMIT',
    ]);
  });

  it('reports heuristic provenance at half confidence', () => {
    // Half, not "somewhat lower": the scanner matched a line and took a name
    // out of it. It does not know whether that line is a declaration, a call
    // or a comment, so it should not be able to score like something that does.
    expect(HEURISTIC_CONFIDENCE).toBe(0.5);
    for (const symbol of parseWithHeuristics('a.go', 'func Run() {}', 'Go')) {
      expect(symbol.parser).toBe('heuristic');
      expect(symbol.parserConfidence).toBe(HEURISTIC_CONFIDENCE);
    }
  });

  it('returns nothing for a language it has no profile for', () => {
    expect(supportsHeuristics('Cairo')).toBe(false);
    expect(parseWithHeuristics('a.cairo', 'func main() {}', 'Cairo')).toEqual([]);
  });

  it('does not report the same line as two symbols', () => {
    // `export const enum Mode` matches the `enum` rule, and then the `const`
    // rule, which reads `enum` itself as the constant's name. Stopping after
    // the first hit is the only thing keeping the second symbol out.
    //
    // (An earlier version of this test used `public class Foo {` and a
    // comment claiming the Java method rule also matched. It does not — that
    // rule requires a `(`, so the test passed with or without the `break`,
    // and the mutation that removes it went unnoticed.)
    expect(names('export const enum Mode { A, B }', 'TypeScript')).toEqual(['enum Mode']);
  });
});
