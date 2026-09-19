/**
 * Minimal typed client for the RepoPilot API.
 */
export type Mode = 'quick' | 'full';
export type Target = 'hackathon' | 'open_source' | 'production';
export type Language = 'en' | 'zh-CN';

export interface ScoreBreakdown {
  raw: number;
  rules: { rule: string; delta: number; reason: string }[];
  final: number;
}

export interface Evidence {
  file: string;
  line: number | null;
  reason: string;
}

export interface Finding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: Evidence[];
  recommendedAction: string;
  acceptanceCriteria: string[];
}

export interface Report {
  reportVersion: string;
  repository: {
    url: string;
    owner: string;
    name: string;
    defaultBranch: string;
    license: string | null;
    lastUpdatedAt: string | null;
    visibility: string;
    stars: number;
    openIssues: number;
    description: string | null;
    primaryLanguage: string | null;
  };
  summary: string;
  detectedStack: string[];
  scores: {
    overall: number;
    documentation: number;
    reproducibility: number;
    securityHygiene: number;
    deploymentReadiness: number;
    breakdown: Record<string, ScoreBreakdown | undefined>;
  };
  blockers: Finding[];
  documentationGaps: Finding[];
  securityFindings: Finding[];
  deploymentPlan: { order: number; title: string; description: string; commands: string[] }[];
  recommendedTasks: { id: string; title: string; description: string; effort: string }[];
  launchChecklist: { id: string; title: string; done: boolean; evidence: string[] }[];
  launchCopy: { oneSentencePitch: string; shortDescription: string; xPost: string };
  limitations: string[];
  generatedAt: string;
  auditMode: Mode;
  target: Target;
  outputLanguage: Language;
}

export interface Capabilities {
  name: string;
  version: string;
  paymentMode: 'mock' | 'okx';
  pricing: { quickScan: { amount: string; currency: string }; fullAudit: { amount: string; currency: string } };
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; rateLimitPerMinute: number };
}

export interface Health {
  status: 'ok';
  version: string;
  paymentMode: 'mock' | 'okx';
  database: 'ok' | 'degraded';
}

export type AuditResponse =
  | { jobId: string; status: 'completed'; report: Report }
  | { jobId: string; status: 'queued' | 'processing' | 'failed'; payment?: { paymentId: string; mode: 'mock' | 'okx'; amount: string; currency: string; challenge: unknown; expiresAt: string }; report?: Report; error?: string };

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

export interface CreateAuditInput {
  repoUrl: string;
  mode: Mode;
  target: Target;
  outputLanguage: Language;
  includeLaunchCopy: boolean;
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
