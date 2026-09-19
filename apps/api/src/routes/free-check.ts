/**
 * /api/v1/free-check — the no-payment entry point.
 *
 * - 100% free, no x402 challenge, no payment headers required.
 * - Same input shape (minus mode/target/includeLaunchCopy) as the paid
 *   audit. Same URL parser, same SSRF defenses, same stack detector.
 * - Rate-limited via the global rate-limit middleware.
 * - No state, no DB writes, no LLM, no repo code execution.
 *
 * The response is a `FreeCheckReport` (reportVersion="1.0", kind="free-check").
 * The Paid Audit (`/api/v1/audits`) is a superset of this for users who need
 * deeper analysis, blockers with evidence, and the launch copy block.
 */
import type { FastifyInstance } from 'fastify';
import {
  FreeCheckInputSchema,
  FreeCheckReportSchema,
  FreeCheckRunner,
  InvalidRepoUrlError,
  RepoFetchError,
} from '@repopilot/core';
import { sendError, HttpError } from '../utils/errors.js';

export interface FreeCheckRoutesDeps {
  runner: FreeCheckRunner;
  allowedHosts: string[];
  githubToken?: string;
}

/**
 * Map a runner error to a structured HTTP error.
 *
 * - `InvalidRepoUrlError` → 403 HOST_NOT_ALLOWED (SSRF defense)
 * - `RepoFetchError` with status 404 → 404 REPO_NOT_FOUND
 * - `RepoFetchError` with status 403 → 429 UPSTREAM_RATE_LIMITED
 * - `RepoFetchError` with status 429 → 429 UPSTREAM_RATE_LIMITED
 * - Anything else → 502 UPSTREAM_FAILED
 */
function mapRunnerError(e: unknown): HttpError {
  if (e instanceof InvalidRepoUrlError) {
    return new HttpError({ statusCode: 403, code: 'HOST_NOT_ALLOWED', message: e.message });
  }
  if (e instanceof RepoFetchError) {
    if (e.status === 404) {
      return new HttpError({ statusCode: 404, code: 'REPO_NOT_FOUND', message: e.message });
    }
    if (e.status === 403 || e.status === 429) {
      return new HttpError({
        statusCode: 429,
        code: 'UPSTREAM_RATE_LIMITED',
        message:
          'GitHub rate-limited the request. Set GITHUB_TOKEN to raise the limit and retry.',
      });
    }
    return new HttpError({ statusCode: 502, code: 'UPSTREAM_FAILED', message: e.message });
  }
  const msg = (e as Error)?.message ?? 'free check failed';
  return new HttpError({ statusCode: 502, code: 'UPSTREAM_FAILED', message: msg });
}

export function registerFreeCheckRoutes(app: FastifyInstance, deps: FreeCheckRoutesDeps) {
  app.post('/api/v1/free-check', async (req, reply) => {
    const parsed = FreeCheckInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        new HttpError({
          statusCode: 400,
          code: 'INVALID_INPUT',
          message: parsed.error.issues
            .map((i: { path: (string | number)[]; message: string }) =>
              `${i.path.join('.')}: ${i.message}`,
            )
            .join('; '),
        }),
      );
    }
    try {
      const report = await deps.runner.run(parsed.data);
      return reply.send(FreeCheckReportSchema.parse(report));
    } catch (e) {
      return sendError(reply, mapRunnerError(e));
    }
  });
}

export { FreeCheckReportSchema };
