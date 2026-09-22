/**
 * MCP server for RepoPilot.
 *
 * Exposes seven tools, split by cost:
 *
 *   Paid (they run the pipeline):
 *   - audit_github_repository: run a Quick Scan or Full Launch Audit
 *   - reaudit_repository: run a fresh audit of a repo you already audited
 *
 *   Free (pure derivations of a report that already exists):
 *   - quality_status: may this ship? pass / pass_with_warnings / blocked
 *   - release_check: which findings block a release, by fingerprint
 *   - get_fix_plan: actionable plans with evidence and agent instructions
 *   - compare_audits: before/after with rule-level score attribution
 *   - list_audit_history: audits recorded for a repository this session
 *   - get_audit_status: poll a previously created job
 *   - get_repopilot_capabilities: inputs, outputs, limits, pricing, billing
 *
 * The free tools never scan a repository: they call the same pure
 * functions (`buildFixPlanSet`, `diffReports`) the HTTP API uses.
 *
 * Communication is stdio JSON-RPC (the official MCP transport). No
 * credentials are stored here; payment is handled by the OKX adapter
 * configured in the parent process / via env.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  AuditPipeline,
  CreateAuditInputSchema,
  buildFixPlanSet,
  collectFindings,
  diffReports,
  evaluateQualityContract,
  findingKey,
  type CreateAuditInput,
  type Report,
  type Capabilities,
  DEFAULT_LIMITS,
  DEFAULT_PRICING,
  CORE_VERSION,
  ReportSchema,
} from '@repopilot/core';
import { buildPaymentAdapter, type PaymentConfig, priceFor } from '@repopilot/okx-adapter';
import { createLogger } from './logger.js';
import { JobStore, type AuditJob } from './job-store.js';

export interface McpServerOptions {
  payment: PaymentConfig;
  githubToken?: string;
  allowedHosts: string[];
}

/** Which tools cost money. Surfaced by `get_repopilot_capabilities`. */
const BILLING = {
  audit_github_repository: { paid: true, reason: 'Runs the analysis pipeline.' },
  reaudit_repository: { paid: true, reason: 'Runs the analysis pipeline.' },
  get_fix_plan: { paid: false, reason: 'Derived from an existing report.' },
  quality_status: { paid: false, reason: 'Derived from an existing report.' },
  release_check: { paid: false, reason: 'Derived from an existing report.' },
  compare_audits: { paid: false, reason: 'Derived from two existing reports.' },
  list_audit_history: { paid: false, reason: 'Reads recorded job metadata.' },
  get_audit_status: { paid: false, reason: 'Reads recorded job metadata.' },
  get_repopilot_capabilities: { paid: false, reason: 'Static metadata.' },
} as const;

