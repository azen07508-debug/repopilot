/**
 * Quality Contract — the layer that turns findings into a decision.
 *
 * A score answers "how good is this?". A contract answers "may this
 * ship?". Teams act on the second question, and a number out of 100
 * cannot answer it.
 *
 * Every threshold below maps to a deterministic rule. Nothing here can
 * be satisfied or violated by an LLM's opinion, and every check names
 * the rule ids behind it so a caller can drill into the findings.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '1.0' as const;

const SecuritySection = z.object({
  /** Maximum live credentials allowed in the working tree. */
  maxSecrets: z.number().int().min(0).default(0),
  /** Maximum critical-severity findings of any kind. */
  maxCritical: z.number().int().min(0).default(0),
  /** Maximum credentials allowed to remain reachable through history. */
  maxHistorySecrets: z.number().int().min(0).default(0),
});

const TestingSection = z.object({
  /** A test command must be declared and runnable. */
  required: z.boolean().default(true),
  /** Contract tests must exist wherever contracts do. */
  contractTestsRequired: z.boolean().default(false),
});

const CiSection = z.object({
  required: z.boolean().default(true),
});

const RepositorySection = z.object({
  readme: z.boolean().default(true),
  license: z.boolean().default(true),
  /** Off by default: plenty of shipped projects have no .env.example. */
  envExample: z.boolean().default(false),
});

const ReleaseSection = z.object({
  /** A production build path must exist (Dockerfile or a run script). */
  build: z.boolean().default(true),
});

export const QualityContractSchema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  security: SecuritySection.default({}),
  testing: TestingSection.default({}),
  ci: CiSection.default({}),
  repository: RepositorySection.default({}),
  release: ReleaseSection.default({}),
});
export type QualityContract = z.infer<typeof QualityContractSchema>;

/**
 * The contract applied when a caller does not supply one.
 *
 * Deliberately strict on the things that are never acceptable to ship
 * (secrets, critical findings) and quiet about the things reasonable
 * projects disagree on (env example, contract tests).
 */
export const DEFAULT_QUALITY_CONTRACT: QualityContract = QualityContractSchema.parse({
  schemaVersion: CONTRACT_VERSION,
});

export const ContractStatusSchema = z.enum(['pass', 'warn', 'fail']);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractCheckSchema = z.object({
  /** Stable id, e.g. `security.no-secrets`. */
  id: z.string().min(1),
  section: z.string().min(1),
  /** What the contract asked for, in words. */
  requirement: z.string().min(1),
  /** What the audit actually found, in words. */
  observed: z.string().min(1),
  status: ContractStatusSchema,
  /** Rule ids behind this check, so a caller can drill into findings. */
  ruleIds: z.array(z.string()).default([]),
});
export type ContractCheck = z.infer<typeof ContractCheckSchema>;

export const ContractSectionSchema = z.object({
  id: z.string().min(1),
  status: ContractStatusSchema,
  checks: z.array(ContractCheckSchema),
});
export type ContractSection = z.infer<typeof ContractSectionSchema>;

export const QualityContractResultSchema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  /**
   * pass              — every check passed
   * pass_with_warnings — nothing blocking, but something could not be
   *                      evaluated or is worth a look
   * blocked           — at least one check failed; do not ship
   */
  status: z.enum(['pass', 'pass_with_warnings', 'blocked']),
  /** The single answer a team actually wants. */
  ship: z.boolean(),
  blockerCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  sections: z.array(ContractSectionSchema),
  /**
   * Fingerprints of every finding that caused a blocker. This is what
   * re-audit compares against to answer "did the blockers go away?".
   */
  blockingFingerprints: z.array(z.string()).default([]),
  evaluatedAt: z.string(),
});
export type QualityContractResult = z.infer<typeof QualityContractResultSchema>;
