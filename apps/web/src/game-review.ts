import type { GameReadResponse } from '@chess/contracts';
import { replayFen } from './board-model';
import { EngineCache, EngineController, type EngineEvaluation, type EngineState,
  type EngineWorker } from './engine-analysis';

export const reviewMethodVersion = 'local-cpl-v1';
export const reviewPauseMs = 150;

export interface ReviewedMove {
  readonly ply: number;
  readonly san: string;
  readonly side: 'white' | 'black';
  readonly lossCp: number | null;
  readonly label: 'Strong' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Mate score';
}

export interface GameReview {
  readonly method: typeof reviewMethodVersion;
  readonly evaluations: readonly EngineEvaluation[];
  readonly moves: readonly ReviewedMove[];
}

export function reviewPositions(game: GameReadResponse): string[] {
  if (game.status !== 'finished') throw new Error('Only finished games can be reviewed.');
  replayFen(game, game.history.length);
  return game.history.length === 0 ? [game.position.fen]
    : [game.history[0]!.beforeFen, ...game.history.map(move => move.afterFen)];
}

function whiteCentipawns(evaluation: EngineEvaluation): number | null {
  if (evaluation.score.kind === 'mate') return null;
  return (evaluation.fen.split(' ')[1] === 'w' ? 1 : -1) * evaluation.score.value;
}

export function graphCentipawns(evaluation: EngineEvaluation): number {
  const cp = whiteCentipawns(evaluation);
  if (cp !== null) return Math.max(-1000, Math.min(1000, cp));
  const sideSign = evaluation.fen.split(' ')[1] === 'w' ? 1 : -1;
  // A mate score of zero means the side to move is already checkmated.
  return (evaluation.score.value > 0 ? sideSign : -sideSign) * 1000;
}

export function moveLabel(lossCp: number): Exclude<ReviewedMove['label'], 'Mate score'> {
  if (lossCp <= 20) return 'Strong';
  if (lossCp <= 60) return 'Good';
  if (lossCp <= 120) return 'Inaccuracy';
  if (lossCp <= 250) return 'Mistake';
  return 'Blunder';
}

export function buildGameReview(game: GameReadResponse,
  evaluations: readonly EngineEvaluation[]): GameReview {
  const fens = reviewPositions(game);
  if (evaluations.length !== fens.length
    || evaluations.some((evaluation, index) => evaluation.fen !== fens[index]))
    throw new Error('Review evaluations do not match the saved main line.');
  const moves: ReviewedMove[] = game.history.map((move, index) => {
    const before = whiteCentipawns(evaluations[index]!);
    const after = whiteCentipawns(evaluations[index + 1]!);
    const lossCp = before === null || after === null ? null
      : Math.max(0, (move.side === 'white' ? 1 : -1) * (before - after));
    return { ply: move.ply, san: move.san, side: move.side, lossCp,
      label: lossCp === null ? 'Mate score' : moveLabel(lossCp) };
  });
  return { method: reviewMethodVersion, evaluations, moves };
}

export interface ReviewProgress { readonly completed: number; readonly total: number;
  readonly cached: number }

export class GameReviewRunner {
  private readonly controller: EngineController;
  private readonly evaluations: EngineEvaluation[] = [];
  private current = 0;
  private cached = 0;
  private running = false;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly positions: readonly string[],
    makeWorker: () => EngineWorker, private readonly cache: EngineCache,
    private readonly onProgress: (progress: ReviewProgress) => void,
    private readonly onComplete: (evaluations: readonly EngineEvaluation[]) => void,
    private readonly onError: (message: string) => void) {
    this.controller = new EngineController(makeWorker, state => this.handleEngine(state), cache);
  }

  start(): void {
    if (this.running || this.positions.length === 0) return;
    this.running = true;
    this.onProgress({ completed: 0, total: this.positions.length, cached: 0 });
    this.advance();
  }

  cancel(): void {
    this.running = false;
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.nextTimer = null;
    this.watchdog = null;
    this.controller.dispose();
  }

  private advance(): void {
    if (!this.running) return;
    if (this.current === this.positions.length) {
      this.running = false;
      this.controller.dispose();
      this.onComplete([...this.evaluations]);
      return;
    }
    const fen = this.positions[this.current]!;
    const cached = this.cache.get(fen);
    if (cached) { this.accept(cached, true); return; }
    this.watchdog = setTimeout(() => this.fail('The engine took too long to review a position.'), 20_000);
    this.controller.start(fen);
  }

  private handleEngine(state: EngineState): void {
    if (!this.running) return;
    if (state.kind === 'error') this.fail(state.message);
    else if (state.kind === 'done' && state.evaluation.fen === this.positions[this.current])
      this.accept(state.evaluation, state.cached);
  }

  private accept(evaluation: EngineEvaluation, cached: boolean): void {
    if (!this.running) return;
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.evaluations.push(evaluation);
    this.current += 1;
    if (cached) this.cached += 1;
    this.onProgress({ completed: this.current, total: this.positions.length, cached: this.cached });
    this.nextTimer = setTimeout(() => { this.nextTimer = null; this.advance(); },
      cached ? 0 : reviewPauseMs);
  }

  private fail(message: string): void {
    if (!this.running) return;
    this.cancel();
    this.onError(message);
  }
}
