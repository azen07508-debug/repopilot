/**
 * Input schemas — every public API/MCP entry point validates input through these.
 */
import { z } from 'zod';

export const RepoUrlSchema = z
  .string()
  .url()
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Repository URL must be an https URL')
  .refine((u) => {
    // Accept only github.com/<owner>/<repo> or <host>/<owner>/<repo>
    return /^https:\/\/[^\/]+\/[^\/]+\/[^\/]+\/?$/.test(u.replace(/\.git$/, ''));
  }, 'Repository URL must look like https://<host>/<owner>/<repo>');

export const AuditModeSchema = z.enum(['quick', 'full']);
export const AuditTargetSchema = z.enum(['hackathon', 'open_source', 'production']);
export const OutputLanguageSchema = z.enum(['en', 'zh-CN']);
export type AuditMode = z.infer<typeof AuditModeSchema>;
export type AuditTarget = z.infer<typeof AuditTargetSchema>;
export type OutputLanguage = z.infer<typeof OutputLanguageSchema>;

/**
 * FreeCheck — input schema for the no-payment entry point.
 *
 * Public GitHub URL only. No payment header. No `mode` / `target` knobs.
 * Internally maps to a deterministic, lightweight subset of the audit
 * pipeline (URL validity, metadata, stack detection, the 5 critical
 * presence checks, and a quick score).
 */
export const FreeCheckInputSchema = z.object({
  repoUrl: RepoUrlSchema,
  outputLanguage: OutputLanguageSchema.default('en'),
});
export type FreeCheckInput = z.infer<typeof FreeCheckInputSchema>;

export const CreateAuditInputSchema = z.object({
  repoUrl: RepoUrlSchema,
  mode: AuditModeSchema.default('quick'),
  target: AuditTargetSchema.default('open_source'),
  outputLanguage: OutputLanguageSchema.default('en'),
  includeLaunchCopy: z.boolean().default(true),
});
export type CreateAuditInput = z.infer<typeof CreateAuditInputSchema>;

/**
 * FreeCheckReport — slim JSON shape returned from `/api/v1/free-check`.
 * Validated end-to-end before being sent back to the caller.
 *
 * The version here is deliberately NOT `SUPPORTED_REPORT_VERSIONS`. This
 * is a different document with a different shape; it has not changed, so
 * it stays at 1.0 and says so. Sharing the constant would make it accept
 * versions it never emits, and would widen it again the next time the
 * audit report moves.
 */
export const FreeCheckReportSchema = z.object({
  reportVersion: z.literal('1.0'),
  kind: z.literal('free-check'),
  repository: z.object({
    url: z.string(),
    host: z.string(),
    owner: z.string(),
    name: z.string(),
    valid: z.boolean(),
  }),
  metadata: z
    .object({
      description: z.string().nullable().default(null),
      defaultBranch: z.string().nullable().default(null),
      stars: z.number().int().nonnegative().nullable().default(null),
      language: z.string().nullable().default(null),
      topics: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  stack: z
    .object({
      languages: z.array(z.string()).default([]),
      frameworks: z.array(z.string()).default([]),
      runtimes: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      passed: z.boolean(),
      evidence: z.string().nullable().default(null),
    })
  ),
  score: z.object({
    value: z.number().int().min(0).max(100),
    passed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  generatedAt: z.string(),
});
export type FreeCheckReport = z.infer<typeof FreeCheckReportSchema>;

export const JobStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const AuditJobSchema = z.object({
  jobId: z.string().min(1),
  status: JobStatusSchema,
  input: CreateAuditInputSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  paymentId: z.string().nullable().default(null),
  report: z.unknown().nullable().default(null),
  error: z.string().nullable().default(null),
  // Lifecycle fields populated by the worker / repository. The route
  // and the worker read these; tests and the route GET handler
  // surface them in the response when present.
  errorCode: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  failedAt: z.string().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  idempotencyKey: z.string().nullable().default(null),
  // Head SHA resolved by the route before enqueueing. Null when the
  // lookup failed. Fix-plan and diff derivations read it from here so
  // they never have to re-resolve it.
  commitSha: z.string().nullable().default(null),
  // Cache metadata captured by the worker. `null` while the job is
  // queued/processing. The route surfaces this in the GET response.
  cache: z
    .object({
      hit: z.boolean(),
      keyVersion: z.string(),
      expiresAt: z.string().nullable(),
    })
    .nullable()
    .default(null),
});
export type AuditJob = z.infer<typeof AuditJobSchema>;

export const CapabilitiesSchema = z.object({
  name: z.literal('RepoPilot'),
  version: z.string(),
  inputs: z.object({
    repoUrl: z.string(),
    mode: z.string(),
    target: z.string(),
    outputLanguage: z.string(),
  }),
  outputs: z.object({
    report: z.string(),
  }),
  limits: z.object({
    maxFiles: z.number(),
    maxFileBytes: z.number(),
    maxTotalBytes: z.number(),
    rateLimitPerMinute: z.number(),
  }),
  pricing: z.object({
    quickScan: z.object({ amount: z.string(), currency: z.string() }),
    fullAudit: z.object({ amount: z.string(), currency: z.string() }),
  }),
  paymentMode: z.enum(['mock', 'okx']),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
