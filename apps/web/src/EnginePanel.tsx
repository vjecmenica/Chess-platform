import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameReadResponse } from '@chess/contracts';
import { EngineCache, EngineController,
  evaluationLabel, searchProfile, variationSan, type EngineEvaluation,
  type EngineLine, type EngineState, type MultiPvCount, type SearchLimits } from './engine-analysis';
import { buildGameReview, GameReviewRunner, graphCentipawns, nextReviewedMovePly, reviewMethodVersion, reviewSummary,
  reviewPositions, type GameReview, type ReviewProgress } from './game-review';
import { accuracyMethodVersion, type PlayerAccuracy } from './game-accuracy';
import { createInteractiveSettings, scheduleInteractiveEngine, toggleContinuousSettings, updateInteractiveSettings,
  type InteractiveSettingsState } from './interactive-engine';
import { MoveTimes } from './MoveTimes';
import { moveTimes } from './move-times';
import { createBrowserEngineWorker } from './browser-engine-worker';
import { browserSupportsEngineThreads, effectiveThreads, engineCacheIdentity, engineDescription, liteEngine, maximumEngineThreads,
  readEnginePreference, resolveEngine, saveEnginePreference, type EnginePreference } from './engine-builds';

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export type ReviewState = { readonly kind: 'idle' | 'cancelled' }
  | { readonly kind: 'running'; readonly progress: ReviewProgress }
  | { readonly kind: 'complete'; readonly review: GameReview }
  | { readonly kind: 'error'; readonly message: string };

/** Publish one lifecycle transition to both the panel and its parent's move annotations. */
export function publishReviewState(next: ReviewState, onState: (state: ReviewState) => void,
  onReport: (review: GameReview | null) => void) {
  onState(next);
  onReport(next.kind === 'complete' ? next.review : null);
}

export function AccuracyEstimate({ result }: { readonly result: PlayerAccuracy }) {
  const explanation = result.unavailable === 'no_moves' ? 'No moves by this player.'
    : result.unavailable === 'missing_evaluation' ? 'A complete set of valid evaluations is required.'
      : `Local engine estimate from ${result.moveCount} moves.`;
  return <span className="review-average" data-accuracy-method={result.method}
    title={`${result.method}. ${explanation}`}>
    <b aria-label={result.value === null ? `Accuracy unavailable. ${explanation}`
      : `Accuracy ${result.value.toFixed(1)} percent`}>{result.value === null ? '—' : `${result.value.toFixed(1)}%`}</b>
    <small>Local accuracy</small>
  </span>;
}
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
    <svg ref={graphRef} className="review-graph" viewBox={`0 0 ${width} 160`} preserveAspectRatio="none" role="group"
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

export function EngineToggle({ enabled, score, onToggle }: {
  enabled: boolean; score: string | null; onToggle: () => void;
}) {
  return <div className="engine-toggle-status">
    <button type="button" className="engine-toggle" role="switch" aria-checked={enabled}
      aria-label="Interactive engine" aria-description="Turn current-position evaluation on or off. Computer Analysis runs independently."
      onClick={onToggle}>
      <span className="engine-toggle-track" aria-hidden="true"><span>{enabled ? '✓' : ''}</span></span>
    </button>
    <strong className="engine-current-score" aria-label={score === null
      ? enabled ? 'Current position evaluation pending' : 'Interactive engine off'
      : `Current position, White perspective ${score}`}>{score ?? '—'}</strong>
  </div>;
}

export function currentEngineEvaluation(state: EngineState, fen: string): EngineEvaluation | null {
  return (state.kind === 'done' || state.kind === 'searching') && state.evaluation?.fen === fen
    ? state.evaluation : null;
}

