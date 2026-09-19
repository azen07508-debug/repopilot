#!/usr/bin/env tsx
/**
 * scripts/mcp-audit.ts — Drive the MCP server over stdio to run a *real*
 * audit (octocat/Hello-World) and dump the report to screenshots/.
 *
 * Usage:
 *   pnpm tsx scripts/mcp-audit.ts [repo_url] [mode]
 *
 * Defaults:
 *   repo_url = https://github.com/octocat/Hello-World
 *   mode     = quick
 *
 * Outputs:
 *   screenshots/mcp-audit-<repo>-<mode>-<timestamp>.json
 *   screenshots/mcp-audit-<repo>-<mode>-<timestamp>.md
 *   screenshots/mcp-audit-<repo>-<mode>-<timestamp>.html
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const OUT_DIR = join(REPO, 'screenshots');

const repoUrl = process.argv[2] ?? 'https://github.com/octocat/Hello-World';
const mode = (process.argv[3] ?? 'quick') as 'quick' | 'full';

if (mode !== 'quick' && mode !== 'full') {
  console.error(`mode must be quick|full, got: ${mode}`);
  process.exit(1);
}
const repoSlug = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\//g, '-');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

interface McpResponse {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  result?: {
    content: Array<{ type: string; text: string }>;
    tools?: Array<{ name: string; description: string }>;
  };
  error?: { code: number; message: string; data?: unknown };
}

function child(): ChildProcess {
  return spawn('node', ['packages/mcp-server/dist/cli.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PAYMENT_MODE: 'mock',
      LOG_LEVEL: 'error',
      ALLOWED_REPO_HOSTS: 'github.com,raw.githubusercontent.com',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function send(proc: ChildProcess, payload: object): void {
  proc.stdin!.write(JSON.stringify(payload) + '\n');
}

async function readOne(proc: ChildProcess, id: number, timeoutMs: number): Promise<McpResponse> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      // Each response is on its own line. We may receive multiple notifications first.
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as McpResponse;
          if (obj.id === id) {
            proc.stdout!.off('data', onData);
            clearTimeout(t);
            resolve(obj);
            return;
          }
        } catch {
          // Not JSON; ignore.
        }
      }
    };
    const t = setTimeout(() => {
      proc.stdout!.off('data', onData);
      reject(new Error(`Timeout waiting for id=${id} after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', () => {
      /* swallow */
    });
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const proc = child();

  // 1) initialize
  send(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-audit-script', version: '0.1.0' },
    },
  });
  const init = await readOne(proc, 1, 15_000);
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
  console.log('✓ initialized');

  // 2) notifications/initialized
  send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

  // 3) tools/list (sanity check)
  send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = await readOne(proc, 2, 10_000);
  const tools = list.result?.tools?.map((t) => t.name) ?? [];
  console.log(`✓ tools/list returned: ${tools.join(', ')}`);
  if (!tools.includes('audit_github_repository')) {
    throw new Error('audit_github_repository not in tools/list');
  }

  // 4) tools/call audit_github_repository
  const t0 = Date.now();
  send(proc, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'audit_github_repository',
      arguments: {
        repo_url: repoUrl,
        mode,
        target: 'open_source',
        output_language: 'en',
        include_launch_copy: true,
      },
    },
  });
  const call = await readOne(proc, 3, 120_000);
  const duration = Date.now() - t0;

  if (call.error) throw new Error(`audit_github_repository failed: ${call.error.message}`);
  const text = call.result?.content?.[0]?.text;
  if (!text) throw new Error('no text in audit response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  console.log(`✓ audit_github_repository returned in ${(duration / 1000).toFixed(2)}s`);

  // 5) shutdown
  try {
    proc.kill('SIGTERM');
  } catch {
    /* noop */
  }

  // 6) persist
  const baseName = `mcp-audit-${repoSlug}-${mode}-${stamp}`;
  const jsonPath = join(OUT_DIR, `${baseName}.json`);
  const mdPath = join(OUT_DIR, `${baseName}.md`);
  const htmlPath = join(OUT_DIR, `${baseName}.html`);

  writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');
  console.log(`✓ wrote ${basename(jsonPath)}`);

  const md = renderMarkdown(parsed, { repoUrl, mode, durationMs: duration });
  writeFileSync(mdPath, md, 'utf8');
  console.log(`✓ wrote ${basename(mdPath)}`);

  const html = renderHtml(md, { repoUrl, mode, durationMs: duration });
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`✓ wrote ${basename(htmlPath)}`);

  // 7) summary
  const summary = parsed as {
    summary?: string;
    scores?: number;
    scoreBreakdown?: { documentation?: number; reproducibility?: number; securityHygiene?: number; deploymentReadiness?: number };
    detectedStack?: string[];
    blockerCount?: number;
    documentationGapCount?: number;
    securityFindingCount?: number;
    status?: string;
  };
  if (summary) {
    console.log('\n── Audit summary ──');
    console.log(`Status      : ${summary.status ?? 'unknown'}`);
    console.log(`Headline    : ${summary.summary ?? '(none)'}`);
    if (typeof summary.scores === 'number') {
      const sb = summary.scoreBreakdown ?? {};
      console.log(
        `Scores      : overall=${summary.scores}  doc=${sb.documentation ?? '?'}  repro=${sb.reproducibility ?? '?'}  sec=${sb.securityHygiene ?? '?'}  deploy=${sb.deploymentReadiness ?? '?'}`,
      );
    }
    console.log(
      `Counts      : blockers=${summary.blockerCount}  docGaps=${summary.documentationGapCount}  secFindings=${summary.securityFindingCount}`,
    );
    if (summary.detectedStack && summary.detectedStack.length > 0) {
      console.log(`Stack       : ${summary.detectedStack.join(', ')}`);
    }
  }
  console.log('\nAll outputs in: ' + OUT_DIR);
}

