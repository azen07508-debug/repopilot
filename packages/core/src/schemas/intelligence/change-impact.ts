/**
 * Change Impact — what a base→head change actually touches.
 *
 * Produced by the Change Impact Engine (V0.4). Per D-020 the diff comes
 * from a `ChangeSource` abstraction; the first implementation is the
 * GitHub Compare API, so there is no git history and no local clone
 * involved.
 *
 * When git information is unavailable the engine returns a valid
 * document with `degraded: true` and empty arrays. It never throws.
 */
import { z } from 'zod';
import { EvidenceV2Schema } from './evidence-v2.js';

export const CHANGE_IMPACT_SCHEMA_VERSION = '1.0' as const;

export const ChangeStatusSchema = z.enum(['added', 'modified', 'removed', 'renamed']);
export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;

export const ChangedFileSchema = z.object({
  path: z.string().min(1),
  status: ChangeStatusSchema,
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  /** Set only for `renamed`: the previous path. */
  previousPath: z.string().nullable().default(null),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ChangedSymbolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  change: z.enum(['added', 'modified', 'removed', 'signature-changed']),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbolSchema>;

export const AffectedModuleSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  reason: z.string().min(1),
  /** 1 = directly changed, 2 = depends on a changed file, and so on. */
  distance: z.number().int().positive(),
});
export type AffectedModule = z.infer<typeof AffectedModuleSchema>;

export const RiskLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ChangeImpactSchema = z.object({
  schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
  base: z.string().min(1),
  head: z.string().min(1),
  changedFiles: z.array(ChangedFileSchema).default([]),
  changedSymbols: z.array(ChangedSymbolSchema).default([]),
  affectedModules: z.array(AffectedModuleSchema).default([]),
  /** Test files that cover the changed surface. */
  affectedTests: z.array(z.string()).default([]),
  /** Changed surface with no corresponding test change. */
  testGaps: z
    .array(
      z.object({
        module: z.string().min(1),
        reason: z.string().min(1),
        evidence: z.array(EvidenceV2Schema).default([]),
      })
    )
    .default([]),
  documentationGaps: z
    .array(
      z.object({
        path: z.string().min(1),
        reason: z.string().min(1),
        evidence: z.array(EvidenceV2Schema).default([]),
      })
    )
    .default([]),
  risk: RiskLevelSchema,
  riskReasons: z.array(z.string()).default([]),
  evidence: z.array(EvidenceV2Schema).default([]),
  degraded: z.boolean().default(false),
  limitations: z.array(z.string()).default([]),
});
export type ChangeImpact = z.infer<typeof ChangeImpactSchema>;

/** The degraded document returned when git information is unavailable. */
export function unavailableChangeImpact(
  base: string,
  head: string,
  reason: string
): ChangeImpact {
  return {
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    base,
    head,
    changedFiles: [],
    changedSymbols: [],
    affectedModules: [],
    affectedTests: [],
    testGaps: [],
    documentationGaps: [],
    risk: 'none',
    riskReasons: [],
    evidence: [],
    degraded: true,
    limitations: [reason],
  };
}
