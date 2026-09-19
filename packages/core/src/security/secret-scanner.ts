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
    pattern: /\b(?:[a-z]{3,12}\s){11,23}[a-z]{3,12}\b/,
    severity: 'critical',
    reason: 'Possible BIP-39 mnemonic phrase (12+ lowercase words)',
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

const SAMPLE_KEYWORDS = [
  'example',
  'sample',
  'placeholder',
  'changeme',
  'change-me',
  'your-key',
  'your_key',
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

function looksLikeSample(value: string): boolean {
  const lower = value.toLowerCase();
  return SAMPLE_KEYWORDS.some((k) => lower.includes(k));
}

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

export function scanForSecrets(inputs: SecretScanInput[]): SecretFindingDraft[] {
  const drafts: SecretFindingDraft[] = [];
  for (const { path: filePath, content } of inputs) {
    const isAllowlist = ALLOWLIST_FILES.has(filePath.split('/').pop() ?? '');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const pat of PATTERNS) {
        const m = pat.pattern.exec(line);
        if (!m) continue;
        const matchValue = m[0];
        if (looksLikeSample(matchValue)) continue;
        drafts.push({
          kind: pat.kind,
          severity: pat.severity,
          file: filePath,
          evidence: [
            {
              file: filePath,
              line: i + 1,
              reason: pat.reason,
            },
          ],
        });
      }

      // Generic high-entropy token heuristic (catch-all for unknown formats).
      if (!isAllowlist) {
        const entropyMatches = line.match(/['"]?([A-Za-z0-9_\-+/=]{32,})['"]?/g) ?? [];
        for (const token of entropyMatches) {
          const cleaned = token.replace(/^['"]|['"]$/g, '');
          if (looksLikeSample(cleaned)) continue;
          if (shannonEntropy(cleaned) < 4.0) continue;
          // Avoid double-reporting when a more specific pattern already matched.
          const alreadyReported = drafts.some(
            (d) => d.file === filePath && d.evidence[0]?.line === i + 1
          );
          if (alreadyReported) continue;
          drafts.push({
            kind: 'generic_high_entropy',
            severity: 'medium',
            file: filePath,
            evidence: [
              {
                file: filePath,
                line: i + 1,
                reason: `High-entropy string (${cleaned.length} chars, H=${shannonEntropy(
                  cleaned
                ).toFixed(2)}) — possible API key, token or signing material`,
              },
            ],
          });
        }
      }
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

function slugify(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function titleForKind(k: SecretKind): string {
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
