/**
 * Minimal typed client for the RepoPilot API.
 *
 * Report-shaped types are imported from `@repopilot/core` so the UI
 * cannot silently drift from the report schema. The import is
 * type-only on purpose: `@repopilot/core` depends on `@octokit/rest`,
 * which must never reach the browser bundle.
 *
 * `Health` and `AuditResponse` stay here because they describe the HTTP
 * transport contract, not the report schema.
 */
import type {
  AuditMode,
  AuditTarget,
  AuditDiff,
  Capabilities,
  CreateAuditInput,
  Evidence,
  Finding,
  FixPlanSet,
  OutputLanguage,
  Report,
  ScoreBreakdown,
} from '@repopilot/core';

export type Mode = AuditMode;
export type Target = AuditTarget;
export type Language = OutputLanguage;

export type {
  AuditDiff,
  Capabilities,
  CreateAuditInput,
  Evidence,
  Finding,
  FixPlanSet,
  Report,
  ScoreBreakdown,
};

export interface Health {
  status: 'ok';
  version: string;
  paymentMode: 'mock' | 'okx';
  database: 'ok' | 'degraded';
}

export type AuditResponse =
  | { jobId: string; status: 'completed'; report: Report }
  | {
      jobId: string;
      status: 'queued' | 'processing' | 'failed';
      payment?: {
        paymentId: string;
        mode: 'mock' | 'okx';
        amount: string;
        currency: string;
        challenge: unknown;
        expiresAt: string;
      };
      report?: Report;
      error?: string;
    };

const base = '';

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${base}/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function getCapabilities(): Promise<Capabilities> {
  const r = await fetch(`${base}/api/v1/capabilities`);
  if (!r.ok) throw new Error(`capabilities ${r.status}`);
  return r.json();
}

export async function createAudit(input: CreateAuditInput, paymentHeader?: string): Promise<AuditResponse> {
  const r = await fetch(`${base}/api/v1/audits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(paymentHeader ? { 'x-payment': paymentHeader } : {}),
    },
    body: JSON.stringify(input),
  });
  const body = await r.json();
  if (r.status === 402) {
    return body as AuditResponse;
  }
  if (!r.ok) {
    throw new Error(body?.error?.message ?? `audit ${r.status}`);
  }
  return body as AuditResponse;
}

export async function getAudit(jobId: string): Promise<AuditResponse> {
  const r = await fetch(`${base}/api/v1/audits/${encodeURIComponent(jobId)}`);
  if (!r.ok) throw new Error(`audit ${r.status}`);
  return r.json();
}

/* ---------- Derived views ----------
 *
 * These three endpoints answer questions about audits that already
 * happened. They are free and they never re-scan a repository, so the
 * UI can call them as often as it likes.
 */

export interface AuditHistoryEntry {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  commitSha: string | null;
  mode: Mode;
  target: Target;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  overall: number | null;
  findingCount: number | null;
}

export interface AuditHistory {
  owner: string;
  repo: string;
  limit: number;
  count: number;
  audits: AuditHistoryEntry[];
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `${what} ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export function getFixPlan(jobId: string): Promise<FixPlanSet> {
  return getJson<FixPlanSet>(`/api/v1/audits/${encodeURIComponent(jobId)}/fix-plan`, 'fix-plan');
}

export function getAuditDiff(jobId: string, base: string): Promise<AuditDiff> {
  return getJson<AuditDiff>(
    `/api/v1/audits/${encodeURIComponent(jobId)}/diff?base=${encodeURIComponent(base)}`,
    'diff'
  );
}

export function listRepoAudits(owner: string, repo: string, limit = 20): Promise<AuditHistory> {
  return getJson<AuditHistory>(
    `/api/v1/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/audits?limit=${limit}`,
    'history'
  );
}
