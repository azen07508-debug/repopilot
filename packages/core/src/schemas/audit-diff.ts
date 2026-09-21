/**
 * AuditDiff schema — the before/after comparison between two reports of
 * the same repository.
 *
 * Everything here is derived from two existing `Report` documents. No
 * repository is scanned, no analyzer runs.
 *
 * `ruleDeltas` is the interesting part: because `ScoreBreakdown` records
 * every applied rule with its delta and reason, a score change can be
 * attributed rule by rule without asking an LLM to explain it.
 */
import { z } from 'zod';

export const AUDIT_DIFF_SCHEMA_VERSION = '1.0' as const;

export const ScoreDimensionSchema = z.enum([
  'documentation',
  'reproducibility',
  'securityHygiene',
  'deploymentReadiness',
]);
export type ScoreDimension = z.infer<typeof ScoreDimensionSchema>;

export const SCORE_DIMENSIONS: ScoreDimension[] = [
  'documentation',
  'reproducibility',
  'securityHygiene',
  'deploymentReadiness',
];

export const AuditRefSchema = z.object({
  /** Null when the diff was built from a bare report instead of a job. */
  jobId: z.string().nullable().default(null),
  commitSha: z.string().nullable().default(null),
  generatedAt: z.string().min(1),
  overall: z.number().min(0).max(100),
});
export type AuditRef = z.infer<typeof AuditRefSchema>;

export const RuleDeltaSchema = z.object({
  rule: z.string().min(1),
  dimension: ScoreDimensionSchema,
  /** Delta applied in the base report (0 when the rule did not fire). */
  before: z.number(),
  /** Delta applied in the head report (0 when the rule did not fire). */
  after: z.number(),
  /** after - before. Positive means the score went up. */
  delta: z.number(),
  reason: z.string().min(1),
});
export type RuleDelta = z.infer<typeof RuleDeltaSchema>;

export const DimensionDeltasSchema = z.object({
  documentation: z.number(),
  reproducibility: z.number(),
  securityHygiene: z.number(),
  deploymentReadiness: z.number(),
});
export type DimensionDeltas = z.infer<typeof DimensionDeltasSchema>;

export const DiffVerdictSchema = z.enum(['improved', 'regressed', 'unchanged']);
export type DiffVerdict = z.infer<typeof DiffVerdictSchema>;

export const AuditDiffSchema = z.object({
  schemaVersion: z.literal(AUDIT_DIFF_SCHEMA_VERSION),
  base: AuditRefSchema,
  head: AuditRefSchema,
  /** head.overall - base.overall */
  scoreDelta: z.number(),
  dimensionDeltas: DimensionDeltasSchema,
  /** Sorted by absolute delta, descending. */
  ruleDeltas: z.array(RuleDeltaSchema).default([]),
  /**
   * Finding fingerprints present in base but not in head.
   *
   * Fingerprint rather than `id`: a location-bearing id — secrets,
   * injections, per-section README checks — embeds a line number, so
   * inserting one line above a secret used to read as "resolved plus
   * new" instead of "unchanged". See findings/fingerprint.ts.
   */
  resolved: z.array(z.string()).default([]),
  /** Fingerprints present in head but not in base. */
  new: z.array(z.string()).default([]),
  /** Fingerprints present in both. */
  persistent: z.array(z.string()).default([]),
  /**
   * Findings that kept their rule and their file but changed line —
   * usually something was inserted above them.
   *
   * Reported separately so `resolved` keeps meaning "actually gone"
   * rather than "moved slightly".
   */
  moved: z
    .array(
      z.object({
        ruleId: z.string(),
        file: z.string(),
        fromLine: z.number().int().positive().nullable(),
        toLine: z.number().int().positive().nullable(),
      })
    )
    .default([]),
  verdict: DiffVerdictSchema,
});
export type AuditDiff = z.infer<typeof AuditDiffSchema>;
