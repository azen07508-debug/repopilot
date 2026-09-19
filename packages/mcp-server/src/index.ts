/**
 * MCP server for RepoPilot.
 *
 * Exposes three tools:
 *   - audit_github_repository: run a Quick Scan or Full Launch Audit
 *   - get_audit_status: poll the status of a previously created job
 *   - get_repopilot_capabilities: list supported inputs, outputs, limits, pricing
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
      const job = jobStore.create(input);
      const price = priceFor(opts.payment, input.mode);
      const challenge = await paymentAdapter.createChallenge({
        quote: { ...price, mode: input.mode },
        quoteKey: `mcp:${input.mode}:${input.repoUrl}`,
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
          return textResult(reportSummary(result.report));
        }
        jobStore.fail(job.jobId, `Payment failed: ${receipt.status}`);
        return textResult({ error: 'payment_failed', paymentId: challenge.paymentId, status: receipt.status });
      }
      // Production OKX flow: caller must retry with X-PAYMENT (handled at the
      // HTTP layer). We return the challenge so the agent can decide.
      return textResult({
        status: 'awaiting_payment',
        paymentId: challenge.paymentId,
        challenge: challenge.challenge,
        price,
        nextAction:
          'Call onchainos payment pay --payment-id <id> --yes, then call get_audit_status with the same paymentId.',
      });
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
    'get_repopilot_capabilities',
    'Return RepoPilot capabilities: name, version, supported inputs/outputs, limits, and pricing.',
    {},
    async () => {
      const caps: Capabilities = {
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
