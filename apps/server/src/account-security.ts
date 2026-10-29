import { createHash } from 'node:crypto';
import type pg from 'pg';

export const passwordOptions = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const passwordSchema = { type: 'string', minLength: 15, maxLength: 128 } as const;

export async function rateAllowed(pool: pg.Pool, key: string, limit: number): Promise<boolean> {
  const keyHash = createHash('sha256').update(key).digest();
  const { rows } = await pool.query<{ attempts: number }>(`INSERT INTO chess.account_auth_limits
    (key_hash, attempts, resets_at) VALUES ($1, 1, now() + interval '15 minutes')
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN account_auth_limits.resets_at <= now() THEN 1 ELSE account_auth_limits.attempts + 1 END,
      resets_at = CASE WHEN account_auth_limits.resets_at <= now() THEN now() + interval '15 minutes'
        ELSE account_auth_limits.resets_at END RETURNING attempts`, [keyHash]);
  return rows[0]!.attempts <= limit;
}
