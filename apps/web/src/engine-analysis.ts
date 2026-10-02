import { createPositionFromFen } from '@chess/domain';

export const engineBuild = 'Stockfish 19 lite single-threaded';
export const engineWorkerUrl = '/engine/stockfish-19-lite-single.js';
const cacheKey = 'chess-engine:stockfish-19-lite-single:depth14-time1200:v1';

export interface EngineEvaluation {
  readonly fen: string;
  readonly depth: number;
  readonly score: { readonly kind: 'cp' | 'mate'; readonly value: number };
  readonly bestMove: string | null;
  readonly variation: readonly string[];
}

export type EngineState = { readonly kind: 'off' | 'loading' | 'searching' }
  | { readonly kind: 'done'; readonly evaluation: EngineEvaluation; readonly cached: boolean }
  | { readonly kind: 'error'; readonly message: string };

export interface EngineWorker {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface EngineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SearchInfo { depth: number; score: EngineEvaluation['score']; pv: string[] }
const uciMove = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function parseSearchInfo(line: string): SearchInfo | null {
  if (!line.startsWith('info ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const depth = /\bdepth (\d+)\b/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)\b/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);
  if (!depth || !score) return null;
  const moves = pv ? pv[1]!.trim().split(/\s+/).filter(move => uciMove.test(move)) : [];
  return { depth: Number(depth[1]), score: { kind: score[1] as 'cp' | 'mate', value: Number(score[2]) },
    pv: moves };
}

export function variationSan(fen: string, moves: readonly string[]): string[] {
  const position = createPositionFromFen(fen);
  const result: string[] = [];
  for (const uci of moves.slice(0, 12)) {
    if (!uciMove.test(uci)) break;
    const side = position.getPosition().sideToMove;
    const moved = position.submitMove({ side, from: uci.slice(0, 2), to: uci.slice(2, 4),
      ...(uci.length === 5 ? { promotion: uci[4] as 'q' | 'r' | 'b' | 'n' } : {}) });
    if (!moved.accepted) break;
    result.push(moved.move.san);
  }
  return result;
}

export function evaluationLabel(evaluation: EngineEvaluation): string {
  const whiteToMove = evaluation.fen.split(' ')[1] === 'w';
  const value = whiteToMove ? evaluation.score.value : -evaluation.score.value;
  if (evaluation.score.kind === 'mate') return value === 0 ? 'Mate' : `Mate ${value > 0 ? '+' : ''}${value}`;
  return `${value >= 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
}

function validEvaluation(value: unknown): value is EngineEvaluation {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<EngineEvaluation>;
  return typeof item.fen === 'string' && item.fen.length <= 128
    && Number.isInteger(item.depth) && item.depth! >= 0 && item.depth! <= 100
    && (item.score?.kind === 'cp' || item.score?.kind === 'mate')
    && Number.isInteger(item.score.value) && Math.abs(item.score.value) < 100_000
    && (item.bestMove === null || typeof item.bestMove === 'string' && uciMove.test(item.bestMove))
    && Array.isArray(item.variation) && item.variation.length <= 32
    && item.variation.every(move => typeof move === 'string' && uciMove.test(move));
}

export class EngineCache {
  private readonly memory = new Map<string, EngineEvaluation>();

  constructor(private readonly storage?: EngineStorage) {
    try {
      const raw = storage?.getItem(cacheKey);
      if (!raw || raw.length > 250_000) return;
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      for (const item of entries.slice(-200)) if (validEvaluation(item)) this.memory.set(item.fen, item);
    } catch { /* Storage is optional. */ }
  }

  get(fen: string): EngineEvaluation | undefined { return this.memory.get(fen); }

  put(evaluation: EngineEvaluation): void {
    this.memory.delete(evaluation.fen);
    this.memory.set(evaluation.fen, evaluation);
    while (this.memory.size > 200) this.memory.delete(this.memory.keys().next().value!);
    try { this.storage?.setItem(cacheKey, JSON.stringify([...this.memory.values()])); }
    catch { /* Keep the in-memory cache when browser storage is unavailable. */ }
  }
}

export class EngineController {
  private worker: EngineWorker | null = null;
  private ready = false;
  private waitingReady = false;
  private waitingStop = false;
  private enabled = false;
  private requestedFen: string | null = null;
  private activeFen: string | null = null;
  private lastInfo: SearchInfo | null = null;

  constructor(private readonly makeWorker: () => EngineWorker,
    private readonly onState: (state: EngineState) => void,
    private readonly cache: EngineCache) {}

  start(fen: string): void { this.enabled = true; this.setPosition(fen); }

  setPosition(fen: string): void {
    if (!this.enabled || fen === this.requestedFen) return;
    this.requestedFen = fen;
    const cached = this.cache.get(fen);
    if (cached) this.onState({ kind: 'done', evaluation: cached, cached: true });
    else this.onState({ kind: this.ready ? 'searching' : 'loading' });
    if (this.worker) {
      if (this.ready && !this.waitingReady && !this.waitingStop) this.resetSearch();
    } else if (!cached) this.openWorker();
  }

  stop(): void {
    this.enabled = false;
    this.requestedFen = null;
    this.activeFen = null;
    this.lastInfo = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.waitingReady = false;
    this.waitingStop = false;
    this.onState({ kind: 'off' });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.enabled = false;
    this.requestedFen = null;
  }

  private openWorker(): void {
    try {
      const worker = this.makeWorker();
      this.worker = worker;
      worker.onmessage = event => { if (this.worker === worker) this.handleMessage(String(event.data)); };
      worker.onerror = () => { if (this.worker === worker) this.fail('Stockfish could not load in this browser.'); };
      worker.postMessage('uci');
    } catch { this.fail('Stockfish could not start in this browser.'); }
  }

  private fail(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.waitingReady = false;
    this.waitingStop = false;
    this.activeFen = null;
    this.lastInfo = null;
    this.enabled = false;
    this.requestedFen = null;
    this.onState({ kind: 'error', message });
  }

  private resetSearch(): void {
    if (!this.worker || !this.ready) return;
    const wasSearching = this.activeFen !== null;
    this.activeFen = null;
    this.lastInfo = null;
    if (wasSearching) {
      this.waitingStop = true;
      this.worker.postMessage('stop');
    } else {
      this.waitingReady = true;
      this.worker.postMessage('isready');
    }
  }

  private beginSearch(): void {
    const fen = this.requestedFen;
    if (!this.worker || !this.ready || !this.enabled || !fen || this.cache.get(fen)) return;
    this.activeFen = fen;
    this.lastInfo = null;
    this.onState({ kind: 'searching' });
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage('go depth 14 movetime 1200');
  }

  private handleMessage(message: string): void {
    for (const line of message.split(/\r?\n/)) {
      if (this.waitingStop && line.startsWith('bestmove ')) {
        this.waitingStop = false;
        this.waitingReady = true;
        this.worker?.postMessage('isready');
        continue;
      }
      if (line === 'uciok') {
        this.worker?.postMessage('setoption name Hash value 16');
        this.worker?.postMessage('setoption name MultiPV value 1');
        this.waitingReady = true;
        this.worker?.postMessage('isready');
      } else if (line === 'readyok') {
        this.ready = true;
        this.waitingReady = false;
        this.beginSearch();
      } else if (this.activeFen && !this.waitingReady && !this.waitingStop) {
        const info = parseSearchInfo(line);
        if (info && (!this.lastInfo || info.depth > this.lastInfo.depth
          || info.depth === this.lastInfo.depth && info.pv.length >= this.lastInfo.pv.length)) this.lastInfo = info;
        if (line.startsWith('bestmove ')) this.finishSearch(line);
      }
    }
  }

  private finishSearch(line: string): void {
    const fen = this.activeFen;
    this.activeFen = null;
    const best = /^bestmove (\S+)/.exec(line)?.[1];
    if (!fen || !this.lastInfo || !best || best !== '(none)' && !uciMove.test(best)) {
      this.fail('Stockfish did not return a usable evaluation.');
      return;
    }
    const evaluation: EngineEvaluation = { fen, depth: this.lastInfo.depth,
      score: this.lastInfo.score, bestMove: best === '(none)' ? null : best,
      variation: this.lastInfo.pv };
    this.cache.put(evaluation);
    if (this.requestedFen === fen) this.onState({ kind: 'done', evaluation, cached: false });
    this.lastInfo = null;
  }
}
