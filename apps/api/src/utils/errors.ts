/**
 * Tiny error helpers. We surface a `code` and a `message` and *never* leak
 * stack traces, environment variables, or secrets to the client.
 */
import type { FastifyReply } from 'fastify';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(opts: { statusCode: number; code: string; message: string; details?: unknown }) {
    super(opts.message);
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof HttpError) {
    reply
      .status(err.statusCode)
      .send({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const e = err as { statusCode?: number; code?: string; message?: string };
  reply
    .status(e.statusCode ?? 500)
    .send({ error: { code: e.code ?? 'INTERNAL', message: e.message ?? 'Internal error' } });
}
