/**
 * RepoPilot report schema — single source of truth for the audit output.
 * Every field the report exposes is validated by Zod before being returned.
 */
import { z } from 'zod';

export const EvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive().nullable(),
  reason: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
  'documentation',
  'reproducibility',
  'security',
  'deployment',
  'web3',
  'hackathon',
  'meta',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1),
  description: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
  recommendedAction: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ScoreBreakdownSchema = z.object({
  raw: z.number().min(0).max(100),
  rules: z.array(
    z.object({
      rule: z.string(),
      delta: z.number(),
      reason: z.string(),
    })
  ),
  final: z.number().min(0).max(100),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const ScoresSchema = z.object({
  overall: z.number().min(0).max(100),
  documentation: z.number().min(0).max(100),
  reproducibility: z.number().min(0).max(100),
  securityHygiene: z.number().min(0).max(100),
  deploymentReadiness: z.number().min(0).max(100),
  breakdown: z
    .object({
      documentation: ScoreBreakdownSchema.optional(),
      reproducibility: ScoreBreakdownSchema.optional(),
      securityHygiene: ScoreBreakdownSchema.optional(),
      deploymentReadiness: ScoreBreakdownSchema.optional(),
    })
    .default({}),
});
export type Scores = z.infer<typeof ScoresSchema>;

export const RepositorySchema = z.object({
  url: z.string().url(),
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().min(1),
  license: z.string().nullable(),
  lastUpdatedAt: z.string().nullable(),
  visibility: z.literal('public'),
  archived: z.boolean().default(false),
  stars: z.number().int().nonnegative().default(0),
  openIssues: z.number().int().nonnegative().default(0),
  openPulls: z.number().int().nonnegative().default(0),
  description: z.string().nullable().default(null),
  primaryLanguage: z.string().nullable().default(null),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  effort: z.enum(['S', 'M', 'L']),
  description: z.string(),
  relatedFindings: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

export const DeploymentStepSchema = z.object({
  order: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  commands: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type DeploymentStep = z.infer<typeof DeploymentStepSchema>;

export const LaunchChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  evidence: z.array(z.string()).default([]),
});
export type LaunchChecklistItem = z.infer<typeof LaunchChecklistItemSchema>;

export const LaunchCopySchema = z.object({
  oneSentencePitch: z.string(),
  shortDescription: z.string(),
  xPost: z.string(),
});
export type LaunchCopy = z.infer<typeof LaunchCopySchema>;

export const ReportSchema = z.object({
  reportVersion: z.literal('1.0'),
  repository: RepositorySchema,
  summary: z.string(),
  detectedStack: z.array(z.string()),
  scores: ScoresSchema,
  blockers: z.array(FindingSchema),
  documentationGaps: z.array(FindingSchema),
  securityFindings: z.array(FindingSchema),
  deploymentPlan: z.array(DeploymentStepSchema),
  recommendedTasks: z.array(TaskSchema),
  launchChecklist: z.array(LaunchChecklistItemSchema),
  launchCopy: LaunchCopySchema,
  limitations: z.array(z.string()),
  generatedAt: z.string(),
  auditMode: z.enum(['quick', 'full']),
  target: z.enum(['hackathon', 'open_source', 'production']),
  outputLanguage: z.enum(['en', 'zh-CN']),
  analyzerProvenance: z.record(z.string(), z.string()).default({}),
});
export type Report = z.infer<typeof ReportSchema>;

export const ReportJsonSchema = ReportSchema; // alias
