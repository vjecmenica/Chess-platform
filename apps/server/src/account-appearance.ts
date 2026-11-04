import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { appearanceSchema, restoreAppearance, type BoardAppearance } from '@chess/contracts';
import { requireGuest } from './guest-session.js';
import { currentAccount } from './account-session.js';
export function registerAppearance(app: FastifyInstance, pool: pg.Pool) {
    for (const method of ['GET', 'PUT'] as const)
        app.route<{
            Body: BoardAppearance;
        }>({ method, url: '/account/appearance', schema: method === 'PUT' ? { body: appearanceSchema } : {}, handler: async (req, reply) => {
                reply.header('Cache-Control', 'no-store');
                const guest = await requireGuest(pool, req, reply, method === 'PUT');
                if (!guest)
                    return;
                const account = await currentAccount(pool, req, guest);
                if (method === 'GET') {
                    const row = account ? (await pool.query('SELECT board_appearance FROM chess.accounts WHERE id=$1', [account.id])).rows[0] : null;
                    return { owner: account?.id ?? null, appearance: restoreAppearance(row?.board_appearance) };
                }
                if (!account)
                    return reply.code(401).send({ error: 'account_required' });
                if (req.headers['x-appearance-owner'] !== account.id)
                    return reply.code(409).send({ error: 'appearance_owner_changed' });
                await pool.query('UPDATE chess.accounts SET board_appearance=$2::jsonb WHERE id=$1', [account.id, JSON.stringify(req.body)]);
                return { owner: account.id, appearance: req.body };
            } });
}
