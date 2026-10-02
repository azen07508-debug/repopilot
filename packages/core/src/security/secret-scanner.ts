/**
 * Secret / credential hygiene analyzer.
 *
 * RepoPilot treats every match as TEXT — it NEVER prints the actual value
 * it suspects. Every finding exposes:
 *   - file path,
 *   - line number,
 *   - secret kind (api_key | private_key | mnemonic | jwt | db_url | cloud_cred | generic_token),
 *   - short, low-entropy reason string (NOT the secret itself).
 */
import type { Evidence, Finding, Severity } from '../schemas/report.js';
import { BIP39_ENGLISH, BIP39_VALID_LENGTHS } from './bip39-english.js';
import { slugify } from './security-slug.js';
import { severityForPath } from './severity.js';

export type SecretKind =
  | 'private_key'
  | 'mnemonic'
  | 'aws_access_key'
  | 'aws_secret_key'
  | 'github_pat'
  | 'slack_token'
  | 'stripe_live_key'
  | 'stripe_test_key'
  | 'google_api_key'
  | 'openai_api_key'
  | 'anthropic_api_key'
  | 'jwt'
  | 'db_url'
  | 'generic_high_entropy'
  | 'hardcoded_password';

interface SecretPattern {
  kind: SecretKind;
  /** Regex source. Must capture a value group OR be used as a marker. */
  pattern: RegExp;
  severity: Severity;
  reason: string;
  /**
   * Optional second gate.
   *
   * A regex can only assert "this shape looks like a credential". For the
   * vendor patterns that is enough — `ghp_` followed by 36 base62 chars is
   * not anything else. For a *heuristic* it is not enough: the shape is
   * shared with ordinary text, so the match has to survive a content check
   * before it is allowed to become a finding.
   */
  validate?: (match: string) => boolean;
}

const PATTERNS: SecretPattern[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    severity: 'critical',
    reason: 'Embedded private-key block',
  },
  {
    kind: 'mnemonic',
    // Candidate shape only: a run of 12-24 lowercase words. This regex
    // cannot tell a seed phrase from a sentence, so it must never be the
    // last word — `validate` decides.
    pattern: /\b(?:[a-z]{3,12}\s){11,23}[a-z]{3,12}\b/,
    severity: 'critical',
    reason: 'Possible BIP-39 mnemonic phrase (every word is in the BIP-39 list)',
    validate: isBip39Phrase,
  },
  {
    kind: 'aws_access_key',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/,
    severity: 'critical',
    reason: 'AWS access key ID pattern',
  },
  {
    kind: 'aws_secret_key',
    pattern: /aws(?:_secret)?_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i,
    severity: 'critical',
    reason: 'AWS secret access key assignment',
  },
  {
    kind: 'github_pat',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    severity: 'high',
    reason: 'GitHub personal access token (gh*_…)',
  },
  {
    kind: 'github_pat',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
    severity: 'high',
    reason: 'GitHub fine-grained PAT (github_pat_…)',
  },
  {
    kind: 'slack_token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    severity: 'high',
    reason: 'Slack token pattern (xox*…)',
  },
  {
    kind: 'stripe_live_key',
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/,
    severity: 'critical',
    reason: 'Stripe live secret key',
  },
  {
    kind: 'stripe_test_key',
    pattern: /\bsk_test_[A-Za-z0-9]{24,}\b/,
    severity: 'medium',
    reason: 'Stripe test secret key (still a secret if committed)',
  },
  {
    kind: 'google_api_key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: 'high',
    reason: 'Google API key',
  },
  {
    kind: 'openai_api_key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/,
    severity: 'high',
    reason: 'OpenAI API key',
  },
  {
    kind: 'anthropic_api_key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    severity: 'high',
    reason: 'Anthropic API key',
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    severity: 'medium',
    reason: 'JSON Web Token (3 base64url segments)',
  },
  {
    kind: 'db_url',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]*:[^\s'"<>]+@[^\s'"<>]+/,
    severity: 'critical',
    reason: 'Database connection string with embedded password',
  },
  {
    kind: 'hardcoded_password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    severity: 'high',
    reason: 'Hardcoded password assignment',
  },
];