export function EnginePanel({ game, fen, selectedPly, onSelectPly, onReviewChange,
  onEvaluationChange, onEvaluationPendingChange, reviewHost, sessionOnly = false }: {
  readonly game: GameReadResponse; readonly fen: string; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
  readonly onReviewChange: (review: GameReview | null) => void;
  readonly onEvaluationChange: (evaluation: EngineEvaluation | null) => void;
  readonly onEvaluationPendingChange?: (fen: string | null) => void;
  readonly reviewHost?: HTMLElement | null;
  readonly sessionOnly?: boolean;
}) {
  const [enabled, setEnabled] = useState(true);
  const [preference, setPreference] = useState(() => readEnginePreference(browserStorage()));
  const [fallback, setFallback] = useState(false);
  const [isolated] = useState(browserSupportsEngineThreads);
  const maxThreads = maximumEngineThreads(typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency);
  const variant = resolveEngine(fallback ? 'lite' : preference.choice, isolated);
  const threads = effectiveThreads(variant, preference.threads, maxThreads);
  const description = engineDescription(variant, threads);
  const [lineCount, setLineCount] = useState<MultiPvCount>(1);
  const [searchSettings, setSearchSettings] = useState(createInteractiveSettings);
  const { depth, timeMs, unlimitedDepth, unlimitedTime } = searchSettings.current;
  const continuous = unlimitedDepth && unlimitedTime;
  const [state, setState] = useState<EngineState>({ kind: 'off' });
  const [review, setReview] = useState<ReviewState>({ kind: 'idle' });
  const [reviewTab, setReviewTab] = useState<'computer' | 'times'>('computer');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<EngineController | null>(null);
  const runner = useRef<GameReviewRunner | null>(null);
  const cache = useRef<EngineCache | null>(null);
  const reviewCache = useRef<EngineCache | null>(null);
  const limits = interactiveLimits(unlimitedDepth ? null : depth, unlimitedTime ? null : timeMs);
  const profile = searchProfile(limits);
  const hasMoveTimes = useMemo(() => moveTimes(game).some(move => move.elapsedMs !== null), [game]);

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
    reviewCache.current = new EngineCache(sessionOnly ? undefined : browserStorage());
    return () => { runner.current?.cancel(); runner.current = null; reviewCache.current = null; };
  }, []);

  useEffect(() => {
    cache.current = new EngineCache(sessionOnly ? undefined : browserStorage(),
      engineCacheIdentity(variant, threads), description);
    onEvaluationChange(null);
    controller.current = new EngineController(
      () => createBrowserEngineWorker(variant.url), next => {
        if (next.kind === 'error' && variant.id !== liteEngine.id) {
          setState({ kind: 'loading' }); setFallback(true); onEvaluationChange(null);
        } else setState(next);
      }, cache.current, variant.multithreaded ? { threads } : {});
    controller.current.setLineCount(lineCount);
    const stopInteractive = scheduleInteractiveEngine(controller.current, fen, limits, enabled);
    return () => {
      stopInteractive(); controller.current = null;
      cache.current = null;
    };
  }, [variant.id, threads]);

  useEffect(() => { if (enabled) controller.current?.setPosition(fen); }, [enabled, fen]);
  useEffect(() => { onEvaluationChange(cache.current?.get(fen, lineCount, profile) ?? null); },
    [fen, lineCount, profile, variant.id, threads, onEvaluationChange]);

  function changeEngine(next: EnginePreference) {
    setPreference(next); saveEnginePreference(browserStorage(), next); setFallback(false);
    setState(enabled ? { kind: 'loading' } : { kind: 'off' }); onEvaluationChange(null);
  }

  function applySettings(next: InteractiveSettingsState) {
    setSearchSettings(next);
    const settings = next.current;
    controller.current?.setSearchLimits(interactiveLimits(
      settings.unlimitedDepth ? null : settings.depth, settings.unlimitedTime ? null : settings.timeMs));
    onEvaluationChange(null);
  }

  function updateLimits(nextDepth: number, nextTimeMs: number,
    nextUnlimitedDepth: boolean, nextUnlimitedTime: boolean) {
    applySettings(updateInteractiveSettings(searchSettings, { depth: nextDepth, timeMs: nextTimeMs,
      unlimitedDepth: nextUnlimitedDepth, unlimitedTime: nextUnlimitedTime }));
  }

  function toggleContinuous() {
    applySettings(toggleContinuousSettings(searchSettings));
    if (!continuous && (!enabled || state.kind === 'error')) {
      controller.current?.start(fen); setEnabled(true);
    }
  }

  function changeReview(next: ReviewState) {
    publishReviewState(next, setReview, onReviewChange);
  }

  function startReview() {
    if (reviewCache.current === null || review.kind === 'running') return;
    runner.current?.cancel();
    changeReview({ kind: 'running', progress: { completed: 0, total: game.history.length + 1, cached: 0 } });
    try {
      const positions = reviewPositions(game);
      const next = new GameReviewRunner(positions,
        () => createBrowserEngineWorker(liteEngine.url), reviewCache.current,
        progress => changeReview({ kind: 'running', progress }),
        evaluations => {
          try {
            const complete = buildGameReview(game, evaluations);
            changeReview({ kind: 'complete', review: complete });
          }
          catch { changeReview({ kind: 'error', message: 'The review did not match the saved game.' }); }
        },
        message => changeReview({ kind: 'error', message }));
      runner.current = next;
      next.start();
    } catch { changeReview({ kind: 'error', message: 'The saved main line could not be reviewed.' }); }
  }

  const evaluation = currentEngineEvaluation(state, fen);
  // Reuse SAN conversion when review progress or parent callbacks render this panel.
  const lines = useMemo(() => state.kind === 'searching' && state.fen === fen && state.lines
    ? state.lines.map(line => candidateLine(fen, line))
    : evaluation === null ? [] : candidateLines(evaluation), [state, fen, evaluation]);

  useEffect(() => { if (evaluation !== null) onEvaluationChange(evaluation); },
    [evaluation, onEvaluationChange]);
  useEffect(() => {
    onEvaluationPendingChange?.(evaluation === null && enabled && state.kind !== 'error' ? fen : null);
  }, [fen, enabled, state.kind, evaluation, onEvaluationPendingChange]);
  useEffect(() => () => onEvaluationPendingChange?.(null), [onEvaluationPendingChange]);

  return <section className="engine-panel" aria-label="Stockfish analysis">
    <div className="engine-heading">
      <EngineToggle enabled={enabled && state.kind !== 'error'}
        score={enabled ? lines.find(line => line.rank === 1)?.score ?? null : null}
        onToggle={() => {
          if (enabled && state.kind !== 'error') { controller.current?.stop(); setEnabled(false); }
          else { controller.current?.start(fen); setEnabled(true); }
        }} />
      <strong className="engine-panel-title">Engine Evaluation</strong>
      <button type="button" className="engine-settings-button" ref={settingsButtonRef}
        aria-label="Engine settings" aria-expanded={settingsOpen} aria-controls="engine-settings"
        onClick={() => setSettingsOpen(value => !value)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M9.5 2h5l.5 2.7 2 .9 2.4-1.3 2.5 4.4-2 1.8v2.4l2 1.8-2.5 4.4-2.4-1.3-2 .9-.5 2.7h-5L9 18.4l-2-.9-2.4 1.3-2.5-4.4 2-1.8v-2.4l-2-1.8 2.5-4.4L7 5.3l2-.9Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
    {settingsOpen && <div className="engine-settings-popover" id="engine-settings"
      role="dialog" aria-label="Engine settings" ref={settingsRef}>
      <div className="engine-settings-heading"><strong>Search settings</strong>
        <button type="button" className="secondary" onClick={() => {
          setSettingsOpen(false); settingsButtonRef.current?.focus();
        }}>Close</button></div>
      <label className="engine-line-setting">Engine
        <select aria-label="Analysis engine" aria-description="Applies to Engine Evaluation. Computer Analysis uses Stockfish 19 Lite."
          value={preference.choice} onChange={event => {
          changeEngine({ ...preference, choice: event.target.value === 'lite' ? 'lite' : 'full' });
        }}><option value="full">Stockfish 19 Full</option><option value="lite">Stockfish 19 Lite</option></select>
      </label>
      {variant.multithreaded && <label className="engine-range-setting engine-thread-setting">Threads
        <input type="range" aria-label="Engine threads" min="1" max={maxThreads} value={threads}
          disabled={maxThreads === 1} onChange={event => changeEngine({ ...preference, threads: Number(event.target.value) })} />
        <output>{threads}</output>
      </label>}
      {preference.choice === 'full' && !isolated && <small>Full single-threaded: browser isolation is unavailable.</small>}
      <label className="engine-line-setting">Lines
          <select value={lineCount}
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
            disabled={unlimitedDepth}
            onChange={event => updateLimits(Number(event.target.value), timeMs,
              unlimitedDepth, unlimitedTime)} />
          <output>{unlimitedDepth ? '—' : depth}</output>
        </label>
        <label className="engine-unlimited"><input type="checkbox" aria-label="Unlimited depth"
          checked={unlimitedDepth}
          onChange={event => updateLimits(depth, timeMs, event.target.checked, unlimitedTime)} />Unlimited</label>
      </div>
      <div className="engine-limit-setting">
        <label className="engine-range-setting">Search time
          <input type="range" min="200" max="30000" step="100" value={timeMs}
            disabled={unlimitedTime}
            onChange={event => updateLimits(depth, Number(event.target.value),
              unlimitedDepth, unlimitedTime)} />
          <output>{unlimitedTime ? '—' : `${(timeMs / 1000).toFixed(1)}s`}</output>
        </label>
        <label className="engine-unlimited"><input type="checkbox" aria-label="Unlimited search time"
          checked={unlimitedTime}
          onChange={event => updateLimits(depth, timeMs, unlimitedDepth, event.target.checked)} />Unlimited</label>
      </div>
    </div>
    <a className="engine-credit" href="/engine/NOTICE.md" target="_blank" rel="noreferrer"
      title={`${description}, GPLv3. Runs in this browser.`}>Engine license and source</a>
    </div>}
    <div className="engine-depth-row">
      <small className="engine-depth">Depth {evaluation?.depth ?? '—'}{state.kind === 'done' && state.cached ? ' · cached' : ''}</small>
      <button type="button" className="engine-continuous" aria-label="Continuous analysis" aria-pressed={continuous}
        aria-description="Analyze without a depth or time limit. Activate again to restore the previous bounded limits."
        onClick={toggleContinuous}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden="true" focusable="false"><path d="M8 2v12M2 8h12" /></svg>
      </button>
      {state.kind === 'searching' && <small className="engine-search-status">{continuous ? 'Continuous' : 'Searching'}</small>}
      <small className="engine-build">{description}</small>
    </div>
    {fallback && <div className="engine-fallback" role="status">Full could not run. Using Stockfish 19 Lite.
      <button type="button" className="secondary" onClick={() => {
        setState({ kind: 'loading' }); setFallback(false); setEnabled(true);
      }}>Retry Full</button></div>}
    {!enabled && <p className="engine-idle">Evaluate the selected position with Stockfish in this browser.</p>}
    {enabled && state.kind === 'loading' && <div className="engine-loading" role="status">
      <span>Loading {variant === liteEngine ? 'Lite' : 'Full'}{state.progress === undefined ? '…' : ` · ${state.progress}%`}</span>
      <progress aria-label="Engine download" max="100" value={state.progress} />
    </div>}
    {enabled && state.kind === 'error' && <span role="alert">{state.message}</span>}
    {enabled && (state.kind === 'searching' || state.kind === 'done') &&
      <div className="engine-result" role="group" aria-label="Engine lines">
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
    <div className="review-heading"><strong>Computer Analysis</strong>
    {reviewTab === 'computer' && <div className="review-control">
      <button type="button" className={review.kind === 'running' ? 'secondary' : 'primary'} disabled={game.history.length === 0} onClick={() => {
        if (review.kind === 'running') {
          runner.current?.cancel(); changeReview({ kind: 'cancelled' });
        } else startReview();
      }}>{review.kind === 'running' ? 'Cancel analysis'
          : review.kind === 'complete' ? 'Analyze again' : 'Analyze game'}</button>
      {review.kind === 'running' && <span role="status">
        {review.progress.completed} / {review.progress.total} positions
        {review.progress.cached > 0 ? ` · ${review.progress.cached} cached` : ''}
      </span>}
    </div>}
    </div>
    <div className="review-tabs" role="tablist" aria-label="Game analysis views"
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'ArrowRight' ? 'times' : 'computer';
        if (next === 'times' && !hasMoveTimes) return;
        setReviewTab(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`[aria-controls="${next === 'times'
          ? 'move-times-view' : 'computer-analysis-view'}"]`)?.focus();
      }}>
      <button type="button" role="tab" aria-selected={reviewTab === 'computer'}
        aria-controls="computer-analysis-view" tabIndex={reviewTab === 'computer' ? 0 : -1}
        onClick={() => setReviewTab('computer')}>Computer Analysis</button>
      <button type="button" role="tab" aria-selected={reviewTab === 'times'}
        aria-controls="move-times-view" tabIndex={reviewTab === 'times' ? 0 : -1} disabled={!hasMoveTimes}
        aria-description={hasMoveTimes ? 'View recorded move durations' : 'No move durations can be calculated from this game'}
        onClick={() => setReviewTab('times')}>Move times</button>
    </div>
    <div id="move-times-view" role="tabpanel" aria-label="Move times" hidden={reviewTab !== 'times'}>
      {reviewTab === 'times' && <MoveTimes game={game} selectedPly={selectedPly} onSelectPly={onSelectPly} />}
    </div>
    <div id="computer-analysis-view" role="tabpanel" aria-label="Computer Analysis"
      hidden={reviewTab !== 'computer'}>
    <small className="review-engine">Stockfish 19 Lite · 1 thread · depth 14 / 1.2s per position</small>
    {review.kind === 'error' && <span role="alert">{review.message}</span>}
    {review.kind === 'complete' && <div className="review-results">
      <ReviewGraph review={review.review} selectedPly={selectedPly} onSelectPly={onSelectPly} />
      <small className="review-scale" title={`White perspective; nonlinear scale; mate at the graph edge. ${reviewMethodVersion}`}>White perspective · ±10 pawns</small>
      <div className="review-summary" aria-label="Computer Analysis summary">
        {(['white', 'black'] as const).map(side => {
          const summary = reviewSummary(review.review, side);
          return <div key={side} className="review-player">
            <strong>{side === 'white' ? 'White' : 'Black'}</strong>
            <AccuracyEstimate result={review.review.accuracy[side]} />
            <span className="review-average"><b>{summary.averageLossCp === null ? '—'
              : `${summary.averageLossCp} cp`}</b><small>Average centipawn loss</small></span>
            {(['inaccuracy', 'mistake', 'blunder'] as const).map(kind => {
              const label = (kind[0]!.toUpperCase() + kind.slice(1)) as 'Inaccuracy' | 'Mistake' | 'Blunder';
              const next = nextReviewedMovePly(review.review, side, label, selectedPly);
              return <button key={kind} type="button" className={`review-count review-${kind}`}
                disabled={next === null} onClick={() => { if (next !== null) onSelectPly(next); }}
                aria-description={next === null ? `No ${kind} moves by ${side}` : `Show next ${kind} by ${side}`}>
                <strong>{summary[kind]}</strong>
                <span>{kind === 'inaccuracy' ? 'inaccuracies' : `${kind}s`}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
      <small className="review-method" title="Accuracy is a local engine estimate, not an Elo rating or a measure of established strength.">Local engine estimate · {' '}
        <a href="https://github.com/vjecmenica/Chess-platform/blob/main/docs/accuracy-method.md"
          target="_blank" rel="noreferrer" aria-label={`Accuracy methodology: ${accuracyMethodVersion}`}>Methodology</a>
      </small>
    </div>}
    </div>
    </div>, reviewHost)}
  </section>;
}
