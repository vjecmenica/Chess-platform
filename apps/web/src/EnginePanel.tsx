import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameReadResponse } from '@chess/contracts';
import { EngineCache, EngineController, engineBuild, engineWorkerUrl,
  defaultSearchLimits, evaluationLabel, searchProfile, variationSan, type EngineEvaluation,
  type EngineLine, type EngineState, type EngineWorker, type MultiPvCount, type SearchLimits } from './engine-analysis';
import { buildGameReview, GameReviewRunner, graphCentipawns, nextReviewedMovePly, reviewMethodVersion, reviewSummary,
  reviewPositions, type GameReview, type ReviewProgress } from './game-review';

type ReviewState = { readonly kind: 'idle' | 'cancelled' }
  | { readonly kind: 'running'; readonly progress: ReviewProgress }
  | { readonly kind: 'complete'; readonly review: GameReview }
  | { readonly kind: 'error'; readonly message: string };
export function interactiveLimits(depth: number | null, timeMs: number | null): SearchLimits {
  return depth === null && timeMs === null ? { mode: 'infinite' }
    : { mode: 'bounded', depth, timeMs };
}

export function candidateLines(evaluation: EngineEvaluation):
  { rank: number; score: string; san: string[] }[] {
  const lines = evaluation.lines ?? [{ rank: 1, score: evaluation.score,
    variation: evaluation.variation }];
  return lines.map(line => candidateLine(evaluation.fen, line, evaluation.bestMove));
}

function candidateLine(fen: string, line: EngineLine, bestMove: string | null = null) {
  return { rank: line.rank, score: evaluationLabel({ fen, depth: 0, score: line.score,
    bestMove, variation: line.variation }),
  san: variationSan(fen, line.variation.length === 0 && line.rank === 1 && bestMove !== null
    ? [bestMove] : line.variation) };
}

export function engineLineRows<T extends { rank: number }>(lines: readonly T[], count: MultiPvCount):
  (T | null)[] {
  return Array.from({ length: count }, (_, index) => lines.find(line => line.rank === index + 1) ?? null);
}

export function reviewGraphX(index: number, count: number, width: number): number {
  return 10 + index * (width - 20) / Math.max(1, count - 1);
}

export function reviewGraphY(whiteCentipawns: number): number {
  return 80 - Math.asinh(whiteCentipawns / 120) / Math.asinh(1000 / 120) * 70;
}

export function reviewPositionText(review: GameReview, index: number): string {
  const evaluation = review.evaluations[index];
  if (!evaluation) return '';
  const move = review.moves[index - 1];
  const position = index === 0 ? 'Initial position'
    : `After ${Math.ceil(index / 2)}${index % 2 === 0 ? '...' : '.'} ${move?.san ?? ''}`;
  const score = evaluation.score.kind === 'mate' && evaluation.score.value === 0
    ? `${graphCentipawns(evaluation) > 0 ? 'White' : 'Black'} wins by mate`
    : evaluationLabel(evaluation);
  return `${position} · Stockfish: ${score}`;
}

export function reviewAdvantageSegments(scores: readonly number[], width: number):
  { side: 'white' | 'black'; points: string }[] {
  const segments: { side: 'white' | 'black'; points: string }[] = [];
  const x = (index: number) => reviewGraphX(index, scores.length, width);
  const add = (side: 'white' | 'black', x1: number, y1: number, x2: number, y2: number) => {
    segments.push({ side, points: `${x1},80 ${x1},${y1} ${x2},${y2} ${x2},80` });
  };
  for (let index = 0; index < scores.length - 1; index++) {
    const x1 = x(index), x2 = x(index + 1);
    const y1 = reviewGraphY(scores[index]!), y2 = reviewGraphY(scores[index + 1]!);
    if (y1 === 80 && y2 === 80) continue;
    if ((y1 <= 80 && y2 <= 80) || (y1 >= 80 && y2 >= 80)) {
      add((y1 + y2) / 2 < 80 ? 'white' : 'black', x1, y1, x2, y2);
    } else {
      const crossing = Math.round((x1 + (80 - y1) / (y2 - y1) * (x2 - x1)) * 1000) / 1000;
      add(y1 < 80 ? 'white' : 'black', x1, y1, crossing, 80);
      add(y2 < 80 ? 'white' : 'black', crossing, 80, x2, y2);
    }
  }
  return segments;
}

