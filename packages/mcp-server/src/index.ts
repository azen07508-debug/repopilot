/**
 * MCP server for RepoPilot.
 *
 * Exposes fourteen tools, split by cost:
 *
 *   Paid (they run the pipeline):
 *   - audit_github_repository: gate a repo — the verdict, plus the launch materials in `full`
 *   - reaudit_repository: run a fresh audit of a repo you already audited
 *
 *   Free (no analysis pipeline, no LLM, no scan for findings):
 *   - quality_status: may this ship? pass / pass_with_warnings / blocked
 *   - release_check: which findings block a release, by fingerprint
 *   - get_fix_plan: actionable plans with evidence and agent instructions
 *   - compare_audits: before/after with rule-level score attribution
 *   - list_audit_history: audits recorded for a repository this session
 *   - get_audit_status: poll a previously created job
 *   - get_repopilot_capabilities: inputs, outputs, limits, pricing, billing
 *
 *   Free, and they do read a repository (V0.2-g, ADR D-028):
 *   - free_check: five presence checks and a score, from the file names alone
 *   - get_repository_context: what is this repo, and where do I start?
 *   - get_repository_map: modules, entrypoints, dependencies, important files
 *   - get_symbol_map: the declaration surface, with line ranges
 *   - get_dependency_graph: what imports what, with the importing line
 *
 * The report tools never scan a repository: they call the same pure functions
 * (`buildFixPlanSet`, `diffReports`) the HTTP API uses. The intelligence tools
 * do read one — and that is the distinction this header used to blur. **Free
 * means no analysis pipeline**, not "no network": the five repository-reading
 * tools fetch a tree and, for the four that need file contents, a tarball
 * (three requests, D-017) and derive, and nothing they do scores, judges or
 * scans history. `free_check` is the cheapest of them — it reads the tree
 * listing and stops, because presence is a question about names. D-019 is the
 * reason they are free — an agent asks them five to ten times per repository,
 * and a paid call at that frequency is a paid call nobody makes.
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
  FreeCheckRunner,
  type CreateAuditInput,
  type FreeCheckSource,
  type Report,
  type Capabilities,
  DEFAULT_LIMITS,
  DEFAULT_PRICING,
  CORE_VERSION,
  REPORT_VERSION,
  ReportSchema,
} from '@repopilot/core';
import { buildPaymentAdapter, type PaymentConfig, priceFor } from '@repopilot/okx-adapter';
import { createLogger } from './logger.js';
import { JobStore, type AuditJob } from './job-store.js';
import {
  RepositorySnapshots,
  buildRepositoryContext,
  dependencyGraphOf,
  dependencyGraphView,
  repositoryMapOf,
  symbolMapOf,
  symbolMapView,
  type RepositorySnapshot,
  type SnapshotLoader,
} from './intelligence.js';

export interface McpServerOptions {
  payment: PaymentConfig;
  githubToken?: string;
  allowedHosts: string[];
  /**
   * The seam a test drives instead of the network.
   *
   * `RepositorySnapshots` has taken a `load` override since it was written,
   * but nothing forwarded one, so the four intelligence tools could only be
   * exercised against GitHub. Passing it here is what lets a test assert what
   * a tool *returns* — including what it returns when the fetch fails.
   */
  snapshotLoader?: SnapshotLoader;
  /**
   * The same seam for `free_check`.
   *
   * A second seam rather than a second loader because the free check reads a
   * tree and nothing else: it needs no contents, no tarball, and it is the one
   * tool here whose whole answer is derived from file names. Sharing
   * `snapshotLoader` would have meant downloading a repository to answer a
   * question that never looks inside a file.
   */
  freeCheckSource?: FreeCheckSource;
}

/**
 * Which tools cost money. Surfaced by `get_repopilot_capabilities`.
 *
 * Exported so the test suite can hold it against the registrations below. It
 * used to be module-private, and nothing asserted it: the test named
 * "registers every tool the billing map advertises" checked a hand-copied
 * list in the test file instead, so a tool added to `server.tool()` and
 * forgotten here would have shipped — the capabilities response would omit it
 * and every test would still be green. Two statements of one list need a
 * check that compares them, not a third list.
 */
