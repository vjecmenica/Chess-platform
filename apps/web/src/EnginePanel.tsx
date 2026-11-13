import {useSettings} from './SettingsDialog';
import {readSettings, settingsChanged, settingsKey, setRuntimeSettings} from './settings-store';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameReadResponse, GameSide } from '@chess/contracts';
import { EngineVariation } from './EngineVariation';
import { ThreatControl } from './ThreatControl';
import { engineVariation, createEngineVariationReader } from './engine-variation';
import { createEngineStatePublisher } from './engine-ui-updates';
import { EngineCache, EngineController,
  evaluationLabel, searchProfile, type EngineEvaluation,
  type EngineLine, type EngineState, type MultiPvCount, type SearchLimits } from './engine-analysis';
import { buildGameReview, GameReviewRunner, graphCentipawns, nextReviewedMovePly, reviewMethodVersion, reviewSummary,
  reviewPositions, type GameReview, type ReviewProgress } from './game-review';
import { accuracyMethodVersion, type PlayerAccuracy } from './game-accuracy';
import {
  scheduleInteractiveEngine, toggleContinuousSettings,
  type InteractiveSettingsState } from './interactive-engine';
import { MoveTimes } from './MoveTimes';
import { moveTimes } from './move-times';
import { createBrowserEngineWorker } from './browser-engine-worker';
import { engineBestMove, type EngineBestMove } from './engine-board';
import { browserEngineThreadCapabilities, engineThreadFailure, effectiveThreads, engineCacheIdentity, engineDescription, liteEngine, maximumEngineThreads,
  resolveEngine, type EnginePreference } from './engine-builds';

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

export function candidateLines(evaluation: EngineEvaluation, readVariation = engineVariation):
  ReturnType<typeof candidateLine>[] {
  const lines = evaluation.lines ?? [{ rank: 1, score: evaluation.score,
    variation: evaluation.variation }];
  return lines.map(line => candidateLine(evaluation.fen, line, evaluation.bestMove, readVariation));
}

export function EngineScoreBadge({ score, whiteToMove }: { score: string; whiteToMove?: boolean }) {
  const blackAhead = score === 'Mate' ? whiteToMove === true : /^(?:Mate )?-/.test(score);
  return <span className="engine-score engine-score-badge" data-side={blackAhead ? 'black' : 'white'}>{score}</span>;
}