export function buildMcpServer(opts: McpServerOptions): { server: McpServer; jobStore: JobStore } {
  const log = createLogger({ level: process.env['LOG_LEVEL'] ?? 'info', name: 'repopilot-mcp' });
  const jobStore = new JobStore();
  const paymentAdapter = buildPaymentAdapter(opts.payment);
  const pipeline = new AuditPipeline({
    githubToken: opts.githubToken,
    allowedHosts: opts.allowedHosts,
    log,
  });

  const server = new McpServer(
    {
      name: 'repopilot',
      version: CORE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  /**
   * Shared paid path for `audit_github_repository` and
   * `reaudit_repository`.
   *
   * Extracted so the payment handshake, the mock auto-verify and the
   * pipeline invocation exist once. The two tools differ only in how the
   * caller supplies the repository.
   */
  async function runPaidAudit(input: CreateAuditInput, quoteKey: string): Promise<unknown> {
    const job = jobStore.create(input);
    const price = priceFor(opts.payment, input.mode);
    const challenge = await paymentAdapter.createChallenge({
      quote: { ...price, mode: input.mode },
      quoteKey,
    });
    jobStore.attachPayment(job.jobId, challenge.paymentId);

    if (opts.payment.mode === 'mock') {
      // In mock mode we auto-verify so the agent gets a synchronous result.
      const receipt = await paymentAdapter.verifyPayment({
        paymentId: challenge.paymentId,
        rawHeader: `mock:${challenge.paymentId}`,
      });
      if (receipt.status === 'completed') {
        const result = await pipeline.run({
          repoUrl: input.repoUrl,
          mode: input.mode,
          target: input.target,
          outputLanguage: input.outputLanguage,
          includeLaunchCopy: input.includeLaunchCopy,
          llmProviderName: 'none',
          llmProviderConfigured: false,
        });
        jobStore.complete(job.jobId, result.report);
        return reportSummary(result.report);
      }
      jobStore.fail(job.jobId, `Payment failed: ${receipt.status}`);
      return { error: 'payment_failed', paymentId: challenge.paymentId, status: receipt.status };
    }

    // Production OKX flow: caller must retry with X-PAYMENT (handled at the
    // HTTP layer). We return the challenge so the agent can decide.
    return {
      status: 'awaiting_payment',
      jobId: job.jobId,
      paymentId: challenge.paymentId,
      challenge: challenge.challenge,
      price,
      nextAction:
        'Call onchainos payment pay --payment-id <id> --yes, then call get_audit_status with the same paymentId.',
    };
  }

  /** Resolve a completed report or a machine-readable error. */
  function requireReport(jobId: string): { report: Report; job: AuditJob } | { error: string } {
    const job = jobStore.get(jobId);
    if (!job) return { error: 'job_not_found' };
    if (job.status !== 'completed' || !job.report) {
      return { error: `report_not_ready:${job.status}` };
    }
    return { report: job.report as Report, job };
  }

  server.tool(
    'audit_github_repository',
    'Audit a public GitHub repository. Returns a structured launch-readiness report with documented evidence, prioritized blockers, and acceptance criteria. Static analysis only — never executes repository code.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      mode: z.enum(['quick', 'full']).default('quick').describe('Quick Scan (fast) or Full Launch Audit'),
      target: z
        .enum(['hackathon', 'open_source', 'production'])
        .default('open_source')
        .describe('Scoring target — adjusts score weights'),
      output_language: z.enum(['en', 'zh-CN']).default('en').describe('Summary language'),
      include_launch_copy: z
        .boolean()
        .default(true)
        .describe('Whether to include one-sentence pitch, short description, and X post'),
    },
    async (args) => {
      const input = CreateAuditInputSchema.parse({
        repoUrl: args.repo_url,
        mode: args.mode,
        target: args.target,
        outputLanguage: args.output_language,
        includeLaunchCopy: args.include_launch_copy,
      });
      return textResult(await runPaidAudit(input, `mcp:${input.mode}:${input.repoUrl}`));
    }
  );

  server.tool(
    'reaudit_repository',
    'Run a fresh audit of a repository you audited before, after making changes. Paid — it runs the pipeline again. Pair it with compare_audits to see what your fix actually changed.',
    {
      repo_url: z.string().url().describe('The same public GitHub URL you audited before'),
      mode: z.enum(['quick', 'full']).default('quick'),
      target: z.enum(['hackathon', 'open_source', 'production']).default('open_source'),
      output_language: z.enum(['en', 'zh-CN']).default('en'),
      include_launch_copy: z.boolean().default(false),
    },
    async (args) => {
      const input = CreateAuditInputSchema.parse({
        repoUrl: args.repo_url,
        mode: args.mode,
        target: args.target,
        outputLanguage: args.output_language,
        includeLaunchCopy: args.include_launch_copy,
      });
      return textResult(await runPaidAudit(input, `mcp:reaudit:${input.mode}:${input.repoUrl}`));
    }
  );

  server.tool(
    'get_audit_status',
    'Look up the status of a previously created audit job.',
    {
      job_id: z.string().describe('The jobId returned by audit_github_repository'),
    },
    async (args) => {
      const job = jobStore.get(args.job_id);
      if (!job) return textResult({ error: 'job_not_found' });
      return textResult(job);
    }
  );

  server.tool(
    'quality_status',
    'Answer "may this ship?" for a completed audit. Returns pass / pass_with_warnings / blocked, the blocker and warning counts, and a per-section verdict. Free — a deterministic function of the stored report: no LLM, no repository scan. The status is never model-assigned.',
    {
      job_id: z.string().describe('The jobId of a completed audit'),
    },
    async (args) => {
      const loaded = requireReport(args.job_id);
      if ('error' in loaded) return textResult(loaded);

      const result = evaluateQualityContract(loaded.report);
      return textResult({
        status: result.status,
        ship: result.ship,
        blockers: result.blockerCount,
        warnings: result.warningCount,
        sections: result.sections.map((s) => ({ id: s.id, status: s.status })),
      });
    }
  );

  server.tool(
    'release_check',
    'The release gate in detail: exactly which findings block a ship, by rule id and fingerprint. Feed the fingerprints to compare_audits after fixing to confirm the blockers are gone. Free.',
    {
      job_id: z.string().describe('The jobId of a completed audit'),
    },
    async (args) => {
      const loaded = requireReport(args.job_id);
      if ('error' in loaded) return textResult(loaded);

      const result = evaluateQualityContract(loaded.report);
      const blocking = new Set(result.blockingFingerprints);
      const blockers = collectFindings(loaded.report)
        .filter((f) => blocking.has(findingKey(f)))
        .map((f) => ({
          ruleId: f.ruleId ?? f.id,
          fingerprint: findingKey(f),
          severity: f.severity,
          title: f.title,
        }));

      return textResult({
        status: result.status,
        ship: result.ship,
        blockerCount: result.blockerCount,
        blockers,
      });
    }
  );

  server.tool(
    'get_fix_plan',
    'Get an actionable fix plan for a completed audit. One plan per finding, each with its evidence, ordered steps, tests to add, acceptance criteria, estimated effort, risks, and an agentInstructions block you can follow directly. Free — derived from the stored report, no repository scan.',
    {
      job_id: z.string().describe('The jobId of a completed audit'),
    },
    async (args) => {
      const resolved = requireReport(args.job_id);
      if ('error' in resolved) return textResult({ error: resolved.error });
      const planSet = buildFixPlanSet(resolved.report, {
        commitSha: resolved.job.commitSha ?? null,
      });
      return textResult(planSet);
    }
  );

  server.tool(
    'compare_audits',
    'Compare two completed audits of the same repository and explain what changed: the overall and per-dimension score deltas, rule-level attribution of WHY the score moved, and which findings were resolved, newly appeared, or still persist. Free — derived from the two stored reports, no repository scan.',
    {
      base_job_id: z.string().describe('The jobId of the earlier audit'),
      head_job_id: z.string().describe('The jobId of the later audit'),
    },
    async (args) => {
      if (args.base_job_id === args.head_job_id) {
        return textResult({ error: 'invalid_input: a job cannot be compared with itself' });
      }
      const base = requireReport(args.base_job_id);
      if ('error' in base) return textResult({ error: `base_${base.error}` });
      const head = requireReport(args.head_job_id);
      if ('error' in head) return textResult({ error: `head_${head.error}` });
      if (base.report.repository.url !== head.report.repository.url) {
        return textResult({
          error: 'repo_mismatch: both audits must be for the same repository URL',
        });
      }
      return textResult(
        diffReports(base.report, head.report, {
          baseJobId: args.base_job_id,
          headJobId: args.head_job_id,
          baseCommitSha: base.job.commitSha ?? null,
          headCommitSha: head.job.commitSha ?? null,
        })
      );
    }
  );

  server.tool(
    'list_audit_history',
    'List the audits recorded for a repository in this session, newest first. Use it to find the job ids that compare_audits needs. Free.',
    {
      repo_url: z.string().url().describe('Public GitHub URL you audited before'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (args) => {
      const jobs = jobStore.listByRepo(args.repo_url, args.limit);
      return textResult({
        repoUrl: args.repo_url,
        count: jobs.length,
        audits: jobs.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          createdAt: job.createdAt,
          mode: job.input.mode,
          target: job.input.target,
          overall: (job.report as Report | null)?.scores?.overall ?? null,
          findingCount: job.report
            ? (job.report as Report).blockers.length +
              (job.report as Report).documentationGaps.length +
              (job.report as Report).securityFindings.length
            : null,
        })),
      });
    }
  );

  server.tool(
    'get_repopilot_capabilities',
    'Return RepoPilot capabilities: name, version, supported inputs/outputs, limits, pricing, and which tools are free or paid.',
    {},
    async () => {
      const caps: Capabilities & { billing: typeof BILLING } = {
        name: 'RepoPilot',
        version: CORE_VERSION,
        inputs: {
          repoUrl: 'https URL to a public GitHub repository',
          mode: 'quick | full',
          target: 'hackathon | open_source | production',
          outputLanguage: 'en | zh-CN',
        },
        outputs: {
          report:
            'JSON document conforming to @repopilot/core Report schema (1.0): blockers, scores, evidence, deployment plan, launch copy.',
        },
        limits: {
          maxFiles: DEFAULT_LIMITS.maxFiles,
          maxFileBytes: DEFAULT_LIMITS.maxFileBytes,
          maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes,
          rateLimitPerMinute: DEFAULT_LIMITS.rateLimitPerMinute,
        },
        pricing: {
          quickScan: opts.payment.pricing.quickScan,
          fullAudit: opts.payment.pricing.fullAudit,
        },
        paymentMode: opts.payment.mode,
        billing: BILLING,
      };
      return textResult(caps);
    }
  );

  return { server, jobStore };
}

