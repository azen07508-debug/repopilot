import { describe, expect, it } from 'vitest';
import { FindingSchema, RuleConfidence, type Finding } from '../schemas/report.js';
import { enrichFinding, enrichFindings } from './enrich.js';
import { findingFingerprint, fingerprintOf } from './fingerprint.js';
import { knownRuleIds, ruleFor } from './rule-registry.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'doc-license',
    ruleId: 'UNMAPPED',
    fingerprint: '',
    category: 'documentation',
    severity: 'high',
    confidence: 1,
    title: 'LICENSE is missing',
    description: 'No LICENSE file at the repository root.',
    // No `source`: analyzers do not set it, enrichment does.
    evidence: [{ file: 'README.md', line: null, reason: 'no LICENSE' }],
    recommendedAction: 'Add a LICENSE file.',
    verification: null,
    acceptanceCriteria: ['LICENSE exists.'],
    ...overrides,
  };
}

describe('fingerprintOf', () => {
  it('is deterministic', () => {
    expect(fingerprintOf('abc')).toBe(fingerprintOf('abc'));
  });

  it('produces 16 hex characters', () => {
    expect(fingerprintOf('abc')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates inputs that differ by one character', () => {
    expect(fingerprintOf('abc')).not.toBe(fingerprintOf('abd'));
  });

  it('separates empty string from a single null byte', () => {
    // Guards the seed separator: '' and '\u0000' must not collide.
    expect(fingerprintOf('')).not.toBe(fingerprintOf('\u0000'));
  });
});

describe('findingFingerprint', () => {
  const base = { ruleId: 'SEC-SECRET-001' };

  it('is stable for the same rule and location', () => {
    const a = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 10 }] });
    const b = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 10 }] });
    expect(a).toBe(b);
  });

  it('ignores the order evidence is emitted in', () => {
    const a = findingFingerprint({
      ...base,
      evidence: [
        { file: 'src/a.ts', line: 10 },
        { file: 'src/b.ts', line: 4 },
      ],
    });
    const b = findingFingerprint({
      ...base,
      evidence: [
        { file: 'src/b.ts', line: 4 },
        { file: 'src/a.ts', line: 10 },
      ],
    });
    expect(a).toBe(b);
  });

  it('differs for the same rule at different locations', () => {
    const a = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 10 }] });
    const b = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 11 }] });
    expect(a).not.toBe(b);
  });

  it('differs for different rules at the same location', () => {
    const a = findingFingerprint({ ruleId: 'SEC-SECRET-001', evidence: [{ file: 'src/a.ts', line: 10 }] });
    const b = findingFingerprint({ ruleId: 'SEC-KEY-001', evidence: [{ file: 'src/a.ts', line: 10 }] });
    expect(a).not.toBe(b);
  });

  it('treats a null line as a location of its own', () => {
    const a = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: null }] });
    const b = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 1 }] });
    expect(a).not.toBe(b);
  });

  it('changes when a line number shifts — documented behaviour, not an accident', () => {
    const before = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 42 }] });
    const after = findingFingerprint({ ...base, evidence: [{ file: 'src/a.ts', line: 43 }] });
    expect(before).not.toBe(after);
  });
});

describe('ruleFor', () => {
  it('maps a known slug to its public rule id', () => {
    expect(ruleFor('doc-license').ruleId).toBe('REPO-LICENSE-001');
    expect(ruleFor('repro-no-ci').ruleId).toBe('CI-001');
    expect(ruleFor('repro-no-test-script').ruleId).toBe('TEST-002');
  });

  it('matches location-bearing slugs by prefix', () => {
    expect(ruleFor('secret-pattern-42-src-config-js').ruleId).toBe('SEC-SECRET-001');
    expect(ruleFor('injection-src-prompts-md').ruleId).toBe('SEC-INJECTION-001');
    expect(ruleFor('doc-readme-section-install').ruleId).toBe('REPO-README-003');
  });

  it('prefers the longest matching prefix', () => {
    // 'doc-readme-section-' must win over any shorter overlap.
    expect(ruleFor('doc-readme-section-x').ruleId).toBe('REPO-README-003');
  });

  it('surfaces unknown slugs instead of hiding them', () => {
    const def = ruleFor('brand-new-thing');
    expect(def.ruleId).toBe('UNMAPPED-BRAND-NEW-THING');
  });

  it('assigns confidence from the detection method, not from a model', () => {
    // Exact: file presence.
    expect(ruleFor('doc-license').confidence).toBe(RuleConfidence.exact);
    // Structural: manifest parsing.
    expect(ruleFor('repro-pkg-invalid').confidence).toBe(RuleConfidence.structural);
    // Heuristic: keyword + invisible-unicode matching.
    expect(ruleFor('injection-src-x').confidence).toBe(RuleConfidence.heuristic);
  });

  it('gives machine-checkable verification where one exists', () => {
    expect(ruleFor('doc-license').verification).toEqual({
      kind: 'file_present',
      target: 'LICENSE',
      expected: null,
      note: null,
    });
    expect(ruleFor('repro-no-ci').verification?.kind).toBe('file_present');
    expect(ruleFor('repro-no-test-script').verification?.kind).toBe('manifest_field');
  });

  it('never claims a machine check it cannot perform', () => {
    // A secret can only be proven gone by reading history, which is a
    // different rule (SEC-HISTORY-001). Do not pretend otherwise.
    expect(ruleFor('secret-pattern-1-a-ts').verification).toBeNull();
  });

  it('reserves identifiers for rules that are not implemented yet', () => {
    const ids = knownRuleIds();
    expect(ids).toContain('SEC-HISTORY-001');
    expect(ids).toContain('AI-PLACEHOLDER-001');
  });
});

