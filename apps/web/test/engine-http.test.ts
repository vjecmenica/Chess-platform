import { randomUUID } from 'node:crypto';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
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
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  await response.arrayBuffer();
  if (path === '/' || path.startsWith('/challenge/'))
    expect(response.headers.get('content-type')).toContain('text/html');
  const etag = response.headers.get('etag');
  if (path !== '/') expect(etag).not.toBeNull();
  if (etag) {
    const cached = await fetch(origin + path, { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(cached.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect((await cached.arrayBuffer()).byteLength).toBe(0);
  }
}

async function checkEmbedHeaders(origin: string, production: boolean) {
  const response = await fetch(origin + '/embed?game=scholars-mate');
  expect(response.status).toBe(200);
  expect(new URL(response.url).pathname).toBe('/embed/');
  expect(response.headers.get('x-frame-options')).toBeNull();
  expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  const policy = response.headers.get('content-security-policy');
  expect(policy).toContain('frame-ancestors *');
  expect(policy).toContain("form-action 'none'");
  if (production) {
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
  }
  expect(await response.text()).toContain('<title>Chess game replay</title>');
  const forbidden = await fetch(origin + '/embed/unknown');
  expect(forbidden.headers.get('x-frame-options')).toBe('DENY');
  await forbidden.arrayBuffer();
}

it('serves isolation headers and cache validators for documents and engine assets in development', async () => {
  const server = await createServer({ root, configFile, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server.');
    const origin = `http://127.0.0.1:${address.port}`;
    const document = await fetch(origin + '/challenge/00000000-0000-4000-8000-000000000001',
      { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } });
    expect(document.status).toBe(200);
    expect(document.redirected).toBe(false);
    expect(await document.text()).toContain('<meta name="chess-isolation-policy" content="1">');
    await checkHeaders(origin, '/');
    await checkHeaders(origin, '/challenge/00000000-0000-4000-8000-000000000001');
    await checkHeaders(origin, '/engine/stockfish-19-lite-single.js');
    await checkHeaders(origin, '/engine/stockfish-19-lite-single.wasm');
    const wasm = await fetch(origin + '/engine/stockfish-19-lite-single.wasm', { method: 'HEAD' });
    expect(wasm.headers.get('content-type')).toContain('application/wasm');
    await checkEmbedHeaders(origin, false);
  } finally { await server.close(); }
}, 15_000);

it('applies the same isolation and cache behavior when previewing production static files', async () => {
  // A small isolated output fixture keeps this check independent of stale local builds.
  const directory = new URL(`../../../.local/engine-preview-${randomUUID()}/`, import.meta.url);
  await mkdir(new URL('engine/', directory), { recursive: true });
  await mkdir(new URL('embed/', directory), { recursive: true });
  await writeFile(new URL('index.html', directory), '<!doctype html><h1>Production header test</h1>');
  await writeFile(new URL('embed/index.html', directory), '<!doctype html><title>Chess game replay</title>');
  await writeFile(new URL('engine/test.wasm', directory), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const server = await preview({ root, configFile, logLevel: 'silent', build: { outDir: fileURLToPath(directory) },
    preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server.');
    const origin = `http://127.0.0.1:${address.port}`;
    await checkHeaders(origin, '/');
    await checkHeaders(origin, '/challenge/00000000-0000-4000-8000-000000000001');
    await checkHeaders(origin, '/engine/test.wasm');
    await checkEmbedHeaders(origin, true);
    await unlink(new URL('embed/index.html', directory));
    const missing = await fetch(origin + '/embed/');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-frame-options')).toBe('DENY');
    expect(await missing.text()).toBe('Embed viewer unavailable.');
  } finally {
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    // The absolute target is a newly created UUID directory beneath this workspace's .local.
    await rm(directory, { recursive: true });
  }
}, 15_000);
