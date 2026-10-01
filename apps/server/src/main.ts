import { buildApp } from './app.js';
import { loadEnvironment, readConfig } from './config.js';
import { checkDatabase, createPool } from './database.js';
import { checkChallengeSchema } from './challenge-routes.js';
import { createGameService } from './game-service.js';

async function main() {
  loadEnvironment();
  const config = readConfig();
  const pool = createPool(config.connectionString);
  const gameService = createGameService(pool);
  const secureCookies = process.env.NODE_ENV === 'production'
    || !['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const app = buildApp(() => checkDatabase(pool), true, { pool, secureCookies, gameService });
  let timer: ReturnType<typeof setInterval> | null = null;
  let resignationTimer: ReturnType<typeof setInterval> | null = null;
  app.addHook('onClose', async () => {
    if (timer !== null) clearInterval(timer);
    if (resignationTimer !== null) clearInterval(resignationTimer);
    await gameService.stop();
    await pool.end();
  });

  try {
    await checkDatabase(pool);
    await checkChallengeSchema(pool);
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
    catch { console.error('Could not check due game clocks; the next poll will retry.'); }
    finally { polling = false; }
  };
  timer = setInterval(() => { void poll(); }, 500);
  void poll();

  let checkingResignations = false;
  const checkResignations = async () => {
    if (checkingResignations) return;
    checkingResignations = true;
    try { await gameService.pollPendingResignations(); }
    catch { console.error('Could not verify pending resignations; the next poll will retry.'); }
    finally { checkingResignations = false; }
  };
  resignationTimer = setInterval(() => { void checkResignations(); }, 1_000);
  void checkResignations();

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
