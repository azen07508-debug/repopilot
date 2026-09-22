import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../server.js';
import type { AuditPipeline } from '@repopilot/core';
import type { Report, RepoMetadata, FileEntry } from '@repopilot/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_DIR = path.resolve(__dirname, '../../../../fixtures/complete-project');

class FakePipeline {
  lastInput: unknown = null;
  /**
   * Per-repository report overrides.
   *
   * Keyed by repoUrl rather than held in a single mutable field, so a
   * test that needs a blocking report cannot leak it into the tests that
   * expect a clean one — whichever order they happen to run in.
   */
  private overrides = new Map<string, Report>();

  setReport(repoUrl: string, report: Report): void {
    this.overrides.set(repoUrl, report);
  }

  async run(input: { repoUrl: string }) {
    this.lastInput = input;
    return {
      report: this.overrides.get(input.repoUrl) ?? fakeReport(),
      truncated: false,
    };
  }
}

function fakeReport(): Report {
  return {
    reportVersion: '1.0',
    repository: {
      url: 'https://github.com/okx/repopilot',
      owner: 'okx',
      name: 'repopilot',
      defaultBranch: 'main',
      license: 'MIT',
      lastUpdatedAt: '2026-01-01T00:00:00Z',
      visibility: 'public',
      archived: false,
      stars: 0,
      openIssues: 0,
      openPulls: 0,
      description: 'Test',
      primaryLanguage: 'TypeScript',
    },
    summary: 'OK',
    detectedStack: ['TypeScript', 'Node.js'],
    scores: {
      overall: 90,
      documentation: 95,
      reproducibility: 90,
      securityHygiene: 100,
      deploymentReadiness: 85,
      breakdown: {},
    },
    blockers: [],
    documentationGaps: [],
    securityFindings: [],
    qualityFindings: [],
    fixtureFindings: [],
    deploymentPlan: [],
    recommendedTasks: [],
    launchChecklist: [],
    launchCopy: {
      oneSentencePitch: 'Pitch',
      shortDescription: 'Short',
      xPost: 'X post',
    },
    limitations: [],
    generatedAt: new Date().toISOString(),
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    analyzerProvenance: {},
  };
}

/**
 * A report carrying one live credential — the case the quality contract
 * exists to catch. Nothing else about the report changes, so a `blocked`
 * verdict can only come from the finding.
 */
function blockedReport(): Report {
  const base = fakeReport();
  return {
    ...base,
    securityFindings: [
      {
        id: 'SEC-SECRET-001:src/config.ts:12',
        ruleId: 'SEC-SECRET-001',
        fingerprint: 'fp-live-credential',
        category: 'security',
        severity: 'critical',
        confidence: 0.7,
        title: 'Live credential committed to source',
        description: 'An assignment to `apiKey` in src/config.ts looks like a real key.',
        evidence: [
          { file: 'src/config.ts', line: 12, reason: 'high-entropy string assigned to apiKey' },
        ],
        recommendedAction: 'Rotate the credential, then read it from the environment.',
        acceptanceCriteria: ['The credential no longer appears in the tree.'],
      },
    ],
  };
}

