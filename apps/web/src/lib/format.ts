/**
 * Display formatting shared by the report, history and comparison views.
 *
 * `shortSha`, `when` and `scoreClass` were each written once per component
 * that needed them. Three copies of one date format is three places for it
 * to drift apart.
 */

/** The first 7 characters of a commit SHA, or `unknown` when there is none. */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : 'unknown';
}

/** `2026-10-09T11:45:12.000Z` → `2026-10-09 11:45`. An unparseable input is returned as-is. */
export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
}

/** Score bucket, used as a CSS class name. `null` (no score) gets no class. */
export function scoreClass(n: number | null): string {
  if (n === null) return '';
  if (n >= 80) return 'ok';
  if (n >= 50) return 'warn';
  return 'bad';
}
