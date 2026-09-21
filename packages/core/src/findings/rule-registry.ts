/**
 * Rule registry.
 *
 * The analyzers emit stable slugs (`doc-license`, `repro-no-ci`). This
 * table maps those slugs onto the public rule identifiers the quality
 * gate reports, and records three things per rule:
 *
 *   1. `evidenceSource` — where the evidence comes from. Declared here,
 *      once, rather than at the thirty-odd evidence literals scattered
 *      through the analyzers: a rule's source is a property of the rule.
 *   2. `confidence` — how certain the detection method is. A property of
 *      the method, NOT of an LLM's opinion, so it is hard-coded and
 *      fully reproducible.
 *   3. `verification` — how to check the fix mechanically, so re-audit
 *      can decide "is this gone?" without asking a model.
 *
 * Unmapped slugs are surfaced as `UNMAPPED-<SLUG>` rather than silently
 * passed through: a new analyzer finding should show up as a visible gap,
 * not as an anonymous rule.
 */
import {
  RuleConfidence,
  type EvidenceOrigin,
  type Verification,
} from '../schemas/report.js';

export interface RuleDefinition {
  ruleId: string;
  /** Where this rule's evidence comes from. */
  evidenceSource: EvidenceOrigin;
  /** 0..1, derived from the detection method. Never LLM-assigned. */
  confidence: number;
  /** Machine-checkable fix condition, or null when not expressible. */
  verification: Verification | null;
}

function verify(
  kind: Verification['kind'],
  target: string,
  note?: string
): Verification {
  return { kind, target, expected: null, note: note ?? null };
}

function rule(
  ruleId: string,
  evidenceSource: EvidenceOrigin,
  confidence: number,
  verification: Verification | null = null
): RuleDefinition {
  return { ruleId, evidenceSource, confidence, verification };
}

const EXACT = RuleConfidence.exact;
const STRUCTURAL = RuleConfidence.structural;
const HEURISTIC = RuleConfidence.heuristic;

/** Slugs that map to exactly one rule. */
const EXACT_MATCH: Record<string, RuleDefinition> = {
  // ---- Repository hygiene ----------------------------------------------
  'doc-readme': rule('REPO-README-001', 'file_tree', EXACT, verify('file_present', 'README.md')),
  'doc-readme-short': rule('REPO-README-002', 'file', EXACT),
  'doc-license': rule('REPO-LICENSE-001', 'file_tree', EXACT, verify('file_present', 'LICENSE')),
  'doc-contributing': rule(
    'REPO-CONTRIBUTING-001',
    'file_tree',
    EXACT,
    verify('file_present', 'CONTRIBUTING.md')
  ),
  'doc-coc': rule('REPO-COC-001', 'file_tree', EXACT, verify('file_present', 'CODE_OF_CONDUCT.md')),
  'doc-security': rule('REPO-SECURITY-001', 'file_tree', EXACT, verify('file_present', 'SECURITY.md')),
  'doc-changelog': rule('REPO-CHANGELOG-001', 'file_tree', EXACT, verify('file_present', 'CHANGELOG.md')),
  'doc-api': rule('REPO-APIDOCS-001', 'file_tree', EXACT),
  'doc-env-example': rule(
    'REPO-ENVEXAMPLE-001',
    'file_tree',
    EXACT,
    verify('file_present', '.env.example', 'and .env must be listed in .gitignore')
  ),
  'repo-no-gitignore': rule(
    'REPO-GITIGNORE-001',
    'file_tree',
    EXACT,
    verify('file_present', '.gitignore')
  ),
  // Security, but it reads .gitignore, so it sits with the .env rules.
  'env-not-ignored': rule('SEC-ENV-002', 'text_match', EXACT),

  // ---- CI / testing / build --------------------------------------------
  'repro-no-ci': rule(
    'CI-001',
    'workflow',
    EXACT,
    verify('file_present', '.github/workflows', 'a workflow file that runs install + test')
  ),
  'repro-no-test-script': rule(
    'TEST-002',
    'dependency_manifest',
    EXACT,
    verify('manifest_field', 'package.json#scripts.test')
  ),
  'test-no-runner': rule('TEST-001', 'dependency_manifest', STRUCTURAL),
  'repro-no-run-script': rule(
    'BUILD-002',
    'dependency_manifest',
    EXACT,
    verify('manifest_field', 'package.json#scripts.start')
  ),
  'repro-no-scripts': rule(
    'BUILD-003',
    'dependency_manifest',
    EXACT,
    verify('manifest_field', 'package.json#scripts')
  ),
  'repro-no-docker': rule('BUILD-001', 'file_tree', EXACT, verify('file_present', 'Dockerfile')),

  // ---- Dependencies ----------------------------------------------------
  'repro-no-lockfile': rule(
    'DEP-LOCKFILE-001',
    'file_tree',
    EXACT,
    verify('file_present', 'pnpm-lock.yaml', 'or another committed lockfile')
  ),
  'repro-pkg-invalid': rule('DEP-MANIFEST-001', 'dependency_manifest', STRUCTURAL),
  'repro-py-no-requirements': rule(
    'DEP-MANIFEST-002',
    'dependency_manifest',
    EXACT,
    verify('file_present', 'requirements.txt')
  ),

  // ---- Web3 (engineering completeness only, not a contract audit) ------
  'web3-no-contract-tests': rule('TEST-003', 'file_tree', EXACT),
  'web3-no-audit-note': rule('WEB3-AUDIT-001', 'file_tree', EXACT),
  'web3-no-chain-config': rule('WEB3-CHAIN-001', 'text_match', EXACT),
  'web3-no-deploy-script': rule('WEB3-DEPLOY-001', 'file_tree', EXACT),

  // ---- Hackathon target ------------------------------------------------
  'hack-no-demo': rule('HACK-DEMO-001', 'text_match', EXACT),
  'hack-no-video': rule('HACK-VIDEO-001', 'text_match', EXACT),
  'hack-no-architecture': rule('HACK-ARCH-001', 'text_match', EXACT),
  'hack-no-screenshots': rule('HACK-SHOT-001', 'file_tree', EXACT),
  'hack-no-license': rule('HACK-LICENSE-001', 'file_tree', EXACT, verify('file_present', 'LICENSE')),
  'hack-no-chain': rule('HACK-CHAIN-001', 'text_match', EXACT),
  'hack-no-social': rule('HACK-SOCIAL-001', 'text_match', EXACT),
};