describe('enrichFinding', () => {
  it('fills ruleId, confidence, verification and fingerprint', () => {
    const out = enrichFinding(finding());
    expect(out.ruleId).toBe('REPO-LICENSE-001');
    expect(out.confidence).toBe(1);
    expect(out.verification?.kind).toBe('file_present');
    expect(out.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is idempotent', () => {
    const once = enrichFinding(finding());
    const twice = enrichFinding(once);
    expect(twice).toEqual(once);
  });

  it('produces the same fingerprint for the same input twice', () => {
    expect(enrichFinding(finding()).fingerprint).toBe(enrichFinding(finding()).fingerprint);
  });

  it('produces different fingerprints for the same rule in different files', () => {
    const a = enrichFinding(
      finding({
        id: 'secret-pattern-1-src-a-ts',
        evidence: [{ file: 'src/a.ts', line: 1, reason: 'r', source: 'text_match', excerpt: null, reproducible: true }],
      })
    );
    const b = enrichFinding(
      finding({
        id: 'secret-pattern-1-src-b-ts',
        evidence: [{ file: 'src/b.ts', line: 1, reason: 'r', source: 'text_match', excerpt: null, reproducible: true }],
      })
    );
    expect(a.ruleId).toBe(b.ruleId);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('fills each evidence entry with the rule declared origin', () => {
    expect(enrichFinding(finding({ id: 'doc-license' })).evidence[0]?.source).toBe('file_tree');
    expect(enrichFinding(finding({ id: 'repro-no-ci' })).evidence[0]?.source).toBe('workflow');
    expect(enrichFinding(finding({ id: 'repro-no-test-script' })).evidence[0]?.source).toBe(
      'dependency_manifest'
    );
  });

  it('lets an analyzer override the declared origin', () => {
    const out = enrichFinding(
      finding({
        id: 'doc-license',
        evidence: [{ file: 'LICENSE', line: null, reason: 'r', source: 'github_api' }],
      })
    );
    expect(out.evidence[0]?.source).toBe('github_api');
  });

  it('does not mutate its input', () => {
    const input = finding();
    const snapshot = JSON.parse(JSON.stringify(input)) as Finding;
    enrichFinding(input);
    expect(input).toEqual(snapshot);
  });

  it('enriches a list without dropping or reordering', () => {
    const list = [finding({ id: 'doc-readme' }), finding({ id: 'doc-license' })];
    const out = enrichFindings(list);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.id)).toEqual(['doc-readme', 'doc-license']);
  });
});

describe('backwards compatibility', () => {
  it('parses a finding written before the new fields existed', () => {
    // This is the shape every report in the database has today.
    const legacy = {
      id: 'doc-license',
      category: 'documentation',
      severity: 'high',
      title: 'LICENSE is missing',
      description: 'No LICENSE file.',
      evidence: [{ file: 'README.md', line: null, reason: 'no LICENSE' }],
      recommendedAction: 'Add a LICENSE file.',
      acceptanceCriteria: ['LICENSE exists.'],
    };
    const parsed = FindingSchema.parse(legacy);
    // Absent, not defaulted: enrichment is what gives a finding its
    // identity, and an un-enriched finding must not pretend otherwise.
    expect(parsed.ruleId).toBeUndefined();
    expect(parsed.fingerprint).toBeUndefined();
    expect(parsed.confidence).toBeUndefined();
    expect(parsed.verification).toBeUndefined();
    // Evidence keeps its old shape too. The new fields stay absent until
    // enrichment runs, so an old report round-trips unchanged.
    expect(parsed.evidence[0]?.source).toBeUndefined();
    expect(parsed.evidence[0]?.excerpt).toBeUndefined();
    expect(parsed.evidence[0]?.reproducible).toBeUndefined();
  });

  it('rejects an evidence source that is not in the enum', () => {
    const bad = {
      ...finding(),
      evidence: [{ file: 'a.ts', line: 1, reason: 'r', source: 'local_git', excerpt: null, reproducible: true }],
    };
    expect(() => FindingSchema.parse(bad)).toThrow();
  });
});
