import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function loadEnvironment(): void {
  // src and dist are both one level below apps/server.
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
}

export function databaseUrl(value: string | undefined, name = 'DATABASE_URL'): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required. Copy .env.example to .env at the repository root and configure PostgreSQL.`);
  }
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error('Invalid database URL');
    }
  } catch {
    throw new Error(`${name} must be a PostgreSQL URL including a host and database name. Do not paste credentials into logs.`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = databaseUrl(env.DATABASE_URL);
  const portText = env.PORT ?? '3001';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('HOST must not be empty. Use 127.0.0.1 for local development.');
  return { connectionString, host, port };
}