/**
 * Slugs that embed a location and therefore vary per hit.
 * Matching is by prefix, longest first.
 */
const PREFIX_MATCH: Array<{ prefix: string; def: RuleDefinition }> = [
  {
    prefix: 'doc-readme-section-',
    def: rule('REPO-README-003', 'text_match', EXACT, verify('text_present', 'README.md')),
  },
  {
    // `secret-<kind>-<line>-<file>` — an exact regex hit inside a file.
    prefix: 'secret-',
    def: rule('SEC-SECRET-001', 'text_match', EXACT),
  },
  {
    // `secret-history-<kind>-<sha>-<file>` — found in a commit diff.
    // Longer than `secret-`, so the longest-prefix rule picks this one.
    prefix: 'secret-history-',
    def: rule('SEC-HISTORY-001', 'git_history', EXACT),
  },
  {
    // `injection-<file>` — keyword matcher + invisible-unicode detector.
    prefix: 'injection-',
    def: rule('SEC-INJECTION-001', 'text_match', HEURISTIC),
  },
  {
    // `env-committed-<file>` — a .env present in the tracked tree.
    prefix: 'env-committed-',
    def: rule('SEC-ENV-001', 'file_tree', EXACT),
  },
  {
    // `ci-workflow-invalid-<path>` — a workflow that cannot run.
    prefix: 'ci-workflow-invalid-',
    def: rule('CI-002', 'workflow', EXACT),
  },
  {
    // `ai-placeholder-return-<file>-<line>` — a name promising a check,
    // a body returning a constant.
    prefix: 'ai-placeholder-return-',
    def: rule('AI-PLACEHOLDER-001', 'text_match', EXACT),
  },
  {
    // `ai-empty-catch-<file>-<line>`
    prefix: 'ai-empty-catch-',
    def: rule('AI-CATCH-001', 'text_match', EXACT),
  },
  {
    // `ai-mock-in-production-<file>`
    prefix: 'ai-mock-in-production-',
    def: rule('AI-MOCK-001', 'text_match', EXACT),
  },
  {
    // `ai-todo-in-implementation-<file>-<line>`
    prefix: 'ai-todo-in-implementation-',
    def: rule('AI-TODO-001', 'text_match', EXACT),
  },
  {
    // `ai-duplicated-block-<file>-<line>` — similarity, not equality of
    // meaning, so this one is heuristic rather than exact.
    prefix: 'ai-duplicated-block-',
    def: rule('AI-DUP-001', 'text_match', HEURISTIC),
  },
];

/**
 * Rules that have no analyzer yet. Declared here so their identifiers are
 * reserved and the roadmap is visible in code rather than only in docs.
 */
export const PLANNED_RULES = {
  // Private keys are already covered by SEC-SECRET-001's `private_key`
  // pattern, so there is no separate SEC-KEY-001: two ids for one check
  // would just make the contract harder to write.
  'DEP-ADVISORY-001': 'a dependency with a published advisory',
} as const;

export function ruleFor(findingId: string): RuleDefinition {
  const exact = EXACT_MATCH[findingId];
  if (exact) return exact;

  let best: RuleDefinition | null = null;
  let bestLength = -1;
  for (const { prefix, def } of PREFIX_MATCH) {
    if (findingId.startsWith(prefix) && prefix.length > bestLength) {
      best = def;
      bestLength = prefix.length;
    }
  }
  if (best) return best;

  return {
    ruleId: `UNMAPPED-${findingId.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    evidenceSource: 'file',
    confidence: EXACT,
    verification: null,
  };
}

/** Every rule id this build can emit, mapped or not. Used by tests and docs. */
export function knownRuleIds(): string[] {
  const ids = new Set<string>();
  for (const def of Object.values(EXACT_MATCH)) ids.add(def.ruleId);
  for (const { def } of PREFIX_MATCH) ids.add(def.ruleId);
  for (const id of Object.keys(PLANNED_RULES)) ids.add(id);
  return [...ids].sort();
}
