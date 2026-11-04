import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { defaultAppearance } from '@chess/contracts';
import { loadEnvironment, databaseUrl } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { buildApp } from '../src/app.js';
let pool: ReturnType<typeof createPool>;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => { loadEnvironment(); pool = createPool(databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL')); await migrate(pool); app = buildApp(async () => { }, false, { pool, secureCookies: false }); });
afterAll(async () => { await app.close(); await pool.end(); });
async function browser() { const r = await app.inject('/guest-session'); return { cookie: r.cookies.map(c => c.name + '=' + c.value).join('; '), csrf: r.json().csrfToken }; }
async function auth(w: Awaited<ReturnType<typeof browser>>, mode: string, username: string) { const r = await app.inject({ method: 'POST', url: '/account/' + mode, headers: { cookie: w.cookie, 'x-csrf-token': w.csrf }, payload: { username, password: 'A synthetic long test password 2026' } }); expect(r.statusCode).toBe(200); const jar = new Map(w.cookie.split('; ').map(x => x.split('=') as [
    string,
    string
])); for (const c of r.cookies)
    c.value ? jar.set(c.name, c.value) : jar.delete(c.name); w.cookie = [...jar].map(([k, v]) => k + '=' + v).join('; '); w.csrf = r.json().csrfToken; }
it('persists private account preferences across sessions and rejects guests, CSRF failures and owner switches', async () => {
    const a = await browser(), b = await browser(), guest = await browser();
    const name = 'a_' + randomUUID().replaceAll('-', '').slice(0, 16);
    await auth(a, 'register', name);
    await auth(b, 'register', 'b_' + randomUUID().replaceAll('-', '').slice(0, 16));
    const read = (w: typeof a) => app.inject({ url: '/account/appearance', headers: { cookie: w.cookie } });
    const initial = (await read(a)).json();
    expect(initial.appearance).toEqual(defaultAppearance);
    const save = (w: typeof a, owner: string, value: object, csrf = w.csrf) => app.inject({ method: 'PUT', url: '/account/appearance', headers: { cookie: w.cookie, 'x-csrf-token': csrf, 'x-appearance-owner': owner }, payload: value });
    const selected = { ...defaultAppearance, pieceSet: 'kosal', theme: 'goldenwood', scale: 105, frame: false, grid: false };
    expect((await save(a, initial.owner, selected)).statusCode).toBe(200);
    const second = await browser();
    await auth(second, 'login', name);
    expect((await read(second)).json().appearance).toEqual(selected);
    expect((await read(b)).json().appearance).toEqual(defaultAppearance);
    expect((await read(guest)).json().owner).toBeNull();
    expect((await save(guest, initial.owner, selected)).statusCode).toBe(401);
    expect((await save(b, initial.owner, selected)).statusCode).toBe(409);
    expect((await save(a, initial.owner, selected, 'bad')).statusCode).toBe(403);
    expect((await save(a, initial.owner, { ...selected, scale: 1000 })).statusCode).toBe(400);
    expect((await save(a, initial.owner, { ...selected, pieceSet: 'future' })).statusCode).toBe(400);
    expect((await read(a)).headers['cache-control']).toBe('no-store');
});