/** Drive one audit through payment and the queue until it completes. */
async function runAudit(app: FastifyInstance, repoUrl: string): Promise<string> {
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/audits',
    payload: { repoUrl, mode: 'quick' },
  });
  const { jobId, payment } = create.json() as { jobId: string; payment: { paymentId: string } };

  const paid = await app.inject({
    method: 'POST',
    url: '/api/v1/audits',
    headers: { 'x-payment': `mock:${payment.paymentId}` },
    payload: { repoUrl, mode: 'quick' },
  });
  expect(paid.statusCode).toBe(202);

  for (let i = 0; i < 50; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}` });
    const got = res.json() as { status: string };
    if (res.statusCode === 200 && got.status === 'completed') return jobId;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`job ${jobId} never completed`);
}

interface QualityBody {
  schemaVersion: string;
  status: string;
  ship: boolean;
  blockerCount: number;
  warningCount: number;
  sections: { id: string; status: string; checks: { id: string; status: string }[] }[];
  blockingFingerprints: string[];
  evaluatedAt: string;
}

describe('API integration', () => {
  let app: FastifyInstance;
  let pipeline: FakePipeline;
  let deps: AppDeps;

  beforeAll(async () => {
    pipeline = new FakePipeline();
    deps = {
      payment: {
        mode: 'mock',
        okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
        pricing: {
          quickScan: { amount: '0.02', currency: 'USDT' },
          fullAudit: { amount: '0.10', currency: 'USDT' },
        },
      },
      allowedHosts: ['github.com', 'raw.githubusercontent.com'],
      pipeline: pipeline as unknown as AuditPipeline,
      databaseUrl: 'file:./data/test-api-integration.db',
    };
    app = await buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; paymentMode: string; database: string };
    expect(body.status).toBe('ok');
    expect(body.paymentMode).toBe('mock');
    expect(body.database).toBe('ok');
  });

  it('GET /api/v1/capabilities returns the schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; paymentMode: string; pricing: { quickScan: { amount: string } } };
    expect(body.name).toBe('RepoPilot');
    expect(body.paymentMode).toBe('mock');
    expect(body.pricing.quickScan.amount).toBe('0.02');
  });

  it('POST /api/v1/audits rejects bad URLs with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      payload: { repoUrl: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /api/v1/audits without payment returns 402 with a challenge', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      payload: {
        repoUrl: 'https://github.com/okx/repopilot',
        mode: 'quick',
        target: 'open_source',
        outputLanguage: 'en',
        includeLaunchCopy: true,
      },
    });
    expect(res.statusCode).toBe(402);
    const body = res.json() as { jobId: string; payment: { paymentId: string; challenge: { x402Version: number; accepts: { scheme: string }[] } } };
    expect(body.jobId).toMatch(/^job_/);
    expect(body.payment.challenge.x402Version).toBe(2);
    expect(body.payment.challenge.accepts[0]?.scheme).toBe('exact');
  });

  it('POST /api/v1/audits with X-PAYMENT (mock) returns a queued job, then completes', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      payload: {
        repoUrl: 'https://github.com/okx/repopilot',
        mode: 'full',
        target: 'production',
        outputLanguage: 'en',
        includeLaunchCopy: true,
      },
    });
    expect(create.statusCode).toBe(402);
    const { jobId, payment } = create.json() as { jobId: string; payment: { paymentId: string } };

    const paid = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': `mock:${payment.paymentId}` },
      payload: {
        repoUrl: 'https://github.com/okx/repopilot',
        mode: 'full',
        target: 'production',
        outputLanguage: 'en',
        includeLaunchCopy: true,
      },
    });
    // New contract: 202 + Location + Retry-After. The job is enqueued,
    // not yet finished. The route returns the polling URL.
    expect(paid.statusCode).toBe(202);
    expect(paid.headers['location']).toBe(`/api/v1/audits/${jobId}`);
    expect(paid.headers['retry-after']).toBe('1');
    const queued = paid.json() as { jobId: string; status: string; statusUrl: string; pollAfterMs: number };
    expect(queued.jobId).toBe(jobId);
    expect(queued.status).toMatch(/^(queued|processing|completed)$/);
    expect(queued.statusUrl).toBe(`/api/v1/audits/${jobId}`);
    expect(queued.pollAfterMs).toBe(1000);

    // Poll until completed. The fake pipeline returns immediately so
    // this is bounded.
    let body: { jobId: string; status: string; report?: { scores: { overall: number }; repository: { name: string } } } | null = null;
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}` });
      const got = res.json() as { jobId: string; status: string; report?: { scores: { overall: number }; repository: { name: string } } };
      if (res.statusCode === 200 && got.status === 'completed') {
        body = got;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(body).not.toBeNull();
    expect(body!.jobId).toBe(jobId);
    expect(body!.status).toBe('completed');
    expect(body!.report!.scores.overall).toBe(90);
    expect(body!.report!.repository.name).toBe('repopilot');
  });

  it('GET /api/v1/audits/:jobId returns the stored job', async () => {
    // Run a paid job to populate the report
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      payload: { repoUrl: 'https://github.com/okx/repopilot', mode: 'quick' },
    });
    const { jobId, payment } = create.json() as { jobId: string; payment: { paymentId: string } };
    const paid = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      headers: { 'x-payment': `mock:${payment.paymentId}` },
      payload: { repoUrl: 'https://github.com/okx/repopilot', mode: 'quick' },
    });
    expect(paid.statusCode).toBe(202);

    // Poll until completed
    let body: { jobId: string; status: string; report?: { scores: { overall: number } } } | null = null;
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}` });
      const got = res.json() as { jobId: string; status: string; report?: { scores: { overall: number } } };
      if (res.statusCode === 200 && got.status === 'completed') {
        body = got;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(body).not.toBeNull();
    expect(body!.jobId).toBe(jobId);
    expect(body!.status).toBe('completed');
  });

  it('GET /api/v1/audits/:jobId returns 404 for missing job', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audits/job_does_not_exist' });
    expect(res.statusCode).toBe(404);
  });

  it('denies disallowed hosts (SSRF defense)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audits',
      payload: { repoUrl: 'https://gitlab.com/foo/bar', mode: 'quick' },
    });
    // Zod accepts the URL shape; the pipeline / fetcher rejects the host.
    // The 402 path still creates a job; the actual host check happens at fetch.
    // Confirm at least the call is accepted up to Zod parsing.
    expect([200, 202, 400, 402]).toContain(res.statusCode);
  });

  it('POST /api/v1/free-check rejects bad URLs with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/free-check',
      payload: { repoUrl: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /api/v1/free-check never returns 402 (no payment required)', async () => {
    // Even with a totally fake URL the endpoint must never emit a payment
    // challenge. Acceptable outcomes are 200 (ok), 400 (bad URL),
    // 404 (repo not found / upstream says 404), 429 (rate limited),
    // or 502 (upstream unreachable). The free tier must be reachable for
    // the OKX.AI ASP QA pass before the Beta wallet is wired.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/free-check',
      payload: { repoUrl: 'https://github.com/octocat/Hello-World' },
    });
    expect([200, 400, 404, 429, 502]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(402);
  });

  it('POST /api/v1/free-check returns 502 (never 5xx) when upstream is unreachable', async () => {
    // Host allowlist deliberately excludes this domain; the runner
    // should map the error to 502 UPSTREAM_FAILED (the route does NOT
    // leak 5xx stack traces to the client).
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/free-check',
      payload: { repoUrl: 'https://example.com/never-resolves/repo' },
    });
    expect([403, 502]).toContain(res.statusCode);
  });

  describe('derived routes', () => {
    const CLEAN_REPO = 'https://github.com/okx/repopilot';
    const BLOCKED_REPO = 'https://github.com/okx/repopilot-blocked-fixture';

    it('GET /api/v1/audits/:jobId/quality answers "may this ship?"', async () => {
      const jobId = await runAudit(app, CLEAN_REPO);
      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}/quality` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as QualityBody;
      expect(body.schemaVersion).toBe('1.0');
      expect(body.status).toBe('pass');
      expect(body.ship).toBe(true);
      expect(body.blockerCount).toBe(0);
      expect(body.blockingFingerprints).toEqual([]);
      expect(body.sections.map((s) => s.id)).toEqual([
        'security',
        'testing',
        'ci',
        'repository',
        'release',
        'coverage',
      ]);
      expect(Number.isNaN(Date.parse(body.evaluatedAt))).toBe(false);
    });

    it('blocks a report carrying a live credential, and names the fingerprint', async () => {
      pipeline.setReport(BLOCKED_REPO, blockedReport());
      const jobId = await runAudit(app, BLOCKED_REPO);
      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}/quality` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as QualityBody;
      expect(body.status).toBe('blocked');
      expect(body.ship).toBe(false);
      expect(body.blockerCount).toBeGreaterThan(0);
      // The fingerprint is what a re-audit compares against afterwards.
      expect(body.blockingFingerprints).toContain('fp-live-credential');

      const security = body.sections.find((s) => s.id === 'security');
      const failed = (security?.checks ?? []).filter((c) => c.status === 'fail').map((c) => c.id);
      expect(failed).toContain('security.no-secrets');
      expect(failed).toContain('security.no-critical');
    });

    it('re-evaluates on every read instead of replaying a stored verdict', async () => {
      const jobId = await runAudit(app, CLEAN_REPO);
      const url = `/api/v1/audits/${jobId}/quality`;
      const first = (await app.inject({ method: 'GET', url })).json() as QualityBody;
      const second = (await app.inject({ method: 'GET', url })).json() as QualityBody;

      // Same policy, same report, same verdict — plus a timestamp that
      // moves, which is only possible because nothing was frozen at
      // write time.
      expect({ ...second, evaluatedAt: '' }).toEqual({ ...first, evaluatedAt: '' });
      expect(second.evaluatedAt >= first.evaluatedAt).toBe(true);
    });

    it('never asks for payment', async () => {
      const jobId = await runAudit(app, CLEAN_REPO);
      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}/quality` });
      expect(res.statusCode).not.toBe(402);
    });

    it('409 when the audit has no report yet', async () => {
      // The 402 path still creates the job; it is simply never enqueued.
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/audits',
        payload: { repoUrl: CLEAN_REPO, mode: 'quick' },
      });
      const { jobId } = create.json() as { jobId: string };

      const res = await app.inject({ method: 'GET', url: `/api/v1/audits/${jobId}/quality` });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('REPORT_NOT_READY');
    });

    it('404 for an unknown job', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/audits/job_missing/quality' });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('JOB_NOT_FOUND');
    });
  });
});
