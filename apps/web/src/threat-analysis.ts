import { opponentPassPosition } from '@chess/domain';
import { EngineCache, EngineController, type EngineWorker, type EngineState } from './engine-analysis';
import { engineBestMove, type EngineBestMove } from './engine-board';

export type ThreatState = { readonly kind: 'off' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'loading' | 'searching' | 'done'; readonly move: EngineBestMove | null }
  | { readonly kind: 'error'; readonly message: string };

export const threatLimits = { mode: 'bounded', depth: 14, timeMs: 1200 } as const;

/** One optional Lite worker; no shared evaluation cache, PV state, or persistent output. */
export class ThreatController {
  private current: EngineController | null = null;
  private generation = 0;
  private signature = '';
  constructor(private readonly makeWorker: () => EngineWorker,
    private readonly publish: (state: ThreatState) => void) {}

  start(fen: string, gameId: string): void {
    this.dispose();
    const generation = this.generation;
    const position = opponentPassPosition(fen);
    if (position.kind === 'unavailable') {
      this.emit({ kind: 'unavailable', message: position.reason === 'in_check'
        ? 'Threat unavailable while in check.' : position.reason === 'no_moves'
          ? 'No legal threat can be calculated for this terminal position.' : 'Threat unavailable for this position.' });
      return;
    }
    const receive = (state: EngineState) => {
      if (generation !== this.generation) return;
      if (state.kind === 'error') { this.emit({ kind: 'error', message: 'Threat engine could not run. Toggle Threat to retry.' }); return; }
      if (state.kind === 'off') { this.emit({ kind: 'off' }); return; }
      const best = engineBestMove(state, position.fen, gameId, true);
      this.emit({ kind: state.kind === 'done' ? 'done' : state.kind === 'loading' ? 'loading' : 'searching',
        move: best ? { ...best, fen } : null });
    };
    this.current = new EngineController(this.makeWorker, receive, new EngineCache());
    this.current.setSearchLimits(threatLimits);
    this.current.start(position.fen);
  }

  private emit(state: ThreatState): void {
    // PV/score churn with the same move need not re-render the board or panel.
    const signature = JSON.stringify(state);
    if (signature !== this.signature) { this.signature = signature; this.publish(state); }
  }

  dispose(): void { this.generation++; this.current?.dispose(); this.current = null; this.signature = ''; }
}
