import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

const cookieName = 'chess_guest';
const sessionSeconds = 30 * 24 * 60 * 60;

export interface GuestSession {
  readonly id: string;
  readonly csrfToken: string;
}

export function cookieToken(header: string | undefined, name = cookieName): string | null {
  const matches = header?.split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)) ?? [];
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function currentGuest(pool: pg.Pool, request: FastifyRequest): Promise<GuestSession | null> {
  const token = cookieToken(request.headers.cookie);
  if (token === null) return null;
  const { rows } = await pool.query<{ id: string; csrf_token: string }>(
    'SELECT id, csrf_token FROM chess.guest_sessions WHERE token_hash = $1 AND expires_at > now()',
    [tokenHash(token)],
  );
  const guest = rows[0];
  return guest ? { id: guest.id, csrfToken: guest.csrf_token } : null;
}

export async function createGuest(pool: Pick<pg.Pool, 'query'>, reply: FastifyReply, secureCookies: boolean): Promise<GuestSession> {
  const token = randomBytes(32).toString('hex');
  const guest = { id: randomUUID(), csrfToken: randomBytes(32).toString('hex') };
  await pool.query(`INSERT INTO chess.guest_sessions (id, token_hash, csrf_token, expires_at)
    VALUES ($1, $2, $3, now() + interval '30 days')`, [guest.id, tokenHash(token), guest.csrfToken]);
  setSessionCookie(reply, cookieName, token, secureCookies);
  return guest;
}

export function setSessionCookie(reply: FastifyReply, name: string, token: string,
  secure: boolean, maxAge = sessionSeconds): void {
  reply.setCookie(name, token, { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge });
}

export async function rotateGuest(pool: Pick<pg.Pool, 'query'>, reply: FastifyReply,
  secure: boolean, guest: GuestSession): Promise<GuestSession> {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  await pool.query(`UPDATE chess.guest_sessions SET token_hash = $2, csrf_token = $3,
    expires_at = now() + interval '30 days' WHERE id = $1`, [guest.id, tokenHash(token), csrfToken]);
  setSessionCookie(reply, cookieName, token, secure);
  return { id: guest.id, csrfToken };
}

export function validCsrf(request: FastifyRequest, guest: GuestSession): boolean {
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(guest.csrfToken, 'hex'));
}

export async function requireGuest(pool: pg.Pool, request: FastifyRequest,
  reply: FastifyReply, csrf = false): Promise<GuestSession | null> {
  const guest = await currentGuest(pool, request);
  if (guest === null) {
    reply.code(401).send({ error: 'guest_session_required' });
    return null;
  }
  if (csrf && !validCsrf(request, guest)) {
    reply.code(403).send({ error: 'invalid_csrf_token' });
    return null;
  }
  return guest;
}
