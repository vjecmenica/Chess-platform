import { ExplorerGames } from './ExplorerGames';
import type { ParsedPgn } from '@chess/domain';
import { memo, useEffect, useId, useState, type ReactNode } from 'react';
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
    <div className="book-source-tabs" role="tablist" aria-label="Opening Book sources">
      <button type="button" role="tab" id={id + '-masters'} aria-selected="true" aria-controls={id + '-content'}
        aria-description="Masters statistics from licensed TWIC games."
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
          }
        }}>Masters</button>
      <button type="button" role="tab" aria-selected="false" disabled
        aria-description="Coming soon. Site-game opening statistics are not available.">Site games<small>Coming soon</small></button>
      <button type="button" role="tab" aria-selected="false" disabled
        aria-description="Coming soon. Your personal opening statistics are not available.">Player<small>Coming soon</small></button>
    </div>
    <div className="book-source-content" role="tabpanel" id={id + '-content'} aria-labelledby={id + '-masters'}>
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
    {examples !== undefined && <ExplorerExamples>{examples}</ExplorerExamples>}
    <small className="book-source-notice">Source: licensed TWIC games · statistics and limited game replay.</small>
    </div>
  </section>;
}

export function ExplorerExamples({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return <section className="book-examples" data-expanded={expanded}>
    <button type="button" className="book-examples-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>Example games <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    <div className="book-examples-content" id={id} hidden={!expanded}>{children}</div>
  </section>;
}

export const MastersPanel = memo(function MastersPanel({ game, tree, onExplore, onOpenGame }: {
  game: GameReadResponse; tree: AnalysisTree; onExplore: (uci: string) => void;
  onOpenGame: (game: ParsedPgn, id: string, ply: number) => void;
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
    examples={<ExplorerGames key={fen} fen={fen} onOpen={onOpenGame} />} />;
});
