// Test-only instrumentation: count actual pthread launches without modifying Stockfish.
const workerThreads = require('node:worker_threads');
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class extends NativeWorker {
  postMessage(message, ...args) {
    if (message?.cmd === 'run') process.stderr.write('CHESS_TEST_WASM_PTHREAD_STARTED\n');
    return super.postMessage(message, ...args);
  }
};
