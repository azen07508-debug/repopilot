/**
 * /api/v1/audits — create and fetch audit jobs.
 *
 * Contract (v0.1.0-rc.2 — async):
 *   1. Client POSTs { repoUrl, mode, target, outputLanguage, includeLaunchCopy }.
 *   2. Server validates input.
 *   3. Server checks for X-PAYMENT (or for an Idempotency-Key header) and
 *      dedupes by paymentId / idempotency key.
 *   4. If no payment: server returns 402 with a payment challenge.
 *   5. If payment: server verifies it, creates a `queued` job, enqueues it
 *      via the configured AuditQueue adapter (Inline or PgBoss), and
 *      returns 202 with `Location: /api/v1/audits/:jobId` and
 *      `Retry-After: 1`.
 *   6. Client polls `GET /api/v1/audits/:jobId` until status is
 *      `completed` or `failed`.
 *      - `queued` / `processing`: returns 202 + Retry-After: 1
 *      - `completed`:               returns 200 + report + cache metadata
 *      - `failed`:                  returns 200 + structured error info
 *
 * Idempotency:
 *   - If a request comes in with an `Idempotency-Key` header that
 *     matches an existing job, the same jobId is returned and the job
 *     is NOT re-enqueued.
 *   - If a request comes in with `X-PAYMENT` whose paymentId matches an
 *     existing job, the same jobId is reused. This makes safe client
 *     retries cheap.
 *
 * Cache:
 *   - The AuditWorker, NOT this route, consults the report cache. The
 *     worker uses the same cache service as the rest of the system.
 *
 * Payment is verified BEFORE the job is enqueued; the worker never sees
 * a payment header and never charges the buyer.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateAuditInputSchema,
  ReportSchema,
  MetadataAnalyzer,
  parseRepoUrl,
  type CreateAuditInput,
  type Report,
} from '@repopilot/core';
import { priceFor, type PaymentConfig } from '@repopilot/okx-adapter';
import { sendError, HttpError } from '../utils/errors.js';
import type { JobService } from '../services/job-service.js';
import type { CacheService } from '../services/cache-service.js';
import type { AuditQueue } from '../queue/audit-queue.js';

const POLL_AFTER_MS = 1000;

/** Plain GitHub path segments. Anything else is rejected before a URL is built. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface AuditRoutesDeps {
  service: JobService;
  payment: PaymentConfig;
  cache: CacheService;
  cacheEnabled: boolean;
  queue: AuditQueue;
  /** GitHub token used to look up the head SHA. Optional. */
  githubToken?: string;
  /** Default branch resolution cache; injected so the analyzer is reused. */
  metadataAnalyzer: MetadataAnalyzer;
  /** Allowed hosts for the repoUrl (SSRF defense). */
  allowedHosts: string[];
  /** Optional logger. */
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

/**
 * Extract the paymentId from an X-PAYMENT header.
 *
 * Mock format: `mock:<paymentId>`.
 * OKX format: base64-encoded JSON envelope containing `{ paymentId, ... }`.
 *
 * Returns null if the value cannot be parsed.
 */
function extractPaymentId(raw: string, mode: 'mock' | 'okx'): string | null {
  if (mode === 'mock') {
    const m = /^mock:([A-Za-z0-9_\-]+)$/.exec(raw.trim());
    return m && m[1] ? m[1] : null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      paymentId?: unknown;
    };
    if (typeof decoded.paymentId === 'string') return decoded.paymentId;
  } catch {
    /* swallow */
  }
  return null;
}

