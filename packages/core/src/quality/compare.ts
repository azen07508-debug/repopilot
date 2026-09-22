/**
 * Quality gate comparison.
 *
 * Answers the question a team actually asks after a round of fixes: did
 * the blockers go away, and may we ship now?
 *
 * Works on fingerprints, so "resolved" means this specific finding is
 * gone rather than the rule stopped firing somewhere.
 *
 * A blocker whose line shifted has a different fingerprint, so it counts
 * as resolved plus new rather than being silently matched to its old
 * self. That is deliberate — the gate does not guess. `AuditDiff.moved`
 * is where a line shift is named, and a caller that wants "actually
 * gone" subtracts it.
 */
import type { Report } from '../schemas/report.js';
import {
  DEFAULT_QUALITY_CONTRACT,
  type QualityContract,
  type QualityContractResult,
} from '../schemas/quality-contract.js';
import { evaluateQualityContract } from './evaluate.js';

export interface GateSide {
  status: QualityContractResult['status'];
  ship: boolean;
  blockers: number;
  warnings: number;
}

export interface QualityGateDiff {
  before: GateSide;
  after: GateSide;
  /** Fingerprints that blocked before and do not block now. */
  resolvedBlockers: string[];
  /** Fingerprints that block now and did not before. */
  newBlockers: string[];
  /** Fingerprints that block on both sides. */
  remainingBlockers: string[];
  /** True when the ship decision flipped, in either direction. */
  shipChanged: boolean;
  /** One line an agent can act on without parsing the rest. */
  summary: string;
}

function side(result: QualityContractResult): GateSide {
  return {
    status: result.status,
    ship: result.ship,
    blockers: result.blockerCount,
    warnings: result.warningCount,
  };
}

function summarise(
  before: GateSide,
  after: GateSide,
  resolved: number,
  added: number,
  remaining: number
): string {
  if (after.ship && !before.ship) {
    return `Unblocked: ${resolved} blocker(s) resolved — shipping is allowed again.`;
  }
  if (!after.ship && before.ship) {
    return `Regressed: ${added} new blocker(s) — shipping is now blocked.`;
  }
  if (!after.ship) {
    if (remaining === 0) return `Still blocked by ${added} new blocker(s); none carried over.`;
    return `Still blocked: ${remaining} blocker(s) remain${added > 0 ? `, ${added} new` : ''}.`;
  }
  return resolved > 0
    ? `Shippable, and ${resolved} blocker(s) resolved along the way.`
    : 'Shippable; no blockers on either side.';
}

export function compareQualityGates(
  before: Report,
  after: Report,
  contract: QualityContract = DEFAULT_QUALITY_CONTRACT
): QualityGateDiff {
  const beforeResult = evaluateQualityContract(before, contract);
  const afterResult = evaluateQualityContract(after, contract);

  const beforeSet = new Set(beforeResult.blockingFingerprints);
  const afterSet = new Set(afterResult.blockingFingerprints);

  const resolvedBlockers = [...beforeSet].filter((k) => !afterSet.has(k)).sort();
  const newBlockers = [...afterSet].filter((k) => !beforeSet.has(k)).sort();
  const remainingBlockers = [...afterSet].filter((k) => beforeSet.has(k)).sort();

  const beforeSide = side(beforeResult);
  const afterSide = side(afterResult);

  return {
    before: beforeSide,
    after: afterSide,
    resolvedBlockers,
    newBlockers,
    remainingBlockers,
    shipChanged: beforeSide.ship !== afterSide.ship,
    summary: summarise(
      beforeSide,
      afterSide,
      resolvedBlockers.length,
      newBlockers.length,
      remainingBlockers.length
    ),
  };
}
