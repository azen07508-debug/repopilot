#!/usr/bin/env node
/**
 * scripts/check-env.ts — verify the environment before starting the API.
 *
 * Exit codes:
 *   0 — all required variables are set
 *   1 — at least one required variable is missing or invalid
 */
import { loadConfig } from '../apps/api/src/config.js';

const cfg = loadConfig();
const issues: string[] = [];

if (!cfg.GITHUB_TOKEN) {
  issues.push('GITHUB_TOKEN is empty (rate limit will be 60 req/h; set this for production).');
}
if (cfg.PAYMENT_MODE === 'okx') {
  if (!cfg.OKX_PAYMENT_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(cfg.OKX_PAYMENT_ADDRESS)) {
    issues.push('PAYMENT_MODE=okx but OKX_PAYMENT_ADDRESS is missing or invalid.');
  }
  if (!cfg.OKX_PAYMENT_NETWORK) {
    issues.push('OKX_PAYMENT_NETWORK is required when PAYMENT_MODE=okx.');
  }
}
if (!cfg.ALLOWED_REPO_HOSTS.length) {
  issues.push('ALLOWED_REPO_HOSTS is empty; SSRF defense would block all requests.');
}
if (!/^\d+(\.\d+)?$/.test(cfg.PRICE_QUICK_SCAN) || !/^\d+(\.\d+)?$/.test(cfg.PRICE_FULL_AUDIT)) {
  issues.push('PRICE_QUICK_SCAN / PRICE_FULL_AUDIT must be decimal strings.');
}

if (issues.length === 0) {
  // eslint-disable-next-line no-console
  console.log('OK — environment looks good.');
  process.exit(0);
} else {
  // eslint-disable-next-line no-console
  console.error('Environment issues:');
  for (const i of issues) console.error(' - ' + i);
  process.exit(1);
}
