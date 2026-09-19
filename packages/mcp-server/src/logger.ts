import { pino } from 'pino';

export function createLogger(opts: { level?: string; name?: string } = {}) {
  return pino({
    level: opts.level ?? 'info',
    name: opts.name ?? 'repopilot-mcp',
    redact: {
      paths: ['*.token', '*.apiKey', '*.secret', '*.privateKey', '*.mnemonic'],
      remove: false,
      censor: '[REDACTED]',
    },
  });
}
