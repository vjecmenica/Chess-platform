import { ExplorerGames } from './ExplorerGames';
import { memo, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisTree } from './analysis-model';
import { mastersPath, playedPercentage, MastersClient, type MastersResult } from './masters-explorer';

const client = new MastersClient();

export function ExplorerContent({ result, onExplore, onRetry, examples }: {
  result: MastersResult | null; onExplore: (uci: string) => void; onRetry: () => void; examples?: ReactNode;
}) {
  const data = result?.kind === 'ok' ? result.data : null;
  const id = useId();
  return <section className="masters-panel" aria-label="Opening explorer">
    <div className="masters-heading"><strong>Opening Book</strong></div>
    <div className="book-source-tabs analysis-view-tabs" role="group" aria-label="Opening Book sources">
      <button type="button" id={id + '-masters'} aria-pressed="true" aria-controls={id + '-content'}
        aria-description="Masters statistics from licensed TWIC games.">Masters</button>
      <button type="button" aria-pressed="false" disabled
        aria-description="Coming soon. Site-game opening statistics are not available.">Site games<small>Coming soon</small></button>
      <button type="button" aria-pressed="false" disabled
        aria-description="Coming soon. Your personal opening statistics are not available.">Player<small>Coming soon</small></button>
    </div>
    <div className="book-source-content" role="region" id={id + '-content'} aria-labelledby={id + '-masters'}>
    <div className="book-split">
    <div className="masters-statistics">
    {result === null && <p role="status">Loading opening statistics…</p>}
    {result?.kind === 'error' && <p role="status">{result.message} <button type="button"
      className="secondary" onClick={onRetry}>Retry</button></p>}
    {data && (data.moves.length === 0 ? <p>No indexed games found for this position.</p>
      : <>
        <div className="masters-moves" role="list" aria-label="Opening candidate moves" tabIndex={0}>
        <div className="book-columns" aria-hidden="true"><span>Move</span><span>Played %</span><span>Games</span><span>White / Draw / Black</span></div>
        {data.moves.map(move => <div role="listitem" key={move.uci}>
          <button type="button" className="masters-move" onClick={() => onExplore(move.uci)}
            aria-description={`Explore ${move.san} as a local analysis variation`}><span className="book-san">{move.san}</span>
          <span>{playedPercentage(data.moves, move.games).toFixed(1)}%</span>
          <span aria-label={`${move.games.toLocaleString()} games`}>{move.games.toLocaleString()}</span>
          <span className="book-outcomes" role="img"
            aria-label={`White ${(move.white * 100 / move.games).toFixed(1)}%, Draw ${(move.draws * 100 / move.games).toFixed(1)}%, Black ${(move.black * 100 / move.games).toFixed(1)}%`}>
            <span className="book-outcome-bar" aria-hidden="true">{([['white', move.white], ['draw', move.draws], ['black', move.black]] as const).map(([side, count]) => {
              const percent = count * 100 / move.games;
              return <span key={side} className={`book-${side}`} style={{ width: `${percent}%` }}
                aria-hidden="true" />;
            })}</span>
            <span className="book-outcome-values" aria-hidden="true">
              {[move.white, move.draws, move.black].map((count, index) => <span key={index}>
                {Math.round(count * 100 / move.games)}%</span>)}
            </span></span></button>
        </div>)}</div></>)}
    </div>
    {examples !== undefined && <ExplorerExamples hasMoves={Boolean(data?.moves.length)}>{examples}</ExplorerExamples>}
    </div>
    <small className="book-source-notice">Source: licensed TWIC games · statistics and limited game replay.</small>
    </div>
  </section>;
}

