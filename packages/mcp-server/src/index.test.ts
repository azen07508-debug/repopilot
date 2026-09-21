import { describe, it, expect, beforeAll } from 'vitest';
import type { PaymentConfig } from '@repopilot/okx-adapter';
import { buildMcpServer } from './index.js';

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

/** Tool names as registered on the SDK's internal registry. */
function toolNames(): string[] {
  const { server } = buildMcpServer({
    payment,
    allowedHosts: ['github.com', 'raw.githubusercontent.com'],
  });
  const registry =
    (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ??
    (server as unknown as { server?: { _registeredTools?: Record<string, unknown> } }).server
      ?._registeredTools;
  return Object.keys(registry ?? {});
}

describe('MCP server', () => {
  it('builds and registers tools', () => {
    const { server } = buildMcpServer({
      payment,
      allowedHosts: ['github.com', 'raw.githubusercontent.com'],
    });
    expect(server).toBeTruthy();
    expect(toolNames().length).toBeGreaterThan(0);
  });

  it('exposes the quality gate', () => {
    const names = toolNames();
    expect(names).toContain('quality_status');
    expect(names).toContain('release_check');
  });

  it('registers every tool the billing map advertises', () => {
    // An agent decides what it can afford from get_repopilot_capabilities,
    // so the advertised list and the registered list must not drift.
    const names = toolNames();
    const advertised = [
      'audit_github_repository',
      'reaudit_repository',
      'get_fix_plan',
      'quality_status',
      'release_check',
      'compare_audits',
      'list_audit_history',
      'get_audit_status',
      'get_repopilot_capabilities',
    ];
    for (const tool of advertised) {
      expect(names, `missing tool: ${tool}`).toContain(tool);
    }
  });

  it('registers nothing that is not advertised', () => {
    const advertised = new Set([
      'audit_github_repository',
      'reaudit_repository',
      'get_fix_plan',
      'quality_status',
      'release_check',
      'compare_audits',
      'list_audit_history',
      'get_audit_status',
      'get_repopilot_capabilities',
    ]);
    for (const name of toolNames()) {
      expect(advertised, `undocumented tool: ${name}`).toContain(name);
    }
  });
});
