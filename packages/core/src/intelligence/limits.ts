/**
 * The one size limit every Repository Intelligence reader shares (R-18).
 *
 * The Symbol Map refuses to hand a file larger than this to a parser, and the
 * Dependency Graph refuses to hand one to an import extractor. Those are the
 * same bound for the same reason, so they read the same number rather than
 * two that have to be kept equal by hand — and they live here because a
 * constant owned by one of the two readers would make the other depend on it
 * for a fact that belongs to neither.
 */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
