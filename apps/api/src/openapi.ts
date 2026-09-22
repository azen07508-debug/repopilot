/**
 * OpenAPI 3.1 spec for RepoPilot.
 *
 * Hand-written (no codegen). The spec lives next to the routes so adding
 * an endpoint forces an explicit review of its public shape.
 *
 * Served at `GET /docs/openapi.json`. The `paths` block is intentionally
 * inline so reviewers can read it without jumping files.
 */
import { CORE_VERSION } from '@repopilot/core';

export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'RepoPilot API',
      version: CORE_VERSION,
      summary: 'GitHub repository launch-readiness audit',
      description:
        'RepoPilot audits a public GitHub repository and returns a ' +
        'structured launch report. Two entry points: a no-payment ' +
        '`/api/v1/free-check` for a quick readiness signal, and a ' +
        'paid `/api/v1/audits` for the full evidence-backed audit.',
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Local dev' },
    ],
    tags: [
      { name: 'meta', description: 'Service metadata' },
      { name: 'capabilities', description: 'Public service capabilities' },
      { name: 'free-check', description: 'No-payment entry point' },
      { name: 'audits', description: 'Paid audits' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['meta'],
          summary: 'Liveness probe',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Process is up',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/capabilities': {
        get: {
          tags: ['capabilities'],
          summary: 'Service capabilities',
          operationId: 'getCapabilities',
          responses: {
            '200': {
              description: 'Service capabilities',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CapabilitiesResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/free-check': {
        post: {
          tags: ['free-check'],
          summary: 'No-payment repository readiness check',
          description:
            'Returns a slim readiness signal (README/LICENSE/lockfile/CI presence, ' +
            'stack detection, 0–100 score). Never executes repository code. ' +
            'Never reads payment. Rate-limited per IP.',
          operationId: 'freeCheck',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FreeCheckRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Free check report',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FreeCheckReport' },
                },
              },
            },
            '400': {
              description: 'Invalid input',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'Host not in the allowlist (SSRF defence)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Repository not found or not accessible',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '429': {
              description: 'Rate-limited (per-IP) or upstream GitHub limit',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '502': {
              description: 'Upstream failure (GitHub unreachable, etc.)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/audits': {
        post: {
          tags: ['audits'],
          summary: 'Create or replay an audit job',
          description:
            'POST /api/v1/audits is async: it always returns 202 + ' +
            '`Location: /api/v1/audits/{jobId}` + `Retry-After: 1` once ' +
            'payment is verified. The client then polls `GET /api/v1/audits/{jobId}` ' +
            'until the job is `completed` (200) or `failed` (200 with structured error).\n\n' +
            'First call (no `X-PAYMENT`): creates a job and returns 402 with a ' +
            'payment challenge. Replay with `X-PAYMENT` or supply an `Idempotency-Key` ' +
            'header. Both make the request idempotent on the server side.',
          operationId: 'createAudit',
          parameters: [
            {
              name: 'X-PAYMENT',
              in: 'header',
              required: false,
              description: 'Payment receipt (mock: `<id>` or base64-JSON for OKX).',
              schema: { type: 'string' },
            },
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              description: 'Optional client-supplied dedup key. Repeat calls return the same jobId.',
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateAuditRequest' },
              },
            },
          },
          responses: {
            '202': {
              description: 'Audit job accepted and queued. Poll GET /api/v1/audits/{jobId}.',
              headers: {
                'Location': {
                  description: 'Path to the job resource for polling.',
                  schema: { type: 'string' },
                },
                'Retry-After': {
                  description: 'Recommended poll interval in seconds.',
                  schema: { type: 'integer', minimum: 1 },
                },
              },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuditQueuedResponse' },
                },
              },
            },
            '400': {
              description: 'Invalid input',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '402': {
              description: 'Payment required / not yet settled',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PaymentChallenge' },
                },
              },
            },
            '429': {
              description: 'Rate-limited',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '503': {
              description: 'Queue unavailable; please retry',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/audits/{jobId}': {
        get: {
          tags: ['audits'],
          summary: 'Fetch an audit job',
          operationId: 'getAudit',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Job status: completed (with report) or failed (with structured error).',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuditStatusResponse' },
                },
              },
            },
            '202': {
              description: 'Job is queued or processing. Retry with Retry-After header.',
              headers: {
                'Retry-After': {
                  description: 'Recommended poll interval in seconds.',
                  schema: { type: 'integer', minimum: 1 },
                },
              },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuditStatusResponse' },
                },
              },
            },
            '404': {
              description: 'Unknown job',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/audits/{jobId}/fix-plan': {
        get: {
          tags: ['derived'],
          summary: 'Fix plans for a completed audit',
          description:
            'Derived from the stored report: one plan per finding, each with evidence, ordered steps, tests to add, acceptance criteria and agent instructions. Free — no payment challenge — and no repository is scanned.',
          operationId: 'getAuditFixPlan',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'A FixPlanSet for the job.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Unknown job',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '409': {
              description: 'The job has not completed yet, so there is no report to derive from.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/audits/{jobId}/diff': {
        get: {
          tags: ['derived'],
          summary: 'Compare two completed audits of the same repository',
          description:
            'Rule-level attribution of the score change, plus resolved / new / persistent findings. Free, and derived purely from the two stored reports.',
          operationId: 'getAuditDiff',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'base',
              in: 'query',
              required: true,
              description: 'jobId of the earlier audit. List them via the repository history endpoint.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'An AuditDiff.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '400': {
              description: 'Missing base, self-comparison, or the two audits belong to different repositories.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Unknown head or base job',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/audits/{jobId}/quality': {
        get: {
          tags: ['derived'],
          summary: 'Quality contract for a completed audit — may this ship?',
          description:
            'A deterministic pass / pass_with_warnings / blocked verdict, the blocker and warning counts, and every check with its requirement, what was observed, and the rule ids behind it. Free, derived from the stored report, and re-evaluated on each read so a contract change applies to existing audits. The verdict is never model-assigned.',
          operationId: 'getAuditQuality',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'A QualityContractResult for the job.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Unknown job',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '409': {
              description: 'The job has not completed yet, so there is no report to evaluate.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/repositories/{owner}/{repo}/reaudit': {
        post: {
          tags: ['derived'],
          summary: 'Re-audit a repository',
          description:
            'Same payment and idempotency path as POST /api/v1/audits, but the repository comes from the path instead of the body. Paid — it runs the pipeline again. This is the write half of the fix → re-audit → compare loop.',
          operationId: 'reauditRepository',
          parameters: [
            {
              name: 'owner',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'repo',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    mode: { type: 'string', enum: ['quick', 'full'] },
                    target: {
                      type: 'string',
                      enum: ['hackathon', 'open_source', 'production'],
                    },
                    outputLanguage: { type: 'string', enum: ['en', 'zh-CN'] },
                    includeLaunchCopy: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '202': {
              description: 'Job queued. Poll the Location header with Retry-After.',
            },
            '400': {
              description: 'Invalid owner/repo segment or request body.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '402': {
              description: 'Payment required. Replay with X-PAYMENT.',
            },
          },
        },
      },
      '/api/v1/repositories/{owner}/{repo}/audits': {
        get: {
          tags: ['derived'],
          summary: 'Audit history for one repository',
          description:
            'Newest-first summaries. Full reports stay available through GET /api/v1/audits/{jobId}.',
          operationId: 'listRepositoryAudits',
          parameters: [
            {
              name: 'owner',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'repo',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            '200': {
              description: 'Audit summaries for the repository.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          required: ['status', 'version', 'paymentMode', 'database', 'queue'],
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'] },
            version: { type: 'string' },
            paymentMode: { type: 'string', enum: ['mock', 'okx'] },
            database: { type: 'string', enum: ['ok', 'degraded'] },
            queue: {
              type: 'object',
              required: ['driver', 'status', 'acceptingJobs'],
              properties: {
                driver: { type: 'string', enum: ['inline', 'pg-boss'] },
                status: { type: 'string', enum: ['ok', 'degraded', 'unavailable'] },
                acceptingJobs: { type: 'boolean' },
                pending: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        CapabilitiesResponse: {
          type: 'object',
          required: [
            'name',
            'version',
            'inputs',
            'outputs',
            'limits',
            'pricing',
            'paymentMode',
            'endpoints',
          ],
          properties: {
            name: { type: 'string', enum: ['RepoPilot'] },
            version: { type: 'string' },
            inputs: { type: 'object', additionalProperties: { type: 'string' } },
            outputs: { type: 'object', additionalProperties: { type: 'string' } },
            limits: { type: 'object', additionalProperties: true },
            pricing: { type: 'object', additionalProperties: true },
            paymentMode: { type: 'string', enum: ['mock', 'okx'] },
            endpoints: {
              type: 'object',
              required: ['freeCheck', 'audits'],
              properties: {
                freeCheck: {
                  type: 'object',
                  required: ['path', 'method', 'auth', 'input', 'output'],
                  properties: {
                    path: { type: 'string' },
                    method: { type: 'string', enum: ['POST'] },
                    auth: { type: 'string', enum: ['none'] },
                    input: { type: 'string' },
                    output: { type: 'string' },
                    rateLimited: { type: 'boolean' },
                    pricingUsdt: { type: 'string' },
                  },
                },
                audits: {
                  type: 'object',
                  required: ['path', 'method', 'auth', 'input', 'output'],
                  properties: {
                    path: { type: 'string' },
                    method: { type: 'string', enum: ['POST'] },
                    auth: { type: 'string', enum: ['x402'] },
                    input: { type: 'string' },
                    output: { type: 'string' },
                    rateLimited: { type: 'boolean' },
                    pricingUsdt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        FreeCheckRequest: {
          type: 'object',
          required: ['repoUrl'],
          properties: {
            repoUrl: {
              type: 'string',
              format: 'uri',
              description: 'https URL to a public GitHub repository',
            },
            outputLanguage: { type: 'string', enum: ['en', 'zh-CN'], default: 'en' },
          },
        },
        FreeCheckReport: {
          type: 'object',
          required: [
            'reportVersion',
            'kind',
            'repository',
            'metadata',
            'stack',
            'checks',
            'score',
            'generatedAt',
          ],
          properties: {
            reportVersion: { type: 'string', enum: ['1.0'] },
            kind: { type: 'string', enum: ['free-check'] },
            repository: {
              type: 'object',
              required: ['url', 'host', 'owner', 'name', 'valid'],
              properties: {
                url: { type: 'string' },
                host: { type: 'string' },
                owner: { type: 'string' },
                name: { type: 'string' },
                valid: { type: 'boolean' },
              },
            },
            metadata: {
              type: 'object',
              nullable: true,
              properties: {
                description: { type: 'string', nullable: true },
                defaultBranch: { type: 'string', nullable: true },
                stars: { type: 'integer', nullable: true, minimum: 0 },
                language: { type: 'string', nullable: true },
                topics: { type: 'array', items: { type: 'string' } },
              },
            },
            stack: {
              type: 'object',
              nullable: true,
              properties: {
                languages: { type: 'array', items: { type: 'string' } },
                frameworks: { type: 'array', items: { type: 'string' } },
                runtimes: { type: 'array', items: { type: 'string' } },
              },
            },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'passed', 'evidence'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  passed: { type: 'boolean' },
                  evidence: { type: 'string', nullable: true },
                },
              },
            },
            score: {
              type: 'object',
              required: ['value', 'passed', 'total'],
              properties: {
                value: { type: 'integer', minimum: 0, maximum: 100 },
                passed: { type: 'integer', minimum: 0 },
                total: { type: 'integer', minimum: 1 },
              },
            },
            generatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateAuditRequest: {
          type: 'object',
          required: ['repoUrl'],
          properties: {
            repoUrl: { type: 'string', format: 'uri' },
            mode: { type: 'string', enum: ['quick', 'full'], default: 'quick' },
            target: {
              type: 'string',
              enum: ['hackathon', 'open_source', 'production'],
              default: 'open_source',
            },
            outputLanguage: { type: 'string', enum: ['en', 'zh-CN'], default: 'en' },
            includeLaunchCopy: { type: 'boolean', default: true },
          },
        },
        AuditQueuedResponse: {
          type: 'object',
          required: ['jobId', 'status', 'statusUrl', 'pollAfterMs'],
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'processing'] },
            statusUrl: { type: 'string', description: 'Path to GET for polling.' },
            pollAfterMs: { type: 'integer', minimum: 0 },
          },
        },
        AuditCompletedResponse: {
          type: 'object',
          required: ['jobId', 'status', 'report', 'cache'],
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string', enum: ['completed'] },
            report: { type: 'object' },
            cache: {
              type: 'object',
              required: ['hit', 'keyVersion', 'expiresAt'],
              properties: {
                hit: { type: 'boolean' },
                keyVersion: { type: 'string' },
                expiresAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
        AuditStatusResponse: {
          type: 'object',
          required: ['jobId', 'status'],
          properties: {
            jobId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['queued', 'processing', 'completed', 'failed'],
            },
            report: { type: 'object', nullable: true },
            error: { type: 'object', nullable: true },
            cache: {
              type: 'object',
              required: ['hit', 'keyVersion', 'expiresAt'],
              properties: {
                hit: { type: 'boolean' },
                keyVersion: { type: 'string' },
                expiresAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
        PaymentChallenge: {
          type: 'object',
          required: ['jobId', 'payment'],
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'processing'] },
            payment: { type: 'object' },
            error: { type: 'object' },
            paymentId: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
              },
            },
          },
        },
      },
    },
  };
}
