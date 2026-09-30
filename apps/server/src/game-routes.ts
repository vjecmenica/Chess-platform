import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireGuest } from './guest-session.js';
import { createGameService, type Arrival, type GameService, type MoveBody, type WallClock } from './game-service.js';

const uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const square = '^[a-h][1-8]$';
const idParams = { type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: uuid } } } as const;
const requestHeaders = { type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', pattern: uuid } } } as const;
const moveBody = { type: 'object', required: ['expectedVersion', 'from', 'to'], additionalProperties: false,
  properties: { expectedVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
    from: { type: 'string', pattern: square }, to: { type: 'string', pattern: square },
    promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] } } } as const;

export { createGameService };
export type { GameService, WallClock };

export function registerGameRoutes(app: FastifyInstance, pool: pg.Pool,
  service: GameService = createGameService(pool)): void {
  const arrivals = new WeakMap<FastifyRequest, Arrival>();
  app.addHook('onReady', () => service.start());
  app.addHook('onClose', () => service.stop());
  app.get<{ Params: { id: string } }>('/games/:id', { schema: { params: idParams } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply);
      if (guest === null) return;
      const result = await service.read(request.params.id, guest.id);
      return reply.code(result.status).send(result.body);
    });

  app.post<{ Params: { id: string } }>('/games/:id/ready',
    { schema: { params: idParams },
      preValidation: (request, _reply, done) => {
        arrivals.set(request, service.beginReceipt());
        done();
      },
      onResponse: async request => {
        const arrival = arrivals.get(request);
        if (arrival) await arrival.release();
        arrivals.delete(request);
      } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (guest === null) return;
      if (request.body !== undefined) return reply.code(400).send({ error: 'unexpected_body' });
      const result = await service.ready(request.params.id, guest.id);
      return reply.code(result.status).send(result.body);
    });

  app.post<{ Params: { id: string }; Body: MoveBody }>('/games/:id/moves',
    { schema: { params: idParams, headers: requestHeaders, body: moveBody },
      // The complete body has arrived, but guest lookup has not started.
      preValidation: (request, _reply, done) => {
        arrivals.set(request, service.beginReceipt());
        done();
      },
      onResponse: async request => {
        const arrival = arrivals.get(request);
        if (arrival) await arrival.release();
        arrivals.delete(request);
      } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (guest === null) return;
      const requestId = request.headers['idempotency-key'];
      if (typeof requestId !== 'string') return reply.code(400).send({ error: 'invalid_idempotency_key' });
      const arrival = arrivals.get(request);
      if (!arrival) throw new Error('Move arrival was not recorded.');
      const result = await service.move(request.params.id, guest.id, requestId, request.body, arrival);
      return reply.code(result.status).send(result.body);
    });
}
