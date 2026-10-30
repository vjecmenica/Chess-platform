import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
async function checkHeaders(origin: string, path: string) {
  const response = await fetch(origin + path);
  expect(response.status).toBe(200);
  expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  await response.arrayBuffer();
  const etag = response.headers.get('etag');
  if (path !== '/') expect(etag).not.toBeNull();
  if (etag) {
    const cached = await fetch(origin + path, { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
    expect((await cached.arrayBuffer()).byteLength).toBe(0);
  }
}

it('serves isolation headers and cache validators for documents and engine assets in development', async () => {
  const server = await createServer({ root, configFile, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server.');
    const origin = `http://127.0.0.1:${address.port}`;
    await checkHeaders(origin, '/');
    await checkHeaders(origin, '/engine/stockfish-19-lite-single.js');
    await checkHeaders(origin, '/engine/stockfish-19-lite-single.wasm');
    const wasm = await fetch(origin + '/engine/stockfish-19-lite-single.wasm', { method: 'HEAD' });
    expect(wasm.headers.get('content-type')).toContain('application/wasm');
  } finally { await server.close(); }
}, 15_000);

it('applies the same isolation and cache behavior when previewing production static files', async () => {
  // A small isolated output fixture keeps this check independent of stale local builds.
  const directory = new URL(`../../../.local/engine-preview-${randomUUID()}/`, import.meta.url);
  await mkdir(new URL('engine/', directory), { recursive: true });
  await writeFile(new URL('index.html', directory), '<!doctype html><h1>Production header test</h1>');
  await writeFile(new URL('engine/test.wasm', directory), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const server = await preview({ root, configFile, logLevel: 'silent', build: { outDir: fileURLToPath(directory) },
    preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server.');
    const origin = `http://127.0.0.1:${address.port}`;
    await checkHeaders(origin, '/');
    await checkHeaders(origin, '/engine/test.wasm');
  } finally {
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    // The absolute target is a newly created UUID directory beneath this workspace's .local.
    await rm(directory, { recursive: true });
  }
}, 15_000);
