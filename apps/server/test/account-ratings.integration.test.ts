import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ratingPools } from '@chess/contracts';
import { initialRatingState, rateGame } from '@chess/domain';
import { loadOrCreateAccountRating } from '../src/account-ratings.js';
import { databaseUrl, loadEnvironment } from '../src/config.js';
import { createPool } from '../src/database.js';
import { migrate } from '../src/migrations.js';

let pool: pg.Pool;
let testUrl: string;
const accountIds: string[] = [];

beforeAll(async () => {
  loadEnvironment();
  testUrl = databaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  pool = createPool(testUrl);
  await migrate(pool);
});

afterAll(async () => {
  if (!pool) return;
  try {
    if (accountIds.length) await pool.query('DELETE FROM chess.accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  } finally {
    await pool.end();
  }
});

async function createAccount() {
  const id = randomUUID();
  await pool.query('INSERT INTO chess.accounts (id, username, password_hash) VALUES ($1, $2, $3)',
    [id, `rating_${id.slice(0, 8)}`, 'unused rating fixture']);
  accountIds.push(id);
  return id;
}

it('lazily initializes one row per pool under concurrency and cascades account deletion', async () => {
  const id = await createAccount();
  const readPools = () => pool.query('SELECT pool FROM chess.account_ratings WHERE account_id = $1 ORDER BY pool', [id]);
  expect((await readPools()).rows).toEqual([]);

  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const ratings = await Promise.all(clients.map(client => loadOrCreateAccountRating(client, id, 'blitz')));
    expect(ratings).toEqual([initialRatingState(), initialRatingState()]);
  } finally {
    for (const client of clients) client.release();
  }
  expect((await readPools()).rows).toEqual([{ pool: 'blitz' }]);
  await expect(pool.query(`INSERT INTO chess.account_ratings SELECT * FROM chess.account_ratings
    WHERE account_id = $1 AND pool = 'blitz'`, [id])).rejects.toMatchObject({ code: '23505' });

  for (const ratingPool of ratingPools) expect(await loadOrCreateAccountRating(pool, id, ratingPool)).toEqual(initialRatingState());
  expect((await readPools()).rows.map(row => row.pool)).toEqual([...ratingPools].sort());
  await pool.query('DELETE FROM chess.accounts WHERE id = $1', [id]);
  expect((await readPools()).rows).toEqual([]);
});

it('preserves full precision and isolates stored values by account and pool across connections', async () => {
  const first = await createAccount();
  const second = await createAccount();
  const initial = initialRatingState();
  await loadOrCreateAccountRating(pool, first, 'blitz');
  const [stored] = rateGame(initial, initial, 1, Date.UTC(2026, 0, 1) + 123);
  await pool.query(`UPDATE chess.account_ratings
    SET rating = $2, rd = $3, volatility = $4, rated_games = $5, last_rated_at = $6
    WHERE account_id = $1 AND pool = 'blitz'`,
  [first, stored.rating, stored.rd, stored.volatility, stored.ratedGames, new Date(stored.lastRatedAtMs!)]);

  const reopened = createPool(testUrl);
  try {
    expect(await loadOrCreateAccountRating(reopened, first, 'blitz')).toEqual(stored);
    expect(await loadOrCreateAccountRating(reopened, first, 'rapid')).toEqual(initial);
    expect(await loadOrCreateAccountRating(reopened, second, 'blitz')).toEqual(initial);
  } finally {
    await reopened.end();
  }
});

it('rejects unsupported pools, invalid values and inconsistent or non-finite activity', async () => {
  const id = await createAccount();
  await loadOrCreateAccountRating(pool, id, 'rapid');
  for (const invalid of [
    "pool = 'ultrabullet'", "rating = 'NaN'", "rating = 'Infinity'", "rating = '-Infinity'",
    'rd = -1', 'rd = 0', 'rd = 351', "rd = 'NaN'", 'volatility = 0', "volatility = 'NaN'",
    "volatility = 'Infinity'", 'rated_games = -1', 'rated_games = 1', 'last_rated_at = now()',
    "rated_games = 1, last_rated_at = 'infinity'", "rated_games = 1, last_rated_at = '1969-01-01 UTC'",
  ]) {
    await expect(pool.query(`UPDATE chess.account_ratings SET ${invalid} WHERE account_id = $1`, [id]))
      .rejects.toMatchObject({ code: '23514' });
  }
  await expect(loadOrCreateAccountRating(pool, randomUUID(), 'rapid')).rejects.toMatchObject({ code: '23503' });
  expect(await loadOrCreateAccountRating(pool, id, 'rapid')).toEqual(initialRatingState());
});