const ALLOWLIST_FILES = new Set(['.env.example', 'example.env', 'sample.env']);

/**
 * Kinds that are always the template inside an allowlisted placeholder
 * file.
 *
 * A `.env.example` exists to show the SHAPE of a connection string or a
 * password field. Reporting those as critical buries the findings that
 * matter — a real run against a repository whose only sin was a
 * well-written .env.example produced 547 blockers, which makes the gate
 * useless. Token-shaped patterns still apply here, because a private key
 * or a cloud key is never a template.
 */
const TEMPLATE_ONLY_KINDS = new Set<SecretKind>(['db_url', 'hardcoded_password']);

/**
 * Paths whose job is to contain fake credentials.
 *
 * A secret scanner's own test suite has to hold realistic-looking keys to
 * prove it detects them; so do sample apps and fixtures. A real run
 * against a repository whose only sin was testing its own scanner
 * reported 542 live credentials.
 */
// Moved to security/severity.ts so the AI-pattern rules and the quality
// contract can reach it without importing the secret scanner.
export { isFixturePath, severityForPath } from './severity.js';

/**
 * A connection string aimed at localhost, or one whose password is
 * literally the word "password", is documentation rather than a
 * credential. A leaked URL points at a real host and carries a password
 * that does not spell itself out.
 */
function looksLikePlaceholderDbUrl(match: string): boolean {
  const lower = match.toLowerCase();
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return true;

  // Docker Compose and Compose-style local stacks address each other by
  // service name, so `@db:5432` is a container link rather than a public
  // host. A real leaked URL does not point at a service called `db`.
  if (
    /@(?:db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|host):\d+/i.test(match)
  ) {
    return true;
  }

  return /:\/\/[^:@/]*:(?:password|passwd|pass|secret|changeme|change[_-]me|your[-_]?password)@/i.test(
    match
  );
}

/**
 * Substrings that mark a value as a deliberate placeholder.
 *
 * Kept as substrings rather than whole-word matches on purpose: a sample
 * token is usually embedded in something longer (`your-key-here`,
 * `EXAMPLE_TOKEN_123`).
 */
const SAMPLE_SUBSTRINGS = [
  'example',
  'sample',
  'placeholder',
  'changeme',
  'change-me',
  'change_me',
  'xxxxx',
  '00000',
  '11111',
  'foo',
  'bar',
  'baz',
  '<your',
  '${',
  'process.env',
  'env.get',
];

/**
 * Placeholder shapes that an enumeration always misses one of.
 *
 * `SAMPLE_SUBSTRINGS` carried `your-key` and `your_key` but not
 * `your-password`, so a real audit reported pino's documented
 * `password: 'your-password'` as a hardcoded credential. A pattern covers
 * the family; a list only covers the members someone happened to think of.
 */
const SAMPLE_PATTERNS = [
  /your[-_]?(?:key|token|password|passwd|secret|api|user|name|host|domain|email|account|project|bucket)/i,
  /^<[^>]*>$/,
  /^(?:x{5,}|0{5,}|1{5,})$/i,
];

function looksLikeSample(value: string): boolean {
  const lower = value.toLowerCase();
  if (SAMPLE_SUBSTRINGS.some((k) => lower.includes(k))) return true;
  return SAMPLE_PATTERNS.some((re) => re.test(value));
}

/**
 * True when some run of 12/15/18/21/24 consecutive words is entirely made
 * of BIP-39 words.
 *
 * Checking the whole match is not enough: the regex is greedy, so a real
 * 12-word phrase sitting inside a longer sentence is handed over as a
 * 20-word run and would be rejected. Scanning windows of the valid lengths
 * finds the phrase inside the run.
 *
 * The wordlist is what makes this a detector rather than a filter. Without
 * it the rule was just "twelve lowercase words", and English prose cleared
 * that bar constantly — a real audit of pinojs/pino reported the sentence
 * "chance that objects being logged have properties that conflict with
 * those from pino itself" as a critical seed phrase.
 */
