/**
 * CacheService — request-coalescing, TTL-aware report cache.
 *
 * Backed by `ReportCacheRepository` (persistent DB) plus an in-process
 * `Map` of in-flight computations so concurrent callers for the same
 * key do not both fetch the report from GitHub.
 *
 * Concurrency contract: for N concurrent callers of `getOrCompute` on
 * the same key, exactly one `compute()` runs; all N callers receive
 * the same report; the first caller reports `hit=false`; the rest
 * report `hit=true` once the persistent row is written.
 */
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { Report } from '@repopilot/core';
import { ReportCacheRepository, type ReportCacheRow } from '../repositories/report-cache-repository.js';

export interface BuildCacheKeyInput {
  owner: string;
  repo: string;
  commitSha: string;
  mode: 'quick' | 'full';
  target: 'hackathon' | 'open_source' | 'production';
  outputLanguage: 'en' | 'zh-CN';
  reportVersion: string;
  includeLaunchCopy: boolean;
}

export interface CacheLookupResult {
  hit: boolean;
  keyVersion: string;
  report?: Report;
  expiresAt?: string;
}

const KEY_VERSION_PREFIX = 'v1';

export function buildCacheKey(input: BuildCacheKeyInput): string {
  const payload = JSON.stringify({
    commitSha: input.commitSha,
    includeLaunchCopy: input.includeLaunchCopy,
    mode: input.mode,
    outputLanguage: input.outputLanguage,
    owner: input.owner,
    repo: input.repo,
    reportVersion: input.reportVersion,
    target: input.target,
  });
  const sha = createHash('sha256').update(payload).digest('hex');
  return `${KEY_VERSION_PREFIX}:${sha}`;
}

export interface CacheServiceOptions {
  repo: ReportCacheRepository;
  log: Logger;
  enabled: boolean;
  ttlSeconds: number;
}

interface InflightEntry {
  promise: Promise<{ report: Report; commitSha: string }>;
  firstCaller: boolean;
  firstCallerPromise: Promise<void>;
}

export class CacheService {
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(private readonly opts: CacheServiceOptions) {}

  buildKey(input: BuildCacheKeyInput): string {
    return buildCacheKey(input);
  }

  async lookup(key: string, keyVersion: string): Promise<CacheLookupResult> {
    if (!this.opts.enabled) {
      return { hit: false, keyVersion };
    }
    const row = await this.opts.repo.findByKey(key, keyVersion);
    if (!row) {
      this.opts.log.info({ key, keyVersion, hit: false }, 'cache miss');
      return { hit: false, keyVersion };
    }
    // eslint-disable-next-line no-floating-promise
    this.opts.repo.incrementHits(key, keyVersion).catch((err: unknown) => {
      this.opts.log.warn({ err, key, keyVersion }, 'cache hits++ failed');
    });
    this.opts.log.info({ key, keyVersion, hit: true, expiresAt: row.expiresAt }, 'cache hit');
    return { hit: true, keyVersion, report: row.report as Report, expiresAt: row.expiresAt };
  }

  async getOrCompute(
    key: string,
    keyVersion: string,
    commitSha: string,
    compute: () => Promise<{ report: Report }>,
  ): Promise<{ report: Report; hit: boolean; keyVersion: string; expiresAt: string | null }> {
    if (!this.opts.enabled) {
      const result = await compute();
      return { report: result.report, hit: false, keyVersion, expiresAt: null };
    }
    // Hot path: read the cache first.
    const cached = await this.lookup(key, keyVersion);
    if (cached.hit && cached.report) {
      return { report: cached.report, hit: true, keyVersion, expiresAt: cached.expiresAt ?? null };
    }
    // Cache miss. Coalesce concurrent callers onto a single compute().
    const existing = this.inflight.get(key);
    if (existing) {
      // We are a follower. Wait for the leader to finish writing the
      // row, then return a hit.
      const result = await existing.promise;
      // Wait for the leader's firstCallerPromise (which resolves once
      // upsert returns) to ensure the row is in the DB before we report hit.
      await existing.firstCallerPromise;
      return { report: result.report, hit: true, keyVersion, expiresAt: new Date(Date.now() + this.opts.ttlSeconds * 1000).toISOString() };
    }
    // We are the leader. Run compute, write the row, and signal followers.
    let firstResolve!: () => void;
    const firstCallerPromise = new Promise<void>((resolve) => {
      firstResolve = resolve;
    });
    const computePromise = (async () => {
      const computed = await compute();
      return { report: computed.report, commitSha };
    })();
    const entry: InflightEntry = { promise: computePromise, firstCaller: true, firstCallerPromise };
    this.inflight.set(key, entry);
    try {
      const result = await computePromise;
      const expiresAt = new Date(Date.now() + this.opts.ttlSeconds * 1000).toISOString();
      // Wait for the upsert to land before signalling followers so they
      // can confidently report hit=true.
      try {
        await this.opts.repo.upsert({ key, keyVersion, report: result.report, commitSha: result.commitSha, expiresAt });
        this.opts.log.info({ key, keyVersion, commitSha: result.commitSha, expiresAt }, 'cache stored');
      } catch (err) {
        this.opts.log.warn({ err, key, keyVersion }, 'cache write failed');
      } finally {
        firstResolve();
      }
      return { report: result.report, hit: false, keyVersion, expiresAt };
    } finally {
      this.inflight.delete(key);
    }
  }

  async invalidate(key: string, keyVersion: string): Promise<void> {
    await this.opts.repo.deleteByKey(key, keyVersion);
    this.opts.log.info({ key, keyVersion }, 'cache invalidated');
  }

  async prune(): Promise<number> {
    if (!this.opts.enabled) return 0;
    return this.opts.repo.pruneExpired();
  }

  async _peek(key: string, keyVersion: string): Promise<ReportCacheRow | null> {
    return this.opts.repo.findByKey(key, keyVersion);
  }
}

export const KEY_VERSION = KEY_VERSION_PREFIX;
