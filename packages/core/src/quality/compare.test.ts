import { describe, expect, it } from 'vitest';
import type { Finding, Report } from '../schemas/report.js';
import { makeFinding, reportWithFindings } from '../test-utils/report-factory.js';
import { compareQualityGates } from './compare.js';

/** A finding the default contract blocks on (CI-001 fails ci.workflow). */
function blocking(fingerprint: string, overrides: Partial<Finding> = {}): Finding {
  return makeFinding({
    ruleId: 'CI-001',
    fingerprint,
    severity: 'high',
    ...overrides,
  });
}

function clean(): Report {
  return reportWithFindings([]);
}

function blocked(...fingerprints: string[]): Report {
  return reportWithFindings(fingerprints.map((fp) => blocking(fp)));
}

describe('compareQualityGates', () => {
  it('reports a fix round that unblocked the release', () => {
    const diff = compareQualityGates(blocked('a', 'b'), clean());
    expect(diff.before.ship).toBe(false);
    expect(diff.after.ship).toBe(true);
    expect(diff.shipChanged).toBe(true);
    expect(diff.resolvedBlockers).toEqual(['a', 'b']);
    expect(diff.summary).toContain('Unblocked');
  });

  it('keeps the gate closed when a blocker remains', () => {
    const diff = compareQualityGates(blocked('a', 'b', 'c'), blocked('a'));
    expect(diff.after.ship).toBe(false);
    expect(diff.resolvedBlockers).toEqual(['b', 'c']);
    expect(diff.remainingBlockers).toEqual(['a']);
    expect(diff.summary).toContain('Still blocked');
  });

  it('reports a regression when new blockers appear', () => {
    const diff = compareQualityGates(clean(), blocked('x'));
    expect(diff.shipChanged).toBe(true);
    expect(diff.newBlockers).toEqual(['x']);
    expect(diff.summary).toContain('Regressed');
  });

  it('separates carried-over blockers from new ones', () => {
    const diff = compareQualityGates(blocked('a'), blocked('a', 'b'));
    expect(diff.remainingBlockers).toEqual(['a']);
    expect(diff.newBlockers).toEqual(['b']);
    expect(diff.resolvedBlockers).toEqual([]);
  });

  it('treats a blocker that changed fingerprint as resolved plus new', () => {
    // A finding that moved has a different fingerprint. The gate reports
    // that honestly rather than guessing the two are the same finding.
    const diff = compareQualityGates(blocked('fp-line-10'), blocked('fp-line-20'));
    expect(diff.resolvedBlockers).toEqual(['fp-line-10']);
    expect(diff.newBlockers).toEqual(['fp-line-20']);
    expect(diff.remainingBlockers).toEqual([]);
  });

  it('is quiet when nothing was blocking on either side', () => {
    const diff = compareQualityGates(clean(), clean());
    expect(diff.shipChanged).toBe(false);
    expect(diff.summary).toContain('no blockers');
  });

  it('says so when blockers were replaced rather than carried over', () => {
    const diff = compareQualityGates(blocked('a'), blocked('b'));
    expect(diff.summary).toContain('none carried over');
  });

  it('sorts every fingerprint list', () => {
    const diff = compareQualityGates(blocked('z', 'a', 'm'), clean());
    expect(diff.resolvedBlockers).toEqual(['a', 'm', 'z']);
  });

  it('is deterministic', () => {
    const first = compareQualityGates(blocked('a', 'b'), blocked('b'));
    const second = compareQualityGates(blocked('a', 'b'), blocked('b'));
    expect(first).toEqual(second);
  });

  it('carries the contract status and counts on both sides', () => {
    const diff = compareQualityGates(blocked('a'), clean());
    expect(diff.before.status).toBe('blocked');
    expect(diff.before.blockers).toBeGreaterThan(0);
    expect(diff.after.status).toBe('pass');
    expect(diff.after.blockers).toBe(0);
  });
});
