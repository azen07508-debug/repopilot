/**
 * RepoPilot report schema — single source of truth for the audit output.
 * Every field the report exposes is validated by Zod before being returned.
 */
import { z } from 'zod';
import { SUPPORTED_REPORT_VERSIONS } from '../utils/constants.js';

/**
 * Which remote source produced a piece of evidence.
 *
 * Distinct from `EvidenceSourceSchema` in schemas/intelligence, which
 * answers "which analyzer produced this?". This one answers "where did
 * the data come from?", and that is the axis the quality gate cares
 * about: a rule that cannot name one of these does not belong in a
 * deterministic finding.
 *
 * RepoPilot never clones a repository, so `git_history` means "read
 * through the GitHub API", not "read a local git directory".
 */
export const EvidenceOriginSchema = z.enum([
  'file', // contents of a single file
  'file_tree', // path listing / presence check
  'git_history', // commit history via the GitHub API
  'github_api', // repository metadata
  'text_match', // a pattern found inside a file
  'dependency_manifest', // package.json / lockfile / requirements.txt
  'workflow', // CI workflow definition
]);
export type EvidenceOrigin = z.infer<typeof EvidenceOriginSchema>;

export const EvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive().nullable(),
  reason: z.string().min(1),
  /**
   * Where the data came from.
   *
   * Optional on the wire so the thirty-odd existing evidence literals in
   * the analyzers keep working; the rule registry declares each rule's
   * origin and `enrichFinding` fills it in. An analyzer that mixes
   * sources for one finding can set it explicitly and win.
   */
  source: EvidenceOriginSchema.optional(),
  /**
   * The matching text, truncated and redacted. MUST NOT carry a full
   * secret: `security/redact.ts` is the only thing allowed to build one.
   * Absent means "not captured", not "empty".
   */
  excerpt: z.string().nullable().optional(),
  /** Absent means "assumed reproducible". */
  reproducible: z.boolean().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * How a finding can be checked as fixed, mechanically.
 *
 * This exists because acceptance criteria are prose and prose cannot be
 * evaluated. Re-audit needs to decide "is this finding gone?" without an
 * LLM in the loop, so each rule declares a machine-checkable shape.
 */
export const VerificationSchema = z.object({
  kind: z.enum([
    'file_absent', // target path must not exist in the tree
    'file_present', // target path must exist
    'text_absent', // pattern must not appear in target
    'text_present', // pattern must appear in target
    'manifest_field', // a field must be present in a dependency manifest
    'manual', // cannot be checked remotely; never satisfies a contract
  ]),
  /** Path, glob or manifest key the check applies to. */
  target: z.string(),
  /** Expected value for `manifest_field`; null otherwise. */
  expected: z.string().nullable().default(null),
  /** Why the check is shaped this way, for a human reading the plan. */
  note: z.string().nullable().default(null),
});
export type Verification = z.infer<typeof VerificationSchema>;

