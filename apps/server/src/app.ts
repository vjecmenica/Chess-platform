import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type pg from 'pg';
import type { ReadinessResponse } from '@chess/contracts';
import { registerChallengeRoutes } from './challenge-routes.js';
import { registerGameRoutes } from './game-routes.js';
import { createGameService, type GameService } from './game-service.js';
import { registerExplorerRoutes } from './explorer-routes.js';
import { registerGameChatRoutes } from './game-chat.js';
import type { AccountEmail } from './account-email.js';
import { registerRecoveryRoutes } from './account-recovery.js';
import { registerAccountRoutes } from './account-routes.js';

export function buildApp(checkDatabase: () => Promise<void>, logger = false,
  challenges?: { pool: pg.Pool; secureCookies: boolean; gameService?: GameService; accountEmail?: AccountEmail | undefined }) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization',
    'req.headers["x-csrf-token"]', 'req.body', 'req.url', 'res.headers["set-cookie"]'] } : false,
    ajv: { customOptions: { removeAdditional: false } } });
  app.register(fastifyCookie);

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
    registerAccountRoutes(app, challenges.pool, challenges.secureCookies, !!challenges.accountEmail);
    registerRecoveryRoutes(app, challenges.pool, challenges.accountEmail);
    registerExplorerRoutes(app, challenges.pool);
    const gameService = challenges.gameService ?? createGameService(challenges.pool);
    registerChallengeRoutes(app, challenges.pool, challenges.secureCookies,
      () => gameService.trustedNowMs());
    registerGameRoutes(app, challenges.pool, gameService);
    registerGameChatRoutes(app, challenges.pool);
  }

  return app;
}