function renderMarkdown(
  parsed: unknown,
  ctx: { repoUrl: string; mode: string; durationMs: number },
): string {
  const p = parsed as {
    status?: string;
    reportVersion?: string;
    summary?: string;
    scores?: number;
    scoreBreakdown?: { documentation?: number; reproducibility?: number; securityHygiene?: number; deploymentReadiness?: number };
    detectedStack?: string[];
    blockerCount?: number;
    documentationGapCount?: number;
    securityFindingCount?: number;
    repository?: { owner?: string; name?: string; defaultBranch?: string; lastUpdatedAt?: string; stars?: number; openIssues?: number; openPulls?: number; description?: string };
    launchChecklist?: Array<{ id?: string; title?: string; done?: boolean; evidence?: string[] }>;
    report?: {
      blockers?: Array<{ id: string; severity: string; title: string; description?: string; rationale?: string; evidence?: Array<{ file: string; line?: number | null; reason: string }>; recommendedAction?: string; acceptanceCriteria?: string[] }>;
      documentationGaps?: Array<{ id: string; severity: string; title: string; description?: string; rationale?: string; evidence?: Array<{ file: string; line?: number | null; reason: string }>; recommendedAction?: string; acceptanceCriteria?: string[] }>;
      securityFindings?: Array<{ id: string; severity: string; title: string; description?: string; rationale?: string; evidence?: Array<{ file: string; line?: number | null; reason: string }>; recommendedAction?: string; acceptanceCriteria?: string[] }>;
      launchCopy?: { oneSentencePitch?: string; shortDescription?: string; xPost?: string };
      deploymentPlan?: unknown;
      recommendedTasks?: Array<{ id: string; title: string; estimate?: string; priority?: string }>;
      limitations?: string[];
    };
  };

  const fmtNum = (n: number | undefined): string => (typeof n === 'number' ? String(n) : '—');
  const lines: string[] = [];
  lines.push(`# MCP audit_github_repository — real run`);
  lines.push('');
  lines.push(`- Repository: \`${ctx.repoUrl}\``);
  lines.push(`- Mode: \`${ctx.mode}\``);
  lines.push(`- Status: \`${p.status ?? 'unknown'}\``);
  lines.push(`- Report version: \`${p.reportVersion ?? '?'}\``);
  lines.push(`- Duration: **${(ctx.durationMs / 1000).toFixed(2)}s**`);
  if (p.repository) {
    const r = p.repository;
    lines.push(
      `- Repo: \`${r.owner}/${r.name}\` · default branch: \`${r.defaultBranch}\` · stars: ${r.stars ?? '?'} · open issues: ${r.openIssues ?? '?'} · last update: ${r.lastUpdatedAt ?? '?'}`,
    );
    if (r.description) lines.push(`- Description: ${r.description}`);
  }
  lines.push('');

  lines.push(`## Headline`);
  lines.push(p.summary ?? '_(none)_');
  lines.push('');

  lines.push(`## Scores`);
  lines.push(`| Dimension | Score |`);
  lines.push(`| --- | --- |`);
  lines.push(`| **Overall** | **${fmtNum(p.scores)}** |`);
  const sb = p.scoreBreakdown ?? {};
  lines.push(`| Documentation | ${fmtNum(sb.documentation)} |`);
  lines.push(`| Reproducibility | ${fmtNum(sb.reproducibility)} |`);
  lines.push(`| Security hygiene | ${fmtNum(sb.securityHygiene)} |`);
  lines.push(`| Deployment readiness | ${fmtNum(sb.deploymentReadiness)} |`);
  lines.push('');

  if (p.detectedStack && p.detectedStack.length > 0) {
    lines.push(`## Detected stack`);
    for (const s of p.detectedStack) lines.push(`- \`${s}\``);
    lines.push('');
  }

  lines.push(`## Counts`);
  lines.push(`- Blockers: **${fmtNum(p.blockerCount)}**`);
  lines.push(`- Documentation gaps: **${fmtNum(p.documentationGapCount)}**`);
  lines.push(`- Security findings: **${fmtNum(p.securityFindingCount)}**`);
  lines.push('');

  const renderList = (
    label: string,
    items: Array<{ id: string; severity: string; title: string; description?: string; rationale?: string; evidence?: Array<{ file: string; line?: number | null; reason: string }>; recommendedAction?: string; acceptanceCriteria?: string[] }> | undefined,
  ) => {
    if (!items?.length) return;
    lines.push(`## ${label}`);
    for (const it of items) {
      lines.push(`### [${it.severity}] ${it.title}`);
      lines.push(`- id: \`${it.id}\``);
      if (it.description) lines.push(`- description: ${it.description}`);
      if (it.rationale) lines.push(`- rationale: ${it.rationale}`);
      if (it.recommendedAction) lines.push(`- recommended action: ${it.recommendedAction}`);
      if (it.acceptanceCriteria?.length) {
        lines.push(`- acceptance criteria:`);
        for (const a of it.acceptanceCriteria) lines.push(`  - ${a}`);
      }
      if (it.evidence && it.evidence.length > 0) {
        lines.push(`- evidence:`);
        for (const e of it.evidence) {
          const lineStr = e.line == null ? '' : `:${e.line}`;
          lines.push(`  - \`${e.file}${lineStr}\` — ${e.reason}`);
        }
      }
      lines.push('');
    }
  };
  const r = p.report;
  renderList('Blockers', r?.blockers);
  renderList('Documentation gaps', r?.documentationGaps);
  renderList('Security findings', r?.securityFindings);

  if (r?.launchCopy) {
    lines.push(`## Launch copy`);
    if (r.launchCopy.oneSentencePitch) {
      lines.push(`- One-sentence pitch: ${r.launchCopy.oneSentencePitch}`);
    }
    if (r.launchCopy.shortDescription) {
      lines.push(`- Short description: ${r.launchCopy.shortDescription}`);
    }
    if (r.launchCopy.xPost) {
      lines.push(`- X post: ${r.launchCopy.xPost}`);
    }
    lines.push('');
  }

  if (r?.recommendedTasks?.length) {
    lines.push(`## Recommended tasks`);
    for (const t of r.recommendedTasks) {
      lines.push(`- [${t.priority ?? '?'}] ${t.title} _(${t.estimate ?? '?'})_`);
    }
    lines.push('');
  }

  if (p.launchChecklist?.length) {
    lines.push(`## Launch checklist`);
    for (const c of p.launchChecklist) {
      const mark = c.done ? 'x' : ' ';
      const ev = c.evidence && c.evidence.length > 0 ? ` — ${c.evidence.join('; ')}` : '';
      lines.push(`- [${mark}] ${c.title ?? c.id ?? '(unknown)'}${ev}`);
    }
    lines.push('');
  }

  if (r?.limitations?.length) {
    lines.push(`## Limitations`);
    for (const l of r.limitations) lines.push(`- ${l}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderHtml(md: string, ctx: { repoUrl: string; mode: string; durationMs: number }): string {
  // Minimal HTML: the markdown body is rendered below in <pre> for fidelity;
  // browser screenshot will then show it as a clean readable page.
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>RepoPilot MCP audit — ${ctx.repoUrl} (${ctx.mode})</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; padding: 0; background: #f6f7f9; color: #1f2328;
  }
  .wrap { max-width: 1100px; margin: 32px auto; padding: 0 24px; }
  .meta { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
  .meta h1 { margin: 0 0 8px 0; font-size: 22px; }
  .meta code { background: #f0f0f0; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #1f883d; color: #fff; margin-left: 6px; }
  pre {
    background: #fff; border: 1px solid #d0d7de; border-radius: 8px;
    padding: 20px 24px; white-space: pre-wrap; word-wrap: break-word;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.5;
  }
  .footer { color: #656d76; font-size: 12px; margin-top: 16px; text-align: right; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="meta">
      <h1>RepoPilot <span class="badge">MCP</span></h1>
      <div>Repository: <code>${ctx.repoUrl.replace(/</g, '&lt;')}</code> · Mode: <code>${ctx.mode}</code> · Duration: <code>${(ctx.durationMs / 1000).toFixed(2)}s</code></div>
    </div>
    <pre>${escaped}</pre>
    <div class="footer">RepoPilot v0.1.0-rc.2 · MCP stdio transport · real GitHub call</div>
  </div>
</body>
</html>`;
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
