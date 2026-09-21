/**
 * Finding enrichment.
 *
 * One pass that fills what the analyzers do not know about:
 *
 *   - `ruleId`, `confidence`, `verification` come from the rule registry.
 *   - each evidence entry's `source` defaults to the rule's declared
 *     origin, unless the analyzer set one explicitly (which wins).
 *   - `fingerprint` is derived from the rule id plus evidence locations.
 *
 * `ReportBuilder` is the only caller. Everything downstream — fix plans,
 * diffs, the quality contract, MCP — reads the enriched output, so this
 * is the single place where a finding acquires its identity.
 */
import type { Finding } from '../schemas/report.js';
import { findingFingerprint } from './fingerprint.js';
import { ruleFor } from './rule-registry.js';

export function enrichFinding(finding: Finding): Finding {
  const def = ruleFor(finding.id);

  const evidence = finding.evidence.map((e) => ({
    ...e,
    source: e.source ?? def.evidenceSource,
  }));

  return {
    ...finding,
    ruleId: def.ruleId,
    confidence: def.confidence,
    verification: def.verification,
    evidence,
    fingerprint: findingFingerprint({
      ruleId: def.ruleId,
      evidence,
    }),
  };
}

export function enrichFindings(findings: Finding[]): Finding[] {
  return findings.map(enrichFinding);
}