function isBip39Phrase(match: string): boolean {
  const words = match.trim().split(/\s+/);
  for (const len of BIP39_VALID_LENGTHS) {
    if (len > words.length) continue;
    for (let start = 0; start + len <= words.length; start++) {
      let allKnown = true;
      for (let i = start; i < start + len; i++) {
        if (!BIP39_ENGLISH.has(words[i] ?? '')) {
          allKnown = false;
          break;
        }
      }
      if (allKnown) return true;
    }
  }
  return false;
}

/**
 * A URL, so it can be moved out of the entropy heuristic's way.
 *
 * URL paths mix case, digits and separators, which pushes Shannon entropy
 * over any threshold worth naming. A real audit of pinojs/pino turned
 * `com/nodejs/node/blob/main/SECURITY` and
 * `fastify/github-action-merge-dependabot` into suspected API keys.
 *
 * Only the entropy heuristic strips these. The vendor patterns still see
 * the raw line, because a token can genuinely live inside a URL — a
 * lockfile registry entry like `https://svc:ghp_…@npm.example.com` is a
 * real credential and must stay visible.
 */
const URL_RE = /\bhttps?:\/\/[^\s)>\]}"'`]+/gi;

function withoutUrls(line: string): string {
  return line.replace(URL_RE, ' ');
}

/**
 * Integrity digests are not credentials.
 *
 * Lockfiles are mostly `sha512-<base64>` lines. A checksum is *designed*
 * to look random, so every entropy heuristic ever written flags it — one
 * real audit produced 557 findings from a single `pnpm-lock.yaml`, 87% of
 * the whole report. The digests are also public by construction: they are
 * in the lockfile precisely so that anyone can verify them.
 *
 * This stays narrow on purpose. A real credential in a lockfile — a
 * registry token inside a `resolved:` URL — is still reported; it is just
 * not reported as a checksum.
 */
const CHECKSUM_RE = /^(?:sha\d{3}|md5|blake\d?|integrity)[-:]/i;

/**
 * Identifiers and paths are not tokens.
 *
 * `fastify/github-action-merge-dependabot` is a GitHub Actions reference.
 * The entropy heuristic saw a 38-character mixed-case run and called it a
 * suspected API key. Stripping URLs does not help here — there is no
 * scheme — so the candidate itself has to be judged.
 *
 * The discriminator is word structure. A real opaque token is random and
 * does not contain separator-joined dictionary words. Three or more
 * lowercase letters, a `/` or `-`, then three more lowercase letters is
 * the signature of a path segment or a kebab-case name.
 *
 * The cost is bounded: for a 40-character base64url token the chance of
 * containing this shape anywhere is well under 1%, so this trades a
 * negligible number of true positives for the whole class.
 */
const IDENTIFIER_LIKE_RE = /[a-z]{3,}[-/][a-z]{3,}/;

function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const len = s.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / len;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True when a path's basename is a known placeholder file. */
export function isAllowlistedPath(filePath: string): boolean {
  return ALLOWLIST_FILES.has(filePath.split('/').pop() ?? '');
}

export interface SecretScanInput {
  path: string;
  content: string;
}

export interface SecretFindingDraft {
  kind: SecretKind;
  severity: Severity;
  evidence: Evidence[];
  file: string;
}

export interface SecretLineHit {
  kind: SecretKind;
  severity: Severity;
  reason: string;
  /** 1-based line number within the scanned text. */
  line: number;
}

/**
 * Scan a block of text for credential patterns.
 *
 * Shared by the working-tree scanner and the commit-history scanner, so
 * a pattern added here covers both at once. The matched value is never
 * returned, copied or logged — only the kind, severity and a short
 * low-entropy reason.
 *
 * @param allowlist true for files whose contents are expected to hold
 *   placeholders (`.env.example`, fixtures); skips the entropy heuristic
 *   but still applies the explicit patterns.
 */
