/**
 * Logger. Wraps pino with a child-locator convention so all RepoPilot
 * components share a single JSON-ish log stream.
 */
import { pino, type Logger } from 'pino';

export function createLogger(opts: { level?: string; name?: string } = {}): Logger {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    name: opts.name ?? 'repopilot',
    redact: {
      paths: [
        '*.password',
        '*.token',
        '*.apiKey',
        '*.api_key',
        '*.secret',
        '*.privateKey',
        '*.private_key',
        '*.mnemonic',
        'req.headers.authorization',
        'req.headers["x-payment"]',
        'req.headers["x-payment-signature"]',
        'req.headers["x-api-key"]',
        '*.xPayment',
        '*.X-PAYMENT',
        '*.PAYMENT-SIGNATURE',
      ],
      remove: false,
      censor: '[REDACTED]',
    },
  });
}
