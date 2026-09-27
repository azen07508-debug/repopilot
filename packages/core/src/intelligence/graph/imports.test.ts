/**
 * Import extraction.
 *
 * The assertions worth having are the ones a plausible extractor misses:
 * `export … from` and dynamic `import()`, a Go `import ( … )` block, Python's
 * `from . import x` (which is a submodule, not a name), and Rust's `mod foo;`
 * — which is a module of *this* crate and must not be filed as an external
 * dependency.
 */
import { describe, it, expect } from 'vitest';
import { extractImports, supportsImports, type ImportRecord } from './imports.js';

function specs(source: string, language: string): string[] {
  const records = extractImports('a', source, language);
  if (records === null) throw new Error(`no extractor for ${language}`);
  return records.map((record) => record.specifier);
}

function bySpecifier(source: string, language: string): Map<string, ImportRecord> {
  const records = extractImports('a', source, language);
  if (records === null) throw new Error(`no extractor for ${language}`);
  return new Map(records.map((record) => [record.specifier, record]));
}

describe('supportsImports', () => {
  it('names the languages it can read', () => {
    expect(supportsImports('TypeScript')).toBe(true);
    expect(supportsImports('JavaScript')).toBe(true);
    expect(supportsImports('Python')).toBe(true);
    expect(supportsImports('Solidity')).toBe(true);
    expect(supportsImports('Go')).toBe(true);
  });

  it('does not claim a language it has no profile for', () => {
    expect(supportsImports('Cairo')).toBe(false);
    expect(extractImports('a.cairo', 'func main() {}', 'Cairo')).toBeNull();
  });
});

describe('TypeScript and JavaScript', () => {
  it('reads every form that names another module', () => {
    const source = [
      "import { a } from './a.js';",
      "export { b } from './b.js';",
      "export * from './c.js';",
      "import d = require('./d.js');",
      "const e = await import('./e.js');",
      "const f = require('./f.js');",
    ].join('\n');

    expect(specs(source, 'TypeScript')).toEqual([
      './a.js',
      './b.js',
      './c.js',
      './d.js',
      './e.js',
      './f.js',
    ]);
  });

  it('numbers lines from one', () => {
    const source = ["import { a } from './a.js';", '', "import { b } from './b.js';"].join('\n');
    const records = extractImports('a.ts', source, 'TypeScript');
    expect(records?.map((record) => record.line)).toEqual([1, 3]);
  });

  it('reads a .tsx file as TSX rather than TypeScript', () => {
    expect(specs("import x from './x.js';\nexport const C = () => <div />;\n", 'TypeScript')).toEqual([
      './x.js',
    ]);
  });

  it('does not read a string that merely looks like an import', () => {
    expect(specs("const s = \"import x from './nope.js'\";\n", 'TypeScript')).toEqual([]);
  });

  it('marks every specifier certain', () => {
    const records = extractImports('a.ts', "import x from './x.js';", 'TypeScript');
    expect(records?.every((record) => record.certain)).toBe(true);
  });

  it('is deterministic', () => {
    const source = "import b from './b.js';\nimport a from './a.js';";
    expect(extractImports('a.ts', source, 'TypeScript')).toEqual(
      extractImports('a.ts', source, 'TypeScript')
    );
  });
});

describe('Python', () => {
  it('reads a dotted import and a comma list', () => {
    expect(specs('import os.path\nimport a.b, c.d\n', 'Python')).toEqual(['os.path', 'a.b', 'c.d']);
  });

  it('reads from-import as the module, plus each name as a possible submodule', () => {
    // `from . import models` is how most projects reach their own modules, so
    // `.models` has to be tried — but `models` may equally be a class defined
    // in `__init__.py`, so it is not certain.
    const records = bySpecifier('from pkg.util import Thing\n', 'Python');
    expect([...records.keys()]).toEqual(['pkg.util', 'pkg.util.Thing']);
    expect(records.get('pkg.util')?.certain).toBe(true);
    expect(records.get('pkg.util.Thing')?.certain).toBe(false);
  });

  it('joins a dotted module without doubling the separator', () => {
    expect(specs('from . import models\n', 'Python')).toEqual(['.', '.models']);
    expect(specs('from .. import shared\n', 'Python')).toEqual(['..', '..shared']);
  });

  it('reads the parenthesised multi-line form and drops the aliases', () => {
    const source = ['from pkg.util import (', '    Thing,', '    other as renamed,', ')'].join('\n');
    expect(specs(source, 'Python')).toEqual(['pkg.util', 'pkg.util.Thing', 'pkg.util.other']);
  });

  it('reads an import indented inside a block', () => {
    // `if TYPE_CHECKING:` and `try:` are where a Python file's imports often
    // live, and they are indented.
    const source = ['if TYPE_CHECKING:', '    from pkg.util import Thing', ''].join('\n');
    expect(specs(source, 'Python')).toEqual(['pkg.util', 'pkg.util.Thing']);
  });

  it('drops the alias in a direct import', () => {
    // Sorted by specifier within the line, so the order is the artifact's,
    // not the source's.
    expect(specs('import os.path as p, json\n', 'Python')).toEqual(['json', 'os.path']);
  });

  it('orders the guesses on one line so two runs agree', () => {
    expect(specs('from pkg.util import zebra, apple\n', 'Python')).toEqual([
      'pkg.util',
      'pkg.util.apple',
      'pkg.util.zebra',
    ]);
  });

  it('does not read == as an import', () => {
    expect(specs('if a == 1:\n    pass\n', 'Python')).toEqual([]);
  });
});

