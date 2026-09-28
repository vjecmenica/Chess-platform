import Fastify from 'fastify';
import type { ReadinessResponse } from '@chess/contracts';

export function buildApp(checkDatabase: () => Promise<void>, logger = false) {
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

  return app;
}
