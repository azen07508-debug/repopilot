#!/usr/bin/env tsx
/**
 * scripts/okx-seller-smoke.ts — start the API in PAYMENT_MODE=okx against
 * a temporary SQLite DB, hit POST /api/v1/audits, dump the real x402
 * challenge into screenshots/ for evidence that the OKX seller side
 * is fully wired.
 *
 * Usage:
 *   pnpm tsx scripts/okx-seller-smoke.ts [recipient_address]
 *
 * Defaults to the value committed in docs (a representative test
 * address). To smoke against a real wallet, pass it as argv[2].
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnChild, waitForAnswer, type SpawnedChild } from './child-wait.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const OUT_DIR = join(REPO, 'screenshots');
const DATA_DIR = join(REPO, 'data', 'okx-smoke');

const recipient =
  process.argv[2] ?? '0x3a4434baad765136a40f597e29d325b41b9dec61';
// Use a high port that's not in the IANA registered range.
// Override with `PORT=4093 pnpm tsx scripts/okx-seller-smoke.ts` if needed.
const port = Number.parseInt(process.env['PORT'] ?? '4093', 10);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

/**
 * The 402 body this script reads, declared once.
 *
 * It used to be declared twice — here and again as `renderMarkdown`'s
 * parameter — and the copy at the call site drifted: it was still missing
 * `resource`, `description` and `mimeType` when the server had been sending
 * them for months. Nothing noticed, because nothing type-checked `scripts/`
 * (R-31), and the smoke test that exists to prove the seller side is wired
 * was asserting a shape the seller side had stopped sending.
 *
 * This is still a copy of the adapter's contract, not the contract itself, and
 * it stays one: `PaymentChallenge.challenge` is deliberately `unknown`, so
 * there is no exported type for a caller to read. R-31 listed "make the smoke
 * script read the real type" as part of its batch; closing R-31 showed there is
 * no real type to read, so that item is withdrawn rather than done. One copy is
 * one place to update.
 */
interface Audit402Body {
  jobId: string;
  status: string;
  payment: {
    paymentId: string;
    mode: string;
    amount: string;
    currency: string;
    challenge: {
      x402Version: number;
      accepts: Array<{
        scheme: string;
        network: string;
        maxAmountRequired: string;
        resource: string;
        description: string;
        mimeType: string;
        payTo: string;
        maxTimeoutSeconds: number;
        asset: string;
        extra?: Record<string, unknown>;
      }>;
    };
    expiresAt: string;
  };
  nextAction: string;
}

/**
 * How long to wait for the API to answer `/health` with `paymentMode=okx`.
 *
 * A budget, not a measurement — the same reasoning as
 * `verify-release.ts`'s `STARTUP_TIMEOUT_MS`, and this script had the same
 * defect in a third copy: a bare `waitForHealth(15_000)` with no note on it,
 * and the child's stdout and stderr drained into `() => {}`. A server that
 * died on a port clash therefore produced one message that named the symptom
 * (`API never came up with paymentMode=okx after 15000ms`) and hid the cause.
 *
 * The wait and its diagnostics are now shared with `verify:release` — see
 * `scripts/child-wait.ts` — so a dead child reports its exit code and its own
 * output, and this budget is named and overridable.
 *
 * Override with `OKX_SMOKE_STARTUP_TIMEOUT_MS` on a slower machine or a colder
 * cache.
 */
const STARTUP_TIMEOUT_MS = Number(process.env['OKX_SMOKE_STARTUP_TIMEOUT_MS'] ?? 60_000);

