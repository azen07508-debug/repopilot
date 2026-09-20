/**
 * Repository Map — the structured, machine-consumable description of a
 * repository that an AI Coding Agent reads before touching any file.
 *
 * Deliberately NOT a Markdown summary. Every field is deterministic and
 * traceable to a file in the repository. The `schemaVersion` is
 * independent of `Report.reportVersion` (B-4), so the map can evolve
 * without touching the audit report contract.
 */
import { z } from 'zod';
import { EvidenceV2Schema } from './evidence-v2.js';

export const REPOSITORY_MAP_SCHEMA_VERSION = '1.0' as const;

export const EntrypointSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['app', 'cli', 'library', 'server', 'worker', 'test-runner', 'contract']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceV2Schema).default([]),
});
export type Entrypoint = z.infer<typeof EntrypointSchema>;

export const ModuleSchema = z.object({
  name: z.string().min(1),
  /** Directory or workspace-package path, forward slashes, no trailing slash. */
  path: z.string().min(1),
  kind: z.enum(['package', 'directory', 'workspace-package', 'contract-package']),
  /** 0..1. Derived from fan-in, file count and entrypoint proximity — never from an LLM. */
  importance: z.number().min(0).max(1),
  fileCount: z.number().int().nonnegative(),
  languages: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});
export type Module = z.infer<typeof ModuleSchema>;

export const ImportantFileSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
  importance: z.number().min(0).max(1),
});
export type ImportantFile = z.infer<typeof ImportantFileSchema>;

export const ExternalDependencySchema = z.object({
  name: z.string().min(1),
  version: z.string().nullable().default(null),
  kind: z.enum(['runtime', 'dev', 'peer', 'optional']),
  /** Manifest that declared it, e.g. `package.json`, `pyproject.toml`. */
  manifest: z.string().min(1),
});
export type ExternalDependency = z.infer<typeof ExternalDependencySchema>;

export const LanguageUsageSchema = z.object({
  language: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type LanguageUsage = z.infer<typeof LanguageUsageSchema>;

export const RepositoryMapSchema = z.object({
  schemaVersion: z.literal(REPOSITORY_MAP_SCHEMA_VERSION),
  generatedAt: z.string().min(1),
  repository: z.object({
    url: z.string().url(),
    owner: z.string().min(1),
    name: z.string().min(1),
    defaultBranch: z.string().min(1),
    /** Part of the cache key (D-021). Null when the source is a local directory. */
    commitSha: z.string().nullable().default(null),
    primaryLanguage: z.string().nullable().default(null),
    languages: z.array(LanguageUsageSchema).default([]),
    frameworks: z.array(z.string()).default([]),
    packageManagers: z.array(z.string()).default([]),
  }),
  entrypoints: z.array(EntrypointSchema).default([]),
  modules: z.array(ModuleSchema).default([]),
  importantFiles: z.array(ImportantFileSchema).default([]),
  configFiles: z.array(z.string()).default([]),
  testFiles: z.array(z.string()).default([]),
  documentationFiles: z.array(z.string()).default([]),
  externalDependencies: z.array(ExternalDependencySchema).default([]),
  /** Honest accounting of what could not be analysed — same spirit as Report.limitations. */
  limitations: z.array(z.string()).default([]),
  /** True when the I/O layer fell back or the tree was truncated. */
  degraded: z.boolean().default(false),
});
export type RepositoryMap = z.infer<typeof RepositoryMapSchema>;
