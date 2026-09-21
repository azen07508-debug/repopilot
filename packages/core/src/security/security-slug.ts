/**
 * The slug used to build stable finding ids from a path.
 *
 * Lives on its own rather than inside the secret scanner, because every
 * analyzer that emits a per-file finding needs it and none of them should
 * have to depend on the secret scanner to get it.
 *
 * It is deliberately lossy and deterministic: `src/a.ts` becomes
 * `src-a-ts`, the same on every machine and in every run. Finding ids are
 * compared across audits, so anything time- or locale-dependent here
 * would break before/after comparison.
 */
export function slugify(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
