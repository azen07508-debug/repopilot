/**
 * Deterministic finding fingerprints.
 *
 * FNV-1a with two independent seeds, rendered as 16 hex characters.
 * Deliberately NOT `node:crypto`: this module is reachable from the
 * browser bundle through `@repopilot/core`, and pulling in a Node builtin
 * would break that build. 64 bits is far more than enough for the tens —
 * occasionally low hundreds — of findings a report carries.
 *
 * The fingerprint deliberately includes line numbers. A finding that
 * moves to a different line is a different location, and pretending
 * otherwise would hide real churn. What it does buy is that the SAME
 * rule at the SAME location always produces the SAME value, across
 * processes, machines and runs — which is what before/after comparison
 * needs.
 */

export interface FingerprintInput {
  ruleId: string;
  evidence: ReadonlyArray<{ file: string; line: number | null }>;
}

/** Hash an arbitrary string into 16 hex characters. */
export function fingerprintOf(input: string): string {
  return fnv1a(`${input}\u0000a`) + fnv1a(`${input}\u0000b`);
}

/**
 * Identity of one hit: same rule + same evidence locations => same value.
 *
 * Evidence is sorted first so the order analyzers happen to emit it in
 * cannot change the result.
 */
export function findingFingerprint(input: FingerprintInput): string {
  const locations = input.evidence
    .map((e) => `${e.file}:${e.line ?? '-'}`)
    .sort()
    .join(',');
  return fingerprintOf(`${input.ruleId}|${locations}`);
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
