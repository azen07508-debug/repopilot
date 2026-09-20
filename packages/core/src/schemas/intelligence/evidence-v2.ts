/**
 * Evidence V2 — the evidence structure used by Repository Intelligence.
 *
 * This is a strict SUPERSET of the v1 `Evidence` shape
 * (`{ file, line, reason }`). Backward compatibility rule (B-3 in
 * docs/REPOSITORY_INTELLIGENCE_PLAN.md):
 *
 *   - `path` / `startLine` / `endLine` are the canonical fields.
 *   - `file` / `line` remain present and optional so any existing
 *     consumer that reads them keeps working unchanged.
 *   - `source` and `confidence` are new and mandatory for v2 producers.
 *
 * D-008 still applies: a finding without evidence is invalid. V2 adds
 * the source of the evidence so a consumer can tell a static-analysis
 * fact apart from an LLM inference.
 */
import { z } from 'zod';
import { EvidenceSchema, type Evidence } from '../report.js';

export const EvidenceSourceSchema = z.enum([
  'static-analysis',
  'git',
  'dependency-analysis',
  'test-analysis',
  'documentation-analysis',
  'llm-inference',
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceV2Schema = z
  .object({
    /** Repository-relative path, forward slashes. */
    path: z.string().min(1),
    startLine: z.number().int().positive().nullable(),
    endLine: z.number().int().positive().nullable(),
    reason: z.string().min(1),
    /** Where the evidence came from. Never `llm-inference` for a fact that static analysis can determine. */
    source: EvidenceSourceSchema,
    /** 0..1. LLM-only evidence must stay below the static-analysis floor (see confidence policy). */
    confidence: z.number().min(0).max(1),
    symbol: z.string().nullable().default(null),
    module: z.string().nullable().default(null),
    /** v1 compatibility mirror of `path`. */
    file: z.string().optional(),
    /** v1 compatibility mirror of `startLine`. */
    line: z.number().int().positive().nullable().optional(),
  })
  .refine((e) => e.endLine === null || e.startLine === null || e.endLine >= e.startLine, {
    message: 'endLine must be >= startLine when both are present',
  });
export type EvidenceV2 = z.infer<typeof EvidenceV2Schema>;

/** D-008: every finding must carry at least one evidence entry. */
export const EvidenceV2ListSchema = z.array(EvidenceV2Schema).min(1);

/**
 * Upgrade a v1 evidence entry to v2.
 *
 * v1 has no source or confidence, so both are supplied by the caller.
 * The default source is `static-analysis` because every v1 producer in
 * this codebase is deterministic.
 */
export function toEvidenceV2(
  evidence: Evidence,
  opts: { source?: EvidenceSource; confidence?: number } = {}
): EvidenceV2 {
  return {
    path: evidence.file,
    startLine: evidence.line,
    endLine: evidence.line,
    reason: evidence.reason,
    source: opts.source ?? 'static-analysis',
    confidence: opts.confidence ?? 0.9,
    symbol: null,
    module: null,
    file: evidence.file,
    line: evidence.line,
  };
}

/**
 * Downgrade a v2 evidence entry to the v1 shape.
 *
 * Used by anything that still renders `file:line:reason` (the report
 * builder, the web UI, PR comments).
 */
export function toLegacyEvidence(evidence: EvidenceV2): Evidence {
  return {
    file: evidence.file ?? evidence.path,
    line: evidence.line ?? evidence.startLine,
    reason: evidence.reason,
  };
}

/** Validate a v1 evidence entry — re-exported so callers import from one place. */
export { EvidenceSchema };
export type { Evidence };
