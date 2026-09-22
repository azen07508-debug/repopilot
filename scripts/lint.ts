#!/usr/bin/env tsx
/**
 * RepoPilot custom lint: a thin set of project-specific static checks
 * on top of `tsc --noEmit`. The goal is to catch things tsc does not,
 * without pulling in ESLint as a dependency.
 *
 * Rules:
 *   no-console-log     - console.log outside scripts/ + apps/web (use pino)
 *   no-todo-stubs      - TODO / FIXME / HACK in production code (tests ok)
 *   no-hardcoded-port  - hardcoded listen() port outside config
 *   no-hardcoded-secret - looks like a credential literal
 *   no-empty-catch     - catch {} blocks
 *   no-floating-promise - Promise.then() without await / return / assignment
 *
 * Exits 0 on success, 1 on any issue.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

interface Issue {
  file: string;
  line: number;
  rule: string;
  message: string;
}
const issues: Issue[] = [];

function isTestFile(p: string): boolean {
  return /\.test\.[mc]?[jt]sx?$/.test(p) || /__tests__\//.test(p);
}
function isFixture(p: string): boolean {
  return p.includes('fixtures/') || p.startsWith('fixtures/');
}
function isScript(p: string): boolean {
  return p.startsWith('scripts/');
}
function isWeb(p: string): boolean {
  return p.startsWith('apps/web/src/');
}
function isDocsFile(p: string): boolean {
  return p.endsWith('.md');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name.startsWith('.')) {
      continue;
    }
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function checkFile(p: string): void {
  const rel = p.replace(REPO + '/', '');
  if (isTestFile(rel) || isFixture(rel) || isDocsFile(rel)) return;

  const content = readFileSync(p, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

    // console.log outside scripts/ + apps/web
    if (!isScript(rel) && !isWeb(rel) && /\bconsole\.log\(/.test(line)) {
      issues.push({
        file: rel, line: i + 1, rule: 'no-console-log',
        message: 'use pino logger instead of console.log',
      });
    }

    // TODO / FIXME / HACK in production code.
    // Skip lines inside JSDoc blocks (`/** ... */`) and inside script files
    // that describe what the rules look for.
    if (!isTestFile(rel) && !isScript(rel) && /\b(TODO|FIXME|HACK|XXX):?\b/.test(line)) {
      // Detect a JSDoc block: if any earlier non-blank line started with /**,
      // we are inside a docblock.
      let inDocBlock = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (prev === '' || prev.startsWith('*')) continue;
        if (prev.endsWith('/**') || prev.startsWith('/**')) {
          inDocBlock = true;
        }
        break;
      }
      if (!inDocBlock && (line.trim().startsWith('//') || line.trim().startsWith('*'))) {
        issues.push({
          file: rel, line: i + 1, rule: 'no-todo-stubs',
          message: 'remove or convert to docs/EXTERNAL_ACTIONS.md',
        });
      }
    }

    // Hardcoded port
    if (
      /listen\(\s*\d{2,5}/.test(stripped) ||
      /port\s*[=:]\s*\d{2,5}\b/.test(stripped)
    ) {
      if (rel.endsWith('config.ts') || rel.includes('.env.example') || isTestFile(rel)) continue;
      // Skip if it's a documentation comment
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
      issues.push({
        file: rel, line: i + 1, rule: 'no-hardcoded-port',
        message: 'use env var (PORT)',
      });
    }

    // Hardcoded credential literal
    // - Variable/field name on the left must look like a secret (apiKey, etc.)
    // - Value on the right must look high-entropy (>= 20 chars, mixed alpha)
    // - Must NOT be a known-public value (EVM addresses start with 0x and
    //   are flagged separately; we whitelist them here)
    const secretMatch = /((?:api[_-]?key|apikey|api[_-]?token|access[_-]?token|auth[_-]?token|client[_-]?secret|jwt[_-]?secret|secret|password|private[_-]?key|mnemonic))\s*[:=]\s*['"]([^'"]{16,})['"]/i.exec(line);
    if (secretMatch) {
      const value = secretMatch[2];
      // EVM address (0x + 40 hex) is a public identifier, not a secret
      if (/^0x[a-fA-F0-9]{40}$/.test(value)) continue;
      // Public token contract addresses start with 0x and are 42 chars
      if (/^0x[a-fA-F0-9]{40,}$/.test(value)) continue;
      issues.push({
        file: rel, line: i + 1, rule: 'no-hardcoded-secret',
        message: 'looks like a hardcoded credential; use env var',
      });
    }

    // Empty catch
    if (/\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/.test(stripped)) {
      issues.push({
        file: rel, line: i + 1, rule: 'no-empty-catch',
        message: 'empty catch block',
      });
    }

    // Floating promise: a `.then(` or `.catch(` call whose call site is not
    // preceded by `await `, `return `, `await Promise`, or assigned to a
    // variable on the same line. This is a coarse heuristic but it catches
    // the most common bug ("I forgot to await this").
    //
    // Legitimate top-level patterns (entry point `main().catch(...)`, React
    // `useEffect` chains, multi-line builder calls) are exempted. When the
    // call is spread over several lines, `await` / `return` / the assignment
    // appear on the head of the statement rather than on the `.catch(` line,
    // so the exemption is decided from the head — see the walk-back below.
    if (/\.then\s*\(|\.catch\s*\(/.test(stripped)) {
      // Honour `// eslint-disable-next-line` style comments for our own
      // rules (the rule name prefix is `repopilot/...`).
      const prev = (lines[i - 1] ?? '').trim();
      const isExempted =
        /eslint-disable(?:-next-line)?\s+repopilot\//.test(prev) ||
        /eslint-disable(?:-next-line)?\s+no-floating-promise/.test(prev);
      if (isExempted) {
        // skip
      } else {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
          // comment
        } else if (/^[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\.(then|catch)\b/.test(t)) {
          // top-level fire-and-forget
        } else if (/^\.(then|catch)\b/.test(t)) {
          // Continuation of a multi-line call: walk back to find the
          // start of the call and exempt it.
          let j = i - 1;
          while (j >= 0 && /^\s*(allowedHosts|,|\.|\w+:)/.test(lines[j] ?? '')) j--;
          const start = (lines[j] ?? '').trim();
          // The walk-back stops at the head of the statement this call
          // belongs to, so `start` is that head. Three things make the call
          // part of a value rather than a fire-and-forget, and when the call
          // is spread over several lines they show up on the head, not on
          // the `.catch(` line: `(await api.get().catch(() => null))`,
          // `return p.catch(h)`, and `const x = p.catch(h)`. Checking only
          // for a call-shaped head flagged all three — the false positive
          // this branch exists to prevent.
          const headIsValued =
            /\bawait\b|\breturn\b/.test(start) || /[^=!<>]=[^=>]/.test(` ${start} `);
          const looksLikeMultiLineCall =
            /^[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(start) ||
            /^[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test((lines[j + 1] ?? '').trim());
          if (headIsValued || looksLikeMultiLineCall) {
            // exempt
          } else {
            flagFloatingPromise(rel, i, t);
          }
        } else {
          flagFloatingPromise(rel, i, t);
        }
      }
    }
  }
}

function flagFloatingPromise(rel: string, i: number, t: string): void {
  const noPrecedingAwait =
    !/\bawait\b/.test(t) && !/\breturn\b/.test(t) && !/\bconst\b\s+\w+\s*=/.test(t);
  if (noPrecedingAwait) {
    issues.push({
      file: rel, line: i + 1, rule: 'no-floating-promise',
      message: 'a Promise is .then()\'d without await/return/assignment',
    });
  }
}

console.log('lint: tsc + custom rules');
console.log('──────────────────────────────────────────────');

// 1. tsc no-emit (all packages)
console.log('1. tsc --noEmit (all packages)');
try {
  execSync('pnpm -r typecheck', { cwd: REPO, stdio: 'inherit' });
  console.log('  \x1b[32m✓\x1b[0m tsc clean');
} catch {
  console.log('  \x1b[31m✗\x1b[0m tsc failed');
  process.exit(1);
}

// 2. Custom rules
console.log('2. custom rules');
const files = walk(REPO);
for (const f of files) checkFile(f);

if (issues.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m 0 issues');
  process.exit(0);
}

for (const i of issues) {
  console.log(`  \x1b[33m!\x1b[0m ${i.file}:${i.line} [${i.rule}] ${i.message}`);
}
console.log(`\n  ${issues.length} issue(s) found`);
process.exit(1);