export function ReviewGraph({ review, selectedPly, onSelectPly }: {
  readonly review: GameReview; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
}) {
  const graphRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(320);
  const [hoveredPly, setHoveredPly] = useState<number | null>(null);
  useEffect(() => {
    const element = graphRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const x = (index: number) => reviewGraphX(index, review.evaluations.length, width);
  const y = (evaluation: GameReview['evaluations'][number]) =>
    reviewGraphY(graphCentipawns(evaluation));
  const points = review.evaluations.map((evaluation, index) => `${x(index)},${y(evaluation)}`).join(' ');
  const selected = selectedPly === null ? null : review.evaluations[selectedPly];
  const fills = reviewAdvantageSegments(review.evaluations.map(graphCentipawns), width);
  return <div className="review-graph-wrap">
    <svg ref={graphRef} className="review-graph" viewBox={`0 0 ${width} 160`} role="group"
    aria-label="White-perspective evaluation by half-move, nonlinear scale clipped at plus or minus ten pawns; mate at the edge">
    {fills.map((fill, index) => <polygon key={index} points={fill.points}
      className={`review-fill-${fill.side}`} />)}
    <line x1="10" x2={width - 10} y1="80" y2="80" className="review-zero" />
    <polyline points={points} fill="none" className="review-plot-outline" />
    <polyline points={points} fill="none" className="review-plot" />
    {review.evaluations.map((_, index) => {
      const left = index === 0 ? 0 : (x(index - 1) + x(index)) / 2;
      const right = index === review.evaluations.length - 1 ? width
        : (x(index) + x(index + 1)) / 2;
      return <rect key={index} x={left} y="0" width={right - left}
        height="160" className="review-hit"
        role="button" tabIndex={0} aria-label={`Show ${reviewPositionText(review, index)}`}
        onPointerEnter={() => setHoveredPly(index)} onFocus={() => setHoveredPly(index)}
        onPointerLeave={() => setHoveredPly(current => current === index ? null : current)}
        onBlur={() => setHoveredPly(current => current === index ? null : current)}
        onClick={() => onSelectPly(index)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); onSelectPly(index);
        } }} />;
    })}
    {hoveredPly !== null && <line x1={x(hoveredPly)} x2={x(hoveredPly)} y1="8" y2="152"
      className="review-hover-line" />}
    {selected && <circle cx={x(selectedPly!)} cy={y(selected)} r="3" className="review-selected" />}
    </svg>
    {hoveredPly !== null && <span className="review-tooltip" role="tooltip"
      style={{ left: `${Math.max(13, Math.min(87, x(hoveredPly) / width * 100))}%` }}>
      {reviewPositionText(review, hoveredPly)}
    </span>}
  </div>;
}

