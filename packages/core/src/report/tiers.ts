/**
 * What each audit tier contains — the one place that answers it.
 *
 * **A tier changes what the report delivers, never what it measures.**
 *
 * Both tiers run every analyzer over the same archive and produce the same
 * numbers. That is not a limitation being documented, it is the property the
 * product is sold on: the score is a property of the repository, so two
 * buyers looking at the same commit must be able to compare their scores.
 * If a tier could change a measurement, `overall` would silently become
 * "overall, for the price you paid", and no consumer could tell.
 *
 * So the ladder is diagnosis vs. launch materials:
 *
 *   quick  the verdict — scores, blockers, documentation gaps, security
 *          findings, the launch checklist, and the fix plan (the derived
 *          views are free: see `apps/api/src/routes/audit-derived.ts`)
 *   full   the verdict plus the materials you ship with — the deployment
 *          plan and the launch copy
 *
 * This module exists because the previous arrangement had the difference
 * spread across three `if (mode === 'full')` sites in `report/builder.ts`
 * and a fourth statement in `MARKETPLACE_LISTING.md`, and nothing compared
 * them. Two of the three sites added advice rows, the marketplace listing
 * promised "the deeper reproducibility and Web3 analyzers" (which never
 * existed), and the report told a `quick` buyer that some "deeper
 * reproducibility heuristics" had been skipped. They had not. Nothing was
 * skipped. See RISKS.md R-30.
 *
 * Two rules follow from that history, and both are enforced by
 * `tiers.test.ts` rather than by discipline:
 *
 * 1. **A section is omitted or it is not.** Never "omitted, represented by
 *    an empty value" — an empty `deploymentPlan` and an absent one are
 *    different claims, and a reader that cannot tell them apart will read
 *    the second as the first. `omittedSections` on the report carries the
 *    answer, and a test pins that it agrees with the sections themselves.
 * 2. **The prose is generated from the declaration.** The limitation
 *    sentence a `quick` report carries is built by `tierLimitations()`
 *    from `FULL_ONLY_SECTIONS`, so it cannot describe a difference that
 *    the code does not implement (D-033).
 */

import type { AuditMode } from '../schemas/inputs.js';

/**
 * Sections the `full` tier adds, in the order they appear in a report.
 *
 * Deliberately a list of *report fields* rather than a list of features.
 * A name here has to be a key on `Report`, because the consistency test
 * checks the declared omissions against the sections themselves — a
 * feature name would have nothing to check.
 */
export const FULL_ONLY_SECTIONS = ['deploymentPlan', 'launchCopy'] as const;

export type FullOnlySection = (typeof FULL_ONLY_SECTIONS)[number];

export interface TierInput {
  mode: AuditMode;
  /**
   * Whether the caller asked for launch copy.
   *
   * **Its scope is the `full` tier.** It is a refinement inside `full`, not
   * a second way to pick a tier: `quick` omits launch copy whatever this
   * says. That scope is declared here, next to the tier that owns it, for
   * the reason given in D-032 — a flag whose scope is stated somewhere else
   * is a flag whose scope will be forgotten.
   */
  includeLaunchCopy: boolean;
}

/**
 * The sections this report will not carry, by name.
 *
 * Empty means "nothing omitted" — a `full` report with launch copy. That
 * is the only reading that keeps `[]` from being ambiguous, which is why
 * `full` reports never omit anything and the two knobs cannot combine into
 * a report that omits one of the two.
 */
export function omittedSections(input: TierInput): FullOnlySection[] {
  const out: FullOnlySection[] = [];
  if (input.mode !== 'full') out.push('deploymentPlan');
  // `launchCopy` is omitted when the tier does not carry it at all, and
  // also when the tier does but the caller declined it. Those are different
  // reasons for the same fact, and the report states the fact.
  if (input.mode !== 'full' || !input.includeLaunchCopy) out.push('launchCopy');
  return out;
}

/**
 * How the report describes its own omissions, in prose.
 *
 * Generated, never written by hand at a call site — the previous version of
 * this sentence lived as a string literal in `builder.ts` and claimed a
 * difference the code did not implement. Keeping the sentence here means
 * adding a section to `FULL_ONLY_SECTIONS` also updates what the report
 * says about itself.
 */
export function tierLimitations(input: TierInput): string[] {
  const omitted = omittedSections(input);
  if (omitted.length === 0) return [];

  if (input.mode !== 'full') {
    return [
      'This is a quick audit. The analysis is identical to a full audit — ' +
        `what differs is what the report carries: ${listSections(omitted)} ` +
        'are part of the full audit.',
    ];
  }
  // Reached only for a full audit whose caller declined the launch copy.
  // Saying "quick audits omit this" would be true and misleading.
  return [`Omitted on request: ${listSections(omitted)}.`];
}

/** `a`, `a and b`, `a, b and c` — report fields are read, not parsed. */
function listSections(sections: readonly string[]): string {
  if (sections.length === 1) return sections[0] as string;
  return `${sections.slice(0, -1).join(', ')} and ${sections[sections.length - 1] as string}`;
}
