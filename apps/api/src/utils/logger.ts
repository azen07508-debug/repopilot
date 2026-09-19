/**
 * Logger factory — single pino instance shared by the API.
 */
import { pino } from 'pino';

export function createLogger(opts: { level?: string; name?: string } = {}) {
  return pino({
    level: opts.level ?? process.env['LOG_LEVEL'] ?? 'info',
    name: opts.name ?? 'repopilot-api',
    redact: {
      paths: [
        '*.password',
        '*.token',
        '*.apiKey',
        '*.secret',
        '*.privateKey',
        '*.mnemonic',
        'req.headers.authorization',
        'req.headers["x-payment"]',
        'req.headers["x-payment-signature"]',
        'req.headers["x-api-key"]',
        '*.xPayment',
      ],
      remove: false,
      censor: '[REDACTED]',
    },
  });
}

export type AppLogger = ReturnType<typeof createLogger>;

/** Default shared logger for one-off scripts (migrate, seed, env-check). */
export const logger = createLogger({ name: 'repopilot-api-script' });