export const BILLING = {
  audit_github_repository: { paid: true, reason: 'Runs the analysis pipeline.' },
  reaudit_repository: { paid: true, reason: 'Runs the analysis pipeline.' },
  free_check: {
    paid: false,
    reason: 'Reads the repository tree and derives; never runs the pipeline.',
  },
  get_fix_plan: { paid: false, reason: 'Derived from an existing report.' },
  quality_status: { paid: false, reason: 'Derived from an existing report.' },
  release_check: { paid: false, reason: 'Derived from an existing report.' },
  compare_audits: { paid: false, reason: 'Derived from two existing reports.' },
  list_audit_history: { paid: false, reason: 'Reads recorded job metadata.' },
  get_audit_status: { paid: false, reason: 'Reads recorded job metadata.' },
  get_repopilot_capabilities: { paid: false, reason: 'Static metadata.' },
  get_repository_context: {
    paid: false,
    reason: 'Reads the repository tree and derives; never runs the pipeline.',
  },
  get_repository_map: {
    paid: false,
    reason: 'Reads the repository tree and derives; never runs the pipeline.',
  },
  get_symbol_map: {
    paid: false,
    reason: 'Reads the repository tree and derives; never runs the pipeline.',
  },
  get_dependency_graph: {
    paid: false,
    reason: 'Reads the repository tree and derives; never runs the pipeline.',
  },
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
  const snapshots = new RepositorySnapshots({
    githubToken: opts.githubToken,
    allowedHosts: opts.allowedHosts,
    ...(opts.snapshotLoader === undefined ? {} : { load: opts.snapshotLoader }),
  });
  const freeCheck = new FreeCheckRunner({
    githubToken: opts.githubToken,
    allowedHosts: opts.allowedHosts,
    ...(opts.freeCheckSource === undefined ? {} : { source: opts.freeCheckSource }),
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
    const price = priceFor(opts.payment);
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
    'Gate a public GitHub repository for release. Returns a ship-or-block verdict with documented evidence, prioritized blockers, and acceptance criteria. Static analysis only — never executes repository code.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      mode: z
        .enum(['quick', 'full'])
        .default('full')
        .describe(
          'Report shape, not price: quick returns the verdict alone, full adds the deployment plan and launch copy. Same price either way. Defaults to full — the shape the paid service is sold as.'
        ),
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
      mode: z
        .enum(['quick', 'full'])
        .default('full')
        .describe(
          'Report shape, not price: full adds the deployment plan and launch copy. Same price either way. Defaults to full — the shape the paid service is sold as.'
        ),
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
      job_id: z
        .string()
        .describe(
          'A jobId from this session: from list_audit_history, or from the ' +
            'payment challenge that audit_github_repository returns in okx mode ' +
            '(mock mode settles the audit inline and returns no jobId).'
        ),
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

  /**
   * Read a repository once and hand the snapshot to a derivation.
   *
   * Every failure mode here is the caller's to act on — a host outside the
   * allowlist, a repository that does not exist, a rate limit — so they come
   * back as a machine-readable error rather than an exception the agent cannot
   * see. A tool that throws gives an agent nothing to retry with.
   */
  async function withSnapshot<T>(
    repoUrl: string,
    ref: string | undefined,
    derive: (snapshot: RepositorySnapshot) => T
  ): Promise<T | { error: string; message: string }> {
    try {
      return derive(await snapshots.get(repoUrl, ref));
    } catch (error) {
      return { error: 'repository_unavailable', message: describeError(error) };
    }
  }

  /**
   * The funnel entry, on the channel the funnel is aimed at.
   *
   * `MARKETPLACE_LISTING.md` sells Free Check as "the entry point used by other
   * AI agents to triage a repo before deciding to pay for a full audit" — and
   * MCP is the AI-agent channel. It was on the HTTP surface and absent here, so
   * the stated entry point was missing from the one surface that reaches the
   * audience the sentence names. Nothing about the runner is MCP-specific: this
   * is the same dependency-free `FreeCheckRunner` `/api/v1/free-check` uses, and
   * it answers with the same `FreeCheckReport` (reportVersion 1.0).
   *
   * No `jobId`, deliberately. A free check has no job — it never runs the
   * pipeline, so there is nothing to poll and nothing to compare later. That is
   * what separates it from `audit_github_repository`, which returns a jobId in
   * okx mode and none in mock mode.
   *
   * No `output_language` either. The audit exposes one because its summary is
   * generated in it; every string this tool returns is a fixed literal
   * ("README.md found", "No lockfile (reproducibility is at risk)"), so the
   * knob would be a setting that changes nothing — which is what the runner's
   * own `maxFiles` / `maxFileBytes` / `maxTotalBytes` turned out to be.
   */
  server.tool(
    'free_check',
    'Free, no payment and no job. Five presence checks (README, LICENSE, .env.example, lockfile, CI) and a 0-100 score, answered from the repository tree alone — it never reads inside a file. Use it to triage a repository before paying for an audit: it says what is present, not what is wrong. The paid audit is the superset — findings with evidence, blockers, per-dimension scores and a launch plan.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
    },
    async (args) => {
      try {
        return textResult(await freeCheck.run({ repoUrl: args.repo_url, outputLanguage: 'en' }));
      } catch (error) {
        return textResult({ error: 'repository_unavailable', message: describeError(error) });
      }
    }
  );

  server.tool(
    'get_repository_context',
    'What is this repository, and where should I start reading? One call, answered from the repository itself: languages, frameworks, package managers, entrypoints, the modules ranked by importance, the files worth reading first, the heaviest imports, and the dependencies the manifests declare — with their versions. Free — it reads the tree and derives, and never runs the audit pipeline. Start here, then narrow with get_repository_map, get_symbol_map or get_dependency_graph. The declared list is not the imported list: a dev tool is declared and never imported, a phantom dependency is imported and never declared. For what the code actually pulls in, use get_dependency_graph.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      ref: z
        .string()
        .optional()
        .describe('Branch, tag or commit SHA. Defaults to the repository default branch.'),
    },
    async (args) => textResult(await withSnapshot(args.repo_url, args.ref, buildRepositoryContext))
  );

  server.tool(
    'get_repository_map',
    'The repository structure: modules with an importance score, entrypoints, the ranked important files, config / test / documentation files, and the declared external dependencies with their versions. Free. Scores are absolute — 0.6 means the same thing in a five-module repository as in a five-hundred-module one — so two maps can be compared.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      ref: z
        .string()
        .optional()
        .describe('Branch, tag or commit SHA. Defaults to the repository default branch.'),
    },
    async (args) => textResult(await withSnapshot(args.repo_url, args.ref, repositoryMapOf))
  );

  server.tool(
    'get_symbol_map',
    'The declaration surface: functions, classes, interfaces, types, methods, constants, contracts, structs and enums, each with a 1-based line range, its enclosing declaration, and which parser produced it. Free. The parser confidence is per symbol, so a compiler-parsed declaration (0.95) can be weighted against a line-matched one (0.5). A language with no extractor is named rather than guessed at.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      ref: z.string().optional().describe('Branch, tag or commit SHA. Defaults to the default branch.'),
      path_prefix: z
        .string()
        .optional()
        .describe('Only symbols under this directory, e.g. "src/core". Use "." for the whole repository. Narrow here rather than raising max_symbols.'),
      max_symbols: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe('Cap on returned symbols (default 500). The response always says how many were withheld.'),
    },
    async (args) =>
      textResult(
        await withSnapshot(args.repo_url, args.ref, (snapshot) =>
          symbolMapView(symbolMapOf(snapshot), {
            ...(args.max_symbols === undefined ? {} : { maxSymbols: args.max_symbols }),
            ...(args.path_prefix === undefined ? {} : { pathPrefix: args.path_prefix }),
          })
        )
      )
  );

  server.tool(
    'get_dependency_graph',
    'What imports what, at file level, with the importing line as evidence on every edge. Free. External packages are listed separately from internal nodes, and an import that matches no file in the repository is reported in limitations rather than turned into an edge to the nearest-looking path — a wrong edge sends you to the wrong file.',
    {
      repo_url: z.string().url().describe('Public GitHub URL, e.g. https://github.com/owner/repo'),
      ref: z.string().optional().describe('Branch, tag or commit SHA. Defaults to the default branch.'),
      path_prefix: z
        .string()
        .optional()
        .describe('Only nodes and edges under this path, e.g. "src/core". Use "." for the whole repository.'),
      max_nodes: z.number().int().min(1).max(10000).optional().describe('Cap on returned nodes (default 1000).'),
      max_edges: z.number().int().min(1).max(20000).optional().describe('Cap on returned edges (default 500).'),
    },
    async (args) =>
      textResult(
        await withSnapshot(args.repo_url, args.ref, (snapshot) =>
          dependencyGraphView(dependencyGraphOf(snapshot), {
            ...(args.max_nodes === undefined ? {} : { maxNodes: args.max_nodes }),
            ...(args.max_edges === undefined ? {} : { maxEdges: args.max_edges }),
            ...(args.path_prefix === undefined ? {} : { pathPrefix: args.path_prefix }),
          })
        )
      )
  );

  server.tool(
    'get_repopilot_capabilities',
    'Return RepoPilot capabilities: name, version, supported inputs/outputs, limits, pricing, and which tools are free or paid. `limits`, `pricing` and `paymentMode` describe this process, so they can differ from the deployed HTTP API; `endpoints` is empty and `cache.enabled` is false because this server speaks stdio JSON-RPC and holds no audit cache — read `GET /api/v1/capabilities` for the deployed route list.',
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
          // Interpolated, not written out: this string used to say `(1.0)`
          // while `REPORT_VERSION` had moved to `1.2`, so the capabilities
          // payload told every client one version and every report carried
          // another. `docs:check` cannot see it — it reads markdown, and
          // `readMcpTools()` reads this file for tool names only, not for
          // the prose around them.
          report:
            `JSON document conforming to @repopilot/core Report schema (${REPORT_VERSION}): blockers, scores, evidence, deployment plan, launch copy.`,
        },
        /**
         * Empty, and truthfully so.
         *
         * `CapabilitiesSchema` requires this block, and this server has no
         * routes: it speaks stdio JSON-RPC, and the surface it does expose is
         * the tool list that `billing` marks free or paid. Reporting `{}`
         * rather than inventing an `mcp` entry with a fake `method`/`path`
         * keeps the shape identical to `GET /api/v1/capabilities` without
         * telling a client to call an HTTP route that does not exist.
         */
        endpoints: {},
        limits: {
          maxFiles: DEFAULT_LIMITS.maxFiles,
          maxFileBytes: DEFAULT_LIMITS.maxFileBytes,
          maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes,
          rateLimitPerMinute: DEFAULT_LIMITS.rateLimitPerMinute,
        },
        pricing: {
          audit: opts.payment.pricing.audit,
        },
        paymentMode: opts.payment.mode,
        /**
         * No cache here, stated rather than omitted.
         *
         * The audit cache is `apps/api/src/services/cache-service.ts`, keyed on
         * an HTTP request; nothing in this process memoises an audit. The block
         * is still reported because a client that reads both surfaces should
         * see one shape, and because a missing key cannot be told apart from a
         * server built before the field existed — whereas `enabled: false`
         * answers the question an agent actually has: calling the paid tool
         * twice on the same commit will run the pipeline twice.
         *
         * `keyVersion: 'none'` and `ttlSeconds: 0` are the "not applicable"
         * values, not a claim about the API's cache. `isolation: []` says the
         * same thing: nothing is separated because nothing is stored.
         */
        cache: {
          enabled: false,
          ttlSeconds: 0,
          keyVersion: 'none',
          scope: 'none — this server holds no audit cache',
          isolation: [],
        },
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

/**
 * A one-line reason, short enough to act on.
 *
 * `RepoFetchError` carries the HTTP status and 404 / 403 / 502 are three
 * different next moves — a repository that does not exist, a rate limit that
 * clears on its own, a host that is down. Collapsing them into one sentence
 * leaves the agent guessing which. The stack is deliberately dropped: it is
 * not actionable, and a tool result is the wrong place to leak the path the
 * server was started from.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status: unknown = (error as { status?: unknown }).status;
    return typeof status === 'number' ? `[${status}] ${error.message}` : error.message;
  }
  return String(error);
}

export async function startStdioServer(opts: McpServerOptions): Promise<void> {
  const { server } = buildMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export type { AuditJob };
