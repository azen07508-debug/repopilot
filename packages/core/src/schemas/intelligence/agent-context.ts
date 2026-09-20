/**
 * Agent Context Pack — what an AI Coding Agent is given instead of the
 * whole repository.
 *
 * Design constraints (Phase 8):
 *   1. JSON first, never prose.
 *   2. Token-efficient: identifiers and paths, never file bodies.
 *   3. Deterministic: the same repository + commit produces the same pack.
 *   4. Evidence-backed: every risk carries its source.
 *   5. Incrementally updatable via `contextVersion`.
 *
 * The pack deliberately has no `files: [{path, content}]` field. If an
 * agent needs a file body it asks for that file.
 */
import { z } from 'zod';
import { EvidenceV2Schema } from './evidence-v2.js';

export const AGENT_CONTEXT_SCHEMA_VERSION = '1.0' as const;

export const CodingConventionSchema = z.object({
  rule: z.string().min(1),
  /** Config file that proves the rule, e.g. `.editorconfig`, `tsconfig.json`. */
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type CodingConvention = z.infer<typeof CodingConventionSchema>;

export const KnownRiskSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  module: z.string().nullable().default(null),
  reason: z.string().min(1),
  evidence: z.array(EvidenceV2Schema).default([]),
});
export type KnownRisk = z.infer<typeof KnownRiskSchema>;

export const TestStrategySchema = z.object({
  runner: z.string().nullable().default(null),
  commands: z.array(z.string()).default([]),
  testFileCount: z.number().int().nonnegative().default(0),
  /** Directories or glob patterns where tests live. */
  locations: z.array(z.string()).default([]),
});
export type TestStrategy = z.infer<typeof TestStrategySchema>;

export const RecentChangeSchema = z.object({
  sha: z.string().min(1),
  message: z.string().default(''),
  changedFiles: z.number().int().nonnegative().default(0),
});
export type RecentChange = z.infer<typeof RecentChangeSchema>;

export const AgentContextPackSchema = z.object({
  contextVersion: z.literal(AGENT_CONTEXT_SCHEMA_VERSION),
  generatedAt: z.string().min(1),
  repository: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    commitSha: z.string().nullable().default(null),
    primaryLanguage: z.string().nullable().default(null),
    frameworks: z.array(z.string()).default([]),
    packageManagers: z.array(z.string()).default([]),
  }),
  projectSummary: z.string().default(''),
  /** Compact architecture: module names and their dependencies, not a full graph. */
  architecture: z
    .object({
      entrypoints: z.array(z.string()).default([]),
      modules: z
        .array(
          z.object({
            name: z.string().min(1),
            path: z.string().min(1),
            importance: z.number().min(0).max(1),
            dependsOn: z.array(z.string()).default([]),
          })
        )
        .default([]),
      circularDependencies: z.array(z.array(z.string())).default([]),
    })
    .default({
      entrypoints: [],
      modules: [],
      circularDependencies: [],
    }),
  importantFiles: z
    .array(z.object({ path: z.string().min(1), reason: z.string().min(1) }))
    .default([]),
  codingConventions: z.array(CodingConventionSchema).default([]),
  dependencies: z.array(z.string()).default([]),
  testStrategy: TestStrategySchema.default({
    runner: null,
    commands: [],
    testFileCount: 0,
    locations: [],
  }),
  knownRisks: z.array(KnownRiskSchema).default([]),
  recentChanges: z.array(RecentChangeSchema).default([]),
  /** Populated only when the caller supplied a task (Phase 7). */
  taskRelevantFiles: z
    .array(z.object({ path: z.string().min(1), reason: z.string().min(1) }))
    .default([]),
  limitations: z.array(z.string()).default([]),
});
export type AgentContextPack = z.infer<typeof AgentContextPackSchema>;
