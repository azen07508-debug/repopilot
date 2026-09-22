/**
 * Scoring engine.
 *
 * Scores are *deterministic* and *explainable*. Every score is a `ScoreBreakdown`
 * that records the base, every applied rule, and the final value. LLM output
 * is NEVER used to compute scores — only to format summaries around them.
 */
import type { Finding, ScoreBreakdown, Scores, Severity } from '../schemas/report.js';
import { ruleIdOf } from '../findings/fingerprint.js';

export interface ScoringInput {
  hasReadme: boolean;
  hasLicense: boolean;
  hasContributing: boolean;
  hasSecurityPolicy: boolean;
  hasEnvExample: boolean;
  hasApiDocs: boolean;
  hasScreenshots: boolean;
  hasDemoUrl: boolean;
  hasLockfile: boolean;
  hasCI: boolean;
  hasDocker: boolean;
  hasTestCommand: boolean;
  hasRunCommand: boolean;
  hasContracts: boolean;
  hasDeployScripts: boolean;
  hasContractTests: boolean;
  hasAuditNote: boolean;
  hasContractAddresses: boolean;
  hasHackathonDemoUrl: boolean;
  hasHackathonDemoVideo: boolean;
  hasHackathonArchitecture: boolean;
  hasHackathonLicense: boolean;
  hasHackathonNetwork: boolean;
  securityFindings: Finding[];
  documentationFindings: Finding[];
  reproducibilityFindings: Finding[];
  deploymentFindings: Finding[];
  web3Findings: Finding[];
  hackathonFindings: Finding[];
}

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 1.5,
};

/**
 * The most findings one `(file, ruleId)` pair may contribute.
 *
 * A lockfile is mostly `sha512-` integrity digests, which are high-entropy
 * by construction and so match the generic secret heuristic. Those hits are
 * real findings and stay in `securityFindings` — `severityForPath`
 * downgrades rather than drops them — but one file can hold hundreds, and
 * an uncapped sum lets a single generated file zero a whole dimension.
 *
 * Three is where a pair stops carrying new information: a fourth identical
 * hit in the same file under the same rule tells you nothing the third did
 * not. The cap is per pair, so breadth is still punished in full — a
 * hundred secrets in a hundred files still costs a hundred penalties, and
 * only repetition *inside* one file is bounded.
 */
const MAX_PER_GROUP = 3;

interface SeverityPenalty {
  /** Penalty in points, as a positive number, after the per-pair cap. */
  penalty: number;
  /** True finding count, for the `count > 0` gate and the reason text. */
  count: number;
  /** Findings the cap did not count, so the reason can say why. */
  dropped: number;
}

function severityPenalty(findings: Finding[]): SeverityPenalty {
  const groups = new Map<string, number[]>();
  for (const f of findings) {
    // Keyed by the resolved rule id, never by `id`: a finding's `id` embeds
    // its line number, so keying on it would put every hit in a group of
    // its own and the cap would never apply to the case that needs it.
    const key = `${f.evidence[0]?.file ?? ''}\u0000${ruleIdOf(f)}`;
    const list = groups.get(key);
    if (list) list.push(SEVERITY_PENALTY[f.severity] ?? 0);
    else groups.set(key, [SEVERITY_PENALTY[f.severity] ?? 0]);
  }

  let penalty = 0;
  let dropped = 0;
  for (const list of groups.values()) {
    // Worst first, so the cap keeps a pair's most serious hits.
    list.sort((a, b) => b - a);
    const counted = Math.min(list.length, MAX_PER_GROUP);
    for (let i = 0; i < counted; i++) penalty += list[i] ?? 0;
    dropped += list.length - counted;
  }

  return { penalty, count: findings.length, dropped };
}

function penaltyReason(count: number, dropped: number, dimension: string): string {
  const base = `Penalty from ${count} ${dimension} finding(s)`;
  return dropped > 0
    ? `${base}; at most ${MAX_PER_GROUP} counted per file and rule`
    : base;
}

const TARGET = process.env['SCORING_TARGET'] as
  | 'hackathon'
  | 'open_source'
  | 'production'
  | undefined;

