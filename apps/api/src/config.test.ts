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

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: 4000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'file:./data/repopilot.db',
    CORS_ORIGINS: 'http://localhost:5173',
    ALLOWED_REPO_HOSTS: 'github.com,raw.githubusercontent.com',
    GITHUB_TOKEN: '',
    PAYMENT_MODE: 'mock',
    OKX_PAYMENT_ADDRESS: '',
    OKX_PAYMENT_NETWORK: 'xlayer',
    PRICE_QUICK_SCAN: '0.02',
    PRICE_FULL_AUDIT: '0.10',
    AUDIT_QUEUE_DRIVER: 'inline',
    AUDIT_QUEUE_CONCURRENCY: 1,
    AUDIT_QUEUE_RETRY_LIMIT: 3,
    AUDIT_QUEUE_JOB_TIMEOUT_MS: 90_000,
    SHUTDOWN_GRACE_PERIOD_MS: 30_000,
    REPORT_CACHE_ENABLED: true,
    REPORT_CACHE_TTL_SECONDS: 3600,
    ...overrides,
  } as AppConfig;
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

  it('passes in production when PAYMENT_MODE=okx, address is set, queue=pg-boss', () => {
    expect(() =>
      validateProductionConfig(
        baseConfig({
          NODE_ENV: 'production',
          PAYMENT_MODE: 'okx',
          OKX_PAYMENT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
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
