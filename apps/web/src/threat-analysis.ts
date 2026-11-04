import { opponentPassPosition } from '@chess/domain';
import { EngineCache, EngineController, type EngineWorker, type EngineState } from './engine-analysis';
import { engineBestMove, type EngineBestMove } from './engine-board';
import { liteEngine, type EngineVariant } from './engine-builds';

export type ThreatState = { readonly kind: 'off' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'loading' | 'searching' | 'done'; readonly move: EngineBestMove | null }
  | { readonly kind: 'error'; readonly message: string };

export const threatLimits = { mode: 'bounded', depth: 14, timeMs: 750 } as const;

/** One separate bounded worker, reused between positions; no ordinary PV/cache state. */
export class ThreatController {
  private current: EngineController | null = null;
  private generation = 0;
  private signature = '';
  private request: { fen: string; gameId: string; passedFen: string } | null = null;
  constructor(private readonly makeWorker: () => EngineWorker,
    private readonly publish: (state: ThreatState) => void,
    private readonly engine: EngineVariant = liteEngine) {}

  start(fen: string, gameId: string): void {
    if (this.request?.fen === fen && this.request.gameId === gameId) return;
    if (this.request && this.request.gameId !== gameId) this.dispose();
    this.request = null;
    const position = opponentPassPosition(fen);
    if (position.kind === 'unavailable') {
      this.current?.stop();
      this.emit({ kind: 'unavailable', message: position.reason === 'in_check'
        ? 'Threat unavailable while in check.' : position.reason === 'no_moves'
          ? 'No legal threat can be calculated for this terminal position.' : 'Threat unavailable for this position.' });
      return;
    }
    this.request = { fen, gameId, passedFen: position.fen };
    this.emit({ kind: 'loading', move: null });
    if (this.current) { this.current.start(position.fen); return; }
    const generation = this.generation;
    const receive = (state: EngineState) => {
      const request = this.request;
      if (generation !== this.generation || !request) return;
      if (state.kind === 'error') { this.emit({ kind: 'error', message: 'Threat engine could not run. Toggle Threat to retry.' }); return; }
      if (state.kind === 'off') { this.emit({ kind: 'off' }); return; }
      const best = engineBestMove(state, request.passedFen, request.gameId, true);
      this.emit({ kind: state.kind === 'done' ? 'done' : state.kind === 'loading' ? 'loading' : 'searching',
        move: best ? { ...best, fen: request.fen } : null });
    };
    this.current = new EngineController(this.makeWorker, receive,
      new EngineCache(undefined, `${this.engine.id}:threat`, this.engine.label),
      { hashMb: 8, ...(this.engine.multithreaded ? { threads: 1 } : {}) });
    this.current.setSearchLimits(threatLimits);
    this.current.start(position.fen);
  }

  private emit(state: ThreatState): void {
    // PV/score churn with the same move need not re-render the board or panel.
    const signature = JSON.stringify(state);
    if (signature !== this.signature) { this.signature = signature; this.publish(state); }
  }

  dispose(): void { this.generation++; this.request = null; this.current?.dispose(); this.current = null; this.signature = ''; }
}
