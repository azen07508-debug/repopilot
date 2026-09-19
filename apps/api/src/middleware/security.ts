/**
 * Security middleware: helmet, CORS, request size, body limit.
 */
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export async function registerSecurity(app: FastifyInstance, opts: { corsOrigins: string[] }) {
  await app.register(helmet, {
    contentSecurityPolicy: false, // admin UI is served from the same origin in dev
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin / no-origin (server-to-server, curl, MCP, etc.)
      if (!origin) {
        cb(null, true);
        return;
      }
      if (opts.corsOrigins.includes('*') || opts.corsOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: false,
    maxAge: 600,
  });
  // Hard body limit.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const max = 64 * 1024; // 64 KB
    if (typeof body === 'string' && body.length > max) {
      done(new Error('Payload too large'), undefined);
      return;
    }
    try {
      const json = body === '' ? {} : JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });
}
