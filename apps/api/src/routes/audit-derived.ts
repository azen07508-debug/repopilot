/**
 * Derived audit routes.
 *
 * These endpoints answer questions about audits that ALREADY HAPPENED.
 * Every response is a pure derivation of a `Report` stored on a job row:
 *
 *   GET /api/v1/audits/:jobId/fix-plan          Report -> FixPlanSet
 *   GET /api/v1/audits/:jobId/diff?base=<jobId> Report + Report -> AuditDiff
 *   GET /api/v1/repositories/:owner/:repo/audits                 history list
 *
 * Two invariants hold for everything in this file:
 *
 *   1. No payment challenge. These are free queries; the paid path stays
 *      the only way to obtain a new `Report`.
 *   2. No repository access. No `AuditPipeline`, no fetcher, no analyzer,
 *      no network. If a change here ever introduces one of those, the
 *      design is broken — a derived view must never re-scan.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { buildFixPlanSet, diffReports, type AuditJob, type Report } from '@repopilot/core';
import { sendError, HttpError } from '../utils/errors.js';
import type { JobService } from '../services/job-service.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface AuditDerivedRoutesDeps {
  service: JobService;
}

/**
 * Resolve a completed report or send the matching error.
 *
 * Returns null when a response has already been sent, so callers can
 * simply `return reply`.
 */
function requireReport(job: AuditJob | null, reply: FastifyReply, jobId: string): Report | null {
  if (!job) {
    sendError(
      reply,
      new HttpError({ statusCode: 404, code: 'JOB_NOT_FOUND', message: 'No such job' })
    );
    return null;
  }
  if (job.status !== 'completed' || !job.report) {
    sendError(
      reply,
      new HttpError({
        statusCode: 409,
        code: 'REPORT_NOT_READY',
        message: `Job ${jobId} is "${job.status}"; a completed report is required.`,
      })
    );
    return null;
  }
  return job.report as Report;
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function overallOf(report: unknown): number | null {
  const r = report as { scores?: { overall?: unknown } } | null;
  const overall = r?.scores?.overall;
  return typeof overall === 'number' ? overall : null;
}

function findingCountOf(report: unknown): number | null {
  if (!report) return null;
  const r = report as {
    blockers?: unknown[];
    documentationGaps?: unknown[];
    securityFindings?: unknown[];
  };
  return (
    (r.blockers?.length ?? 0) +
    (r.documentationGaps?.length ?? 0) +
    (r.securityFindings?.length ?? 0)
  );
}

export function registerAuditDerivedRoutes(app: FastifyInstance, deps: AuditDerivedRoutesDeps) {
  /**
   * Every fix plan for one completed audit.
   *
   * The plan is generated on read rather than stored: it is a pure
   * function of the report, so persisting it would only create a second
   * copy that can drift.
   */
  app.get<{ Params: { jobId: string } }>(
    '/api/v1/audits/:jobId/fix-plan',
    async (req, reply) => {
      const job = await deps.service.get(req.params.jobId);
      const report = requireReport(job, reply, req.params.jobId);
      if (!report) return reply;
      return reply.send(buildFixPlanSet(report, { commitSha: job?.commitSha ?? null }));
    }
  );

  /**
   * Compare two completed audits of the same repository.
   *
   * `base` is a jobId, not a commit sha: the history endpoint already
   * returns jobIds, and accepting a sha here would force a second URL
   * parse just to recover owner/repo.
   */
  app.get<{ Params: { jobId: string }; Querystring: { base?: string } }>(
    '/api/v1/audits/:jobId/diff',
    async (req, reply) => {
      const base = (req.query.base ?? '').trim();
      if (!base) {
        return sendError(
          reply,
          new HttpError({
            statusCode: 400,
            code: 'INVALID_INPUT',
            message:
              'Query parameter "base" is required. Pass the jobId of the earlier audit; use GET /api/v1/repositories/:owner/:repo/audits to list them.',
          })
        );
      }
      if (base === req.params.jobId) {
        return sendError(
          reply,
          new HttpError({
            statusCode: 400,
            code: 'INVALID_INPUT',
            message: 'A job cannot be compared with itself.',
          })
        );
      }

      const headJob = await deps.service.get(req.params.jobId);
      const headReport = requireReport(headJob, reply, req.params.jobId);
      if (!headReport) return reply;

      const baseJob = await deps.service.get(base);
      const baseReport = requireReport(baseJob, reply, base);
      if (!baseReport) return reply;

      // Cross-repository comparison is meaningless: the finding ids and
      // the scoring inputs describe different projects.
      if (baseJob && headJob && baseJob.input.repoUrl !== headJob.input.repoUrl) {
        return sendError(
          reply,
          new HttpError({
            statusCode: 400,
            code: 'REPO_MISMATCH',
            message: 'Both audits must be for the same repository URL.',
          })
        );
      }

      return reply.send(
        diffReports(baseReport, headReport, {
          baseJobId: baseJob?.jobId ?? null,
          headJobId: headJob?.jobId ?? null,
          baseCommitSha: baseJob?.commitSha ?? null,
          headCommitSha: headJob?.commitSha ?? null,
        })
      );
    }
  );

  /**
   * Audit history for one repository, newest first.
   *
   * Summaries only: the full report of each entry is available through
   * the existing `GET /api/v1/audits/:jobId`.
   */
  app.get<{ Params: { owner: string; repo: string }; Querystring: { limit?: string } }>(
    '/api/v1/repositories/:owner/:repo/audits',
    async (req, reply) => {
      const { owner, repo } = req.params;
      const limit = clampLimit(req.query.limit);
      const jobs = await deps.service.listHistory(owner, repo, limit);
      return reply.send({
        owner,
        repo,
        limit,
        count: jobs.length,
        audits: jobs.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          commitSha: job.commitSha,
          mode: job.input.mode,
          target: job.input.target,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          failedAt: job.failedAt,
          overall: overallOf(job.report),
          findingCount: findingCountOf(job.report),
        })),
      });
    }
  );
}
