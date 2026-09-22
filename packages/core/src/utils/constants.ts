/**
 * Constants and defaults used across the core package.
 */
/**
 * Bumped to 1.1 when findings gained ruleId, fingerprint, confidence and
 * verification. Those fields are additive, so a 1.0 report still parses —
 * which is why the schema accepts both rather than only the new one. A
 * consumer can branch on the version to know whether fingerprints are
 * available, instead of guessing from the shape.
 */
export const REPORT_VERSION = '1.1' as const;

/** Every report version this build can parse, oldest first. */
export const SUPPORTED_REPORT_VERSIONS = ['1.0', '1.1'] as const;

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

export const DEFAULT_PRICING = {
  quickScan: { amount: '0.02', currency: 'USDT' },
  fullAudit: { amount: '0.10', currency: 'USDT' },
};
