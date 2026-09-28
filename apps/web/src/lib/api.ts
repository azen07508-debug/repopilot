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

/**
 * The error envelope the API sends on 4xx and on `status: 'failed'`.
 *
 * It is an object, not a string: `{ code, message }` (`routes/audits.ts`).
 * This type said `string`, so the UI would have put an object into React
 * state and thrown when it tried to render it.
 */
export interface ApiErrorEnvelope {
  code: string;
  message: string;
  payment?: unknown;
}

/**
 * Every shape `POST /api/v1/audits` and `GET /api/v1/audits/:jobId` can
 * return, as discriminated unions on `status`.
 *
 * The previous version of this type claimed a queued response might carry a
 * `report` and omitted `statusUrl` / `pollAfterMs`, which are required by the
 * OpenAPI schema. That is what let `onSubmit` treat a queued response as
 * neither a report nor an error and drop it.
 */
export type AuditResponse =
  /**
   * Settled with a report. `report` is `null` only if a completed row lost
   * its payload — the route parses `job.report ? ... : null`.
   */
  | { jobId: string; status: 'completed'; report: Report | null; createdAt?: string; completedAt?: string | null }
  /** Accepted, not finished. Poll `statusUrl` after `pollAfterMs`. */
  | {
      jobId: string;
      status: 'queued' | 'processing';
      statusUrl: string;
      pollAfterMs: number;
      createdAt?: string;
      /** Present on the 402 challenge: how to settle it. */
      payment?: {
        paymentId: string;
        mode: 'mock' | 'okx';
        amount: string;
        currency: string;
        challenge: unknown;
        expiresAt: string;
      };
      nextAction?: string;
    }
  /** Settled without a report. */
  | { jobId: string; status: 'failed'; error: ApiErrorEnvelope; createdAt?: string; failedAt?: string | null }
  /** Payment not settled (402), or a bare error envelope. */
  | { error: ApiErrorEnvelope; paymentId?: string; jobId?: string; status?: 'queued' };

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

/**
 * Poll a job until it settles, and return its report.
 *
 * This exists because `POST /api/v1/audits` is asynchronous *by design*:
 * `InlineAuditQueue.enqueue()` "schedules the job on a small, bounded worker
 * pool and returns immediately. The HTTP request never waits for the
 * analysis." A settled POST therefore answers 202 with `statusUrl` and
 * `pollAfterMs` — never a report.
 *
 * The UI used to assume the mock replay came back synchronously. It never
 * did, so neither the `report` branch nor the `error` branch matched and
 * the submit click became a silent no-op: no report, no message, nothing
 * to click. Polling is the missing half of that contract, not a workaround.
 */
export interface WaitForReportOptions {
  /** Server-supplied `pollAfterMs`. Defaults to 1000. */
  intervalMs?: number;
  /** Give up after this long. Defaults to 120s. */
  timeoutMs?: number;
  /** Called after each poll that has not settled yet. */
  onPoll?: (elapsedMs: number, status: AuditResponse['status']) => void;
}

export async function waitForReport(jobId: string, opts: WaitForReportOptions = {}): Promise<Report> {
  const intervalMs = Math.max(0, opts.intervalMs ?? 1000);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  for (;;) {
    const r = await getAudit(jobId);
    if ('error' in r) throw new Error(r.error.message);
    if (r.status === 'completed') {
      if (!r.report) throw new Error('Audit completed but the report payload is missing');
      return r.report;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(`Audit did not finish within ${Math.round(timeoutMs / 1000)}s`);
    }
    opts.onPoll?.(elapsed, r.status);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Turn any audit response into a report, polling if the job is still running.
 *
 * This is the single entry point the UI should use. `POST /api/v1/audits` is
 * asynchronous by design — `InlineAuditQueue.enqueue()` "schedules the job on
 * a small, bounded worker pool and returns immediately. The HTTP request never
 * waits for the analysis" — so a settled POST answers 202, never a report.
 * Reading the report is a separate GET, and that step was missing.
 */
export async function settleAudit(r: AuditResponse, opts: WaitForReportOptions = {}): Promise<Report> {
  // The `failed` variant and the bare error envelope both carry `error`.
  if ('error' in r) throw new Error(r.error.message);
  if (r.status === 'completed') {
    if (!r.report) throw new Error('Audit completed but the report payload is missing');
    return r.report;
  }
  return waitForReport(r.jobId, { intervalMs: r.pollAfterMs, ...opts });
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
