import { useEffect, useRef, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import { EngineCache, EngineController, engineBuild, engineWorkerUrl,
  evaluationLabel, variationSan, type EngineState, type EngineWorker } from './engine-analysis';
import { buildGameReview, GameReviewRunner, graphCentipawns, reviewMethodVersion, reviewSummary,
  reviewPositions, type GameReview, type ReviewProgress } from './game-review';

type ReviewState = { readonly kind: 'idle' | 'cancelled' }
  | { readonly kind: 'running'; readonly progress: ReviewProgress }
  | { readonly kind: 'complete'; readonly review: GameReview }
  | { readonly kind: 'error'; readonly message: string };

export function ReviewGraph({ review, selectedPly, onSelectPly }: {
  readonly review: GameReview; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
}) {
  const x = (index: number) => 10 + index * 300 / Math.max(1, review.evaluations.length - 1);
  const y = (evaluation: GameReview['evaluations'][number]) =>
    48 - graphCentipawns(evaluation) * 4 / 100;
  const points = review.evaluations.map((evaluation, index) => `${x(index)},${y(evaluation)}`).join(' ');
  const selected = selectedPly === null ? null : review.evaluations[selectedPly];
  return <svg className="review-graph" viewBox="0 0 320 96" role="group"
    aria-label="White-perspective evaluation by half-move, clipped at plus or minus ten pawns; mate at the edge">
    <line x1="10" x2="310" y1="48" y2="48" className="review-zero" />
    <polyline points={points} fill="none" className="review-plot" />
    {review.evaluations.map((evaluation, index) =>
      <circle key={index} cx={x(index)} cy={y(evaluation)} r="5" className="review-point"
        role="button" tabIndex={0} aria-label={`${index === 0 ? 'Show starting position'
          : `Show position after ${review.moves[index - 1]?.san}`}, evaluation ${evaluationLabel(evaluation)}`}
        onClick={() => onSelectPly(index)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); onSelectPly(index);
        } }} />)}
    {selected && <circle cx={x(selectedPly!)} cy={y(selected)} r="4" className="review-selected" />}
  </svg>;
}

export function EnginePanel({ game, fen, selectedPly, onSelectPly, onReviewChange }: {
  readonly game: GameReadResponse; readonly fen: string; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
  readonly onReviewChange: (review: GameReview | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<EngineState>({ kind: 'off' });
  const [review, setReview] = useState<ReviewState>({ kind: 'idle' });
  const controller = useRef<EngineController | null>(null);
  const runner = useRef<GameReviewRunner | null>(null);
  const cache = useRef<EngineCache | null>(null);

  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Analysis still works without storage. */ }
    cache.current = new EngineCache(storage);
    controller.current = new EngineController(
      () => new Worker(engineWorkerUrl) as EngineWorker, setState, cache.current);
    return () => {
      runner.current?.cancel(); runner.current = null;
      controller.current?.dispose(); controller.current = null;
      cache.current = null;
    };
  }, []);

  useEffect(() => { if (enabled) controller.current?.setPosition(fen); }, [enabled, fen]);

  function startReview() {
    if (cache.current === null || review.kind === 'running') return;
    controller.current?.stop();
    setEnabled(false);
    runner.current?.cancel();
    onReviewChange(null);
    try {
      const positions = reviewPositions(game);
      const next = new GameReviewRunner(positions,
        () => new Worker(engineWorkerUrl) as EngineWorker, cache.current,
        progress => setReview({ kind: 'running', progress }),
        evaluations => {
          try {
            const complete = buildGameReview(game, evaluations);
            setReview({ kind: 'complete', review: complete });
            onReviewChange(complete);
          }
          catch { setReview({ kind: 'error', message: 'The review did not match the saved game.' }); }
        },
        message => setReview({ kind: 'error', message }));
      runner.current = next;
      next.start();
    } catch { setReview({ kind: 'error', message: 'The saved main line could not be reviewed.' }); }
  }

  const evaluation = state.kind === 'done' && state.evaluation.fen === fen
    ? state.evaluation : null;
  const line = evaluation === null ? [] : variationSan(fen, evaluation.variation);

  return <section className="engine-panel" aria-label="Stockfish analysis">
    <div className="engine-heading">
      <strong>Stockfish</strong>
      <button type="button" className="secondary" aria-pressed={enabled}
        disabled={review.kind === 'running'}
        onClick={() => {
          if (enabled && state.kind === 'error') controller.current?.start(fen);
          else if (enabled) { controller.current?.stop(); setEnabled(false); }
          else { controller.current?.start(fen); setEnabled(true); }
        }}>{enabled ? state.kind === 'error' ? 'Retry engine' : 'Stop engine' : 'Start engine'}</button>
    </div>
    {enabled && state.kind === 'loading' && <span role="status">Loading engine…</span>}
    {enabled && state.kind === 'searching' && <span role="status">Evaluating position…</span>}
    {enabled && state.kind === 'error' && <span role="alert">{state.message}</span>}
    {enabled && evaluation !== null && <div className="engine-result" role="status">
      <span className="engine-score" aria-label={`Evaluation from White's perspective ${evaluationLabel(evaluation)}`}>
        {evaluationLabel(evaluation)}</span>
      <span>Best: {line[0] ?? (evaluation.bestMove === null ? 'No legal move' : evaluation.bestMove)}</span>
      <small>Depth {evaluation.depth}{state.kind === 'done' && state.cached ? ' · cached' : ''}</small>
      {line.length > 0 && <span className="engine-line" aria-label={`Principal variation ${line.join(' ')}`}>
        {line.join(' ')}</span>}
    </div>}
    <div className="review-control">
      <button type="button" className="secondary" onClick={() => {
        if (review.kind === 'running') {
          runner.current?.cancel(); setReview({ kind: 'cancelled' }); onReviewChange(null);
        } else startReview();
      }}>{review.kind === 'running' ? 'Cancel review'
          : review.kind === 'complete' ? 'Review again' : 'Review game'}</button>
      {review.kind === 'running' && <span role="status">
        {review.progress.completed} / {review.progress.total} positions
        {review.progress.cached > 0 ? ` · ${review.progress.cached} cached` : ''}
      </span>}
    </div>
    {review.kind === 'error' && <span role="alert">{review.message}</span>}
    {review.kind === 'complete' && <div className="review-results">
      <ReviewGraph review={review.review} selectedPly={selectedPly} onSelectPly={onSelectPly} />
      <small>White perspective · mate at graph edge · {reviewMethodVersion}</small>
      <div className="review-summary" aria-label="Review summary">
        {(['white', 'black'] as const).map(side => {
          const summary = reviewSummary(review.review, side);
          return <div key={side} className="review-player">
            <strong>{side === 'white' ? 'White' : 'Black'}</strong>
            <span>Average loss: {summary.averageLossCp === null ? '—' : `${summary.averageLossCp} cp`}</span>
            {(['inaccuracy', 'mistake', 'blunder'] as const).map(kind => {
              const matching = review.review.moves.find(move => move.side === side
                && move.label.toLowerCase() === kind);
              return <button key={kind} type="button" className={`review-count review-${kind}`}
                disabled={matching === undefined} onClick={() => matching && onSelectPly(matching.ply)}
                title={matching ? `Show first ${kind} by ${side}` : `No ${kind} moves by ${side}`}>
                {summary[kind]} {kind === 'inaccuracy' ? 'inaccuracies' : `${kind}s`}
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
    <a className="engine-credit" href="/engine/NOTICE.md" target="_blank" rel="noreferrer"
      title={`${engineBuild}, GPLv3. Runs in this browser.`}>Engine license and source</a>
  </section>;
}
