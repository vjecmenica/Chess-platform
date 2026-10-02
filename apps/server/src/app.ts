import Fastify from 'fastify';
import type pg from 'pg';
import type { ReadinessResponse } from '@chess/contracts';
import { registerChallengeRoutes } from './challenge-routes.js';
import { registerGameRoutes } from './game-routes.js';
import { createGameService, type GameService } from './game-service.js';

export function buildApp(checkDatabase: () => Promise<void>, logger = false,
  challenges?: { pool: pg.Pool; secureCookies: boolean; gameService?: GameService }) {
  const app = Fastify({ logger, ajv: { customOptions: { removeAdditional: false } } });

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

  if (challenges) {
    const gameService = challenges.gameService ?? createGameService(challenges.pool);
    registerChallengeRoutes(app, challenges.pool, challenges.secureCookies,
      () => gameService.trustedNowMs());
    registerGameRoutes(app, challenges.pool, gameService);
  }

  return app;
}
