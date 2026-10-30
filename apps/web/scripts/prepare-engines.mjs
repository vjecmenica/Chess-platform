import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('stockfish/package.json');
const source = new URL('./bin/', pathToFileURL(packagePath));
const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
if (metadata.version !== '19.0.0') throw new Error('Expected the pinned Stockfish 19.0.0 release.');
const destination = new URL('../public/engine/stockfish-19.0.0/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ['stockfish-19.js', 'stockfish-19.wasm', 'stockfish-19-single.js', 'stockfish-19-single.wasm']) {
  const input = new URL(name, source), output = new URL(name, destination);
  const size = (await stat(input)).size;
  if (size === 0) throw new Error(`Missing engine asset: ${name}`);
  const existing = await stat(output).catch(() => null);
  if (existing?.size !== size) await copyFile(input, output);
}
console.log(`Prepared Stockfish 19 Full assets in ${fileURLToPath(destination)}`);
