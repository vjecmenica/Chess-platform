import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { normalizedPositionKey, parsePgn } from '@chess/domain';
import { explorerMainLine } from './explorer-pgn.js';

// A restricted sample, not an exhaustive corpus browsing/export interface.
const pageSize = 10, sampleSize = 50;
const fenSchema = { type: 'string', minLength: 10, maxLength: 120 };
export function registerExplorerGameRoutes(app: FastifyInstance, pool: pg.Pool,
  authorize: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>) {
  app.get<{ Querystring: { fen: string; page?: number } }>('/opening-explorer/games', {
    schema: { querystring: { type: 'object', required: ['fen'], additionalProperties: false,
      properties: { fen: fenSchema, page: { type: 'integer', minimum: 0, maximum: 4 } } } },
  }, async (request, reply) => {
    if (!await authorize(request, reply)) return;
    let position: string;
    try { position = normalizedPositionKey(request.query.fen); }
    catch { return reply.code(400).send({ error: 'invalid_position' }); }
    const page = request.query.page ?? 0;
    return query(reply, async client => {
      const rows = (await client.query(`SELECT g.id::text, g.white_name, g.black_name, g.white_rating, g.black_rating,
        g.white_fide_id, g.black_fide_id, g.result, g.game_date, g.event, g.site, g.round, g.eco, g.opening,
        g.time_control, p.ply, p.uci FROM chess.explorer_game_positions p
        JOIN chess.explorer_records g ON g.id=p.game_id WHERE p.position=$1
        ORDER BY p.game_id LIMIT $2`, [position, sampleSize])).rows;
      const totalPages = Math.ceil(rows.length / pageSize);
      return { games: rows.slice(page * pageSize, (page + 1) * pageSize), page,
        totalPages, hasMore: page + 1 < totalPages };
    });
  });
  app.get<{ Params: { id: string }; Querystring: { fen: string } }>('/opening-explorer/games/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' } } },
      querystring: { type: 'object', required: ['fen'], additionalProperties: false, properties: { fen: fenSchema } } },
  }, async (request, reply) => {
    if (!await authorize(request, reply)) return;
    let position: string;
    try { position = normalizedPositionKey(request.query.fen); }
    catch { return reply.code(400).send({ error: 'invalid_position' }); }
    return query(reply, async client => {
      const row = (await client.query<{ original_pgn: string; ply: number }>(`SELECT g.original_pgn, p.ply
        FROM (SELECT game_id, ply FROM chess.explorer_game_positions WHERE position=$1 ORDER BY game_id LIMIT $3) p
        JOIN chess.explorer_records g ON g.id=p.game_id WHERE g.id=$2`, [position, request.params.id, sampleSize])).rows[0];
      if (!row) return reply.code(404).send({ error: 'explorer_game_not_found' });
      const parsed = parsePgn(explorerMainLine(row.original_pgn));
      // Return the legal main line for replay, never the private original text/comments.
      return { game: parsed, ply: row.ply };
    });
  });
  async function query(reply: FastifyReply, read: (client: pg.PoolClient) => Promise<unknown>) {
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect(); await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '1500ms'");
      const result = await read(client); await client.query('COMMIT');
      reply.header('Cache-Control', 'private, no-store'); return result;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      app.log.error({ code: typeof error === 'object' && error !== null && 'code' in error ? error.code : 'explorer_replay' },
        'Opening explorer game query failed.');
      return reply.code(503).send({ error: 'explorer_unavailable' });
    } finally { client?.release(); }
  }
}