/** Confidence is a property of the rule's detection method, never of an LLM. */
export const RuleConfidence = {
  /** Exact match: file presence, a regex hit, a manifest field. */
  exact: 1,
  /** Structural: parsed AST, resolved dependency graph. */
  structural: 0.9,
  /** Heuristic: entropy, similarity, repetition. */
  heuristic: 0.7,
} as const;
export type RuleConfidenceLevel = keyof typeof RuleConfidence;

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
  /** Stable slug produced by the rule, e.g. `doc-license`. */
  id: z.string().min(1),
  /**
   * Stable rule identifier, e.g. `REPO-LICENSE-001`.
   *
   * Optional on the wire so an analyzer can emit a finding before
   * enrichment runs; `enrichFinding` fills it. Anything reading findings
   * out of a built Report can rely on it being present.
   */
  ruleId: z.string().min(1).optional(),
  /**
   * Deterministic identity of this hit: same rule + same evidence
   * locations => same fingerprint. Before/after comparison keys on this.
   *
   * `id` alone is not enough: location-sensitive rules (secrets,
   * injections, per-section README checks) emit ids that embed a line
   * number, so inserting one line above a secret would read as "old
   * finding resolved, new finding appeared" instead of "same finding,
   * moved".
   */
  fingerprint: z.string().optional(),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  /** From the rule's detection method, never from an LLM. */
  confidence: z.number().min(0).max(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
  recommendedAction: z.string().min(1),
  /** How to check the fix mechanically. Absent when not expressible. */
  verification: VerificationSchema.nullable().optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

/**
 * Where a finding sits relative to the release decision.
 *
 * Only two values are implemented. The type exists so the future ones —
 * suppressed, informational — have a home that is not `fixture`, which
 * would otherwise become a bucket for everything non-blocking and rot
 * within a release or two.
 */
export const FindingDispositionSchema = z.enum(['active', 'fixture']);
export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;

/**
 * One file-and-rule cluster of fixture findings.
 *
 * A reading aid, not a finding: it carries no fingerprint and nothing
 * keys on it. `fixtureFindings` remains the authoritative list — this is
 * the same findings folded down to something a person can scan, which a
 * real report needed when 542 of them arrived at once.
 *
 * Deliberately carries no sample finding and no description. Those are
 * the fields that made the unfolded list unreadable, and a group whose
 * members are interchangeable does not need one of them repeated.
 */
export const FixtureGroupSchema = z.object({
  /** Evidence file shared by the group, as written in the report. */
  file: z.string(),
  /** Rule shared by the group. `''` when enrichment never ran. */
  ruleId: z.string(),
  /** Title of the first finding in the group — what the group *is*. */
  title: z.string(),
  /** Total findings in the group, not the number of lines listed. */
  count: z.number().int().positive(),
  /** Worst severity among the members. */
  severity: SeveritySchema,
  /**
   * Distinct lines, ascending.
   *
   * The summarizer caps this list and `count` above keeps the true
   * total, so a short list next to a large count means "many hits, few
   * places" rather than "the list is complete". The cap is a reading
   * policy, not a validity rule, which is why the schema does not
   * enforce it.
   */
  lines: z.array(z.number().int().positive()).default([]),
});
export type FixtureGroup = z.infer<typeof FixtureGroupSchema>;

/**
 * How much of the commit history the secret scan actually read.
 *
 * This exists because "no secrets in history" is a claim with a scope. A
 * report that omits the scope is making a stronger claim than it can
 * support: scanning 20 commits and saying "history clean" reads as "all
 * of history", which may be false.
 */
export const HistoryScanSchema = z.object({
  mode: z.enum(['quick', 'full', 'custom', 'disabled']),
  /** How many commits the caller asked for. */
  requestedCommits: z.number().int().min(0),
  /** How many were actually read. */
  scannedCommits: z.number().int().min(0),
  /**
   * True only when the scan reached the beginning of the repository.
   * False whenever older history exists that nobody looked at.
   */
  complete: z.boolean(),
  /** Why the scan was skipped or stopped short, when it was. */
  note: z.string().nullable().default(null),
});
export type HistoryScan = z.infer<typeof HistoryScanSchema>;

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
  reportVersion: z.enum(SUPPORTED_REPORT_VERSIONS),
  repository: RepositorySchema,
  summary: z.string(),
  detectedStack: z.array(z.string()),
  scores: ScoresSchema,
  blockers: z.array(FindingSchema),
  documentationGaps: z.array(FindingSchema),
  securityFindings: z.array(FindingSchema),
  /**
   * Code-hygiene findings that are neither documentation gaps nor
   * security problems — the AI-pattern rules, mostly.
   *
   * Deliberately outside the score: the score answers "is this ready to
   * launch", and a duplicated block or a leftover TODO does not change
   * that answer. The quality contract still sees them, because a team
   * may well decide it cares.
   */
  qualityFindings: z.array(FindingSchema).default([]),
  /**
   * Findings under fixture paths — test files, fixtures, sample apps,
   * example directories.
   *
   * Kept separate rather than dropped. A real credential committed into a
   * test file is still a real credential and still belongs in the report;
   * it just does not participate in the release decision by default.
   * `security.scanFixtures` turns that around for a project that wants
   * the strict reading.
   *
   * Lockfiles and documents are NOT in here. They are downgraded by
   * `severityForPath` instead, for the reason given in
   * `security/severity.ts`: a document is often a finding's evidence file
   * rather than the problem, and moving those here would drop a missing
   * README out of the main report.
   *
   * Separate from `qualityFindings` because the two answer different
   * questions: that one is "code hygiene, not launch readiness", this one
   * is "the finding is real but lives somewhere its blast radius is
   * smaller".
   */
  fixtureFindings: z.array(FindingSchema).default([]),
  /**
   * The same findings, grouped by (file, rule) for reading.
   *
   * A derived view of `fixtureFindings`, stored rather than computed on
   * read because the web bundle cannot import core at runtime — see
   * report/fixtures.ts, which builds it and explains the whole decision.
   *
   * Defaults to empty, so a report written before this field existed
   * still parses. An empty array on an old report means "not summarised",
   * not "no fixtures": read `fixtureFindings` when the two disagree.
   */
  fixtureSummary: z.array(FixtureGroupSchema).default([]),
  /**
   * Scope of the commit-history secret scan.
   *
   * Optional so reports written before this field existed still parse.
   * When it is absent, a caller must not claim the history was checked.
   */
  historyScan: HistoryScanSchema.optional(),
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
