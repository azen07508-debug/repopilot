import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const cacheTestDb = join(REPO ?? process.cwd(), 'data/verify-release/cache.db');
if (existsSync(cacheTestDb)) rmSync(cacheTestDb, { force: true });

const { spawn } = await import('node:child_process');
const proc = spawn('node', ['apps/api/dist/server.js'], {
  cwd: '/home/gem/workspace/agent/workspace/repopilot',
  env: {
    ...process.env,
    REPORT_CACHE_ENABLED: 'true',
    PORT: '4099',
    DATABASE_URL: `file:${cacheTestDb}`,
  },
  stdio: 'pipe',
});
proc.stdout.on('data', d => process.stderr.write(`[API] ${d}`));

async function wait() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:4099/health');
      if (r.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server timeout');
}
await wait();

const payload = {
  repoUrl: 'https://github.com/octocat/Hello-World',
  mode: 'quick',
  target: 'open_source',
  outputLanguage: 'en',
  includeLaunchCopy: true,
};

async function submit() {
  const r = await fetch('http://127.0.0.1:4099/api/v1/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const ch = await r.json();
  const p = await fetch('http://127.0.0.1:4099/api/v1/audits', { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': `mock:${ch.payment.paymentId}` }, body: JSON.stringify(payload) });
  return await p.json();
}
async function poll(jobId) {
  for (let i = 0; i < 300; i++) {
    const r = await fetch(`http://127.0.0.1:4099/api/v1/audits/${jobId}`);
    if (r.status === 200) return await r.json();
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('poll timeout');
}

const j1 = await submit();
const r1 = await poll(j1.jobId);
console.log('R1:', JSON.stringify(r1.cache));

const db = new Database(cacheTestDb, { readonly: true });
const cacheRows = db.prepare('SELECT key, key_version, commit_sha, created_at, expires_at, length(report) as report_len FROM report_cache').all();
console.log('cache after R1:', JSON.stringify(cacheRows, null, 2));
const jobRows = db.prepare('SELECT id, status FROM jobs').all();
console.log('jobs after R1:', JSON.stringify(jobRows, null, 2));

await new Promise(r => setTimeout(r, 1000));
const j2 = await submit();
const r2 = await poll(j2.jobId);
console.log('R2:', JSON.stringify(r2.cache));

proc.kill('SIGTERM');
await new Promise(r => setTimeout(r, 500));
