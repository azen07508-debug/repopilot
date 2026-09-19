#!/usr/bin/env tsx
/**
 * compose:check — static review of docker-compose.yml.
 *
 * - Parses the YAML (no Docker CLI required)
 * - Asserts services: block is present
 * - Asserts each service has a `healthcheck` block
 * - Asserts API depends on DB with `service_healthy` condition
 * - Asserts no hardcoded secrets in env: blocks (looks for `*_KEY=` or
 *   `*_SECRET=` or `*_PASSWORD=` literals)
 * - Asserts no bind mount of `.env` or `node_modules` into the image
 *
 * Use this in CI when Docker CLI is not installed.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const COMPOSE_PATH = join(REPO, 'docker-compose.yml');

interface Issue {
  level: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}
const issues: Issue[] = [];
const err = (field: string, message: string): void => issues.push({ level: 'error', field, message });
const warn = (field: string, message: string): void => issues.push({ level: 'warning', field, message });
const info = (field: string, message: string): void => issues.push({ level: 'info', field, message });

const raw = readFileSync(COMPOSE_PATH, 'utf8');
let parsed: Record<string, unknown>;
try {
  parsed = parseYaml(raw) as Record<string, unknown>;
} catch (e) {
  err('yaml', `failed to parse: ${(e as Error).message}`);
  printAndExit();
}

const services = (parsed['services'] ?? {}) as Record<string, Record<string, unknown>>;
if (Object.keys(services).length === 0) {
  err('services', 'no services defined');
}
for (const [name, svc] of Object.entries(services)) {
  if (!svc['healthcheck']) {
    warn(name, 'no healthcheck block');
  }
  if (!svc['image'] && !svc['build']) {
    err(name, 'no image or build directive');
  }
  // env: literal secrets check
  const env = (svc['environment'] ?? {}) as Record<string, string | number>;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    if (/KEY=|SECRET=|PASSWORD=|TOKEN=/.test(v) && !/^\$\{[A-Z_]+(:-.*)?\}$/.test(v) && v.length > 0) {
      err(name, `env.${k} looks like a hardcoded secret (use \${VAR} form)`);
    }
  }
  // mount security
  const mounts = (svc['volumes'] ?? []) as Array<string | { source: string; target: string }>;
  for (const m of mounts) {
    const s = typeof m === 'string' ? m : m.source;
    if (s && (s.includes('.env') || s.endsWith('/.env') || s.includes('node_modules'))) {
      err(name, `mount ${s} exposes secrets or build cache into the image`);
    }
  }
}

// API depends on DB with service_healthy
const api = services['api'];
if (api) {
  const dep = (api['depends_on'] ?? {}) as Record<string, { condition?: string } | string>;
  if (!dep['db']) {
    warn('api.depends_on', 'no db dependency declared');
  } else if (typeof dep['db'] === 'object' && dep['db'].condition !== 'service_healthy') {
    warn('api.depends_on.db', `expected service_healthy, got ${dep['db'].condition ?? 'none'}`);
  }
}

printAndExit();

function printAndExit(): void {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const infos = issues.filter((i) => i.level === 'info');
  console.log('\ncompose:check');
  console.log('─'.repeat(60));
  if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
    console.log('OK — docker-compose.yml looks sane');
  } else {
    for (const e of errors) console.log(`ERROR    ${e.field.padEnd(30)} ${e.message}`);
    for (const w of warnings) console.log(`WARNING  ${w.field.padEnd(30)} ${w.message}`);
    for (const i of infos) console.log(`INFO     ${i.field.padEnd(30)} ${i.message}`);
  }
  console.log('─'.repeat(60));
  console.log(`${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`);
  if (errors.length > 0) process.exit(1);
  if (warnings.length > 0) process.exit(2);
}
