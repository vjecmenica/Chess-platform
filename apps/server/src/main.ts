import { buildApp } from './app.js';
import { loadEnvironment, readConfig } from './config.js';
import { checkDatabase, createPool } from './database.js';

async function main() {
  loadEnvironment();
  const config = readConfig();
  const pool = createPool(config.connectionString);
  const app = buildApp(() => checkDatabase(pool), true);
  app.addHook('onClose', async () => pool.end());

  try {
    await checkDatabase(pool);
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
