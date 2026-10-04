#!/usr/bin/env node
/**
 * CLI entrypoint: `repopilot-mcp`. Reads environment, starts the stdio server.
 *
 * The shebang is load-bearing. `package.json` declares this file as the
 * `repopilot-mcp` bin, and npm builds that shim by copying the file verbatim
 * when it carries no shebang — so without this line the copy is handed to the
 * shell, which reads `import` as a command and the first path inside the
 * comment below as another one. `tsc` preserves a shebang on line 1.
 */
import { startStdioServer } from './index.js';
import { DEFAULT_PRICING, CORE_VERSION } from '@repopilot/core';
import type { PaymentConfig } from '@repopilot/okx-adapter';

const mode = (process.env['PAYMENT_MODE'] === 'okx' ? 'okx' : 'mock') as 'mock' | 'okx';

const payment: PaymentConfig = {
  mode,
  okx: {
    recipientAddress: process.env['OKX_PAYMENT_ADDRESS'] ?? '',
    network: process.env['OKX_PAYMENT_NETWORK'] ?? 'xlayer',
    x402Version: (Number(process.env['OKX_X402_VERSION']) === 1 ? 1 : 2) as 1 | 2,
  },
  pricing: {
    quickScan: {
      amount: process.env['PRICE_QUICK_SCAN'] ?? DEFAULT_PRICING.quickScan.amount,
      currency: 'USDT',
    },
    fullAudit: {
      amount: process.env['PRICE_FULL_AUDIT'] ?? DEFAULT_PRICING.fullAudit.amount,
      currency: 'USDT',
    },
  },
};

const allowedHosts = (process.env['ALLOWED_REPO_HOSTS'] ?? 'github.com,raw.githubusercontent.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

startStdioServer({
  payment,
  githubToken: process.env['GITHUB_TOKEN'] || undefined,
  allowedHosts,
  // eslint-disable-next-line repopilot/no-floating-promise
}).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('repopilot-mcp failed to start:', err);
  process.exit(1);
});

// Touch the version to make TypeScript happy when nothing else uses it.
void CORE_VERSION;
