import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import { explorerBookMaxPlies, type ExplorerBookCandidate } from '@chess/contracts';
import { createPositionFromFen, normalizedPositionKey } from '@chess/domain';
import { registerExplorerGameRoutes } from './explorer-game-routes.js';
import { requireGuest } from './guest-session.js';

export function registerExplorerRoutes(app: FastifyInstance, pool: pg.Pool) {
  // Bounded process-local abuse guard; deploy a shared edge limit before public scale.
  const requests = new Map<string, { start: number; count: number }>();
  async function authorize(request: FastifyRequest, reply: FastifyReply, csrf = false) {
    const guest = await requireGuest(pool, request, reply, csrf);
    if (!guest) return false;
    const now = Date.now(), old = requests.get(guest.id);
    const window = old && now - old.start < 60_000 ? old : { start: now, count: 0 };
    window.count += 1; requests.set(guest.id, window);
    if (requests.size > 10_000) requests.delete(requests.keys().next().value!);
    if (window.count > 120) { reply.header('Retry-After', '60').code(429).send({ error: 'rate_limited' }); return false; }
    return true;
  }
  registerExplorerGameRoutes(app, pool, authorize);
  app.post<{ Body: { moves: ExplorerBookCandidate[] } }>('/opening-explorer/book-counts', {
    bodyLimit: 8192,
    schema: { body: {
      type: 'object', required: ['moves'], additionalProperties: false,
      properties: { moves: { type: 'array', minItems: 1, maxItems: explorerBookMaxPlies, items: {
        type: 'object', required: ['fen', 'uci'], additionalProperties: false,
        properties: { fen: { type: 'string', minLength: 10, maxLength: 120 },
          uci: { type: 'string', pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' } },
      } } },
    } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await authorize(request, reply, true)) return;
    let positions: string[];
    try { positions = request.body.moves.map(move => normalizedPositionKey(move.fen)); }
    catch { return reply.code(400).send({ error: 'invalid_position' }); }
    return explorerRead(app, pool, reply, async client => {
      const { rows } = await client.query<{ position_games: string; move_games: string }>(
        `SELECT counts.position_games, counts.move_games
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS candidate(position, uci, ply)
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(white + draws + black), 0) AS position_games,
                  COALESCE(SUM(white + draws + black) FILTER (WHERE moves.uci = candidate.uci), 0) AS move_games
           FROM chess.explorer_moves AS moves WHERE moves.position = candidate.position
         ) AS counts ORDER BY candidate.ply`, [positions, request.body.moves.map(move => move.uci)]);
      return { counts: rows.map(row => ({
        positionGames: Number(row.position_games), moveGames: Number(row.move_games),
      })) };
    });
  });
  app.get<{ Querystring: { fen: string } }>('/opening-explorer', { schema: { querystring: {
    type: 'object', required: ['fen'], additionalProperties: false,
    properties: { fen: { type: 'string', minLength: 10, maxLength: 120 } },
  } } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, max-age=60');
    if (!await authorize(request, reply)) return;
    let key: string;
    try { key = normalizedPositionKey(request.query.fen); }
    catch { return reply.code(400).send({ error: 'invalid_position' }); }
    return explorerRead(app, pool, reply, async client => {
      const { rows } = await client.query<{ uci: string; white: string; draws: string; black: string }>(
        `SELECT uci, white, draws, black FROM chess.explorer_moves WHERE position = $1
         ORDER BY white + draws + black DESC, uci LIMIT 218`, [key]);
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
    });
  });
}

async function explorerRead<T>(app: FastifyInstance, pool: pg.Pool, reply: FastifyReply,
  read: (client: pg.PoolClient) => Promise<T>) {
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '1500ms'");
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    app.log.error({ code: typeof error === 'object' && error !== null && 'code' in error ? error.code : 'explorer_query' },
      'Opening explorer query failed.');
    return reply.code(503).send({ error: 'explorer_unavailable' });
  } finally { client?.release(); }
}