function applyRules(
  base: number,
  rules: { when: boolean; delta: number; rule: string; reason: string }[]
): ScoreBreakdown {
  let score = base;
  const applied = rules.map((r) => {
    if (r.when) score += r.delta;
    return { rule: r.rule, delta: r.when ? r.delta : 0, reason: r.reason };
  });
  return { raw: base, rules: applied, final: clamp(score, 0, 100) };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

export function scoreDocumentation(input: ScoringInput): ScoreBreakdown {
  const base = 100;
  const { penalty, count, dropped } = severityPenalty(input.documentationFindings);
  return applyRules(base, [
    { when: !input.hasReadme, delta: -25, rule: 'no-readme', reason: 'README.md is missing' },
    { when: !input.hasLicense, delta: -8, rule: 'no-license', reason: 'LICENSE is missing' },
    { when: !input.hasContributing, delta: -2, rule: 'no-contributing', reason: 'CONTRIBUTING missing' },
    { when: !input.hasSecurityPolicy, delta: -5, rule: 'no-security', reason: 'SECURITY policy missing' },
    { when: !input.hasEnvExample, delta: -5, rule: 'no-env-example', reason: '.env.example missing' },
    { when: !input.hasApiDocs, delta: -3, rule: 'no-api-docs', reason: 'API docs missing' },
    { when: !input.hasScreenshots, delta: -1, rule: 'no-screenshots', reason: 'No screenshots in repo' },
    { when: !input.hasDemoUrl, delta: -2, rule: 'no-demo-url', reason: 'No demo URL in README' },
    {
      when: count > 0,
      delta: -penalty,
      rule: 'severity-penalty',
      reason: penaltyReason(count, dropped, 'documentation'),
    },
  ]);
}

export function scoreReproducibility(input: ScoringInput): ScoreBreakdown {
  const base = 100;
  const { penalty, count, dropped } = severityPenalty(input.reproducibilityFindings);
  return applyRules(base, [
    { when: !input.hasLockfile, delta: -20, rule: 'no-lockfile', reason: 'No lockfile' },
    { when: !input.hasCI, delta: -12, rule: 'no-ci', reason: 'No CI configuration' },
    { when: !input.hasDocker, delta: -4, rule: 'no-docker', reason: 'No Dockerfile' },
    { when: !input.hasEnvExample, delta: -6, rule: 'no-env-example', reason: '.env.example missing' },
    { when: !input.hasTestCommand, delta: -10, rule: 'no-test-script', reason: 'No test script' },
    { when: !input.hasRunCommand, delta: -6, rule: 'no-run-script', reason: 'No dev/start script' },
    {
      when: count > 0,
      delta: -penalty,
      rule: 'severity-penalty',
      reason: penaltyReason(count, dropped, 'reproducibility'),
    },
  ]);
}

export function scoreSecurityHygiene(input: ScoringInput): ScoreBreakdown {
  const base = 100;
  const { penalty, count, dropped } = severityPenalty(input.securityFindings);
  return applyRules(base, [
    {
      when: count > 0,
      delta: -penalty,
      rule: 'severity-penalty',
      reason: penaltyReason(count, dropped, 'security'),
    },
  ]);
}

export function scoreDeploymentReadiness(input: ScoringInput): ScoreBreakdown {
  const base = 100;
  const { penalty, count, dropped } = severityPenalty(input.deploymentFindings);
  const rules = [
    { when: !input.hasDocker, delta: -10, rule: 'no-docker', reason: 'No Dockerfile for prod parity' },
    { when: !input.hasCI, delta: -10, rule: 'no-ci', reason: 'No CI to gate releases' },
    { when: !input.hasEnvExample, delta: -5, rule: 'no-env-example', reason: '.env.example missing' },
    { when: !input.hasTestCommand, delta: -5, rule: 'no-test-script', reason: 'No canonical test command' },
    {
      when: input.hasContracts && !input.hasDeployScripts,
      delta: -15,
      rule: 'web3-no-deploy',
      reason: 'Contracts present but no deploy script',
    },
    {
      when: input.hasContracts && !input.hasContractTests,
      delta: -15,
      rule: 'web3-no-tests',
      reason: 'Contracts present but no contract tests',
    },
    {
      when: input.hasContracts && !input.hasAuditNote,
      delta: -3,
      rule: 'web3-no-audit-note',
      reason: 'No audit status documented',
    },
    {
      when: count > 0,
      delta: -penalty,
      rule: 'severity-penalty',
      reason: penaltyReason(count, dropped, 'deployment'),
    },
  ];
  return applyRules(base, rules);
}

export interface ScoreAllOptions {
  target?: 'hackathon' | 'open_source' | 'production';
  /** If true, boost the documentation score for hackathon submissions that have a demo. */
  hackathonBoost?: boolean;
}

export function scoreAll(input: ScoringInput, opts: ScoreAllOptions = {}): Scores {
  const target = opts.target ?? TARGET ?? 'open_source';
  const doc = scoreDocumentation(input);
  const repro = scoreReproducibility(input);
  const sec = scoreSecurityHygiene(input);
  const deploy = scoreDeploymentReadiness(input);

  // Overall is a weighted average. Weights shift by target.
  const weights = (() => {
    switch (target) {
      case 'hackathon':
        return { documentation: 0.2, reproducibility: 0.2, securityHygiene: 0.25, deploymentReadiness: 0.35 };
      case 'production':
        return { documentation: 0.15, reproducibility: 0.25, securityHygiene: 0.4, deploymentReadiness: 0.2 };
      case 'open_source':
      default:
        return { documentation: 0.3, reproducibility: 0.3, securityHygiene: 0.25, deploymentReadiness: 0.15 };
    }
  })();

  // Hackathon boost: small bonus if demo + video + license are present
  let hackathonBoost = 0;
  if (target === 'hackathon') {
    hackathonBoost =
      (input.hasHackathonDemoUrl ? 2 : 0) +
      (input.hasHackathonDemoVideo ? 2 : 0) +
      (input.hasHackathonArchitecture ? 1 : 0) +
      (input.hasHackathonLicense ? 1 : 0) +
      (input.hasHackathonNetwork ? 1 : 0);
  }

  const overallRaw =
    doc.final * weights.documentation +
    repro.final * weights.reproducibility +
    sec.final * weights.securityHygiene +
    deploy.final * weights.deploymentReadiness;

  const overall = clamp(overallRaw + hackathonBoost, 0, 100);

  return {
    overall,
    documentation: doc.final,
    reproducibility: repro.final,
    securityHygiene: sec.final,
    deploymentReadiness: deploy.final,
    breakdown: {
      documentation: doc,
      reproducibility: repro,
      securityHygiene: sec,
      deploymentReadiness: deploy,
    },
  };
}