describe('Solidity', () => {
  it('reads a plain import and a named one', () => {
    expect(specs('import "./Counter.sol";\n', 'Solidity')).toEqual(['./Counter.sol']);
    expect(specs('import { Counter } from "./Counter.sol";\n', 'Solidity')).toEqual(['./Counter.sol']);
  });

  it('reads a package import', () => {
    expect(specs('import "hardhat/console.sol";\n', 'Solidity')).toEqual(['hardhat/console.sol']);
  });
});

describe('Go', () => {
  it('reads a single-line import', () => {
    expect(specs('import "fmt"\n', 'Go')).toEqual(['fmt']);
  });

  it('reads an import block, including aliases', () => {
    const source = ['import (', '\t"fmt"', '', '\talias "github.com/x/y"', ')'].join('\n');
    expect(specs(source, 'Go')).toEqual(['fmt', 'github.com/x/y']);
  });

  it('does not read a parenthesised line outside a block', () => {
    expect(specs('x := f("y")\n', 'Go')).toEqual([]);
  });
});

describe('Rust', () => {
  it('reads use declarations', () => {
    expect(specs('use crate::a::b;\nuse super::c;\n', 'Rust')).toEqual(['crate::a::b', 'super::c']);
  });

  it('reads mod as a module of this crate, not as an external one', () => {
    // `mod foo;` and `pub mod bar;` declare modules of this crate. Rust spells
    // that `self::foo`, and a bare `foo` would be filed as an external crate.
    expect(specs('mod foo;\npub mod bar;\n', 'Rust')).toEqual(['self::foo', 'self::bar']);
  });

  it('leaves extern crate as a bare name', () => {
    expect(specs('extern crate serde;\n', 'Rust')).toEqual(['serde']);
  });

  it('reads a use indented inside an inline module body', () => {
    // `mod tests { … }` is where most Rust files reach the rest of the crate,
    // and its contents are indented.
    const source = ['#[cfg(test)]', 'mod tests {', '    use super::helper;', '}'].join('\n');
    expect(specs(source, 'Rust')).toEqual(['super::helper']);
  });
});

describe('Java and Kotlin', () => {
  it('reads a dotted import, with and without static', () => {
    expect(specs('import com.acme.Thing;\nimport static com.acme.Util.help;\n', 'Java')).toEqual([
      'com.acme.Thing',
      'com.acme.Util.help',
    ]);
  });

  it('reads a Kotlin import', () => {
    expect(specs('import kotlinx.coroutines.launch\n', 'Kotlin')).toEqual(['kotlinx.coroutines.launch']);
  });
});

describe('Ruby and Shell', () => {
  it('reads require_relative as relative and require as a bare name', () => {
    expect(specs("require_relative 'helper'\nrequire 'json'\n", 'Ruby')).toEqual([
      './helper',
      'json',
    ]);
  });

  it('leaves an already-relative specifier alone', () => {
    expect(specs("require_relative './helper'\n", 'Ruby')).toEqual(['./helper']);
  });

  it('reads a shell source', () => {
    expect(specs('. ./lib.sh\nsource ./other.sh\n', 'Shell')).toEqual(['./lib.sh', './other.sh']);
  });

  it('leaves a PATH lookup bare, because PATH is not the repository', () => {
    expect(specs('. lib.sh\n', 'Shell')).toEqual(['lib.sh']);
  });
});

describe('Protobuf and GraphQL', () => {
  it('reads a proto import', () => {
    expect(specs('import "google/protobuf/timestamp.proto";\n', 'Protobuf')).toEqual([
      'google/protobuf/timestamp.proto',
    ]);
  });

  it('reads a graphql import', () => {
    expect(specs('#import "./schema.graphql"\n', 'GraphQL')).toEqual(['./schema.graphql']);
  });
});
