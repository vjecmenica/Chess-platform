import type { GameReadResponse, SavedMove } from '@chess/contracts';
import type { AnalysisCursor } from './analysis-model';
import { replayFen } from './board-model';
import { calculateGameAccuracy, type GameAccuracy } from './game-accuracy';
import { EngineCache, EngineController, type EngineEvaluation, type EngineState,
  type EngineWorker } from './engine-analysis';
import { engineVariation } from './engine-variation';
import { moveClassifications, type MoveClassification } from './move-classification';

export const reviewMethodVersion = 'local-cpl-v1';
export const reviewPauseMs = 150;

export interface ReviewedMove {
  readonly ply: number;
  readonly san: string;
  readonly side: 'white' | 'black';
  readonly lossCp: number | null;
  readonly label: 'Strong' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Mate score';
  readonly classification: MoveClassification;
}

export interface GameReview {
  readonly gameId: string;
  readonly method: typeof reviewMethodVersion;
  readonly evaluations: readonly EngineEvaluation[];
  readonly moves: readonly ReviewedMove[];
  readonly accuracy: GameAccuracy;
}

const cplClassifications = {
  Strong: 'excellent', Good: 'good', Inaccuracy: 'inaccuracy', Mistake: 'mistake', Blunder: 'blunder', 'Mate score': 'mate',
} as const satisfies Record<ReviewedMove['label'], MoveClassification>;

export function describeReviewedMove(move: ReviewedMove): string {
  const label = moveClassifications[move.classification].label;
  return `Engine: ${label}, ${move.lossCp === null ? 'no numeric centipawn loss' : `${move.lossCp} centipawn loss`}`;
}

export function reviewForGame(game: GameReadResponse | null, review: GameReview | null | undefined): GameReview | null {
  return review && game?.status === 'finished' && game.id === review.gameId
    && game.history.length === review.moves.length && review.evaluations.at(-1)?.fen === game.position.fen ? review : null;
}

export function reviewedDestination(game: GameReadResponse, review: GameReview | null,
  cursor: AnalysisCursor | null, displayedFen: string | null) {
  review = reviewForGame(game, review);
  if (!review || cursor?.kind !== 'main' || cursor.ply < 1) return null;
  const saved = game.history[cursor.ply - 1];
  const move = review.moves[cursor.ply - 1];
  if (!saved || !move || saved.afterFen !== displayedFen
    || review.evaluations[cursor.ply]?.fen !== displayedFen) return null;
  return { square: saved.to, move };
}

export function reviewSummary(review: GameReview, side: 'white' | 'black') {
  const moves = review.moves.filter(move => move.side === side);
  const numeric = moves.flatMap(move => move.lossCp === null ? [] : [move.lossCp]);
  return {
    inaccuracy: moves.filter(move => move.label === 'Inaccuracy').length,
    mistake: moves.filter(move => move.label === 'Mistake').length,
    blunder: moves.filter(move => move.label === 'Blunder').length,
    averageLossCp: numeric.length === 0 ? null
      : Math.round(numeric.reduce((sum, loss) => sum + loss, 0) / numeric.length),
  };
}

export function nextReviewedMovePly(review: GameReview, side: 'white' | 'black',
  label: 'Inaccuracy' | 'Mistake' | 'Blunder', currentPly: number | null): number | null {
  const plies = review.moves.filter(move => move.side === side && move.label === label)
    .map(move => move.ply);
  return plies.find(ply => ply > (currentPly ?? 0)) ?? plies[0] ?? null;
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

function matchesBestMove(move: SavedMove, before: EngineEvaluation): boolean {
  const played = `${move.from}${move.to}${move.promotion ?? ''}`;
  const topLine = before.lines?.find(line => line.rank === 1)?.variation[0];
  if (before.bestMove !== played || (before.variation[0] && before.variation[0] !== played)
    || (topLine && topLine !== played)) return false;
  // Validate standard UCI against the saved position, including king destination for castling.
  return engineVariation(move.beforeFen, [played])[0]?.fen === move.afterFen;
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
    const label = lossCp === null ? 'Mate score' : moveLabel(lossCp);
    // Only distinguish an engine match inside the existing Strong band.
    const classification = label === 'Strong' && matchesBestMove(move, evaluations[index]!)
      ? 'best' : cplClassifications[label];
    return { ply: move.ply, san: move.san, side: move.side, lossCp, label, classification };
  });
  return { gameId: game.id, method: reviewMethodVersion, evaluations, moves,
    accuracy: calculateGameAccuracy(evaluations, moves.map(move => move.side)) };
}

export interface ReviewProgress { readonly completed: number; readonly total: number;
  readonly cached: number }

export class GameReviewRunner {
  private readonly controller: EngineController;
  private readonly evaluations: EngineEvaluation[] = [];
  private current = 0;
  private cached = 0;
  private running = false;
  private firstWorkerSearch = true;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly positions: readonly string[],
    makeWorker: () => EngineWorker, private readonly cache: EngineCache,
    private readonly onProgress: (progress: ReviewProgress) => void,
    private readonly onComplete: (evaluations: readonly EngineEvaluation[]) => void,
    private readonly onError: (message: string) => void,
    options: { readonly threads?: number } = {}) {
    this.controller = new EngineController(makeWorker, state => this.handleEngine(state), cache, options);
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
    // The Full build can take longer to download and initialize on the first uncached position.
    this.watchdog = setTimeout(() => this.fail('The engine took too long to review a position.'),
      this.firstWorkerSearch ? 90_000 : 20_000);
    this.firstWorkerSearch = false;
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