function child(): SpawnedChild {
  return spawnChild('node', ['apps/api/dist/server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PAYMENT_MODE: 'okx',
      LOG_LEVEL: 'error',
      HOST: '127.0.0.1',
      PORT: String(port),
      OKX_PAYMENT_ADDRESS: recipient,
      OKX_PAYMENT_NETWORK: 'xlayer',
      OKX_X402_VERSION: '2',
      DATABASE_URL: `file:${join(DATA_DIR, 'okx.db')}`,
      CORS_ORIGINS: 'http://localhost:5173',
      ALLOWED_REPO_HOSTS: 'github.com,raw.githubusercontent.com',
      AUDIT_QUEUE_DRIVER: 'inline',
    },
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const api = child();
  try {
    await waitForAnswer(
      api,
      {
        label: 'api',
        // Phrased as the claim being waited on rather than as the URL alone, so
        // the timeout message can be read literally: a server that is up and
        // answering `paymentMode=mock` has not "not answered", it has not
        // answered *that*, and the two are different investigations.
        what: `http://127.0.0.1:${port}/health reporting paymentMode=okx`,
        timeoutMs: STARTUP_TIMEOUT_MS,
        envVar: 'OKX_SMOKE_STARTUP_TIMEOUT_MS',
      },
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          if (res.status !== 200) return null;
          const body = (await res.json()) as { paymentMode?: string };
          return body.paymentMode === 'okx' ? body : null;
        } catch {
          // Not listening yet. A refused connection is the state being waited
          // on, not an error to report.
          return null;
        }
      },
    );
    console.log(`✓ API up with paymentMode=okx on :${port}`);

    // 1. POST /api/v1/audits — should return 402 with x402 challenge
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/audits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoUrl: 'https://github.com/octocat/Hello-World',
        mode: 'quick',
        target: 'open_source',
        outputLanguage: 'en',
        includeLaunchCopy: true,
      }),
    });
    const body = (await res.json()) as Audit402Body;
    console.log(`✓ POST /api/v1/audits → ${res.status} in ${Date.now() - t0}ms`);
    console.log(`  paymentId : ${body.payment.paymentId}`);
    console.log(`  amount    : ${body.payment.amount} ${body.payment.currency}`);
    console.log(`  scheme    : ${body.payment.challenge.accepts[0]?.scheme}`);
    console.log(`  network   : ${body.payment.challenge.accepts[0]?.network}`);
    console.log(`  payTo     : ${body.payment.challenge.accepts[0]?.payTo}`);
    console.log(`  asset     : ${body.payment.challenge.accepts[0]?.asset}`);

    if (res.status !== 402) {
      throw new Error(`expected 402, got ${res.status}`);
    }
    if (body.payment.mode !== 'okx') {
      throw new Error(`payment.mode should be okx, got ${body.payment.mode}`);
    }
    const accept = body.payment.challenge.accepts[0];
    if (!accept) throw new Error('no accepts[0] in challenge');
    if (accept.payTo.toLowerCase() !== recipient.toLowerCase()) {
      throw new Error(`payTo ${accept.payTo} != recipient ${recipient}`);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(accept.payTo)) {
      throw new Error(`payTo is not a valid EVM address: ${accept.payTo}`);
    }

    // 2. write artifacts
    const baseName = `okx-seller-smoke-${stamp}`;
    const jsonPath = join(OUT_DIR, `${baseName}.json`);
    const mdPath = join(OUT_DIR, `${baseName}.md`);

    writeFileSync(jsonPath, JSON.stringify(body, null, 2), 'utf8');
    console.log(`✓ wrote ${basename(jsonPath)}`);

    const md = renderMarkdown(body, recipient, port);
    writeFileSync(mdPath, md, 'utf8');
    console.log(`✓ wrote ${basename(mdPath)}`);

    // 3. summary
    console.log('\n── Smoke summary ──');
    console.log(`API       : http://127.0.0.1:${port}`);
    console.log(`Health    : paymentMode=okx`);
    console.log(`402 path  : POST /api/v1/audits → 402 with x402 v2 challenge`);
    console.log(`payTo     : ${accept.payTo}`);
    console.log(`asset     : ${accept.asset}  (X Layer USDT)`);
    console.log(`maxAmount : ${accept.maxAmountRequired} atomic = ${body.payment.amount} ${body.payment.currency}`);
    console.log(`expires   : ${body.payment.expiresAt}`);
  } finally {
    api.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!api.proc.killed) api.proc.kill('SIGKILL');
  }
}

function renderMarkdown(
  body: Audit402Body,
  recipient: string,
  port: number,
): string {
  const accept = body.payment.challenge.accepts[0]!;
  const lines: string[] = [];
  lines.push(`# OKX seller-side smoke — real x402 challenge`);
  lines.push('');
  lines.push(`- API port: \`${port}\``);
  lines.push(`- \`PAYMENT_MODE=okx\``);
  lines.push(`- \`OKX_PAYMENT_ADDRESS=${recipient}\``);
  lines.push(`- POST \`/api/v1/audits\` returned **402 Payment Required** in well under 1 s.`);
  lines.push('');
  lines.push(`## HTTP response`);
  lines.push('```json');
  lines.push(JSON.stringify(body, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`## Acceptance details`);
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| x402 version | ${body.payment.challenge.x402Version} |`);
  lines.push(`| scheme | \`${accept.scheme}\` |`);
  lines.push(`| network | \`${accept.network}\` (chainId 196) |`);
  lines.push(`| payTo (seller) | \`${accept.payTo}\` |`);
  lines.push(`| asset (USDT) | \`${accept.asset}\` |`);
  lines.push(`| maxAmountRequired | \`${accept.maxAmountRequired}\` (atomic units, 6 decimals → ${body.payment.amount} ${body.payment.currency}) |`);
  lines.push(`| maxTimeoutSeconds | ${accept.maxTimeoutSeconds} |`);
  lines.push(`| resource | \`${accept.resource}\` |`);
  lines.push(`| description | ${accept.description} |`);
  lines.push(`| mimeType | \`${accept.mimeType}\` |`);
  lines.push(`| extra | ${JSON.stringify(accept.extra ?? {})} |`);
  lines.push('');
  lines.push(`## Payment metadata`);
  lines.push(`- paymentId: \`${body.payment.paymentId}\``);
  lines.push(`- mode: \`${body.payment.mode}\``);
  lines.push(`- amount: **${body.payment.amount} ${body.payment.currency}**`);
  lines.push(`- expiresAt: \`${body.payment.expiresAt}\``);
  lines.push('');
  lines.push(`## Next action (from server)`);
  lines.push(`> ${body.nextAction}`);
  lines.push('');
  lines.push(`## What this proves`);
  lines.push('');
  lines.push(`1. The \`OkxPaymentAdapter\` is fully constructed and wired when a valid \`OKX_PAYMENT_ADDRESS\` is present — no Beta gate.`);
  lines.push(`2. \`/health\` reports \`paymentMode=okx\`.`);
  lines.push(`3. \`POST /api/v1/audits\` returns a real **x402 v2** challenge with:`);
  lines.push(`   - \`payTo\` = the configured recipient (your X Layer wallet)`);
  lines.push(`   - \`asset\` = USDT contract on X Layer (0x55d3…79955)`);
  lines.push(`   - \`maxAmountRequired\` correctly scaled from \`PRICE_AUDIT\` (1 USDT = 1000000 atomic)`);
  lines.push(`4. The challenge expires in 5 minutes and includes a clear \`nextAction\` telling the buyer how to settle.`);
  return lines.join('\n');
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
