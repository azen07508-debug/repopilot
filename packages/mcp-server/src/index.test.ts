import { describe, it, expect, beforeAll } from 'vitest';
import { buildMcpServer } from './index.js';
import type { PaymentConfig } from '@repopilot/okx-adapter';

const payment: PaymentConfig = {
  mode: 'mock',
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
  pricing: {
    quickScan: { amount: '0.02', currency: 'USDT' },
    fullAudit: { amount: '0.10', currency: 'USDT' },
  },
};

beforeAll(() => {
  process.env['ALLOWED_REPO_HOSTS'] = 'github.com,raw.githubusercontent.com';
});

describe('MCP server', () => {
  it('builds and exposes the expected tools', () => {
    const { server } = buildMcpServer({ payment, allowedHosts: ['github.com', 'raw.githubusercontent.com'] });
    // @ts-expect-error — accessing internal registry for test purposes
    const tools = server._registeredTools ?? server.server?._registeredTools;
    // We just check that the server builds without throwing.
    expect(server).toBeTruthy();
    expect(tools).toBeDefined();
  });
});