function candidateLine(fen: string, line: EngineLine, bestMove: string | null = null, readVariation = engineVariation) {
  const moves = readVariation(fen, line.variation.length === 0 && line.rank === 1 && bestMove !== null
    ? [bestMove] : line.variation);
  return { rank: line.rank, score: evaluationLabel({ fen, depth: 0, score: line.score,
    bestMove, variation: line.variation }),
  san: moves.map(move => move.san), moves };
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

export function EngineToggle({ enabled, onToggle }: {
  enabled: boolean; onToggle: () => void;
}) {
  return <button type="button" className="engine-toggle" role="switch" aria-checked={enabled}
      aria-label="Interactive engine" aria-description="Turn current-position evaluation on or off. Computer Analysis runs independently."
      onClick={onToggle}>
      <span className="engine-toggle-track" aria-hidden="true"><span>{enabled ? '✓' : ''}</span></span>
    </button>;
}
export function currentEngineEvaluation(state: EngineState, fen: string): EngineEvaluation | null {
  return (state.kind === 'done' || state.kind === 'searching') && state.evaluation?.fen === fen
    ? state.evaluation : null;
}

export function EnginePanel({ game, fen, selectedPly, onSelectPly, onReviewChange,
  onEvaluationChange, onEvaluationPendingChange, onBestMoveChange, onThreatMoveChange, onExploreLine, orientation = 'white', reviewHost, sessionOnly = false }: {
  readonly game: GameReadResponse; readonly fen: string; readonly selectedPly: number | null;
  readonly onSelectPly: (ply: number) => void;
  readonly onReviewChange: (review: GameReview | null) => void;
  readonly onEvaluationChange: (evaluation: EngineEvaluation | null) => void;
  readonly onEvaluationPendingChange?: (fen: string | null) => void;
  readonly onBestMoveChange?: (move: EngineBestMove | null) => void;
  readonly onThreatMoveChange?: (move: EngineBestMove | null) => void;
  readonly onExploreLine?: (rootFen: string, moves: readonly string[]) => void;
  readonly orientation?: GameSide;
  readonly reviewHost?: HTMLElement | null;
  readonly sessionOnly?: boolean;
}) {
  const [enabled, setEnabled] = useState(true);
  const [engineEpoch, setEngineEpoch] = useState(0);
  const [preference, setPreference] = useState(() => readSettings().preference);
  const [fallback, setFallback] = useState(false);
  const [capabilities] = useState(browserEngineThreadCapabilities);
  const threadFailure = engineThreadFailure(capabilities);
  const isolated = threadFailure === null;
  const maxThreads = maximumEngineThreads(typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency);
  const variant = resolveEngine(fallback ? 'lite' : preference.choice, isolated);
  const threads = effectiveThreads(variant, preference.threads, maxThreads);
  const description = engineDescription(variant, threads);
  const [lineCount, setLineCount] = useState<MultiPvCount>(()=>readSettings().lines);
  const [searchSettings, setSearchSettings] = useState(()=>readSettings().search);
  const { depth, timeMs, unlimitedDepth, unlimitedTime } = searchSettings.current;
  const continuous = unlimitedDepth && unlimitedTime;
  const [state, setState] = useState<EngineState>({ kind: 'off' });
  const [readVariation] = useState(() => createEngineVariationReader());
  const [review, setReview] = useState<ReviewState>({ kind: 'idle' });
  const [reviewTab, setReviewTab] = useState<'computer' | 'times'>('computer');
  const {open: openSettings, isOpen: settingsOpen} = useSettings();
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<EngineController | null>(null);
  const runner = useRef<GameReviewRunner | null>(null);
  const cache = useRef<EngineCache | null>(null);
  const reviewCache = useRef<EngineCache | null>(null);
  const limits = interactiveLimits(unlimitedDepth ? null : depth, unlimitedTime ? null : timeMs);
  const profile = searchProfile(limits);
  const hasMoveTimes = useMemo(() => moveTimes(game).some(move => move.elapsedMs !== null), [game]);

  useEffect(() => {
    runner.current?.cancel();
    runner.current = null;
    reviewCache.current = new EngineCache(sessionOnly ? undefined : browserStorage(),
      engineCacheIdentity(variant, threads), description);
    changeReview({ kind: 'idle' });
    return () => { runner.current?.cancel(); runner.current = null; reviewCache.current = null; };
  }, [variant.id, threads, sessionOnly]);

  useEffect(() => {
    cache.current = new EngineCache(sessionOnly ? undefined : browserStorage(),
      engineCacheIdentity(variant, threads), description);
    onEvaluationChange(null);
    const output = createEngineStatePublisher(setState);
    controller.current = new EngineController(
      () => createBrowserEngineWorker(variant.url), next => {
        if (next.kind === 'error' && variant.id !== liteEngine.id) {
          output.push({ kind: 'loading' }); setFallback(true); onEvaluationChange(null);
        } else output.push(next);
      }, cache.current, variant.multithreaded ? { threads } : {});
    controller.current.setLineCount(lineCount);
    const stopInteractive = scheduleInteractiveEngine(controller.current, fen, limits, enabled);
    return () => {
      stopInteractive(); output.cancel(); controller.current = null;
      cache.current = null;
    };
  }, [variant.id, threads]);

  useEffect(() => { if (enabled) controller.current?.setPosition(fen); }, [enabled, fen]);
  useEffect(() => { onEvaluationChange(cache.current?.get(fen, lineCount, profile) ?? null); },
    [fen, lineCount, profile, variant.id, threads, onEvaluationChange]);

  function changeEngine(next: EnginePreference) {
    setPreference(next); setFallback(false);
    setState(enabled ? { kind: 'loading' } : { kind: 'off' }); onEvaluationChange(null);
  }

  function applySettings(next: InteractiveSettingsState) {
    setEngineEpoch(value => value + 1);
    setSearchSettings(next);
    const settings = next.current;
    controller.current?.setSearchLimits(interactiveLimits(
      settings.unlimitedDepth ? null : settings.depth, settings.unlimitedTime ? null : settings.timeMs));
    onEvaluationChange(null);
  }

  useEffect(() => {
    setRuntimeSettings(()=>({preference,lineCount,searchSettings}));
  }, [preference,lineCount,searchSettings]);
  const syncSettings = useRef(()=>{});
  syncSettings.current=()=>{const next=readSettings(true); if(JSON.stringify(next.preference)!==JSON.stringify(preference))changeEngine(next.preference); setLineCount(next.lines); controller.current?.setLineCount(next.lines); applySettings(next.search);};
  useEffect(() => {
    const sync=()=>syncSettings.current();
    const storage=(e:StorageEvent)=>{if(e.key===settingsKey)sync();};
    window.addEventListener(settingsChanged,sync); window.addEventListener('storage',storage);
    return ()=>{setRuntimeSettings(null);window.removeEventListener(settingsChanged,sync);window.removeEventListener('storage',storage);};
  }, []);
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
        () => createBrowserEngineWorker(variant.url), reviewCache.current,
        progress => changeReview({ kind: 'running', progress }),
        evaluations => {
          try {
            const complete = buildGameReview(game, evaluations);
            changeReview({ kind: 'complete', review: complete });
          }
          catch { changeReview({ kind: 'error', message: 'The review did not match the saved game.' }); }
        },
        message => changeReview({ kind: 'error', message }),
        variant.multithreaded ? { threads } : {});
      runner.current = next;
      next.start();
    } catch { changeReview({ kind: 'error', message: 'The saved main line could not be reviewed.' }); }
  }

  const evaluation = currentEngineEvaluation(state, fen);
  const bestMove = useMemo(() => engineBestMove(state, fen, game.id, enabled), [state, fen, game.id, enabled]);
  useLayoutEffect(() => { onBestMoveChange?.(bestMove); },
    [bestMove?.gameId, bestMove?.fen, bestMove?.from, bestMove?.to, onBestMoveChange]);
  useEffect(() => () => onBestMoveChange?.(null), [onBestMoveChange]);
  // Reuse SAN conversion when review progress or parent callbacks render this panel.
  const lines = useMemo(() => state.kind === 'searching' && state.fen === fen && state.lines
    ? state.lines.map(line => candidateLine(fen, line, null, readVariation))
    : evaluation === null ? [] : candidateLines(evaluation, readVariation), [state, fen, evaluation, readVariation]);

  useEffect(() => { if (evaluation !== null) onEvaluationChange(evaluation); },
    [evaluation, onEvaluationChange]);
  useEffect(() => {
    onEvaluationPendingChange?.(evaluation === null && enabled && state.kind !== 'error' ? fen : null);
  }, [fen, enabled, state.kind, evaluation, onEvaluationPendingChange]);
  useEffect(() => () => onEvaluationPendingChange?.(null), [onEvaluationPendingChange]);

  const engineAvailable = enabled && state.kind !== 'error';
  return <section className="engine-panel" aria-label="Stockfish analysis">
    <ThreatControl fen={fen} gameId={game.id}
      selected={variant}
      requestKey={`${variant.id}:${threads}:${lineCount}:${profile}:${engineEpoch}`}
      available={engineAvailable}
      reviewing={review.kind === 'running'} onMove={onThreatMoveChange}
      renderToolbar={threatToggle => <div className="engine-depth-row">
      <div className="engine-search-controls">
        <EngineToggle enabled={engineAvailable} onToggle={() => {
          setEngineEpoch(value => value + 1);
          if (engineAvailable) { controller.current?.stop(); setEnabled(false); }
          else { controller.current?.start(fen); setEnabled(true); }
        }} />
        <small className="engine-depth">Depth {evaluation?.depth ?? '—'}
          {state.kind === 'done' && state.cached ? ' · cached' : ''}
          {state.kind === 'searching' && <span className="engine-search-status"> · {continuous ? 'Continuous' : 'Searching'}</span>}
        </small>
        {engineAvailable && <><button type="button" className="engine-continuous" aria-label="Continuous analysis" aria-pressed={continuous}
          aria-description="Analyze without a depth or time limit. Activate again to restore the previous bounded limits."
          onClick={toggleContinuous}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
            aria-hidden="true" focusable="false">{continuous ? <path d="M5 3v10M11 3v10" strokeWidth="3"/> : <path d="M8 2v12M2 8h12" />}</svg>
        </button>
        {threatToggle}</>}
      </div>
      <div className="engine-build-controls">
        <small className="engine-build">{description}</small>
        <button type="button" className="engine-settings-button" ref={settingsButtonRef}
          aria-label="Engine settings" aria-expanded={settingsOpen} aria-controls="engine-settings"
          onClick={() => openSettings('engine')}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M9.5 2h5l.5 2.7 2 .9 2.4-1.3 2.5 4.4-2 1.8v2.4l2 1.8-2.5 4.4-2.4-1.3-2 .9-.5 2.7h-5L9 18.4l-2-.9-2.4 1.3-2.5-4.4 2-1.8v-2.4l-2-1.8 2.5-4.4L7 5.3l2-.9Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>} />
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
          aria-label={`Line ${rank}, White perspective ${line.score}, ${line.san.join(' ') || 'no legal move'}`}>
          <span className="engine-rank">{rank}.</span>
          <EngineScoreBadge score={line.score} whiteToMove={fen.split(' ')[1] === 'w'} />
          <EngineVariation key={`${game.id}:${fen}`} fen={fen} moves={line.moves} orientation={orientation} onExplore={onExploreLine} />
        </div> : <div className="engine-candidate engine-candidate-pending" key={rank}
          aria-label={`Line ${rank}, waiting for Stockfish`}>
          <span className="engine-rank">{rank}.</span><span className="engine-score">—</span>
          <span className="engine-line">Pending…</span>
        </div>;
      })}
    </div>}
    {reviewHost && createPortal(<div className="review-content">
    <div className="review-toolbar">
      <div className="review-tabs analysis-view-tabs" role="group" aria-label="Game analysis views">
        <button type="button" id="computer-analysis-button" aria-pressed={reviewTab === 'computer'}
          aria-controls="computer-analysis-view"
          onClick={() => setReviewTab('computer')}>Evaluation</button>
        <button type="button" id="move-times-button" aria-pressed={reviewTab === 'times'}
          aria-controls="move-times-view" disabled={!hasMoveTimes}
          aria-description={hasMoveTimes ? 'View recorded move durations' : 'No move durations can be calculated from this game'}
          onClick={() => setReviewTab('times')}>Move Times</button>
      </div>
      <button type="button" className={`review-action ${review.kind === 'running' ? 'secondary' : 'primary'}`}
        disabled={game.history.length === 0} onClick={() => {
          if (review.kind === 'running') {
            runner.current?.cancel(); changeReview({ kind: 'cancelled' });
          } else startReview();
        }}>{review.kind === 'running' ? 'Cancel analysis'
          : review.kind === 'complete' ? 'Analyze again' : 'Analyze game'}</button>
    </div>
    <small className="review-engine">{description} · depth 14 / 1.2s per position</small>
    {review.kind === 'running' && <small className="review-progress" role="status">
      {review.progress.completed} / {review.progress.total} positions
      {review.progress.cached > 0 ? ` · ${review.progress.cached} cached` : ''}
    </small>}
    <div id="move-times-view" role="region" aria-labelledby="move-times-button" hidden={reviewTab !== 'times'}>
      <MoveTimes game={game} selectedPly={selectedPly} onSelectPly={onSelectPly} />
    </div>
    <div id="computer-analysis-view" role="region" aria-labelledby="computer-analysis-button">
    {review.kind === 'error' && <span role="alert">{review.message}</span>}
    {review.kind === 'complete' && <div className="review-results">
      <div hidden={reviewTab !== 'computer'}><ReviewGraph review={review.review} selectedPly={selectedPly} onSelectPly={onSelectPly} />
      <small className="review-scale" title={`White perspective; nonlinear scale; mate at the graph edge. ${reviewMethodVersion}`}>White perspective · ±10 pawns</small></div>
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
