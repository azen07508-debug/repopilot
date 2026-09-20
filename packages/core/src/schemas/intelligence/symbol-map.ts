/**
 * Symbol Map — the extracted declaration surface of a repository.
 *
 * Per D-018: TypeScript/JavaScript are parsed with the `typescript`
 * compiler API; every other language uses a regex fallback. The
 * `parser` and `parserConfidence` fields make that difference explicit
 * instead of pretending all languages are equally precise.
 *
 * Hard rule: a parser failure in ONE language must never fail the
 * whole audit. Such a failure shows up as `degraded: true` plus an
 * entry in `failures`.
 */
import { z } from 'zod';

export const SYMBOL_MAP_SCHEMA_VERSION = '1.0' as const;

export const SymbolKindSchema = z.enum([
  'function',
  'class',
  'interface',
  'type',
  'variable',
  'method',
  'contract',
  'struct',
  'enum',
  'constant',
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const ParserKindSchema = z.enum(['typescript-compiler', 'regex', 'heuristic']);
export type ParserKind = z.infer<typeof ParserKindSchema>;

export const SymbolSchema = z
  .object({
    /** Stable id: `${path}#${name}#${startLine}`. */
    id: z.string().min(1),
    name: z.string().min(1),
    type: SymbolKindSchema,
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    /** Enclosing class / contract / namespace, when there is one. */
    parent: z.string().nullable().default(null),
    exported: z.boolean().default(false),
    /** How many other files reference this symbol. 0 does not imply dead code. */
    references: z.number().int().nonnegative().default(0),
    parser: ParserKindSchema,
    parserConfidence: z.number().min(0).max(1),
  })
  .refine((s) => s.endLine >= s.startLine, {
    message: 'endLine must be >= startLine',
  });
export type Symbol = z.infer<typeof SymbolSchema>;

export const LanguageCoverageSchema = z.object({
  language: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  parser: ParserKindSchema,
  /** True when the preferred parser was unavailable and a fallback was used. */
  degraded: z.boolean().default(false),
});
export type LanguageCoverage = z.infer<typeof LanguageCoverageSchema>;

export const SymbolMapSchema = z.object({
  schemaVersion: z.literal(SYMBOL_MAP_SCHEMA_VERSION),
  languageCoverage: z.array(LanguageCoverageSchema).default([]),
  symbols: z.array(SymbolSchema).default([]),
  /** True when at least one language could not be parsed with its preferred parser. */
  degraded: z.boolean().default(false),
  failures: z
    .array(
      z.object({
        language: z.string().min(1),
        reason: z.string().min(1),
      })
    )
    .default([]),
});
export type SymbolMap = z.infer<typeof SymbolMapSchema>;

/** Build the canonical symbol id. Exported so producers and tests agree on the format. */
export function symbolId(path: string, name: string, startLine: number): string {
  return `${path}#${name}#${startLine}`;
}
