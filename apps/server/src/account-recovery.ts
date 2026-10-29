import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { currentAccount } from './account-session.js';
import { requireGuest, tokenHash } from './guest-session.js';
import { passwordOptions, passwordSchema, rateAllowed } from './account-security.js';
import type { AccountEmail } from './account-email.js';

const emailSchema = { type: 'string', minLength: 3, maxLength: 254,
  pattern: '^[A-Za-z0-9.!#$%&\u0027*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\\.[A-Za-z]{2,}$' } as const;
const tokenSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const accepted = { message: 'If this address is verified for an account, a password-reset link will be sent.' };

export async function revokeAccountSessions(client: pg.PoolClient, accountId: string, exceptGuestId?: string) {
  const guests = await client.query<{ id: string }>(`SELECT id FROM chess.guest_sessions
    WHERE ($2::uuid IS NULL OR id <> $2) AND (account_id = $1 OR id IN
      (SELECT guest_id FROM chess.account_sessions WHERE account_id = $1)) ORDER BY id FOR UPDATE`, [accountId, exceptGuestId ?? null]);
  for (const guest of guests.rows) await client.query(
    'UPDATE chess.guest_sessions SET token_hash = $2, csrf_token = $3 WHERE id = $1',
    [guest.id, tokenHash(randomBytes(32).toString('hex')), randomBytes(32).toString('hex')]);
  await client.query('DELETE FROM chess.account_sessions WHERE account_id = $1', [accountId]);
  await client.query("DELETE FROM chess.account_email_tokens WHERE account_id = $1 AND purpose = 'reset'", [accountId]);
}

async function issue(client: pg.PoolClient, accountId: string, purpose: 'verify' | 'reset', email: string) {
  const token = randomBytes(32).toString('hex');
  await client.query(`INSERT INTO chess.account_email_tokens (account_id, purpose, token_hash, email, expires_at)
    VALUES ($1, $2, $3, $4, clock_timestamp() + $5::interval)
    ON CONFLICT (account_id, purpose) DO UPDATE SET token_hash = EXCLUDED.token_hash,
      email = EXCLUDED.email, expires_at = EXCLUDED.expires_at`,
  [accountId, purpose, tokenHash(token), email, purpose === 'verify' ? '24 hours' : '30 minutes']);
  return token;
}

