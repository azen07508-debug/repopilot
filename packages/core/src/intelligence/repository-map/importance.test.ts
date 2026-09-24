/**
 * Importance scoring tests.
 *
 * The interesting properties are not "does it return a number" but the
 * shape of the curve: bounded, monotonic, saturating, and — the one that
 * is easy to get wrong and impossible to notice — independent of what
 * else is in the repository.
 */
import { describe, it, expect } from 'vitest';
import { clamp01, moduleImportance, round4, saturating, scoreImportantFile } from './importance.js';

describe('saturating', () => {
  it('is 0 at 0 and 0.5 at the half point', () => {
    expect(saturating(0, 3)).toBe(0);
    expect(saturating(3, 3)).toBe(0.5);
  });

  it('approaches 1 without reaching it', () => {
    expect(saturating(1_000_000, 3)).toBeLessThan(1);
    expect(saturating(1_000_000, 3)).toBeGreaterThan(0.999);
  });

  it('has diminishing returns', () => {
    const firstStep = saturating(1, 3) - saturating(0, 3);
    const tenthStep = saturating(10, 3) - saturating(9, 3);
    expect(firstStep).toBeGreaterThan(tenthStep);
  });

  it('treats negative and non-finite input as 0 rather than propagating NaN', () => {
    expect(saturating(-5, 3)).toBe(0);
    expect(saturating(Number.NaN, 3)).toBe(0);
    expect(saturating(Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
});

describe('clamp01', () => {
  it('clamps both ends and rejects non-finite input', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('moduleImportance', () => {
  it('stays within 0..1 for extreme inputs', () => {
    for (const fanIn of [0, 1, 1000]) {
      for (const fileCount of [0, 1, 100_000]) {
        for (const hasEntrypoint of [true, false]) {
          const score = moduleImportance({ fanIn, fileCount, hasEntrypoint });
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rises with fan-in and with file count', () => {
    const base = moduleImportance({ fanIn: 0, fileCount: 0, hasEntrypoint: false });
    const dependedOn = moduleImportance({ fanIn: 5, fileCount: 0, hasEntrypoint: false });
    const larger = moduleImportance({ fanIn: 0, fileCount: 40, hasEntrypoint: false });
    expect(dependedOn).toBeGreaterThan(base);
    expect(larger).toBeGreaterThan(base);
  });

  it('counts an entrypoint', () => {
    const without = moduleImportance({ fanIn: 2, fileCount: 10, hasEntrypoint: false });
    const withEntrypoint = moduleImportance({ fanIn: 2, fileCount: 10, hasEntrypoint: true });
    expect(withEntrypoint).toBeGreaterThan(without);
  });

  it('is absolute, not scaled to the repository being scored', () => {
    // 3 fan-in and 20 files are the documented midpoints of both curves,
    // so this is 0.5 * 0.5 + 0.3 * 0.5 = 0.4 — the same number whether the
    // module is the largest in a tiny repository or the smallest in a huge
    // one. A relative formula would make both answers 1.0 and 0.0.
    expect(moduleImportance({ fanIn: 3, fileCount: 20, hasEntrypoint: false })).toBe(0.4);
  });

  it('does not depend on evaluation order', () => {
    const inputs = [
      { fanIn: 7, fileCount: 13, hasEntrypoint: true },
      { fanIn: 0, fileCount: 200, hasEntrypoint: false },
      { fanIn: 3, fileCount: 20, hasEntrypoint: false },
    ];
    const forwards = inputs.map((i) => moduleImportance(i));
    const backwards = [...inputs].reverse().map((i) => moduleImportance(i)).reverse();
    expect(forwards).toEqual(backwards);
  });

  it('is stable to four decimals', () => {
    const score = moduleImportance({ fanIn: 7, fileCount: 13, hasEntrypoint: true });
    expect(score).toBe(round4(score));
    expect(String(score)).toBe(String(round4(score)));
  });
});

describe('scoreImportantFile', () => {
  it('returns null when nothing applies', () => {
    expect(scoreImportantFile({ entrypoint: null, configLevel: null })).toBeNull();
  });

  it('ranks an entrypoint above root configuration', () => {
    const entrypoint = scoreImportantFile({
      entrypoint: { kind: 'cli', confidence: 0.95 },
      configLevel: null,
    });
    const config = scoreImportantFile({ entrypoint: null, configLevel: 'root' });
    expect(entrypoint?.importance).toBeGreaterThan(config?.importance ?? 0);
  });

  it('ranks root configuration above a nested manifest', () => {
    const root = scoreImportantFile({ entrypoint: null, configLevel: 'root' });
    const nested = scoreImportantFile({ entrypoint: null, configLevel: 'nested' });
    expect(root?.importance).toBeGreaterThan(nested?.importance ?? 0);
  });

  it('takes the strongest reason instead of summing them', () => {
    const entrypointOnly = scoreImportantFile({
      entrypoint: { kind: 'library', confidence: 0.7 },
      configLevel: null,
    });
    const configOnly = scoreImportantFile({ entrypoint: null, configLevel: 'root' });
    const both = scoreImportantFile({
      entrypoint: { kind: 'library', confidence: 0.7 },
      configLevel: 'root',
    });

    // Asserted as max directly rather than as an expected number, so the
    // test states the rule instead of a constant that happens to follow
    // from it. A 0.7-confidence entrypoint scores 0.795 and the root
    // configuration 0.8, so this is also the case that catches a sum.
    expect(both?.importance).toBe(
      Math.max(entrypointOnly?.importance ?? 0, configOnly?.importance ?? 0)
    );
    expect(both?.importance).toBeLessThan(
      (entrypointOnly?.importance ?? 0) + (configOnly?.importance ?? 0)
    );
    expect(both?.reasons).toHaveLength(2);
  });

  it('keeps every applicable reason', () => {
    const score = scoreImportantFile({
      entrypoint: { kind: 'cli', confidence: 0.9 },
      configLevel: 'nested',
    });
    expect(score?.reasons).toHaveLength(2);
    expect(score?.reasons.join(' ')).toContain('Entrypoint (cli)');
    expect(score?.reasons.join(' ')).toContain('Configuration or manifest');
  });

  it('scales the entrypoint score with its confidence', () => {
    const low = scoreImportantFile({ entrypoint: { kind: 'app', confidence: 0.5 }, configLevel: null });
    const high = scoreImportantFile({ entrypoint: { kind: 'app', confidence: 0.95 }, configLevel: null });
    expect(high?.importance).toBeGreaterThan(low?.importance ?? 0);
  });

  it('clamps a confidence outside 0..1 rather than exceeding the schema bound', () => {
    const over = scoreImportantFile({ entrypoint: { kind: 'app', confidence: 5 }, configLevel: null });
    expect(over?.importance).toBeLessThanOrEqual(1);
  });

  it('stays inside 0..1 when every reason applies at once', () => {
    // `ImportantFile.importance` is `min(0).max(1)`. A file can be an
    // entrypoint and the root configuration simultaneously, and a
    // combine-by-adding implementation would emit 1.7 here and fail the
    // schema three layers away from the arithmetic that caused it.
    const score = scoreImportantFile({
      entrypoint: { kind: 'cli', confidence: 1 },
      configLevel: 'root',
    });
    expect(score?.importance).toBe(0.9);
  });
});
