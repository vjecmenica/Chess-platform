import { randomInt, randomUUID } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import type { AccountMail } from '../src/account-email.js';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { seedHistoricalGuestLink } from './legacy-account-fixture.js';
import { tokenHash } from '../src/guest-session.js';

const password = 'Original synthetic long passphrase';
const newPassword = 'Replacement synthetic long passphrase';
interface Browser { cookie: string; csrf: string; ip: string }
describe('verified recovery email against PostgreSQL', () => {
  let pool: pg.Pool;
  const apps: FastifyInstance[] = [];
  const subnet = `127.${randomInt(1,255)}.${randomInt(1,255)}`;
  let number = 0;
  beforeAll(async () => { loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL')); await migrate(pool); });
  afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
  afterAll(async () => { await pool?.end(); });
  function server(fail = false) {
    const emails: AccountMail[] = [];
    const app = buildApp(async () => {}, false, { pool, secureCookies: false, accountEmail: {
      publicOrigin: 'https://chess.example', send: async email => { if (fail) throw new Error('secret transport details'); emails.push(email); },
    } }); apps.push(app); return { app, emails };
  }
  async function browser(app: FastifyInstance) {
    const r = await app.inject('/guest-session');
    return { cookie: r.cookies.map(c => `${c.name}=${c.value}`).join('; '), csrf: r.json().csrfToken, ip: `${subnet}.${++number}` };
  }
  async function post(app: FastifyInstance, who: Browser, url: string, payload?: object) {
    const body = payload ?? (url.endsWith('/email/resend') ? {} : undefined);
    const r = await app.inject({ method: 'POST', url, ...(body ? { payload: body } : {}), remoteAddress: who.ip,
      headers: { cookie: who.cookie, 'x-csrf-token': who.csrf, 'idempotency-key': randomUUID(), host: 'attacker.invalid' } });
    const jar = new Map(who.cookie.split('; ').map(c => c.split('=') as [string,string]));
    for (const c of r.cookies) c.value ? jar.set(c.name,c.value) : jar.delete(c.name);
    who.cookie = [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
    if (r.statusCode === 200 && r.json().csrfToken) who.csrf = r.json().csrfToken;
    return r;
  }
  const read = (app: FastifyInstance, who: Browser, url = '/account') => app.inject({ url, headers: { cookie: who.cookie } });
  async function setup() {
    const { app, emails } = server(), owner = await browser(app), stranger = await browser(app);
    const username = `r_${randomUUID().replaceAll('-','').slice(0,20)}`, email = `${username}@example.test`;
    const registered = await post(app, owner, '/account/register', { username, password });
    expect(registered.statusCode).toBe(200);
    return { app, emails, owner, stranger, username, email, id: registered.json().account.id as string };
  }
  function token(mail: AccountMail) { return /#([a-f0-9]{64})/.exec(mail.text)![1]!; }
  async function enable(s: Awaited<ReturnType<typeof setup>>) {
    expect((await post(s.app, s.owner, '/account/email', { email: s.email, currentPassword: password })).statusCode).toBe(200);
    const t = token(s.emails.at(-1)!);
    expect((await post(s.app, s.stranger, '/account/email/verify', { token: t })).statusCode).toBe(200);
  }

  it('keeps optional emails pending until proof, stores only digests, ignores Host, and rejects reused links', async () => {
    const s = await setup();
    expect((await read(s.app,s.owner)).json().email).toEqual({ verified: null, pending: null, deliveryEnabled: true });
    expect((await post(s.app,s.stranger,'/account/email',{ email:s.email,currentPassword:password })).statusCode).toBe(401);
    expect((await post(s.app,s.owner,'/account/email',{ email:s.email,currentPassword:'incorrect' })).statusCode).toBe(401);
    expect((await post(s.app,s.owner,'/account/email',{ email:s.email.toUpperCase(),currentPassword:password })).statusCode).toBe(200);
    const message = s.emails[0]!, t = token(message);
    expect(message.to).toBe(s.email); expect(message.text).toContain('https://chess.example/account/verify-email#');
    expect(message.text).not.toContain('attacker.invalid');
    const saved = (await pool.query('SELECT * FROM chess.account_email_tokens WHERE account_id=$1',[s.id])).rows[0];
    expect(saved.token_hash).toEqual(tokenHash(t)); expect(JSON.stringify(saved)).not.toContain(t);
    const unknown = await post(s.app,s.stranger,'/account/password-reset/request',{email:'unknown@example.test'});
    const pending = await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email});
    expect(pending.statusCode).toBe(unknown.statusCode); expect(pending.json()).toEqual(unknown.json()); expect(s.emails).toHaveLength(1);
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:t})).statusCode).toBe(200);
    expect((await read(s.app,s.owner)).json().email).toEqual({ verified:s.email,pending:null,deliveryEnabled:true });
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:t})).statusCode).toBe(400);
  });

  it('expires verification tokens, invalidates resends and address changes, and never recovers with a pending address', async () => {
    const s=await setup();
    await post(s.app,s.owner,'/account/email',{email:s.email,currentPassword:password});
    const first=token(s.emails.at(-1)!);
    await pool.query("UPDATE chess.account_email_tokens SET expires_at=now()-interval '1 second' WHERE account_id=$1",[s.id]);
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:first})).statusCode).toBe(400);
    await post(s.app,s.owner,'/account/email/resend'); const second=token(s.emails.at(-1)!);
    expect(second).not.toBe(first);
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:second})).statusCode).toBe(200);
    await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email}); const reset=token(s.emails.at(-1)!);
    const next=`next-${s.email}`;
    await post(s.app,s.owner,'/account/email',{email:next,currentPassword:password}); const third=token(s.emails.at(-1)!);
    expect((await read(s.app,s.owner)).json().email).toMatchObject({verified:null,pending:next});
    expect((await post(s.app,s.stranger,'/account/password-reset/confirm',{token:reset,newPassword,confirmPassword:newPassword})).statusCode).toBe(400);
    const count=s.emails.length;
    await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email});
    await post(s.app,s.stranger,'/account/password-reset/request',{email:next}); expect(s.emails).toHaveLength(count);
    await post(s.app,s.owner,'/account/email/resend'); const fourth=token(s.emails.at(-1)!);
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:third})).statusCode).toBe(400);
    expect((await post(s.app,s.stranger,'/account/email/verify',{token:fourth})).statusCode).toBe(200);
    expect((await read(s.app,s.owner)).json().email.verified).toBe(next);
  });

  it('resets once across concurrent servers, revokes sessions and linked guest bearers, then restores original game access on login', async () => {
    const s=await setup(); await enable(s);
    const legacyOwner=await browser(s.app);
    const legacyGame=(await post(s.app,legacyOwner,'/challenges')).json().id;
    await post(s.app,s.stranger,`/challenges/${legacyGame}/accept`);
    await post(s.app,legacyOwner,'/account/login',{username:s.username,password});
    await seedHistoricalGuestLink(pool, legacyOwner.cookie);
    const other=await browser(s.app); await post(s.app,other,'/account/login',{username:s.username,password});
    const game=(await post(s.app,s.owner,'/challenges')).json().id;
    await post(s.app,s.stranger,`/challenges/${game}/accept`);
    await post(s.app,s.owner,`/games/${game}/chat`,{text:'Keep this private history'});
    const seat=(await pool.query('SELECT creator_guest_id FROM chess.challenges WHERE id=$1',[game])).rows[0].creator_guest_id;
    const requester=await browser(s.app);
    await post(s.app,requester,'/account/password-reset/request',{email:s.email}); const t=token(s.emails.at(-1)!);
    expect((await post(s.app,requester,'/account/password-reset/confirm',{token:t,newPassword,confirmPassword:password})).statusCode).toBe(400);
    expect((await post(s.app,requester,'/account/password-reset/confirm',{token:t,newPassword:'short',confirmPassword:'short'})).statusCode).toBe(400);
    const restarted=server().app;
    const results=await Promise.all([post(s.app,requester,'/account/password-reset/confirm',{token:t,newPassword,confirmPassword:newPassword}),
      post(restarted,requester,'/account/password-reset/confirm',{token:t,newPassword,confirmPassword:newPassword})]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,400]);
    expect((await pool.query('SELECT count(*)::int AS n FROM chess.account_sessions WHERE account_id=$1',[s.id])).rows[0].n).toBe(0);
    expect((await read(s.app,s.owner,`/games/${game}`)).statusCode).toBe(401);
    expect((await read(s.app,other,`/games/${game}/chat`)).statusCode).toBe(401);
    expect((await read(s.app,legacyOwner,`/games/${legacyGame}`)).statusCode).toBe(401);
    const saved=(await pool.query('SELECT password_hash FROM chess.accounts WHERE id=$1',[s.id])).rows[0].password_hash;
    expect(saved).toContain('$argon2id$v=19$m=19456,t=2,p=1$'); expect(await verify(saved,newPassword)).toBe(true);
    expect((await post(restarted,requester,'/account/login',{username:s.username,password})).statusCode).toBe(401);
    expect((await post(restarted,requester,'/account/login',{username:s.username,password:newPassword})).statusCode).toBe(200);
    expect((await read(restarted,requester,`/games/${game}`)).statusCode).toBe(200);
    expect((await read(restarted,requester,`/games/${legacyGame}`)).statusCode).toBe(200);
    expect((await read(restarted,requester,`/games/${game}/chat`)).json().messages).toHaveLength(1);
    expect((await read(restarted,requester,'/account/games')).json().games[0].id).toBe(game);
    expect((await pool.query('SELECT creator_guest_id FROM chess.challenges WHERE id=$1',[game])).rows[0].creator_guest_id).toBe(seat);
  });

  it('rejects expired resets, replaces older resets, and invalidates resets on a normal password change', async()=>{
    const s=await setup(); await enable(s);
    await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email}); const first=token(s.emails.at(-1)!);
    await pool.query("UPDATE chess.account_email_tokens SET expires_at=now()-interval '1 second' WHERE account_id=$1 AND purpose='reset'",[s.id]);
    expect((await post(s.app,s.stranger,'/account/password-reset/confirm',{token:first,newPassword,confirmPassword:newPassword})).statusCode).toBe(400);
    await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email}); const second=token(s.emails.at(-1)!);
    await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email}); const third=token(s.emails.at(-1)!);
    expect((await post(s.app,s.stranger,'/account/password-reset/confirm',{token:second,newPassword,confirmPassword:newPassword})).statusCode).toBe(400);
    expect((await post(s.app,s.owner,'/account/password',{currentPassword:password,newPassword,confirmPassword:newPassword})).statusCode).toBe(200);
    expect((await post(s.app,s.stranger,'/account/password-reset/confirm',{token:third,newPassword,confirmPassword:newPassword})).statusCode).toBe(400);
  });

  it('keeps address and IP throttles durable with identical public reset responses and enforces CSRF', async()=>{
    const s=await setup(); await enable(s); const restarted=server();
    for (const [url, payload] of [
      ['/account/password-reset/request', { email: s.email }],
      ['/account/password-reset/confirm', { token: 'a'.repeat(64), newPassword, confirmPassword: newPassword }],
      ['/account/email/verify', { token: 'a'.repeat(64) }],
      ['/account/email', { email: s.email, currentPassword: password }],
      ['/account/email/resend', {}],
    ] as const) expect((await s.app.inject({ method: 'POST', url, headers: { cookie: s.owner.cookie }, payload })).statusCode).toBe(403);
    const responses=[];
    for(let i=0;i<4;i++) responses.push(await post(s.app,s.stranger,'/account/password-reset/request',{email:s.email}));
    const count=s.emails.length;
    responses.push(await post(restarted.app,s.stranger,'/account/password-reset/request',{email:s.email}));
    expect(s.emails.length).toBe(count); expect(restarted.emails).toHaveLength(0); expect(count).toBe(4);
    const unknown=await post(restarted.app,s.stranger,'/account/password-reset/request',{email:`none-${s.email}`});
    for(const r of responses){expect(r.statusCode).toBe(200);expect(r.json()).toEqual(unknown.json());}
    for(let i=0;i<20;i++) await post(s.app,s.stranger,'/account/password-reset/request',{email:`missing-${i}-${s.email}`});
    const distinct=await setup(); await enable(distinct);
    await post(distinct.app,s.stranger,'/account/password-reset/request',{email:distinct.email}); expect(distinct.emails).toHaveLength(1);
    for(let i=0;i<4;i++) await post(s.app,s.owner,'/account/email',{email:`next${i}-${s.email}`,currentPassword:password});
    expect((await post(restarted.app,s.owner,'/account/email/resend')).statusCode).toBe(429);
  });

  it('cannot verify an address owned by another account and reports delivery failures safely', async()=>{
    const first=await setup(); await enable(first); const second=await setup();
    await post(second.app,second.owner,'/account/email',{email:first.email,currentPassword:password});
    expect((await post(second.app,second.stranger,'/account/email/verify',{token:token(second.emails[0]!)})).statusCode).toBe(409);
    expect((await read(second.app,second.owner)).json().email.verified).toBeNull();
    const failed=server(true);
    const response=await post(failed.app,second.owner,'/account/email/resend'); expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    const reset=await post(failed.app,second.stranger,'/account/password-reset/request',{email:first.email});
    expect(reset.statusCode).toBe(200); expect(reset.body).not.toContain('secret');
  });
  it('keeps existing accounts working without mail configuration and never claims delivery succeeded', async () => {
    const s = await setup();
    const disabled = buildApp(async () => {}, false, { pool, secureCookies: false }); apps.push(disabled);
    expect((await read(disabled, s.owner)).json().email).toEqual({ verified: null, pending: null, deliveryEnabled: false });
    expect((await post(disabled, s.owner, '/account/email', { email: s.email, currentPassword: password })).json().error).toBe('email_not_configured');
    const known = await post(disabled, s.stranger, '/account/password-reset/request', { email: s.email });
    const unknown = await post(disabled, s.stranger, '/account/password-reset/request', { email: 'missing@example.test' });
    expect(known.statusCode).toBe(200); expect(known.json()).toEqual(unknown.json());
    expect((await pool.query('SELECT count(*)::int AS n FROM chess.account_email_tokens WHERE account_id=$1', [s.id])).rows[0].n).toBe(0);
    expect((await read(disabled, s.owner, '/account/games')).statusCode).toBe(200);
  });

});
