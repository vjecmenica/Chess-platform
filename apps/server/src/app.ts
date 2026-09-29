import Fastify from 'fastify';
import type pg from 'pg';
import type { ReadinessResponse } from '@chess/contracts';
import { registerChallengeRoutes } from './challenge-routes.js';

export function buildApp(checkDatabase: () => Promise<void>, logger = false,
  challenges?: { pool: pg.Pool; secureCookies: boolean }) {
  const app = Fastify({ logger });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get<{ Reply: ReadinessResponse }>('/health/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await checkDatabase();
      return { status: 'ok', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  if (challenges) registerChallengeRoutes(app, challenges.pool, challenges.secureCookies);

  return app;
}
