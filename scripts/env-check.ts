#!/usr/bin/env tsx
/**
 * env:check — validate the environment without printing secret values.
 *
 * - development: only required vars (with safe defaults)
 * - production:  fail if any required var is missing or unsafe
 * - PAYMENT_MODE=okx: must have a recipient address; on-chain settlement
 *                    must be configured (Beta gate)
 * - PAYMENT_MODE=mock: never requires OKX secrets
 *
 * Exit code: 0 = ok, 1 = errors, 2 = warnings
 *
 * Invoked via `pnpm env:check` from the repo root.
 */
import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The resource-URL predicate, imported rather than copied. `env:check` reports
// every problem instead of throwing on the first, so it cannot use
// `loadConfig()` — but it can use the rule `loadConfig()` enforces.
import { isPublicHttpsUrl } from '../apps/api/src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const envPath = join(REPO_ROOT, '.env');
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

const NODE_ENV = (process.env['NODE_ENV'] ?? 'development') as
  | 'development'
  | 'test'
  | 'production';

const RequiredInProduction = {
  HOST: '0.0.0.0',
  PORT: '4000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://...',
  CORS_ORIGINS: 'https://your-domain.example',
  ALLOWED_REPO_HOSTS: 'github.com,raw.githubusercontent.com',
  PAYMENT_MODE: 'mock',
  PRICE_AUDIT: '1',
};

const KNOWN_SECRET_KEYS = [
  'GITHUB_TOKEN',
  'OKX_AGENT_KEY',
  'OKX_AGENT_SECRET',
  // No longer a RepoPilot variable — R-38 removed it with the rest of the LLM
  // surface. It stays on this list because the list's job is redaction, not
  // configuration: an operator who set `LLM_API_KEY` months ago still has it in
  // their shell, and dropping the entry would print it.
  'LLM_API_KEY',
  'X_API_KEY',
  'REPOPILOT_API_KEY',
  'API_KEY',
  'SECRET',
  'PRIVATE_KEY',
  'MNEMONIC',
];

interface Issue {
  level: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}

const issues: Issue[] = [];

function err(field: string, message: string): void {
  issues.push({ level: 'error', field, message });
}
function warn(field: string, message: string): void {
  issues.push({ level: 'warning', field, message });
}
function info(field: string, message: string): void {
  issues.push({ level: 'info', field, message });
}

// 1. NODE_ENV must be one of the three
if (!['development', 'test', 'production'].includes(NODE_ENV)) {
  err('NODE_ENV', `unknown value "${NODE_ENV}"`);
}

// 2. Production: required fields
if (NODE_ENV === 'production') {
  for (const [field, fallback] of Object.entries(RequiredInProduction)) {
    const v = process.env[field];
    if (v === undefined || v === '') {
      err(field, `required in production (default would be "${fallback}")`);
    }
  }
  // CORS must not be "*"
  if ((process.env['CORS_ORIGINS'] ?? '').trim() === '*') {
    err('CORS_ORIGINS', '"*" is not allowed in production');
  }
  // DATABASE_URL must be set and should be Postgres in production
  const db = process.env['DATABASE_URL'] ?? '';
  if (!db) {
    err('DATABASE_URL', 'must be set in production');
  } else if (db.startsWith('file:')) {
    warn('DATABASE_URL', 'SQLite is not recommended for production (use postgres://)');
  } else if (!db.startsWith('postgres://') && !db.startsWith('postgresql://')) {
    warn('DATABASE_URL', `unrecognized URL scheme in production; expected postgres://`);
  }
  // Production: numeric limits must be set explicitly (no defaults to silently use)
  for (const f of ['MAX_FILES', 'MAX_FILE_BYTES', 'MAX_TOTAL_BYTES', 'RATE_LIMIT_PER_MINUTE']) {
    if (process.env[f] === undefined || process.env[f] === '') {
      warn(f, 'unset; will use built-in default. Recommended to set explicitly in production.');
    }
  }
  // A `LLM_PROVIDER` check stood here. It warned when the variable was empty
  // ("using noop") and, in section 5 below, *errored* when it was
  // `openai-compatible` without a key, base URL and model. Both are gone with
  // the variable (R-38): there is no provider to select, so warning about
  // which one you did not select was noise, and demanding credentials for a
  // capability that does nothing blocked a release for no reason.
  // ALLOWED_REPO_HOSTS must be present and not contain wildcards
  const hostsRaw = (process.env['ALLOWED_REPO_HOSTS'] ?? '').trim();
  if (!hostsRaw) {
    err('ALLOWED_REPO_HOSTS', 'required in production');
  } else if (hostsRaw.includes('*')) {
    err('ALLOWED_REPO_HOSTS', 'wildcards are not allowed in production');
  }
}

