/**
 * A fake RepoPilot API for the web tests.
 *
 * It is a `fetch` stub, not a mock of our own modules, so the tests exercise
 * the real `lib/api.ts` and the real React tree — the P0 this suite exists to
 * prevent was a mismatch between what the server sent and what the client
 * assumed, and mocking our own client would have hidden exactly that.
 *
 * Response shapes and status codes are copied from `apps/api/src/routes/audits.ts`:
 *
 *   - POST without `X-PAYMENT`   → 402 `{ jobId, status:'queued', payment, nextAction }`
 *     Note: the 402 carries **no** `statusUrl` / `pollAfterMs`.
 *   - POST with `X-PAYMENT`      → 202 `{ jobId, status:'queued', statusUrl, pollAfterMs }`
 *   - GET while queued/processing→ 202 (not 200) with the same four fields
 *   - GET completed              → 200 `{ jobId, status:'completed', report }`
 *   - GET failed                 → **200** with `{ status:'failed', error:{code,message} }`
 *     The route deliberately answers 200 so a failed job is not confused with
 *     an outage.
 *
 * The distinction between 202 and 200 matters: `getAudit` only checks `r.ok`,
 * so a stub that answered 200 for a queued job would not exercise the same
 * path the browser takes.
 */
import { vi } from 'vitest';
import type { Capabilities, Health, Report } from '../lib/api.js';
import { makeCapabilities, makeReport } from './fixtures.js';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  /** HTTP status the stub answered with. */
  status: number;
  /** Parsed JSON body the stub answered with (`null` if it was not JSON). */
  response: unknown;
  /** `Date.now()` when the request arrived. Used to check `pollAfterMs`. */
  at: number;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface FakeApiOptions {
  /** Successive answers for `GET /api/v1/audits/:jobId`. The last one repeats. */
  jobStates?: ReadonlyArray<JobStatus>;
  report?: Report;
  /** `pollAfterMs` advertised on the 202. */
  pollAfterMs?: number;
  capabilities?: Capabilities;
  health?: Health;
  /** How the payment-settling POST behaves. */
  settlePost?: 'ok' | 'network' | 'server-error';
  /** How the first POST (the 402 challenge) behaves. */
  challengePost?: 'ok' | 'network';
  /** Make the Nth status GET (1-based) reject, as a dropped connection would. */
  getNetworkErrorAt?: number;
  /** Message carried by a `failed` job. */
  failureMessage?: string;
}

