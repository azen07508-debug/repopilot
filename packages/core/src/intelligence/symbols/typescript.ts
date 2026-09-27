/**
 * TypeScript / JavaScript symbols, via the compiler API (D-018).
 *
 * `createSourceFile` only — never a `Program`. A `Program` type-checks,
 * which means resolving imports, loading `lib.d.ts` and walking
 * `node_modules`: an audit has no business doing any of that, and it is
 * exactly what would make R-18's memory bound untrue. `createSourceFile`
 * is a pure parse of one string, which is all a *declaration surface*
 * needs.
 *
 * What is reported: the declarations an agent would need to navigate the
 * repository — top-level and exported ones, plus class and namespace
 * members. Function bodies are not descended into, so a closure declared
 * inside an implementation is not reported as if it were part of the
 * public surface.
 */
import ts from 'typescript';
import type { Symbol as SymbolEntry, SymbolKind } from '../../schemas/intelligence/symbol-map.js';

/**
 * Syntactic extraction, not semantic: no type checker ran, so nothing here
 * is *verified*, only *parsed*. 0.95 rather than 1 leaves room for the one
 * thing a parse cannot know — whether a declaration is reachable.
 */
const COMPILER_CONFIDENCE = 0.95;

/** A file with more declarations than this is a generated bundle, not a source file. */
export const MAX_SYMBOLS_PER_FILE = 2000;

export interface ParsedFileSymbols {
  symbols: SymbolEntry[];
  /** True when the cap cut the list. */
  truncated: boolean;
}

/**
 * Script kind by extension.
 *
 * This is not cosmetic: `.tsx` parsed as `.ts` turns every JSX element into
 * a syntax error, and the resulting map would be silently wrong rather than
 * visibly broken.
 */
export function scriptKindFor(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function parseTypeScript(
  path: string,
  content: string
): ParsedFileSymbols {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path)
  );

  const state: Collector = { drafts: [], truncated: false };
  collect(sourceFile, null, sourceFile, state);

  const symbols = state.drafts.map((draft) => ({
    id: `${path}#${draft.name}#${draft.startLine}`,
    name: draft.name,
    type: draft.kind,
    path,
    startLine: draft.startLine,
    endLine: draft.endLine,
    parent: draft.parent,
    exported: draft.exported,
    references: 0,
    parser: 'typescript-compiler' as const,
    parserConfidence: COMPILER_CONFIDENCE,
  }));

  return { symbols, truncated: state.truncated };
}

interface Collector {
  drafts: Draft[];
  /**
   * Set only when a declaration was actually refused.
   *
   * `drafts.length >= MAX_SYMBOLS_PER_FILE` cannot answer this: a file with
   * exactly the cap and a file with more both end up with a full array.
   * Inferring truncation from the length is the bug D-025 decision 7 exists
   * to prevent, and it reappeared here twice — first as a length check, then
   * as an early return that skipped a container's members.
   */
  truncated: boolean;
}

interface Draft {
  name: string;
  kind: SymbolKind;
  parent: string | null;
  exported: boolean;
  startLine: number;
  endLine: number;
}

/** Walk the containers that can hold reportable declarations. */
function collect(
  container: ts.Node,
  parent: string | null,
  sourceFile: ts.SourceFile,
  state: Collector
): void {
  ts.forEachChild(container, (child) => {
    // `declarationsOf` runs first so that the flag below is set by the draft
    // that could not be stored, and by nothing else. A SourceFile's children
    // include its `EndOfFileToken`, which contributes no drafts — so a file
    // with exactly `MAX_SYMBOLS_PER_FILE` declarations never enters the loop
    // below and never claims to be truncated. Reading the cap off
    // `drafts.length` instead is what made the first version of this report
    // `truncated: true` for a complete list.
    const drafts = declarationsOf(child, parent, sourceFile);

    for (const draft of drafts) {
      if (state.drafts.length >= MAX_SYMBOLS_PER_FILE) {
        state.truncated = true;
        break;
      }
      state.drafts.push(draft);
    }

    // Descended into even when the cap is already full. Returning early
    // instead — which is what this did first — meant a container whose own
    // declaration was the one that filled the cap was never opened, so its
    // members were dropped and `truncated` stayed false. That is the same
    // silent truncation this flag exists to prevent, one level down. The
    // recursion stops at the first member it cannot store, so the cost is
    // one node per container, not a walk of its subtree.
    if (canHoldDeclarations(child)) {
      collect(child, containerNameOf(child, parent), sourceFile, state);
    }
  });
}

