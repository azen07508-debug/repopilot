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
 */
export const REPORT_VERSION = '1.2' as const;

/** Every report version this build can parse, oldest first. */
export const SUPPORTED_REPORT_VERSIONS = ['1.0', '1.1', '1.2'] as const;

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
 * The two tiers' prices.
 *
 * The full audit was 0.10 and is now 0.05. The 5x gap described the
 * difference the listing claimed — "the deeper reproducibility and Web3
 * analyzers" — which the code never implemented. Once the tiers were
 * separated by what they deliver rather than by claimed analysis depth
 * (RISKS.md R-30), the honest multiple was the one the deliverables
 * support: a deployment plan and a set of launch copy, not a second
 * analysis. Both tiers run the same analyzers over the same archive.
 */
export const DEFAULT_PRICING = {
  quickScan: { amount: '0.02', currency: 'USDT' },
  fullAudit: { amount: '0.05', currency: 'USDT' },
};