export function registerAuditRoutes(app: FastifyInstance, deps: AuditRoutesDeps) {
  app.post('/api/v1/audits', async (req, reply) => {
    const parsed = CreateAuditInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        new HttpError({
          statusCode: 400,
          code: 'INVALID_INPUT',
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        }),
      );
    }
    return handleCreate(req, reply, parsed.data);
  });

  /**
   * Re-audit a repository using coordinates the caller already has.
   *
   * This is deliberately the SAME code path as `POST /api/v1/audits` —
   * same payment challenge, same idempotency keys, same queue. It exists
   * so an agent (or the Web UI) can close the loop — fix, re-audit,
   * compare — without re-typing the URL.
   *
   * Paid: it runs the pipeline again. The derived read-only views
   * (fix-plan / diff / history) are the free half of the same loop.
   */
  app.post<{ Params: { owner: string; repo: string } }>(
    '/api/v1/repositories/:owner/:repo/reaudit',
    async (req, reply) => {
      const { owner, repo } = req.params;
      if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) {
        return sendError(
          reply,
          new HttpError({
            statusCode: 400,
            code: 'INVALID_INPUT',
            message: 'owner and repo must be plain GitHub path segments',
          }),
        );
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsed = CreateAuditInputSchema.safeParse({
        repoUrl: `https://github.com/${owner}/${repo}`,
        mode: body['mode'] ?? 'quick',
        target: body['target'] ?? 'open_source',
        outputLanguage: body['outputLanguage'] ?? 'en',
        includeLaunchCopy: body['includeLaunchCopy'] ?? true,
      });
      if (!parsed.success) {
        return sendError(
          reply,
          new HttpError({
            statusCode: 400,
            code: 'INVALID_INPUT',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          }),
        );
      }
      // The constructed URL still passes through `parseRepoUrl` inside
      // `handleCreateAudit`, so the host allow-list applies here too.
      return handleCreate(req, reply, parsed.data);
    }
  );

  /**
   * Shared create-or-replay path for a paid audit.
   *
   * A closure rather than a module-level function, so both POST routes
   * and the GET below stay in one readable block and `deps` does not
   * have to be threaded through by hand.
   *
   * `POST /audits` and `POST /repositories/:owner/:repo/reaudit` share
   * this so they cannot drift apart: payment verification, idempotency,
   * head-SHA resolution and enqueueing happen exactly once, in one place.
   */
  const handleCreate = async (
    req: FastifyRequest,
    reply: FastifyReply,
    input: CreateAuditInput,
  ): Promise<unknown> => {
    // Idempotency-Key: if the client supplies one and it matches an
    // existing job, return the same jobId without creating new state.
    const idempotencyKey = (
      (req.headers['idempotency-key'] ?? req.headers['Idempotency-Key']) as string | undefined
    )?.trim() || null;

    // X-PAYMENT: indicates the buyer already paid.
    const xPayment = (req.headers['x-payment'] ?? req.headers['X-PAYMENT']) as string | undefined;

    // 1. Try to find an existing job.
    let job = null as null | Awaited<ReturnType<typeof deps.service.getByPaymentId>>;
    if (idempotencyKey) {
      const byKey = await deps.service.getByIdempotencyKey(idempotencyKey);
      if (byKey) job = byKey;
    }
    if (!job && xPayment) {
      const priorPaymentId = extractPaymentId(xPayment, deps.payment.mode);
      if (priorPaymentId) {
        const byPayment = await deps.service.getByPaymentId(priorPaymentId);
        if (byPayment) job = byPayment;
      }
    }
    // Existing job short-circuits:
    if (job && job.status === 'completed' && job.report) {
      return reply.send({
        jobId: job.jobId,
        status: 'completed',
        report: ReportSchema.parse(job.report),
      });
    }
    // For `queued` / `processing` jobs we do NOT short-circuit if the
    // client is supplying payment right now: the first POST (the
    // 402 path) does not enqueue, so the second POST (X-PAYMENT
    // replay) must enqueue. We detect this by `xPayment` being
    // present — the client is actively trying to settle.
    const isSettling = Boolean(xPayment);
    if (job && (job.status === 'queued' || job.status === 'processing') && !isSettling) {
      reply.header('Retry-After', '1');
      reply.header('Location', `/api/v1/audits/${job.jobId}`);
      return reply.status(202).send({
        jobId: job.jobId,
        status: job.status,
        statusUrl: `/api/v1/audits/${job.jobId}`,
        pollAfterMs: POLL_AFTER_MS,
      });
    }

    // 2. Validate the repoUrl host early so we don't 402 a clearly
    //    unsafe request.
    let parsedRepo: { owner: string; repo: string };
    try {
      parsedRepo = parseRepoUrl(input.repoUrl, deps.allowedHosts);
    } catch {
      return sendError(
        reply,
        new HttpError({ statusCode: 400, code: 'HOST_NOT_ALLOWED', message: 'repoUrl host is not in the allow-list' }),
      );
    }

    // 3. If no X-PAYMENT, return 402 with a challenge. We do NOT
    //    enqueue a job until payment is verified.
    if (!xPayment) {
      // We still need a jobId to attach the challenge to so the
      // client can safely retry with X-PAYMENT and reuse the same
      // jobId. We create the queued job WITHOUT a paymentId and
      // attach it on the second POST.
      const queued = await deps.service.create(input, idempotencyKey, parsedRepo);
      const price = priceFor(deps.payment, input.mode);
      const adapter = deps.service.getPaymentAdapter();
      const challenge = await adapter.createChallenge({
        quote: { ...price, mode: input.mode },
        quoteKey: `api:${input.mode}:${input.repoUrl}`,
      });
      await deps.service.attachPayment(queued, challenge.paymentId);
      return reply.status(402).send({
        jobId: queued.jobId,
        status: 'queued',
        payment: {
          paymentId: challenge.paymentId,
          mode: deps.payment.mode,
          amount: price.amount,
          currency: price.currency,
          challenge: challenge.challenge,
          expiresAt: challenge.expiresAt,
        },
        nextAction:
          deps.payment.mode === 'mock'
            ? `Replay this POST with header X-PAYMENT: mock:${challenge.paymentId}`
            : 'Sign with onchainos payment pay --payment-id <id> --yes, then replay with X-PAYMENT: <base64 envelope>',
      });
    }

    // 4. Payment is present. Verify it.
    const priorPaymentId = extractPaymentId(xPayment, deps.payment.mode);
    if (!priorPaymentId) {
      return sendError(
        reply,
        new HttpError({ statusCode: 400, code: 'INVALID_INPUT', message: 'X-PAYMENT header is malformed' }),
      );
    }
    const adapter = deps.service.getPaymentAdapter();
    const receipt = await adapter.verifyPayment({
      paymentId: priorPaymentId,
      rawHeader: xPayment,
    });
    if (receipt.status !== 'completed') {
      return reply.status(402).send({
        error: { code: 'PAYMENT_NOT_SETTLED', message: 'Payment not yet settled', payment: receipt },
        paymentId: priorPaymentId,
      });
    }

    // 5. Payment verified. Create (or reuse) the queued job and enqueue.
    if (!job) {
      job = await deps.service.create(input, idempotencyKey, parsedRepo);
    }
    if (job.paymentId !== priorPaymentId) {
      await deps.service.attachPayment(job, priorPaymentId);
    }
    // Resolve the head SHA up front so the cache key is stable.
    const headSha =
      (await deps.metadataAnalyzer.getHeadSha(parsedRepo.owner, parsedRepo.repo, 'main').catch(() => null)) ??
      (await deps.metadataAnalyzer.getHeadSha(parsedRepo.owner, parsedRepo.repo, 'master').catch(() => null)) ??
      'unknown';
    // Stash the head SHA on the job's input so the worker can reuse it
    // without re-doing the network call.
    await deps.service.setCommitSha(job, headSha);

    // Enqueue. If the queue is shutting down, fail the job and tell
    // the client via 503 so it can retry.
    let enqueueResult;
    try {
      enqueueResult = await deps.queue.enqueue({ jobId: job.jobId });
    } catch (err) {
      const msg = (err as Error).message ?? 'enqueue failed';
      await deps.service.fail(job, 'ENQUEUE_FAILED', msg);
      return reply.status(503).send({
        error: { code: 'ENQUEUE_FAILED', message: 'Queue is not accepting jobs; please retry' },
        jobId: job.jobId,
      });
    }
    if (!enqueueResult.accepted) {
      // The queue already has this job; that's fine, the existing
      // worker call will satisfy it.
      deps.log?.info({ jobId: job.jobId }, 'queue dedup hit; not re-enqueuing');
    }

    reply.header('Retry-After', '1');
    reply.header('Location', `/api/v1/audits/${job.jobId}`);
    return reply.status(202).send({
      jobId: job.jobId,
      status: 'queued',
      statusUrl: `/api/v1/audits/${job.jobId}`,
      pollAfterMs: POLL_AFTER_MS,
    });
  };

  app.get('/api/v1/audits/:jobId', async (req: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
    const job = await deps.service.get(req.params.jobId);
    if (!job) {
      return sendError(reply, new HttpError({ statusCode: 404, code: 'JOB_NOT_FOUND', message: 'No such job' }));
    }
    if (job.status === 'queued' || job.status === 'processing') {
      reply.header('Retry-After', '1');
      return reply.status(202).send({
        jobId: job.jobId,
        status: job.status,
        statusUrl: `/api/v1/audits/${job.jobId}`,
        pollAfterMs: POLL_AFTER_MS,
        createdAt: job.createdAt,
      });
    }
    if (job.status === 'failed') {
      // We return 200 with a structured `error` envelope rather than
      // 5xx, so a failed job is observable but does not look like a
      // server outage. Clients that prefer a 5xx can switch on
      // `status === 'failed'`.
      return reply.send({
        jobId: job.jobId,
        status: 'failed',
        error: {
          code: job.errorCode ?? 'INTERNAL',
          message: job.error ?? 'audit failed',
        },
        createdAt: job.createdAt,
        failedAt: job.failedAt,
      });
    }
    // completed
    return reply.send({
      jobId: job.jobId,
      status: 'completed',
      report: job.report ? ReportSchema.parse(job.report as Report) : null,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      cache: job.cache ?? { hit: false, keyVersion: 'v1', expiresAt: null },
    });
  });
}

export const __cache = { keyVersionPrefix: 'v1' };