export function EnginePanel({ game, fen, selectedPly, onSelectPly, onReviewChange,
  onEvaluationChange, reviewHost }: {
  readonly game: GameReadResponse; readonly fen: string; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
  readonly onReviewChange: (review: GameReview | null) => void;
  readonly onEvaluationChange: (evaluation: EngineEvaluation | null) => void;
  readonly reviewHost?: HTMLElement | null;
}) {
  const [enabled, setEnabled] = useState(false);
  const [lineCount, setLineCount] = useState<MultiPvCount>(1);
  const [depth, setDepth] = useState(defaultSearchLimits.mode === 'bounded'
    ? defaultSearchLimits.depth ?? 14 : 14);
  const [timeMs, setTimeMs] = useState(defaultSearchLimits.mode === 'bounded'
    ? defaultSearchLimits.timeMs ?? 1200 : 1200);
  const [unlimitedDepth, setUnlimitedDepth] = useState(false);
  const [unlimitedTime, setUnlimitedTime] = useState(false);
  const [state, setState] = useState<EngineState>({ kind: 'off' });
  const [review, setReview] = useState<ReviewState>({ kind: 'idle' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<EngineController | null>(null);
  const runner = useRef<GameReviewRunner | null>(null);
  const cache = useRef<EngineCache | null>(null);
  const limits = interactiveLimits(unlimitedDepth ? null : depth, unlimitedTime ? null : timeMs);
  const profile = searchProfile(limits);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)
        && !settingsButtonRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [settingsOpen]);

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
  useEffect(() => { onEvaluationChange(cache.current?.get(fen, lineCount, profile) ?? null); },
    [fen, lineCount, profile, onEvaluationChange]);

  function updateLimits(nextDepth: number, nextTimeMs: number,
    nextUnlimitedDepth: boolean, nextUnlimitedTime: boolean) {
    setDepth(nextDepth); setTimeMs(nextTimeMs);
    setUnlimitedDepth(nextUnlimitedDepth); setUnlimitedTime(nextUnlimitedTime);
    controller.current?.setSearchLimits(interactiveLimits(
      nextUnlimitedDepth ? null : nextDepth, nextUnlimitedTime ? null : nextTimeMs));
    onEvaluationChange(null);
  }

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

  const evaluation = (state.kind === 'done' || state.kind === 'searching')
    && state.evaluation?.fen === fen
    ? state.evaluation : null;
  const lines = state.kind === 'searching' && state.fen === fen && state.lines
    ? state.lines.map(line => candidateLine(fen, line))
    : evaluation === null ? [] : candidateLines(evaluation);

  useEffect(() => { if (evaluation !== null) onEvaluationChange(evaluation); },
    [evaluation, onEvaluationChange]);

  return <section className="engine-panel" aria-label="Stockfish analysis">
    <div className="engine-heading">
      <strong>Stockfish</strong>
      <div className="engine-heading-actions">
        <button type="button" className="secondary" ref={settingsButtonRef}
          aria-label="Engine settings" aria-expanded={settingsOpen} aria-controls="engine-settings"
          onClick={() => setSettingsOpen(value => !value)}>Settings</button>
        <button type="button" className="secondary" aria-pressed={enabled}
          disabled={review.kind === 'running'}
          onClick={() => {
            if (enabled && state.kind === 'error') controller.current?.start(fen);
            else if (enabled) { controller.current?.stop(); setEnabled(false); }
            else { controller.current?.start(fen); setEnabled(true); }
          }}>{enabled ? state.kind === 'error' ? 'Retry engine' : 'Stop engine' : 'Start engine'}</button>
      </div>
    </div>
    {settingsOpen && <div className="engine-settings-popover" id="engine-settings"
      role="dialog" aria-label="Engine settings" ref={settingsRef}>
      <div className="engine-settings-heading"><strong>Search settings</strong>
        <button type="button" className="secondary" onClick={() => {
          setSettingsOpen(false); settingsButtonRef.current?.focus();
        }}>Close</button></div>
      <label className="engine-line-setting">Lines
          <select value={lineCount} disabled={review.kind === 'running'}
            aria-label="Candidate lines" onChange={event => {
              const count = Number(event.target.value) as MultiPvCount;
              setLineCount(count);
              controller.current?.setLineCount(count);
              onEvaluationChange(null);
            }}>
            {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
    <div className="engine-search-settings" role="group" aria-label="Interactive search limits">
      <div className="engine-limit-setting">
        <label className="engine-range-setting">Depth
          <input type="range" min="1" max="40" value={depth}
            disabled={unlimitedDepth || review.kind === 'running'}
            onChange={event => updateLimits(Number(event.target.value), timeMs,
              unlimitedDepth, unlimitedTime)} />
          <output>{unlimitedDepth ? '—' : depth}</output>
        </label>
        <label className="engine-unlimited"><input type="checkbox" aria-label="Unlimited depth"
          checked={unlimitedDepth} disabled={review.kind === 'running'}
          onChange={event => updateLimits(depth, timeMs, event.target.checked, unlimitedTime)} />Unlimited</label>
      </div>
      <div className="engine-limit-setting">
        <label className="engine-range-setting">Search time
          <input type="range" min="200" max="30000" step="100" value={timeMs}
            disabled={unlimitedTime || review.kind === 'running'}
            onChange={event => updateLimits(depth, Number(event.target.value),
              unlimitedDepth, unlimitedTime)} />
          <output>{unlimitedTime ? '—' : `${(timeMs / 1000).toFixed(1)}s`}</output>
        </label>
        <label className="engine-unlimited"><input type="checkbox" aria-label="Unlimited search time"
          checked={unlimitedTime} disabled={review.kind === 'running'}
          onChange={event => updateLimits(depth, timeMs, unlimitedDepth, event.target.checked)} />Unlimited</label>
      </div>
    </div>
    <a className="engine-credit" href="/engine/NOTICE.md" target="_blank" rel="noreferrer"
      title={`${engineBuild}, GPLv3. Runs in this browser.`}>Engine license and source</a>
    </div>}
    {enabled && state.kind === 'loading' && <span role="status">Loading engine…</span>}
    {enabled && state.kind === 'error' && <span role="alert">{state.message}</span>}
    {enabled && (state.kind === 'searching' || state.kind === 'done') &&
      <div className="engine-result" role="group" aria-label="Engine lines">
      <small className="engine-depth">Depth {evaluation?.depth ?? '—'}
        {state.kind === 'done' && state.cached ? ' · cached'
          : state.kind === 'searching' ? ' · searching' : ''}</small>
      {engineLineRows(lines, lineCount).map((line, index) => {
        const rank = index + 1;
        return line ? <div className="engine-candidate" key={rank}
          title={line.san.join(' ') || 'No legal move'}
          aria-label={`Line ${rank}, White perspective ${line.score}, ${line.san.join(' ') || 'no legal move'}`}>
          <span className="engine-rank">{rank}.</span>
          <span className="engine-score">{line.score}</span>
          <span className="engine-line">{line.san.length === 0 ? 'No legal move' : <>
            <strong className="engine-first-move">{line.san[0]}</strong>
            {line.san.length > 1 ? ` ${line.san.slice(1).join(' ')}` : ''}</>}</span>
        </div> : <div className="engine-candidate engine-candidate-pending" key={rank}
          aria-label={`Line ${rank}, waiting for Stockfish`}>
          <span className="engine-rank">{rank}.</span><span className="engine-score">—</span>
          <span className="engine-line">Pending…</span>
        </div>;
      })}
    </div>}
    {reviewHost && createPortal(<div className="review-content">
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
      <small>White perspective · nonlinear display scale · mate at graph edge · {reviewMethodVersion}</small>
      <div className="review-summary" aria-label="Review summary">
        {(['white', 'black'] as const).map(side => {
          const summary = reviewSummary(review.review, side);
          return <div key={side} className="review-player">
            <strong>{side === 'white' ? 'White' : 'Black'}</strong>
            <span className="review-average"><b>{summary.averageLossCp === null ? '—'
              : `${summary.averageLossCp} cp`}</b><small>Average centipawn loss</small></span>
            {(['inaccuracy', 'mistake', 'blunder'] as const).map(kind => {
              const label = (kind[0]!.toUpperCase() + kind.slice(1)) as 'Inaccuracy' | 'Mistake' | 'Blunder';
              const next = nextReviewedMovePly(review.review, side, label, selectedPly);
              return <button key={kind} type="button" className={`review-count review-${kind}`}
                disabled={next === null} onClick={() => { if (next !== null) onSelectPly(next); }}
                title={next === null ? `No ${kind} moves by ${side}` : `Show next ${kind} by ${side}`}>
                <strong>{summary[kind]}</strong>
                <span>{kind === 'inaccuracy' ? 'inaccuracies' : `${kind}s`}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
    </div>, reviewHost)}
  </section>;
}
