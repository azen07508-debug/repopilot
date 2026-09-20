/**
 * FixPlan schema — the actionable, agent-consumable unit derived from a
 * single finding.
 *
 * Design constraints:
 *   - Derived purely from an existing `Report`. Nothing here triggers a
 *     repository scan.
 *   - `priority`, `estimatedEffort`, `evidence` and `steps` are produced by
 *     deterministic rules only. An LLM may polish the natural-language
 *     `why` field and nothing else.
 *   - `evidence` keeps the v1 shape (`{ file, line, reason }`) and stays
 *     mandatory with at least one entry, extending D-008 to fix plans.
 *   - `schemaVersion` is independent of `Report.reportVersion`, which
 *     stays at `'1.0'`.
 */
import { z } from 'zod';
import { EvidenceSchema } from './report.js';

export const FIX_PLAN_SCHEMA_VERSION = '1.0' as const;

export const FixPrioritySchema = z.enum(['P0', 'P1', 'P2']);
export type FixPriority = z.infer<typeof FixPrioritySchema>;

export const FixEffortSchema = z.enum(['S', 'M', 'L']);
export type FixEffort = z.infer<typeof FixEffortSchema>;

export const FixStatusSchema = z.enum(['open', 'resolved', 'ignored']);
export type FixStatus = z.infer<typeof FixStatusSchema>;

export const FixStepSchema = z.object({
  order: z.number().int().positive(),
  action: z.string().min(1),
  /** File or area the step targets. Null when the step is repo-wide. */
  target: z.string().min(1).nullable().default(null),
});
export type FixStep = z.infer<typeof FixStepSchema>;

export const FixPlanSchema = z.object({
  schemaVersion: z.literal(FIX_PLAN_SCHEMA_VERSION),
  /** Stable id: `fixplan:<findingId>`. */
  planId: z.string().min(1),
  findingId: z.string().min(1),
  priority: FixPrioritySchema,
  status: FixStatusSchema,
  title: z.string().min(1),
  why: z.string().min(1),
  /** D-008 extended: a plan without evidence is not actionable. */
  evidence: z.array(EvidenceSchema).min(1),
  steps: z.array(FixStepSchema).min(1),
  testsToAdd: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  estimatedEffort: FixEffortSchema,
  risks: z.array(z.string().min(1)).default([]),
  /** Ready to paste into Codex / Claude Code / OpenCode. */
  agentInstructions: z.string().min(1),
  /** True when the natural-language fields were polished by an LLM. */
  llmEnhanced: z.boolean().default(false),
});
export type FixPlan = z.infer<typeof FixPlanSchema>;

export const FixPlanRepositorySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  /** Null when the source report has no commit information. */
  commitSha: z.string().nullable().default(null),
});
export type FixPlanRepository = z.infer<typeof FixPlanRepositorySchema>;

/** All plans for one report, ordered by priority then severity. */
export const FixPlanSetSchema = z.object({
  schemaVersion: z.literal(FIX_PLAN_SCHEMA_VERSION),
  repository: FixPlanRepositorySchema,
  generatedAt: z.string().min(1),
  reportVersion: z.string().min(1),
  plans: z.array(FixPlanSchema).default([]),
});
export type FixPlanSet = z.infer<typeof FixPlanSetSchema>;

/** Deterministic severity → priority mapping. Never LLM-derived. */
export function priorityForSeverity(severity: 'critical' | 'high' | 'medium' | 'low'): FixPriority {
  if (severity === 'critical' || severity === 'high') return 'P0';
  if (severity === 'medium') return 'P1';
  return 'P2';
}

/** Deterministic severity → effort mapping. */
export function effortForSeverity(severity: 'critical' | 'high' | 'medium' | 'low'): FixEffort {
  if (severity === 'critical') return 'L';
  if (severity === 'high') return 'M';
  return 'S';
}

export function planIdFor(findingId: string): string {
  return `fixplan:${findingId}`;
}