/**
 * Which node types are descended into.
 *
 * Deliberately excludes function bodies and blocks: a `function inner()`
 * declared inside an implementation is not part of the surface a symbol map
 * exists to describe, and reporting it with `parent: null` would place it
 * beside the file's real exports.
 */
function canHoldDeclarations(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isModuleBlock(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node)
  );
}

/** The name that members of this container report as their `parent`. */
function containerNameOf(node: ts.Node, fallback: string | null): string | null {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return node.name ? node.name.text : fallback;
  }
  if (ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isModuleDeclaration(node)) {
    return moduleNameOf(node) ?? fallback;
  }
  return fallback;
}

function moduleNameOf(node: ts.ModuleDeclaration): string | null {
  if (ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

/**
 * Every declaration `node` itself introduces, in source order.
 *
 * A `namespace` introduces none: the schema has no `namespace` kind, so it
 * is a container only — its members report it as their `parent`, and it is
 * reached through `canHoldDeclarations` rather than through this function.
 */
function declarationsOf(
  node: ts.Node,
  parent: string | null,
  sourceFile: ts.SourceFile
): Draft[] {
  const span = (target: ts.Node) => ({
    startLine: sourceFile.getLineAndCharacterOfPosition(target.getStart(sourceFile)).line + 1,
    endLine: sourceFile.getLineAndCharacterOfPosition(target.getEnd()).line + 1,
  });

  const make = (name: string, kind: SymbolKind, target: ts.Node = node): Draft => ({
    name,
    kind,
    parent,
    exported: isExported(node),
    ...span(target),
  });

  if (ts.isFunctionDeclaration(node) && node.name) {
    return [make(node.name.text, 'function')];
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return [make(node.name.text, 'class')];
  }
  if (ts.isInterfaceDeclaration(node)) {
    return [make(node.name.text, 'interface')];
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return [make(node.name.text, 'type')];
  }
  if (ts.isEnumDeclaration(node)) {
    return [make(node.name.text, 'enum')];
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const name = propertyNameOf(node.name);
    return name ? [make(name, 'method')] : [];
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    const name = propertyNameOf(node.name);
    return name ? [make(name, 'variable')] : [];
  }
  if (ts.isVariableStatement(node)) {
    // One statement, several declarations: `const a = 1, b = 2;`.
    const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const out: Draft[] = [];
    for (const declaration of node.declarationList.declarations) {
      const name = bindingNameOf(declaration.name);
      if (!name) continue;
      // `export const handler = () => {}` is a function to anyone reading
      // the map, and reporting it as `constant` would bury it among the
      // real constants.
      const initializer = declaration.initializer;
      const isFunction =
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
      const kind: SymbolKind = isFunction ? 'function' : isConst ? 'constant' : 'variable';
      out.push(make(name, kind, node));
    }
    return out;
  }
  return [];
}

/**
 * Exported-ness, read from the modifiers rather than from
 * `ts.getCombinedModifierFlags`, which walks `node.parent` — and parents are
 * not set (that is the memory saving).
 *
 * Only `export` is consulted. `default` was checked here too, until a
 * mutation that swapped it for an unrelated keyword survived the whole
 * suite: TypeScript only allows `default` on a declaration that already has
 * `export`, so the clause could never be the one that decided the answer.
 */
function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  if (!modifiers) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function propertyNameOf(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isPrivateIdentifier(name)) return name.text;
  // A computed name (`[Symbol.iterator]`) has no stable text worth reporting.
  return null;
}

function bindingNameOf(name: ts.BindingName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  // Destructuring: `const { a, b } = x` introduces two names, but which ones
  // is an evaluation, not a declaration, and the map reports declarations.
  return null;
}
