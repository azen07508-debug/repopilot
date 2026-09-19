/**
 * Server-side environment loader. Reads process.env (or a .env file in dev)
 * and returns a typed, validated config object.
 *
 * If you add a new env variable, declare it here AND in `.env.example`.
 */
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),

  DATABASE_URL: z.string().default('file:./data/repopilot.db'),

  GITHUB_TOKEN: z.string().optional(),

  ALLOWED_REPO_HOSTS: z
    .string()
    .default('github.com,raw.githubusercontent.com')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),

  MAX_FILES: z.coerce.number().int().positive().default(2000),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(1_048_576),
  MAX_TOTAL_BYTES: z.coerce.number().int().positive().default(52_428_800),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  PAYMENT_MODE: z.enum(['mock', 'okx']).default('mock'),
  OKX_PAYMENT_ADDRESS: z.string().default(''),
  OKX_PAYMENT_NETWORK: z.string().default('xlayer'),
  OKX_X402_VERSION: z.coerce.number().int().default(2),

  PRICE_QUICK_SCAN: z.string().default('0.02'),
  PRICE_FULL_AUDIT: z.string().default('0.10'),

  LLM_PROVIDER: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.string().default(''),

  // Report cache (paid audits only). Default off so existing
  // snapshots stay stable; turn on in production.
  REPORT_CACHE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  REPORT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Audit queue driver: "inline" runs in-process; "pg-boss" persists to
  // PostgreSQL. Local dev + tests default to inline. Production MUST be
  // pg-boss (or a future persistent driver) — see config invariants below.
  AUDIT_QUEUE_DRIVER: z.enum(['inline', 'pg-boss']).default('inline'),
  AUDIT_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  AUDIT_QUEUE_RETRY_LIMIT: z.coerce.number().int().min(0).max(5).default(1),
  AUDIT_QUEUE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  // Graceful shutdown window: how long the server waits for in-flight
  // jobs to drain before forcing the queue / DB to close.
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce.number().int().positive().default(30_000),
});

// ----------------------------------------------------------------------------
// Production guards (R-02).
//
// `env:check` and the config schema alone are not enough: they let a
// misconfigured server boot, log a warning, and accept payment in mock mode.
// We add a single, hard fail-point in `validateProductionConfig()` below
// and call it from `loadConfig()` so any process that reads the config
// (API server, scripts, workers) gets the same protection.
//
// Invariants:
//   - production + PAYMENT_MODE=mock            => fail
//   - production + PAYMENT_MODE=okx + empty addr => fail
//   - production + AUDIT_QUEUE_DRIVER=inline    => fail
//
// All error messages are scrubbed of any secret value (we only print the
// names of the offending fields, never the values).
// ----------------------------------------------------------------------------
export class ProductionConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Refusing to start with an unsafe production configuration: ${issues.join('; ')}`,
    );
    this.name = 'ProductionConfigError';
    this.issues = issues;
  }
}

export function validateProductionConfig(cfg: AppConfig): void {
  if (cfg.NODE_ENV !== 'production') return;
  const issues: string[] = [];
  if (cfg.PAYMENT_MODE === 'mock') {
    issues.push(
      'NODE_ENV=production with PAYMENT_MODE=mock is forbidden (R-02). Set PAYMENT_MODE=okx with a valid OKX_PAYMENT_ADDRESS.',
    );
  }
  if (cfg.PAYMENT_MODE === 'okx' && cfg.OKX_PAYMENT_ADDRESS.trim() === '') {
    issues.push(
      'NODE_ENV=production with PAYMENT_MODE=okx requires OKX_PAYMENT_ADDRESS to be set.',
    );
  }
  if (cfg.AUDIT_QUEUE_DRIVER === 'inline') {
    issues.push(
      'NODE_ENV=production with AUDIT_QUEUE_DRIVER=inline is forbidden. Use AUDIT_QUEUE_DRIVER=pg-boss with a persistent PostgreSQL store.',
    );
  }
  if (issues.length > 0) throw new ProductionConfigError(issues);
}

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid configuration:', parsed.error.format());
    throw new Error('Invalid configuration');
  }
  cached = parsed.data;
  validateProductionConfig(cached);
  return cached;
}

export function _resetConfigCacheForTests(): void {
  cached = null;
}
