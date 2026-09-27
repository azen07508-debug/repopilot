/**
 * The one string ordering the intelligence layer sorts by.
 *
 * `a < b` is UTF-16 code-unit order, **not** locale order, and that is the
 * point: `localeCompare` consults the runtime's collation, so the same
 * repository would produce a different map on a machine with a different
 * locale. Every artifact here is meant to be snapshot-tested and cached
 * (D-021), which requires an order that does not depend on where it ran.
 *
 * The consequence to be aware of: `Z` sorts before `a`, and `é` after `z`.
 * For file paths and identifiers that is what you want; for anything
 * user-facing it is not.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
