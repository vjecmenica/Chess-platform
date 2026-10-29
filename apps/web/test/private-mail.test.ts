import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

it('does not serve local test emails through the development filesystem route', async () => {
  const directory = new URL('../../../.local/account-mail/', import.meta.url);
  const fixture = new URL(`${randomUUID()}.json`, directory);
  await mkdir(directory, { recursive: true });
  await writeFile(fixture, 'synthetic private email');
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server.');
    const path = fileURLToPath(fixture).replaceAll('\\', '/');
    const response = await fetch(`http://127.0.0.1:${address.port}/@fs/${path}`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('synthetic private email');
  } finally {
    await server.close();
    await unlink(fixture);
  }
}, 15_000);
