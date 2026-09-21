import { describe, it, expect } from 'vitest';
import { scanForSecrets, toSecretFindings } from '../security/secret-scanner.js';

describe('scanForSecrets', () => {
  it('masks AWS access keys without exposing the value', () => {
    const fileContent = [
      'const key = "AKIA1234567890ABCDEF";',
    ].join('\n');
    const drafts = scanForSecrets([{ path: 'config.js', content: fileContent }]);
    const finding = toSecretFindings(drafts)[0]!;
    expect(finding.title).toMatch(/AWS/);
    // The original secret value must NOT appear in the report.
    const json = JSON.stringify(finding);
    expect(json.includes('AKIA1234567890ABCDEF')).toBe(false);
    expect(finding.evidence[0]?.file).toBe('config.js');
    expect(finding.evidence[0]?.line).toBe(1);
  });

  it('detects GitHub PATs (ghp_*)', () => {
    const drafts = scanForSecrets([
      {
        path: '.env',
        content: 'GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ]);
    const findings = toSecretFindings(drafts);
    expect(findings.length).toBeGreaterThan(0);
    const json = JSON.stringify(findings);
    expect(json.includes('ghp_aaaa')).toBe(false);
  });

  it('detects a private key block', () => {
    const drafts = scanForSecrets([
      {
        path: 'keys.pem',
        content: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
      },
    ]);
    expect(drafts.length).toBeGreaterThan(0);
  });

  it('does NOT report a value that looks like a sample (placeholder)', () => {
    const drafts = scanForSecrets([
      {
        path: '.env.example',
        content: 'API_KEY=your-key-here-please-change-me',
      },
    ]);
    // Allowlist file → entropy heuristic skipped; pattern match also has allowlist
    expect(drafts).toHaveLength(0);
  });

  it('flags high-entropy strings when not in an example file', () => {
    const drafts = scanForSecrets([
      {
        path: 'config.ts',
        content: 'const t = "asdfqwerzxcvplmnbvcmxzqwertyuiopasdfghjkl";',
      },
    ]);
    expect(drafts.some((d) => d.kind === 'generic_high_entropy')).toBe(true);
  });

  it('never stores the actual secret value in the output', () => {
    // Split so the literal never appears whole in source: keeps the runtime
    // value intact for the scanner while avoiding false positives in
    // upstream secret scanners (including GitHub push protection).
    const secret = 'sk_live_' + 'abcdefghijklmnopqrstuvwx';
    const drafts = scanForSecrets([
      {
        path: 'app.js',
        content: `const KEY = "${secret}";`,
      },
    ]);
    const findings = toSecretFindings(drafts);
    const json = JSON.stringify(findings);
    expect(json.includes(secret)).toBe(false);
    expect(json.includes('sk_live_')).toBe(false);
  });
});

describe('placeholder files', () => {
  function kindsIn(path: string, content: string): string[] {
    return scanForSecrets([{ path, content }]).map((d) => d.kind);
  }

  it('does not report a template connection string in .env.example', () => {
    // A real run against a repository whose only sin was a well-written
    // .env.example produced 547 blockers. That makes the gate useless.
    const kinds = kindsIn('.env.example', 'DATABASE_URL=postgres://app:password@localhost:5432/app');
    expect(kinds).not.toContain('db_url');
  });

  it('does not report a template password field in .env.example', () => {
    expect(kindsIn('.env.example', 'DB_PASSWORD=changeme')).not.toContain('hardcoded_password');
  });

  it('still reports a private key in .env.example', () => {
    // A key is never a template, so the allowlist must not hide it.
    expect(kindsIn('.env.example', '-----BEGIN RSA PRIVATE KEY-----')).toContain('private_key');
  });

  it('does not report a localhost connection string anywhere', () => {
    const kinds = kindsIn('.env', 'DATABASE_URL=postgres://app:hunter2@127.0.0.1:5432/app');
    expect(kinds).not.toContain('db_url');
  });

  it('still reports a real connection string', () => {
    const kinds = kindsIn(
      '.env',
      'DATABASE_URL=postgres://svc:Xk9mQ2pLr7Tn4Yb@db.prod.internal:5432/app'
    );
    expect(kinds).toContain('db_url');
  });

  it('still reports a real credential in .env', () => {
    expect(kindsIn('.env', 'STRIPE=sk_live_' + 'abcdefghijklmnopqrstuvwx')).toContain(
      'stripe_live_key'
    );
  });
});
