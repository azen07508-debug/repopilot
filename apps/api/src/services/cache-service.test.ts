/**
 * Unit tests for CacheService + ReportCacheRepository.
 *
 * Each test opens a brand-new isolated SQLite database (see
 * `openIsolatedSqlite` in `db/client.ts`) so the tests do not race
 * each other or the rest of the app.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openIsolatedSqlite, runMigrations } from '../db/client.js';
import { ReportCacheRepository } from '../repositories/report-cache-repository.js';
import { buildCacheKey, CacheService } from './cache-service.js';
import type { Report } from '@repopilot/core';

const log = pino({ level: 'silent' });

function newReport(): Report {
  return {
    reportVersion: '1.0',
    repository: {
      url: 'https://github.com/octocat/Hello-World',
      owner: 'octocat',
      name: 'Hello-World',
      defaultBranch: 'master',
      license: null,
      lastUpdatedAt: '2024-08-20T23:54:42Z',
      visibility: 'public',
      archived: false,
      stars: 0,
      openIssues: 0,
      openPulls: 0,
      description: '',
      primaryLanguage: null,
    },
    summary: 'x',
    detectedStack: [],
    scores: {
      overall: 1,
      documentation: 1,
      reproducibility: 1,
      securityHygiene: 1,
      deploymentReadiness: 1,
      breakdown: {
        documentation: { raw: 1, rules: [], final: 1 },
        reproducibility: { raw: 1, rules: [], final: 1 },
        securityHygiene: { raw: 1, rules: [], final: 1 },
        deploymentReadiness: { raw: 1, rules: [], final: 1 },
      },
    },
    blockers: [],
    documentationGaps: [],
    securityFindings: [],
    deploymentPlan: [],
    recommendedTasks: [],
    launchChecklist: [],
    launchCopy: { oneSentencePitch: '', shortDescription: '', xPost: '' },
    limitations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    auditMode: 'quick',
    target: 'open_source',
    outputLanguage: 'en',
    analyzerProvenance: {},
  } as unknown as Report;
}

describe('buildCacheKey', () => {
  const base = {
    owner: 'octocat',
    repo: 'Hello-World',
    commitSha: 'abc123',
    mode: 'quick' as const,
    target: 'open_source' as const,
    outputLanguage: 'en' as const,
    reportVersion: '1.0',
    includeLaunchCopy: false,
  };
  it('is stable for the same inputs', () => {
    expect(buildCacheKey(base)).toBe(buildCacheKey(base));
  });
  it('changes when commitSha changes', () => {
    expect(buildCacheKey({ ...base, commitSha: 'abc123' })).not.toBe(
      buildCacheKey({ ...base, commitSha: 'def456' }),
    );
  });
  it('Quick and Full are isolated', () => {
    expect(buildCacheKey({ ...base, mode: 'quick' })).not.toBe(
      buildCacheKey({ ...base, mode: 'full' }),
    );
  });
  it('different target / outputLanguage are isolated', () => {
    expect(buildCacheKey({ ...base, target: 'hackathon' })).not.toBe(
      buildCacheKey({ ...base, target: 'open_source' }),
    );
    expect(buildCacheKey({ ...base, outputLanguage: 'en' })).not.toBe(
      buildCacheKey({ ...base, outputLanguage: 'zh-CN' }),
    );
  });
});

describe('CacheService', () => {
  let cache: CacheService;
  let repo: ReportCacheRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repopilot-cache-'));
    const db = openIsolatedSqlite(`file:${join(dir, 'c.db')}`);
    await runMigrations(db);
    repo = new ReportCacheRepository(db);
    cache = new CacheService({ repo, log, enabled: true, ttlSeconds: 60 });
  });

  it('lookup returns miss on empty cache', async () => {
    const res = await cache.lookup('v1:abc', 'v1');
    expect(res.hit).toBe(false);
  });

  it('getOrCompute writes then hits', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return { report: newReport() };
    };
    const first = await cache.getOrCompute('v1:k', 'v1', 'sha1', compute);
    expect(first.hit).toBe(false);
    expect(calls).toBe(1);
    const second = await cache.getOrCompute('v1:k', 'v1', 'sha1', compute);
    expect(second.hit).toBe(true);
    expect(calls).toBe(1);
  });

  it('different cache keys do not share', async () => {
    const first = await cache.getOrCompute('v1:key1', 'v1', 'sha1', async () => ({ report: newReport() }));
    expect(first.hit).toBe(false);
    const second = await cache.getOrCompute('v1:key2', 'v1', 'sha1', async () => ({ report: newReport() }));
    expect(second.hit).toBe(false);
  });

  it('coalesces concurrent compute() calls', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return { report: newReport() };
    };
    const [a, b, c] = await Promise.all([
      cache.getOrCompute('v1:kc', 'v1', 'sha1', compute),
      cache.getOrCompute('v1:kc', 'v1', 'sha1', compute),
      cache.getOrCompute('v1:kc', 'v1', 'sha1', compute),
    ]);
    expect(calls).toBe(1);
    // Exactly one caller should be the leader (hit=false); the other
    // two should report hit=true.
    const hits = [a, b, c].filter((r) => r.hit).length;
    const misses = [a, b, c].filter((r) => !r.hit).length;
    expect(hits).toBe(2);
    expect(misses).toBe(1);
  });

  it('disabled cache short-circuits (no writes, no hits)', async () => {
    const disabled = new CacheService({ repo, log, enabled: false, ttlSeconds: 60 });
    const r = await disabled.getOrCompute('v1:k', 'v1', 'sha1', async () => ({ report: newReport() }));
    expect(r.hit).toBe(false);
    expect(r.expiresAt).toBeNull();
    expect(await repo.count()).toBe(0);
  });

  it('TTL expiry removes the row', async () => {
    const shortTtl = new CacheService({ repo, log, enabled: true, ttlSeconds: 0 });
    await shortTtl.getOrCompute('v1:k', 'v1', 'sha1', async () => ({ report: newReport() }));
    const peek = await repo.findByKey('v1:k', 'v1');
    expect(peek).toBeNull();
  });
});

describe('ReportCacheRepository', () => {
  let repo: ReportCacheRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repopilot-cache-'));
    const db = openIsolatedSqlite(`file:${join(dir, 'c.db')}`);
    await runMigrations(db);
    repo = new ReportCacheRepository(db);
  });

  it('pruneExpired only removes expired rows', async () => {
    const now = Date.now();
    await repo.upsert({
      key: 'v1:a',
      keyVersion: 'v1',
      report: { ok: true },
      commitSha: 'sha1',
      expiresAt: new Date(now - 1000).toISOString(),
    });
    await repo.upsert({
      key: 'v1:b',
      keyVersion: 'v1',
      report: { ok: true },
      commitSha: 'sha2',
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    expect(await repo.count()).toBe(2);
    const removed = await repo.pruneExpired();
    expect(removed).toBe(1);
    expect(await repo.count()).toBe(1);
  });

  it('upsert resets hits to 0 on conflict', async () => {
    await repo.upsert({
      key: 'v1:a',
      keyVersion: 'v1',
      report: { v: 1 },
      commitSha: 'sha1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await repo.incrementHits('v1:a', 'v1');
    await repo.incrementHits('v1:a', 'v1');
    await repo.upsert({
      key: 'v1:a',
      keyVersion: 'v1',
      report: { v: 2 },
      commitSha: 'sha1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const row = await repo.findByKey('v1:a', 'v1');
    expect(row?.hits).toBe(0);
    expect((row?.report as { v: number }).v).toBe(2);
  });
});
