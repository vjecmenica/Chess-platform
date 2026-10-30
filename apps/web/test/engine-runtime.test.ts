import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

function searchWithThreads(threads: number): Promise<{ launches: number; bestMove: string }> {
  const script = createRequire(import.meta.url).resolve('stockfish/bin/stockfish-19.js');
  const observer = fileURLToPath(new URL('./fixtures/stockfish-thread-observer.cjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const engine = spawn(process.execPath, ['--require', observer, script],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let pending = '', diagnostics = '', bestMove = '';
    const timeout = setTimeout(() => { engine.kill(); reject(new Error('Stockfish runtime probe timed out.')); }, 15_000);
    engine.on('error', error => { clearTimeout(timeout); reject(error); });
    engine.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop()!;
      for (const line of lines) {
        if (line === 'uciok') engine.stdin.write(`setoption name Hash value 16\nsetoption name Threads value ${threads}\nisready\n`);
        if (line === 'readyok') engine.stdin.write('position startpos\ngo depth 8 movetime 1000\n');
        if (line.startsWith('bestmove ')) { bestMove = line; engine.stdin.write('quit\n'); }
      }
    });
    engine.stderr.on('data', chunk => { diagnostics += chunk; });
    engine.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || !bestMove) reject(new Error('Stockfish runtime search did not complete.'));
      else resolve({ launches: diagnostics.split('CHESS_TEST_WASM_PTHREAD_STARTED').length - 1, bestMove });
    });
    engine.stdin.write('uci\n');
  });
}

it('the actual Full WASM applies Threads=2 by launching one more pthread than Threads=1', async () => {
  // Node verification is independent of the browser's COOP/COEP capability check.
  const one = await searchWithThreads(1), two = await searchWithThreads(2);
  expect(one.bestMove).toMatch(/^bestmove [a-h][1-8][a-h][1-8]/);
  expect(two.bestMove).toMatch(/^bestmove [a-h][1-8][a-h][1-8]/);
  expect(one.launches).toBeGreaterThan(0);
  expect(two.launches).toBe(one.launches + 1);
}, 30_000);
