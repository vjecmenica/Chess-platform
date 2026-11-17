import { accountEmailFromEnvironment } from './account-email.js';
import { buildApp } from './app.js';
import { loadEnvironment, readConfig } from './config.js';
import { checkDatabase, createPool } from './database.js';
import { checkChallengeSchema } from './challenge-routes.js';
import { createGameService } from './game-service.js';
import { avatarStorageFromEnvironment } from './avatar-storage.js';
import { cleanAvatarObjects } from './account-avatars.js';

async function main() {
  loadEnvironment();
  const config = readConfig();
  const avatarStorage = avatarStorageFromEnvironment();
  const pool = createPool(config.connectionString);
  const gameService = createGameService(pool);
  const secureCookies = process.env.NODE_ENV === 'production'
    || !['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const app = buildApp(() => checkDatabase(pool), true, { pool, secureCookies, gameService,
    accountEmail: accountEmailFromEnvironment(), avatarStorage });
  let timer: ReturnType<typeof setInterval> | null = null;
  let avatarCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let avatarCleanup: Promise<void> | null = null;
  app.addHook('onClose', async () => {
    if (timer !== null) clearInterval(timer);
    if (avatarCleanupTimer !== null) clearInterval(avatarCleanupTimer);
    await avatarCleanup;
    await gameService.stop();
    await pool.end();
  });

  try {
    await checkDatabase(pool);
    await checkChallengeSchema(pool);
    await pool.query('SELECT a.avatar_key FROM chess.accounts a CROSS JOIN chess.avatar_cleanup LIMIT 0');
    await gameService.start();
  } catch (error) {
    await app.close();
    throw error;
  }
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    await app.close();
    throw new Error('Cannot start the HTTP server. Check HOST and PORT and whether the port is already in use.');
  }

  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try { await gameService.pollDueGames(); }
    catch (error) { app.log.error({ err: error }, 'Could not check due game clocks; the next poll will retry.'); }
    finally { polling = false; }
  };
  timer = setInterval(() => { void poll(); }, 500);
  void poll();

  const removeAvatars = () => {
    avatarCleanup ??= cleanAvatarObjects(pool, avatarStorage)
      .catch(error => app.log.error({ err: error }, 'Could not process the avatar cleanup queue.'))
      .finally(() => { avatarCleanup = null; });
  };
  avatarCleanupTimer = setInterval(removeAvatars, 60_000);
  removeAvatars();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        console.error('The server could not shut down cleanly.');
        process.exitCode = 1;
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Server startup failed.');
  process.exitCode = 1;
});