export function scanTextForSecrets(
  content: string,
  opts: { allowlist?: boolean } = {}
): SecretLineHit[] {
  const isAllowlist = opts.allowlist ?? false;
  const hits: SecretLineHit[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    for (const pat of PATTERNS) {
      const m = pat.pattern.exec(line);
      if (!m) continue;
      if (pat.validate && !pat.validate(m[0])) continue;
      if (looksLikeSample(m[0])) continue;
      if (isAllowlist && TEMPLATE_ONLY_KINDS.has(pat.kind)) continue;
      if (pat.kind === 'db_url' && looksLikePlaceholderDbUrl(m[0])) continue;
      hits.push({ kind: pat.kind, severity: pat.severity, reason: pat.reason, line: i + 1 });
    }

    // Generic high-entropy token heuristic (catch-all for unknown formats).
    //
    // Runs against the line with URLs removed. A URL path is not a
    // credential, and it is the single largest source of false positives
    // this heuristic has.
    if (isAllowlist) continue;
    const entropyMatches =
      withoutUrls(line).match(/['"]?([A-Za-z0-9_\-+/=]{32,})['"]?/g) ?? [];
    for (const token of entropyMatches) {
      const cleaned = token.replace(/^['"]|['"]$/g, '');
      if (looksLikeSample(cleaned)) continue;
      if (CHECKSUM_RE.test(cleaned)) continue;
      if (IDENTIFIER_LIKE_RE.test(cleaned)) continue;
      if (shannonEntropy(cleaned) < 4.0) continue;
      // Avoid double-reporting when a more specific pattern already matched
      // on this line.
      if (hits.some((h) => h.line === i + 1)) continue;
      hits.push({
        kind: 'generic_high_entropy',
        severity: 'medium',
        reason: `High-entropy string (${cleaned.length} chars, H=${shannonEntropy(
          cleaned
        ).toFixed(2)}) — possible API key, token or signing material`,
        line: i + 1,
      });
    }
  }

  return hits;
}

export function scanForSecrets(inputs: SecretScanInput[]): SecretFindingDraft[] {
  const drafts: SecretFindingDraft[] = [];
  for (const { path: filePath, content } of inputs) {
    const allowlist = ALLOWLIST_FILES.has(filePath.split('/').pop() ?? '');
    for (const hit of scanTextForSecrets(content, { allowlist })) {
      drafts.push({
        kind: hit.kind,
        severity: severityForPath(filePath, hit.severity),
        file: filePath,
        evidence: [{ file: filePath, line: hit.line, reason: hit.reason }],
      });
    }
  }
  return drafts;
}

/**
 * Aggregate secret findings into the canonical Finding shape.
 * The actual secret value is never read, copied, or returned.
 */
export function toSecretFindings(
  drafts: SecretFindingDraft[]
): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const d of drafts) {
    const key = `${d.file}::${d.kind}::${d.evidence[0]?.line ?? 0}`;
    const existing = byKey.get(key);
    if (existing) continue;
    const finding: Finding = {
      id: `secret-${d.kind}-${d.evidence[0]?.line ?? 0}-${slugify(d.file)}`,
      category: 'security',
      severity: d.severity,
      title: titleForKind(d.kind),
      description: descriptionForKind(d.kind),
      evidence: d.evidence,
      recommendedAction: recommendedForKind(d.kind),
      acceptanceCriteria: [
        'The detected credential is revoked or rotated at the issuing service.',
        'The file is updated to reference the credential via environment variable or secret manager.',
        'Repository history is audited (e.g. `git log -p`) and the secret is no longer reachable from the current tree.',
      ],
    };
    byKey.set(key, finding);
  }
  return [...byKey.values()];
}

// Re-exported for callers that already import it from this module.
export { slugify };

export function titleForKind(k: SecretKind): string {
  switch (k) {
    case 'private_key':
      return 'Embedded private key';
    case 'mnemonic':
      return 'Possible seed phrase';
    case 'aws_access_key':
    case 'aws_secret_key':
      return 'AWS credential';
    case 'github_pat':
      return 'GitHub personal access token';
    case 'slack_token':
      return 'Slack token';
    case 'stripe_live_key':
    case 'stripe_test_key':
      return 'Stripe secret key';
    case 'google_api_key':
      return 'Google API key';
    case 'openai_api_key':
      return 'OpenAI API key';
    case 'anthropic_api_key':
      return 'Anthropic API key';
    case 'jwt':
      return 'JSON Web Token';
    case 'db_url':
      return 'Database connection string with password';
    case 'hardcoded_password':
      return 'Hardcoded password';
    case 'generic_high_entropy':
      return 'High-entropy string (possible secret)';
  }
}

function descriptionForKind(k: SecretKind): string {
  switch (k) {
    case 'private_key':
      return 'A PEM-encoded private key is present in the repository. Anyone with read access can sign transactions or impersonate the owner.';
    case 'mnemonic':
      return 'A 12+ word lowercase phrase was detected. If this is a real BIP-39 mnemonic, the wallet it controls should be considered compromised.';
    case 'aws_access_key':
    case 'aws_secret_key':
      return 'AWS credentials in source. Use IAM roles, AWS Secrets Manager, or short-lived STS tokens instead.';
    case 'github_pat':
      return 'A GitHub Personal Access Token was found in source. Rotate immediately and move it to a secret manager.';
    case 'slack_token':
      return 'A Slack token was found. Slack tokens grant access to channels and DMs; rotate and store in a secret manager.';
    case 'stripe_live_key':
      return 'A live Stripe secret key was found. Treat the key as compromised; roll it from the Stripe dashboard and audit usage.';
    case 'stripe_test_key':
      return 'A Stripe test key was committed. Even test keys can leak metadata; prefer environment-injected values.';
    case 'google_api_key':
      return 'A Google API key was found. Restrict it by HTTP referrer / API / IP at the Google Cloud Console and load from env.';
    case 'openai_api_key':
      return 'An OpenAI API key was found. Rotate via the OpenAI dashboard and load from environment variables.';
    case 'anthropic_api_key':
      return 'An Anthropic API key was found. Rotate via the Anthropic console and load from environment variables.';
    case 'jwt':
      return 'A signed JWT was found. JWTs are bearer tokens; treat as compromised if signed for a real service.';
    case 'db_url':
      return 'A database URL with embedded password is in source. Use environment variables and a secret manager.';
    case 'hardcoded_password':
      return 'A password literal was assigned in source. Use environment variables, secret managers, or instance metadata.';
    case 'generic_high_entropy':
      return 'A long, high-entropy string resembling a token or signing key was found. Inspect manually and treat as a possible secret.';
  }
}

function recommendedForKind(k: SecretKind): string {
  switch (k) {
    case 'private_key':
      return 'Move the key to a secret manager (e.g. HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager) and load at runtime.';
    case 'mnemonic':
      return 'Move the seed to a hardware or wallet-managed signer. Never store BIP-39 phrases in source control.';
    case 'aws_access_key':
    case 'aws_secret_key':
      return 'Use IAM roles, short-lived STS credentials, or AWS Secrets Manager.';
    case 'github_pat':
      return 'Use fine-grained PATs loaded from env, or prefer GitHub App authentication.';
    case 'slack_token':
      return 'Store the token in a secret manager. Rotate the existing token at api.slack.com.';
    case 'stripe_live_key':
      return 'Roll the key from the Stripe dashboard. Use the official SDK with env-injected keys.';
    case 'stripe_test_key':
      return 'Move the key to env. Add `.env` to `.gitignore`.';
    case 'google_api_key':
      return 'Restrict the key at console.cloud.google.com and load from env.';
    case 'openai_api_key':
      return 'Rotate the key in the OpenAI dashboard and load from env.';
    case 'anthropic_api_key':
      return 'Rotate the key in the Anthropic console and load from env.';
    case 'jwt':
      return 'Move the JWT to a secret store. If signed for a real service, treat as compromised.';
    case 'db_url':
      return 'Split the URL into host/user/password env vars and load from a secret manager.';
    case 'hardcoded_password':
      return 'Replace the literal with an env var or secret manager reference.';
    case 'generic_high_entropy':
      return 'Inspect the line manually. If it is a credential, move it to env and rotate.';
  }
}