export function ExplorerExamples({ children, hasMoves }: { children: ReactNode; hasMoves: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const requestedHeight = useRef<number | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const split = section?.parentElement;
    const handle = handleRef.current;
    const statistics = split?.querySelector<HTMLElement>('.masters-statistics');
    if (!expanded || !hasMoves || !section || !split || !handle || !statistics) return;

    const min = 140;
    let max = 0;
    let drag: { id: number; startY: number; startHeight: number } | null = null;
    let pending: number | null = null;
    let frame = 0;

    const showValue = (height: number) => {
      handle.setAttribute('aria-valuenow', String(Math.min(max, Math.round(height))));
      handle.setAttribute('aria-valuetext', `${Math.round(height)} pixels`);
    };
    const apply = (height: number) => {
      const bounded = Math.min(max, Math.max(min, height));
      split.style.setProperty('--book-examples-height', `${bounded}px`);
      split.setAttribute('data-resized', '');
      showValue(bounded);
      return bounded;
    };
    const syncBounds = () => {
      const splitStyle = getComputedStyle(split);
      const headings = statistics.querySelector<HTMLElement>('.book-columns');
      const firstMove = statistics.querySelector<HTMLElement>('.masters-move');
      const minStatisticsHeight = Math.max(parseFloat(getComputedStyle(statistics).minHeight),
        (headings?.offsetHeight ?? 0) + (firstMove?.offsetHeight ?? 0) + 2);
      max = split.clientHeight - parseFloat(splitStyle.rowGap) - minStatisticsHeight;
      // At the natural minimum, let the Book scroll as a whole instead.
      handle.hidden = max <= min || split.clientHeight <= parseFloat(splitStyle.minHeight);
      if (handle.hidden) {
        split.removeAttribute('data-resized');
        return;
      }
      handle.setAttribute('aria-valuemin', String(min));
      handle.setAttribute('aria-valuemax', String(max));
      if (requestedHeight.current !== null) apply(requestedHeight.current);
      else showValue(section.offsetHeight);
    };
    // Write the split directly, once per frame, without rerendering the lists.
    const flush = () => {
      frame = 0;
      if (pending !== null && !handle.hidden) requestedHeight.current = apply(pending);
      pending = null;
    };
    const start = (event: PointerEvent) => {
      if (drag || event.button !== 0) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, startY: event.clientY, startHeight: section.offsetHeight };
    };
    const move = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      pending = drag.startHeight + drag.startY - event.clientY;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const stop = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      cancelAnimationFrame(frame);
      if (event.type !== 'pointerup') pending = null;
      flush();
    };
    const resizeWithKey = (event: KeyboardEvent) => {
      const height = section.offsetHeight;
      const sizes: Record<string, number> = { ArrowUp: height + 16, ArrowDown: height - 16, Home: min, End: max };
      const next = sizes[event.key];
      if (typeof next !== 'number') return;
      event.preventDefault();
      event.stopPropagation();
      requestedHeight.current = apply(next);
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(split);
    observer.observe(section);
    syncBounds();
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    handle.addEventListener('pointerdown', start, options);
    handle.addEventListener('pointermove', move, options);
    handle.addEventListener('pointerup', stop, options);
    handle.addEventListener('pointercancel', stop, options);
    handle.addEventListener('lostpointercapture', stop, options);
    handle.addEventListener('keydown', resizeWithKey, options);
    return () => {
      listeners.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      split.removeAttribute('data-resized');
      handle.hidden = true;
    };
  }, [expanded, hasMoves]);

  return <section ref={sectionRef} className="book-examples" data-expanded={expanded}>
    {expanded && hasMoves && <div ref={handleRef} className="book-resize-handle" role="separator" tabIndex={0} hidden
      aria-label="Resize Example Games" aria-orientation="horizontal" aria-controls={id}
      aria-description="Drag or use Up and Down to adjust the space for example games." />}
    <button type="button" className="book-examples-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>Example games <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    <div className="book-examples-content" id={id} hidden={!expanded}>{children}</div>
  </section>;
}

export const MastersPanel = memo(function MastersPanel({ game, tree, onExplore }: {
  game: GameReadResponse; tree: AnalysisTree; onExplore: (uci: string) => void;
}) {
  const fen = mastersPath(game, tree).fen;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ fen: string; result: MastersResult } | null>(null);
  useEffect(() => {
    if (game.status !== 'finished') return;
    const controller = new AbortController();
    // Debounce rapid replay navigation; do not request every traversed ply.
    const timer = setTimeout(() => {
      void client.lookup({ rootFen: fen, play: [], fen }, controller.signal).then(result => {
        if (!controller.signal.aborted) setState({ fen, result });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fen, retry, game.id, game.status]);
  if (game.status !== 'finished') return null;
  return <ExplorerContent result={state?.fen === fen ? state.result : null}
    onExplore={onExplore} onRetry={() => { setState(null); setRetry(value => value + 1); }}
    examples={<ExplorerGames key={fen} fen={fen} />} />;
});