// 3. Payment mode
const mode = (process.env['PAYMENT_MODE'] ?? 'mock') as 'mock' | 'okx';
if (mode === 'okx') {
  if (!process.env['OKX_PAYMENT_ADDRESS']) {
    err('OKX_PAYMENT_ADDRESS', 'required when PAYMENT_MODE=okx');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(process.env['OKX_PAYMENT_ADDRESS'] ?? '')) {
    err('OKX_PAYMENT_ADDRESS', 'must be a 0x-prefixed EVM address');
  }
  // The URL the 402 challenge names as the thing being paid for. This is the
  // same predicate `validateProductionConfig()` uses, imported rather than
  // re-implemented: two copies of "is this URL usable" could disagree, and the
  // one an operator reads is not the one that decides. The boot guard would
  // catch it too, but a crash-looping container is a worse place to find out.
  if (!isPublicHttpsUrl(process.env['OKX_PAYMENT_RESOURCE_URL'] ?? '')) {
    err(
      'OKX_PAYMENT_RESOURCE_URL',
      'required when PAYMENT_MODE=okx: this deployment\'s own public https URL ' +
        '(for example https://api.example.com/api/v1/audits)',
    );
  }
  // NOTE: OKX.AI Marketplace is GA as of 2026-06-30; ASPs self-register
  // via `onchainos agent register --role asp` (see docs/EXTERNAL_ACTIONS.md
  // item 2). The x402 challenge + EIP-3009 verification is wired and
  // ready; on-chain settlement becomes live the moment the ASP is
  // registered and has at least one approved service endpoint.
  info(
    'OKX',
    'PAYMENT_MODE=okx is live. Run `onchainos agent register --role asp` to publish the marketplace listing.',
  );
} else if (mode === 'mock') {
  if (NODE_ENV === 'production') {
    err('PAYMENT_MODE', 'mock is not allowed in production');
  }
}

// 3b. Audit queue driver (R-02 follow-up). Inline queue is for dev/test
// only; production must use a persistent driver.
const queueDriver = (process.env['AUDIT_QUEUE_DRIVER'] ?? 'inline') as 'inline' | 'pg-boss';
if (queueDriver === 'inline' && NODE_ENV === 'production') {
  err('AUDIT_QUEUE_DRIVER', 'inline is not allowed in production; use pg-boss with PostgreSQL');
}
if (queueDriver === 'pg-boss') {
  const dbUrl = process.env['DATABASE_URL'] ?? '';
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    err('DATABASE_URL', 'pg-boss requires a postgres:// DATABASE_URL');
  }
  if (NODE_ENV !== 'production') {
    info('AUDIT_QUEUE_DRIVER', 'pg-boss used outside production; ensure a Postgres DATABASE_URL is reachable');
  }
}
if (queueDriver === 'pg-boss' && mode === 'mock' && NODE_ENV === 'production') {
  err('PAYMENT_MODE', 'mock is not allowed in production; pg-boss queue is not a substitute for the production payment guard');
}

// 4. Numeric ranges
//
// Every entry here must name a variable some code reads. `ANALYSIS_TIMEOUT_MS`
// was in this list and nowhere else — not in `.env.example`, not in
// `apps/api/src/config.ts`, not read by any module. It validated the range of a
// value that could not affect anything, which is worse than not checking it:
// an operator who set it got a green tick confirming a setting the service
// ignored. Removed in R-39.
const numericChecks: Array<[string, number, number]> = [
  ['PORT', 1, 65535],
  ['MAX_FILES', 1, 100000],
  ['MAX_FILE_BYTES', 1024, 100 * 1024 * 1024],
  ['MAX_TOTAL_BYTES', 1024 * 1024, 1024 * 1024 * 1024],
  ['RATE_LIMIT_PER_MINUTE', 1, 100000],
  ['OKX_X402_VERSION', 1, 2],
];
for (const [field, min, max] of numericChecks) {
  const raw = process.env[field];
  if (raw === undefined || raw === '') continue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    err(field, `must be a number in [${min}, ${max}]`);
  }
}

// 5. LLM provider — removed in R-38.
//
// This block read `LLM_PROVIDER` and, when it was `openai-compatible`, called
// `err()` for a missing `LLM_API_KEY`, `LLM_BASE_URL` or `LLM_MODEL`. That made
// the gate refuse to pass without three credentials for a provider that no code
// path read: setting them changed nothing about a report, and omitting them
// stopped `preflight:production`. A check that demands a secret for a
// capability the repository does not have is worse than no check.

// 6. Known secret keys present in process.env are never printed
for (const k of KNOWN_SECRET_KEYS) {
  if (process.env[k]) {
    info(k, 'present (value suppressed)');
  }
}

// 7. Allowed repo hosts
const hosts = (process.env['ALLOWED_REPO_HOSTS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (hosts.length === 0) {
  if (NODE_ENV === 'production') {
    err('ALLOWED_REPO_HOSTS', 'must include at least one host');
  } else {
    warn('ALLOWED_REPO_HOSTS', 'no .env loaded; falling back to default (github.com, raw.githubusercontent.com)');
  }
}

// Render report
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
const infos = issues.filter((i) => i.level === 'info');

console.log(`\nenv:check (NODE_ENV=${NODE_ENV}, PAYMENT_MODE=${mode})`);
console.log('─'.repeat(60));
if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
  console.log('OK — no findings');
} else {
  for (const e of errors) {
    console.log(`ERROR    ${e.field.padEnd(24)} ${e.message}`);
  }
  for (const w of warnings) {
    console.log(`WARNING  ${w.field.padEnd(24)} ${w.message}`);
  }
  for (const i of infos) {
    console.log(`INFO     ${i.field.padEnd(24)} ${i.message}`);
  }
}
console.log('─'.repeat(60));
console.log(
  `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
);

if (errors.length > 0) {
  process.exit(1);
}
if (warnings.length > 0) {
  process.exit(2);
}
process.exit(0);