export interface FakeApi {
  /** Every request the app made, in order. */
  requests: RecordedRequest[];
  /** Status GETs, in order — the polling trace. */
  polls: RecordedRequest[];
  /** POSTs to `/api/v1/audits`, in order. */
  posts: RecordedRequest[];
  /**
   * Pin what the next status GET reports, regardless of `jobStates`.
   *
   * Tests use this instead of a timed `jobStates` sequence so the assertions
   * never race the poll loop: the test decides when the job moves from
   * `queued` to `processing` to `completed`, not a `setTimeout`.
   */
  setJobState(status: JobStatus): void;
  restore(): void;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function normalizeHeaders(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (init instanceof Headers) {
    init.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[String(k).toLowerCase()] = String(v);
    return out;
  }
  for (const [k, v] of Object.entries(init)) out[k.toLowerCase()] = String(v);
  return out;
}

export function installFakeApi(options: FakeApiOptions = {}): FakeApi {
  const {
    jobStates = ['queued', 'processing', 'completed'],
    report = makeReport(),
    pollAfterMs = 5,
    capabilities = makeCapabilities(),
    health = { status: 'ok', version: '0.0.0-fixture', paymentMode: 'mock', database: 'ok' },
    settlePost = 'ok',
    challengePost = 'ok',
    getNetworkErrorAt,
    failureMessage = 'Analyzer crashed on a malformed file',
  } = options;

  const requests: RecordedRequest[] = [];
  let jobIndex = 0;
  let getCount = 0;
  /** Set by `setJobState`; wins over the `jobStates` sequence. */
  let pinned: JobStatus | null = null;

  const json = (body: unknown, status = 200, extra?: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

  /** The route sends these on every 202 (`audits.ts:213-214`, `334-335`). */
  const ACCEPTED_HEADERS = { 'retry-after': '1', location: '/api/v1/audits/job-1' };

  /**
   * The next status answer, walking `jobStates` and repeating the last entry.
   *
   * The index advances on **every** read, not only on `completed`. An earlier
   * version advanced only on completion, which made
   * `['queued', 'processing', 'completed']` answer `queued` forever — so every
   * "does it eventually finish" test hung until its timeout instead of failing
   * with a useful message.
   */
  const currentStatus = (): JobStatus => {
    if (pinned) return pinned;
    const i = Math.min(jobIndex, jobStates.length - 1);
    jobIndex = Math.min(jobIndex + 1, jobStates.length - 1);
    return jobStates[i]!;
  };

  const route = async (path: string, method: string, headers: Record<string, string>): Promise<Response> => {
    if (path === '/health') return json(health);
    if (path === '/api/v1/capabilities') return json(capabilities);

    if (path === '/api/v1/audits' && method === 'POST') {
      if (!headers['x-payment']) {
        if (challengePost === 'network') throw new TypeError('Failed to fetch');
        // Faithful to the route: no statusUrl, no pollAfterMs on the 402.
        return json(
          {
            jobId: 'job-1',
            status: 'queued',
            payment: {
              paymentId: 'pay-1',
              mode: capabilities.paymentMode,
              amount: '0.5',
              currency: 'USDT',
              challenge: { kind: 'mock' },
              expiresAt: '2026-01-01T00:05:00Z',
            },
            nextAction: 'Replay this POST with header X-PAYMENT: mock:pay-1',
          },
          402
        );
      }
      if (settlePost === 'network') throw new TypeError('Failed to fetch');
      if (settlePost === 'server-error') {
        return json({ error: { code: 'ENQUEUE_FAILED', message: 'Queue is not accepting jobs; please retry' } }, 503);
      }
      // The route also sends `Retry-After: 1` and `Location`; the client reads
      // `pollAfterMs` from the body, so they are reproduced for fidelity only.
      return json(
        { jobId: 'job-1', status: 'queued', statusUrl: '/api/v1/audits/job-1', pollAfterMs },
        202,
        ACCEPTED_HEADERS
      );
    }

    if (path === '/api/v1/audits/job-1/fix-plan') {
      return json({
        schemaVersion: '1.0',
        repository: { owner: 'octocat', name: 'Hello-World' },
        generatedAt: '2026-01-01T00:00:00Z',
        reportVersion: '1.0',
        plans: [],
      });
    }

    if (/^\/api\/v1\/repositories\/[^/]+\/[^/]+\/audits/.test(path)) {
      return json({ owner: 'octocat', repo: 'Hello-World', limit: 20, count: 0, audits: [] });
    }

    if (path === '/api/v1/audits/job-1' && method === 'GET') {
      getCount += 1;
      if (getNetworkErrorAt !== undefined && getCount === getNetworkErrorAt) {
        throw new TypeError('Failed to fetch');
      }
      const status = currentStatus();
      if (status === 'queued' || status === 'processing') {
        return json(
          {
            jobId: 'job-1',
            status,
            statusUrl: '/api/v1/audits/job-1',
            pollAfterMs,
            createdAt: '2026-01-01T00:00:00Z',
          },
          202,
          ACCEPTED_HEADERS
        );
      }
      if (status === 'failed') {
        return json({
          jobId: 'job-1',
          status: 'failed',
          error: { code: 'ANALYZER_FAILED', message: failureMessage },
          createdAt: '2026-01-01T00:00:00Z',
          failedAt: '2026-01-01T00:00:05Z',
        });
      }
      // `cache` is part of the route's completed envelope (audits.ts:382).
      return json({ jobId: 'job-1', status: 'completed', report, cache: { hit: false, keyVersion: 'v1', expiresAt: null } });
    }

    throw new Error(`fake-api: unrouted request ${method} ${path}`);
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = raw.replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = normalizeHeaders(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const entry: RecordedRequest = { method, path, headers, body, status: 0, response: null, at: Date.now() };
    requests.push(entry);

    const res = await route(path, method, headers);
    entry.status = res.status;
    // `clone()` so the app still gets an unread body.
    entry.response = await res
      .clone()
      .json()
      .catch(() => null);
    return res;
  };

  vi.stubGlobal('fetch', vi.fn(handler));

  return {
    requests,
    get polls() {
      return requests.filter((r) => r.method === 'GET' && r.path === '/api/v1/audits/job-1');
    },
    get posts() {
      return requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/audits');
    },
    setJobState(status: JobStatus) {
      pinned = status;
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}
