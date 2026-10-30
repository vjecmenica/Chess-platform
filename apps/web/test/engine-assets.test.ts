import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('identifies the exact distributed engine files and their corresponding source/license', async () => {
  const packagePath = createRequire(import.meta.url).resolve('stockfish/package.json');
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  expect(metadata.version).toBe('19.0.0');
  const notice = await readFile(new URL('../public/engine/NOTICE.md', import.meta.url), 'utf8');
  const files = [...notice.matchAll(/\| `([^`]+\.(?:js|wasm))` \| (\d+) \| `([a-f0-9]{64})` \|/g)];
  expect(files).toHaveLength(6);
  for (const [, filename, expectedSize, expectedHash] of files) {
    const name = filename!.split('/').at(-1)!;
    const hash = createHash('sha256'); let size = 0;
    // Stream even the 99 MB files so the integrity test has bounded memory use.
    for await (const chunk of createReadStream(new URL(`./bin/${name}`, pathToFileURL(packagePath)))) {
      hash.update(chunk); size += chunk.length;
    }
    expect(size, name).toBe(Number(expectedSize));
    expect(hash.digest('hex'), name).toBe(expectedHash);
  }
  expect(notice).toContain('https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.0.tar.gz');
  expect(await readFile(new URL('../public/engine/COPYING.txt', import.meta.url), 'utf8'))
    .toContain('GNU GENERAL PUBLIC LICENSE');
}, 15_000);
