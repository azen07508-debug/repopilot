/**
 * Constants and defaults used across the core package.
 */
/**
 * Bumped to 1.1 when findings gained ruleId, fingerprint, confidence and
 * verification. Those fields are additive, so a 1.0 report still parses —
 * which is why the schema accepts both rather than only the new one. A
 * consumer can branch on the version to know whether fingerprints are
 * available, instead of guessing from the shape.
 *
 * Bumped to 1.2 when the tiers were separated by deliverable rather than by
 * claimed analysis depth (RISKS.md R-30). The schema change is additive —
 * `omittedSections` defaults to `[]`, so a stored 1.1 report still parses
 * and still means "nothing omitted" — but the *content* of a `quick` report
 * changed: it no longer carries a deployment plan or launch copy. A build
 * that had cached a quick report before this bump would otherwise serve the
 * old content for a new request, which is exactly the failure the version
 * in the cache key exists to prevent (`apps/api/src/services/audit-worker.ts`).
 *
 * Bumped to 1.3 when `analyzerProvenance` lost `'analyzers.llm'` (R-38). The
 * entry was `'optional; disabled by default'` — a statement about a component
 * rather than about an analyzer, in a map whose every other key names one that
 * runs. It told every buyer of every report that an LLM analyzer was installed
 * and switched off. Nothing else in the report changed, so 1.2 reports still
 * parse; the version moved because a key left a map that consumers read.
 */
export const REPORT_VERSION = '1.3' as const;

/** Every report version this build can parse, oldest first. */
export const SUPPORTED_REPORT_VERSIONS = ['1.0', '1.1', '1.2', '1.3'] as const;

export const CORE_VERSION = '0.1.0';

export const DEFAULT_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 1_048_576, // 1 MiB
  maxTotalBytes: 52_428_800, // 50 MiB
  rateLimitPerMinute: 60,
  fetchTimeoutMs: 30_000,
  jobTimeoutMs: 300_000,
  /**
   * How many recent commits the secret-history scan reads.
   *
   * Each commit costs one GitHub request to fetch its diff, and anonymous
   * access is 60 requests/hour for a whole IP — so this stays small on
   * purpose. 0 disables the scan.
   */
  historyScanCommits: 20,
};

/**
 * The audit price. One price, one tier.
 *
 * There used to be two: 0.02 for `quick` and 0.05 for `full`. Both ran every
 * analyzer over the same archive (RISKS.md R-30), so the 2.5x bought the
 * deployment plan and the launch copy — report sections, not analysis. The
 * registration copy said so itself ("Runs the same analysis as the quick audit
 * and adds the launch materials"), which meant the expensive tier advertised
 * its own irrelevance and any agent comparing the two picked the cheap one.
 *
 * `mode` still selects what the report carries (D-035). It no longer selects
 * what it costs, because a price that depends on a difference the buyer cannot
 * see is not a tier, it is a fence.
 */
export const DEFAULT_PRICING = {
  audit: { amount: '1', currency: 'USDT' },
};