export function registerRecoveryRoutes(app: FastifyInstance, pool: pg.Pool, mail?: AccountEmail) {
  const deliveries = new Set<Promise<boolean>>();
  async function send(email: string, purpose: 'verify' | 'reset', token: string) {
    const link = `${mail!.publicOrigin}/account/${purpose === 'verify' ? 'verify-email' : 'reset-password'}#${token}`;
    try {
      await mail!.send({ to: email, subject: purpose === 'verify' ? 'Verify your Chess Platform email' : 'Reset your Chess Platform password',
        text: `${purpose === 'verify' ? 'Verify this recovery address' : 'Choose a new password'}: ${link}\n\n`
          + `This single-use link expires in ${purpose === 'verify' ? '24 hours' : '30 minutes'}. If you did not request it, ignore this email.` });
      return true;
    } catch {
      // Transport errors can contain credentials, recipients and message bodies. Never log the exception.
      app.log.error({ purpose }, 'Account email delivery failed. Check transport configuration and provider status.');
      return false;
    }
  }
  function dispatch(email: string, token: string) {
    const delivery = send(email, 'reset', token); deliveries.add(delivery);
    void delivery.finally(() => deliveries.delete(delivery));
  }
  app.addHook('onClose', async () => { await Promise.all(deliveries); });

  for (const mode of ['email', 'email/resend'] as const) {
    app.post<{ Body: { email?: string; currentPassword?: string } }>(`/account/${mode}`, {
      bodyLimit: 4096, schema: { body: { type: 'object', additionalProperties: false,
        required: mode === 'email' ? ['email', 'currentPassword'] : [],
        properties: mode === 'email' ? { email: emailSchema, currentPassword: { type: 'string', minLength: 1, maxLength: 128 } } : {} } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const guest = await requireGuest(pool, request, reply, true); if (!guest) return;
      const account = await currentAccount(pool, request, guest);
      if (!account) return reply.code(401).send({ error: 'account_required' });
      if (!mail) return reply.code(503).send({ error: 'email_not_configured' });
      const ipOk = await rateAllowed(pool, `email-ip:${request.ip}`, 20);
      const accountOk = await rateAllowed(pool, `email-account:${account.id}`, 5);
      if (!ipOk || !accountOk) return reply.code(429).header('Retry-After', '900').send({ error: 'account_rate_limited' });
      const client = await pool.connect();
      let token: string, email: string;
      try {
        await client.query('BEGIN');
        const row = (await client.query<{ password_hash: string; pending_email: string | null; verified_email: string | null }>(
          'SELECT password_hash, pending_email, verified_email FROM chess.accounts WHERE id = $1 FOR UPDATE', [account.id])).rows[0]!;
        if (!await currentAccount(client, request, guest)) return reply.code(401).send({ error: 'account_required' });
        const owner = (await client.query<{ csrf_token: string }>(
          'SELECT csrf_token FROM chess.guest_sessions WHERE id = $1 FOR UPDATE', [guest.id])).rows[0]!;
        if (owner.csrf_token !== guest.csrfToken) return reply.code(409).send({ error: 'session_changed' });
        if (mode === 'email') {
          if (!await verify(row.password_hash, request.body.currentPassword!))
            return reply.code(401).send({ error: 'incorrect_current_password' });
          email = request.body.email!.toLowerCase();
          if (email === row.verified_email) return { message: 'This email is already verified.' };
          await client.query('UPDATE chess.accounts SET pending_email = $2, verified_email = NULL WHERE id = $1', [account.id, email]);
          await client.query('DELETE FROM chess.account_email_tokens WHERE account_id = $1', [account.id]);
        } else {
          if (!row.pending_email) return reply.code(400).send({ error: 'no_pending_email' });
          email = row.pending_email;
        }
        token = await issue(client, account.id, 'verify', email);
        await client.query('COMMIT');
      } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
      const sent = await send(email!, 'verify', token!);
      if (!sent) return reply.code(503).send({ error: 'email_delivery_failed' });
      return { message: 'Verification email sent. Follow the link to enable recovery.' };
    });
  }

  app.post<{ Body: { email: string } }>('/account/password-reset/request', {
    bodyLimit: 4096, schema: { body: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: emailSchema } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await requireGuest(pool, request, reply, true)) return;
    const email = request.body.email.toLowerCase();
    const ipOk = await rateAllowed(pool, `reset-ip:${request.ip}`, 20);
    const addressOk = await rateAllowed(pool, `reset-address:${email}`, 3);
    // Same public response for unknown, pending, throttled, unconfigured and deliverable addresses.
    if (!ipOk || !addressOk || !mail) return accepted;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query<{ id: string }>(
        'SELECT id FROM chess.accounts WHERE verified_email = $1 FOR UPDATE', [email])).rows[0];
      if (!row) return accepted;
      const token = await issue(client, row.id, 'reset', email);
      await client.query('COMMIT');
      // Return without waiting on SMTP, so delivery latency cannot reveal whether an address exists.
      dispatch(email, token);
      return accepted;
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  });

  for (const purpose of ['verify', 'reset'] as const) {
    app.post<{ Body: { token: string; newPassword?: string; confirmPassword?: string } }>(
      `/account/${purpose === 'verify' ? 'email/verify' : 'password-reset/confirm'}`, {
        bodyLimit: 4096, schema: { body: { type: 'object', additionalProperties: false,
          required: purpose === 'verify' ? ['token'] : ['token', 'newPassword', 'confirmPassword'],
          properties: { token: tokenSchema, ...(purpose === 'reset' ? { newPassword: passwordSchema, confirmPassword: passwordSchema } : {}) } } },
      }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
        if (!await requireGuest(pool, request, reply, true)) return;
        if (!await rateAllowed(pool, `email-consume:${request.ip}`, 20))
          return reply.code(429).header('Retry-After', '900').send({ error: 'account_rate_limited' });
        if (purpose === 'reset' && request.body.newPassword !== request.body.confirmPassword)
          return reply.code(400).send({ error: 'password_confirmation_mismatch' });
        const digest = tokenHash(request.body.token);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const token = (await client.query<{ account_id: string }>(
            'SELECT account_id FROM chess.account_email_tokens WHERE token_hash = $1 AND purpose = $2', [digest, purpose])).rows[0];
          if (!token) return reply.code(400).send({ error: 'invalid_email_link' });
          await client.query('SELECT id FROM chess.accounts WHERE id = $1 FOR UPDATE', [token.account_id]);
          const valid = await client.query(`SELECT t.account_id FROM chess.account_email_tokens t JOIN chess.accounts a ON a.id = t.account_id
            WHERE t.token_hash = $1 AND t.purpose = $2 AND t.expires_at > clock_timestamp()
              AND t.email = CASE WHEN t.purpose = 'verify' THEN a.pending_email ELSE a.verified_email END`, [digest, purpose]);
          if (!valid.rowCount) return reply.code(400).send({ error: 'invalid_email_link' });
          if (purpose === 'verify') {
            await client.query('UPDATE chess.accounts SET verified_email = pending_email, pending_email = NULL WHERE id = $1', [token.account_id]);
          } else {
            await client.query('UPDATE chess.accounts SET password_hash = $2 WHERE id = $1',
              [token.account_id, await hash(request.body.newPassword!, passwordOptions)]);
            await revokeAccountSessions(client, token.account_id);
            // A password reset also invalidates an outstanding change-address verification.
            await client.query('UPDATE chess.accounts SET pending_email = NULL WHERE id = $1', [token.account_id]);
          }
          await client.query("DELETE FROM chess.account_email_tokens WHERE account_id = $1 AND ($2 = 'reset' OR purpose = $2)", [token.account_id, purpose]);
          await client.query('COMMIT');
          return { message: purpose === 'verify'
            ? (mail ? 'Email verified. Password recovery is now available.' : 'Email verified. Recovery is unavailable until email delivery is restored.')
            : 'Password reset. Log in with your new password.' };
        } catch (cause) {
          if ((cause as { code?: string }).code === '23505') return reply.code(409).send({ error: 'email_unavailable' });
          throw cause;
        } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
      });
  }
}