function reportSummary(report: Report): unknown {
  return {
    status: 'completed',
    reportVersion: report.reportVersion,
    repository: report.repository,
    summary: report.summary,
    scores: report.scores.overall,
    scoreBreakdown: {
      documentation: report.scores.documentation,
      reproducibility: report.scores.reproducibility,
      securityHygiene: report.scores.securityHygiene,
      deploymentReadiness: report.scores.deploymentReadiness,
    },
    detectedStack: report.detectedStack,
    blockerCount: report.blockers.length,
    documentationGapCount: report.documentationGaps.length,
    securityFindingCount: report.securityFindings.length,
    /**
     * Findings held out of the release gate because of where they live —
     * test files, fixtures, sample apps.
     *
     * Headline numbers, not a list. A real scan produced 542 of them, and
     * an agent that wants the detail gets `fixtureSummary` in the report
     * below. These two lines are what stop an agent reading
     * `securityFindingCount: 3` as "three findings total" when there are
     * five hundred more it is choosing not to block on.
     *
     * Both counts come from `fixtureFindings`, the authoritative list,
     * so a report stored before the summary existed still counts
     * correctly.
     */
    fixtureFindingCount: report.fixtureFindings.length,
    fixtureFileCount: new Set(report.fixtureFindings.map((f) => f.evidence[0]?.file ?? '')).size,
    launchChecklist: report.launchChecklist,
    // The full report is included as well, validated by Zod to make sure
    // every required field is present.
    report: ReportSchema.parse(report),
  };
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function startStdioServer(opts: McpServerOptions): Promise<void> {
  const { server } = buildMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export type { AuditJob };
