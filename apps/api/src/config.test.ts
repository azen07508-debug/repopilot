// Unit tests for the R-02 production guards in `config.ts`.
//
// `validateProductionConfig()` is the last line of defence against
// shipping a service that charges real money through a mock payment
// adapter or relies on the in-process audit queue. The hard fail-point
// lives in `loadConfig()` so every code path that reads the config
// (API server, worker, scripts) gets the same protection.
//
// We test the function directly rather than booting the whole API,
// which makes the failure modes explicit and keeps the test fast.

import { describe, it, expect } from 'vitest';
import {
  validateProductionConfig,
  ProductionConfigError,
  type AppConfig,
} from './config.js';

// A complete production-shaped config. Completeness is enforced by `satisfies`
// rather than asserted: the `as AppConfig` cast that used to be here let this
// fixture keep compiling after `OKX_PAYMENT_RESOURCE_URL` was added to
// `ConfigSchema`, so three tests died at runtime with
// `TypeError: Cannot read properties of undefined (reading 'trim')` — a stack
// trace instead of a compile error. Adding a field now breaks the build here,
// which is where the author of the field will see it.
//
// `ALLOWED_REPO_HOSTS` is an array because `ConfigSchema` transforms the
// comma-separated env string before `AppConfig` is inferred; the string that
// used to be here was a second reason the cast was load-bearing.
function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const complete = {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: 4000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'file:./data/repopilot.db',
    CORS_ORIGINS: 'http://localhost:5173',
    ALLOWED_REPO_HOSTS: ['github.com', 'raw.githubusercontent.com'],
    MAX_FILES: 2000,
    MAX_FILE_BYTES: 1_048_576,
    MAX_TOTAL_BYTES: 52_428_800,
    RATE_LIMIT_PER_MINUTE: 60,
    GITHUB_TOKEN: '',
    PAYMENT_MODE: 'mock',
    OKX_PAYMENT_ADDRESS: '',
    OKX_PAYMENT_NETWORK: 'xlayer',
    OKX_X402_VERSION: 2,
    OKX_PAYMENT_RESOURCE_URL: 'https://api.example.com/api/v1/audits',
    PRICE_AUDIT: '1',
    AUDIT_QUEUE_DRIVER: 'inline',
    AUDIT_QUEUE_CONCURRENCY: 1,
    AUDIT_QUEUE_RETRY_LIMIT: 3,
    AUDIT_QUEUE_JOB_TIMEOUT_MS: 90_000,
    SHUTDOWN_GRACE_PERIOD_MS: 30_000,
    REPORT_CACHE_ENABLED: true,
    REPORT_CACHE_TTL_SECONDS: 3600,
  } satisfies AppConfig;
  // The cast is about the spread, not about the fields: spreading a
  // `Partial<AppConfig>` makes every property optional-with-undefined in the
  // inferred type, which no annotation can undo. The values are a complete
  // config merged with a partial one, so the result is an `AppConfig` by
  // construction and `complete` above is what proves every field was named.
  return { ...complete, ...overrides } as AppConfig;
}

describe('validateProductionConfig (R-02)', () => {
  it('passes in development regardless of PAYMENT_MODE / OKX addr / queue driver', () => {
    expect(() =>
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'development',
          PAYMENT_MODE: 'mock',
          OKX_PAYMENT_ADDRESS: '',
          AUDIT_QUEUE_DRIVER: 'inline',
        }),
      ),
    ).not.toThrow();
  });

  it('passes in production when PAYMENT_MODE=okx, address is set, resource URL is public https, queue=pg-boss', () => {
    expect(() =>
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          OKX_PAYMENT_RESOURCE_URL: 'https://api.example.com/api/v1/audits',
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      ),
    ).not.toThrow();
  });

  it('fails in production with PAYMENT_MODE=mock', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'mock',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).toMatch(
      /PAYMENT_MODE=mock/,
    );
  });

  it('fails in production with PAYMENT_MODE=okx but empty address', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '   ',
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).toMatch(
      /OKX_PAYMENT_ADDRESS/,
    );
  });

  it('fails in production with PAYMENT_MODE=okx but no resource URL', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          OKX_PAYMENT_RESOURCE_URL: '',
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).toMatch(
      /OKX_PAYMENT_RESOURCE_URL/,
    );
  });

  // The resource URL is what the 402 challenge shows the buyer as the thing
  // being paid for, so an unusable one is a challenge naming a resource that
  // cannot be fetched. The `.invalid` row is the one with a story: it is the
  // adapter's own placeholder, so it can appear in a log or a captured
  // challenge, and an operator pasting it into `.env` must not pass.
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['https://repopilot.invalid/api/v1/audits', "the adapter's own .invalid placeholder"],
    ['http://api.example.com/api/v1/audits', 'http, not https'],
    ['https://localhost/api/v1/audits', 'localhost'],
    ['https://api.local/api/v1/audits', '.local'],
    ['https://repopilot/api/v1/audits', 'a host with no dot — the value this replaced'],
    ['https://127.0.0.1/api/v1/audits', 'a bare IPv4 host'],
    ['not a url', 'not a URL at all'],
  ])('rejects the resource URL %j (%s)', (url) => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          OKX_PAYMENT_RESOURCE_URL: url,
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).toMatch(
      /OKX_PAYMENT_RESOURCE_URL/,
    );
  });

  it('accepts a resource URL with a subdomain, a port and a path', () => {
    expect(() =>
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          OKX_PAYMENT_RESOURCE_URL: 'https://api.repopilot.example:8443/api/v1/audits',
          AUDIT_QUEUE_DRIVER: 'pg-boss',
        }),
      ),
    ).not.toThrow();
  });

  it('does not require a resource URL when PAYMENT_MODE=mock', () => {
    // The guard belongs to the okx path. A mock deployment has no 402
    // challenge to put a resource in, so demanding one would be a check
    // that rejects a configuration which is correct.
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'mock',
          OKX_PAYMENT_RESOURCE_URL: '',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).not.toMatch(
      /OKX_PAYMENT_RESOURCE_URL/,
    );
  });

  it('fails in production with AUDIT_QUEUE_DRIVER=inline', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
          AUDIT_QUEUE_DRIVER: 'inline',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    expect((caught as ProductionConfigError).issues.join(' ')).toMatch(
      /AUDIT_QUEUE_DRIVER=inline/,
    );
  });

  it('reports both PAYMENT_MODE=mock and AUDIT_QUEUE_DRIVER=inline together', () => {
    // The OKX address check only fires when PAYMENT_MODE=okx; with
    // PAYMENT_MODE=mock the address is irrelevant. So the bundled
    // report has the two independent issues, not all three.
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'mock',
          OKX_PAYMENT_ADDRESS: '',
          AUDIT_QUEUE_DRIVER: 'inline',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    const issues = (caught as ProductionConfigError).issues;
    expect(issues.length).toBe(2);
    expect(issues[0]).toMatch(/PAYMENT_MODE=mock/);
    expect(issues[1]).toMatch(/AUDIT_QUEUE_DRIVER=inline/);
  });

  it('error message does not contain any address or token value', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'mock',
          OKX_PAYMENT_ADDRESS: '0xsuper-secret-address-do-not-leak',
          AUDIT_QUEUE_DRIVER: 'inline',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionConfigError);
    const message = (caught as Error).message;
    expect(message).not.toContain('0xsuper-secret-address-do-not-leak');
    expect(message).not.toContain('GITHUB_TOKEN');
  });

  it('ProductionConfigError is a real Error subclass with name=ProductionConfigError', () => {
    let caught: unknown;
    try {
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'mock',
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('ProductionConfigError');
  });
});
