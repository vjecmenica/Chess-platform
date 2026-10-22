import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createPositionFromFen, normalizedPositionKey } from '@chess/domain';
import { requireGuest } from './guest-session.js';

export function registerExplorerRoutes(app: FastifyInstance, pool: pg.Pool) {
  // Bounded process-local abuse guard; deploy a shared edge limit before public scale.
  const requests = new Map<string, { start: number; count: number }>();
  app.get<{ Querystring: { fen: string } }>('/opening-explorer', { schema: { querystring: {
    type: 'object', required: ['fen'], additionalProperties: false,
    properties: { fen: { type: 'string', minLength: 10, maxLength: 120 } },
  } } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, max-age=60');
    const guest = await requireGuest(pool, request, reply);
    if (!guest) return;
    const now = Date.now(), old = requests.get(guest.id);
    const window = old && now - old.start < 60_000 ? old : { start: now, count: 0 };
    window.count += 1; requests.set(guest.id, window);
    if (requests.size > 10_000) requests.delete(requests.keys().next().value!);
    if (window.count > 120) return reply.header('Retry-After', '60').code(429).send({ error: 'rate_limited' });
    let key: string;
    try { key = normalizedPositionKey(request.query.fen); }
    catch { return reply.code(400).send({ error: 'invalid_position' }); }
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '1500ms'");
      const { rows } = await client.query<{ uci: string; white: string; draws: string; black: string }>(
        `SELECT uci, white, draws, black FROM chess.explorer_moves WHERE position = $1
         ORDER BY white + draws + black DESC, uci LIMIT 218`, [key]);
      await client.query('COMMIT');
      const moves = rows.map(row => {
        const position = createPositionFromFen(request.query.fen);
        const move = position.submitMove({ side: position.getPosition().sideToMove,
          from: row.uci.slice(0, 2), to: row.uci.slice(2, 4),
          ...(row.uci.length === 5 ? { promotion: row.uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) });
        if (!move.accepted) throw new Error('Invalid explorer candidate.');
        return { uci: row.uci, san: move.move.san, white: Number(row.white),
          draws: Number(row.draws), black: Number(row.black) };
      });
      return { opening: null, moves };
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      app.log.error({ code: typeof error === 'object' && error !== null && 'code' in error ? error.code : 'explorer_query' },
        'Opening explorer query failed.');
      return reply.code(503).send({ error: 'explorer_unavailable' });
    } finally { client?.release(); }
  });
}
