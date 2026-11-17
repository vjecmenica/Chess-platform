import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { avatarUploadMaxBytes, type AccountAvatarResponse } from '@chess/contracts';
import { avatarUrl, currentAccount } from './account-session.js';
import { rateAllowed } from './account-security.js';
import { requireGuest, type GuestSession } from './guest-session.js';
import type { AvatarStorage } from './avatar-storage.js';
import { normalizeAvatar } from './avatar-image.js';

export function registerAccountAvatars(app: FastifyInstance, pool: pg.Pool, storage: AvatarStorage) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  const owners = new WeakMap<FastifyRequest, { id: string; guest: GuestSession }>();
  let decoding = 0;

  app.route({
    method: ['PUT', 'DELETE'], url: '/account/avatar', bodyLimit: avatarUploadMaxBytes,
    async onRequest(request, reply) {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true);
      if (!guest) return;
      const account = await currentAccount(pool, request, guest);
      if (!account) return reply.code(401).send({ error: 'account_required' });
      if (request.headers['x-avatar-owner'] !== account.id)
        return reply.code(409).send({ error: 'avatar_owner_changed' });
      if (request.method === 'PUT' && request.headers['content-type'] !== 'application/octet-stream')
        return reply.code(415).send({ error: 'invalid_avatar' });
      if (!await rateAllowed(pool, `avatar:${account.id}`, 10) || !await rateAllowed(pool, `avatar-ip:${request.ip}`, 40))
        return reply.header('Retry-After', '900').code(429).send({ error: 'avatar_rate_limited' });
      owners.set(request, { id: account.id, guest });
    },
    async handler(request, reply) {
      const owner = owners.get(request)!;
      let key: string | null = null;
      if (request.method === 'PUT') {
        if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'invalid_avatar' });
        if (decoding >= 2) return reply.header('Retry-After', '5').code(503).send({ error: 'avatar_busy' });
        decoding++;
        let image: Buffer | null;
        try { image = await normalizeAvatar(request.body); }
        finally { decoding--; }
        if (!image) return reply.code(400).send({ error: 'invalid_avatar' });
        key = randomUUID();
        // Also recover abandoned objects if the process dies after writing the image.
        await pool.query("INSERT INTO chess.avatar_cleanup (object_key, staged, delete_after) VALUES ($1, true, now() + interval '1 hour')", [key]);
        try { await storage.put(key, image); }
        catch {
          request.log.warn('Could not write an avatar object.');
          return reply.code(503).send({ error: 'avatar_storage_unavailable' });
        }
      } else if (request.body !== undefined) {
        return reply.code(400).send({ error: 'unexpected_body' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const previous = (await client.query<{ avatar_key: string | null }>(
          'SELECT avatar_key FROM chess.accounts WHERE id = $1 FOR UPDATE', [owner.id])).rows[0];
        const guest = (await client.query<{ csrf_token: string }>(
          'SELECT csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [owner.guest.id])).rows[0];
        if (!previous || guest?.csrf_token !== owner.guest.csrfToken
          || (await currentAccount(client, request, owner.guest))?.id !== owner.id)
          return reply.code(409).send({ error: 'avatar_owner_changed' });
        if (key !== null) {
          const staged = await client.query('DELETE FROM chess.avatar_cleanup WHERE object_key = $1 AND staged AND delete_after > now()', [key]);
          if (staged.rowCount !== 1) return reply.code(503).send({ error: 'avatar_storage_unavailable' });
        }
        if (key !== previous.avatar_key) {
          await client.query('UPDATE chess.accounts SET avatar_key = $2 WHERE id = $1', [owner.id, key]);
          if (previous.avatar_key)
            await client.query('INSERT INTO chess.avatar_cleanup (object_key) VALUES ($1)', [previous.avatar_key]);
          await client.query(`SELECT pg_notify('chess_game_updates', json_build_object('id', g.id, 'version', g.version)::text)
            FROM chess.games g JOIN chess.challenges c ON c.id = g.id
            WHERE g.status IN ('active', 'waiting') AND EXISTS (
              SELECT 1 FROM chess.guest_sessions s WHERE s.account_id = $1 AND s.id IN (c.creator_guest_id, c.acceptor_guest_id)
            )`, [owner.id]);
        }
        await client.query('COMMIT');
        return { accountId: owner.id, avatarUrl: avatarUrl(key) } satisfies AccountAvatarResponse;
      } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
    },
  });

  app.get<{ Params: { file: string } }>('/avatars/:file', async (request, reply) => {
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/.exec(request.params.file);
    reply.header('Cache-Control', 'no-store');
    if (!match) return reply.code(404).send();
    try {
      const image = await storage.read(match[1]!);
      if (!image) return reply.code(404).send();
      return reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=3600, immutable')
        .type('image/webp').send(image);
    } catch {
      request.log.warn('Could not read an avatar object.');
      return reply.code(503).send();
    }
  });
}

/** Keep a bounded batch locked until deletion is confirmed. Deletes are idempotent on both stores. */
export async function cleanAvatarObjects(pool: pg.Pool, storage: AvatarStorage): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ object_key: string }>(`SELECT object_key FROM chess.avatar_cleanup
      WHERE delete_after <= now() ORDER BY delete_after LIMIT 8 FOR UPDATE SKIP LOCKED`);
    const results = await Promise.allSettled(rows.map(row => storage.remove(row.object_key)));
    for (const [index, { object_key }] of rows.entries()) {
      if (results[index]?.status === 'fulfilled')
        await client.query('DELETE FROM chess.avatar_cleanup WHERE object_key = $1', [object_key]);
      else await client.query("UPDATE chess.avatar_cleanup SET staged = false, delete_after = now() + interval '5 minutes' WHERE object_key = $1", [object_key]);
    }
    await client.query('COMMIT');
  } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
}
