/**
 * Importance scoring for the Repository Map.
 *
 * Three properties, and every one of them is load-bearing:
 *
 *   1. **Deterministic.** Same input, same number, always. No LLM, no
 *      clock, no randomness, no map iteration order leaking through.
 *   2. **Bounded.** 0..1, by construction rather than by clamping a sum
 *      that might exceed it.
 *   3. **Not normalised against the repository being scored.** This is
 *      the decision worth stating, because the obvious formula is the
 *      other one: "the module with the most fan-in is 1.0, scale the
 *      rest to it". That reads well inside a single repository and means
 *      nothing across two — a 12-file module in a small repo would
 *      outrank a 400-file module in a large one, because each would be
 *      the maximum of its own tree. The curves here saturate instead, so
 *      0.6 means the same thing wherever it appears and two maps can be
 *      compared without knowing what else was in the tree.
 *
 * Nothing in this file reads the filesystem, the network, or the clock.
 */
import type { Entrypoint } from '../../schemas/intelligence/repository-map.js';

/**
 * Fan-in at which the dependency term reaches 0.5.
 *
 * Three, not ten: a module that three other modules import is already
 * structurally central in a repository of any size, and the difference
 * between being imported by 20 things and 21 things is not a difference
 * anyone should act on.
 */
const FAN_IN_HALF = 3;

/** File count at which the size term reaches 0.5. */
const SIZE_HALF = 20;

const W_FAN_IN = 0.5;
const W_SIZE = 0.3;
const W_ENTRYPOINT = 0.2;

/** Entrypoints are navigation targets, so they lead the important-file list. */
const IMPORTANT_ENTRYPOINT_BASE = 0.55;
const IMPORTANT_ENTRYPOINT_SPAN = 0.35;
/** Root configuration is read before any source file. */
const IMPORTANT_ROOT_CONFIG = 0.8;
/** A workspace package's own manifest still matters, just less. */
const IMPORTANT_NESTED_CONFIG = 0.6;

export interface ModuleImportanceInput {
  /** How many other modules depend on this one. */
  fanIn: number;
  fileCount: number;
  hasEntrypoint: boolean;
}

/**
 * Score a module, 0..1.
 *
 * Each term is a saturating curve `x / (x + half)` rather than a ratio
 * against the repository maximum, and the three are weighted and summed
 * so that a module can be important for more than one reason: a big
 * module nothing imports, and a small module everything imports, both
 * land in the middle rather than tying at the top.
 */
export function moduleImportance(input: ModuleImportanceInput): number {
  const fanInScore = saturating(input.fanIn, FAN_IN_HALF);
  const sizeScore = saturating(input.fileCount, SIZE_HALF);
  const entryScore = input.hasEntrypoint ? 1 : 0;
  return round4(W_FAN_IN * fanInScore + W_SIZE * sizeScore + W_ENTRYPOINT * entryScore);
}

/**
 * `x / (x + half)` — 0 at 0, 0.5 at `half`, asymptotic to 1.
 *
 * Rejects negatives and non-finite input rather than letting `NaN`
 * propagate into a schema-validated field, where it would surface as an
 * unexplained Zod error three layers away.
 */
export function saturating(value: number, half: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + half);
}

export interface ImportantFileSignals {
  /** Set when the file was detected as an entrypoint. */
  entrypoint: { kind: Entrypoint['kind']; confidence: number } | null;
  /** `null` when the file is not configuration; otherwise where it sits. */
  configLevel: 'root' | 'nested' | null;
}

export interface ImportantFileScore {
  importance: number;
  reasons: string[];
}

/**
 * Score one important file, or return `null` when nothing applies.
 *
 * Score and reasons are produced together on purpose: computed
 * separately, the two drift, and a file ends up ranked by one rule while
 * being explained by another.
 *
 * The reasons are combined with `max`, not with a sum. The signals
 * overlap — the root `package.json` of a CLI package is a config file
 * *and* a `bin` declaration *and* often the entrypoint's neighbour — and
 * adding them would let two weak reasons outrank one strong one, which is
 * exactly the failure a ranking exists to avoid.
 */
export function scoreImportantFile(signals: ImportantFileSignals): ImportantFileScore | null {
  const reasons: string[] = [];
  let importance = 0;

  if (signals.entrypoint) {
    const { kind, confidence } = signals.entrypoint;
    const score = round4(IMPORTANT_ENTRYPOINT_BASE + IMPORTANT_ENTRYPOINT_SPAN * clamp01(confidence));
    importance = Math.max(importance, score);
    reasons.push(`Entrypoint (${kind}) at confidence ${round4(clamp01(confidence))}`);
  }

  if (signals.configLevel === 'root') {
    importance = Math.max(importance, IMPORTANT_ROOT_CONFIG);
    reasons.push('Root-level configuration or manifest');
  } else if (signals.configLevel === 'nested') {
    importance = Math.max(importance, IMPORTANT_NESTED_CONFIG);
    reasons.push('Configuration or manifest');
  }

  if (reasons.length === 0) return null;
  return { importance: round4(importance), reasons };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Four decimal places.
 *
 * Scores land in snapshots and in cache payloads (D-021), so they have to
 * be stable across platforms and engines. `0.30000000000000004` and
 * `0.3` are the same number to a human and a spurious diff to a machine.
 */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
