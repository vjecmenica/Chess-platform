import { ExplorerGames } from './ExplorerGames';
import type { ParsedPgn } from '@chess/domain';
import { memo, useEffect, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import type { AnalysisTree } from './analysis-model';
import { mastersPath, playedPercentage, MastersClient, type MastersResult } from './masters-explorer';

const client = new MastersClient();

export function ExplorerContent({ result, onExplore, onRetry }: {
  result: MastersResult | null; onExplore: (uci: string) => void; onRetry: () => void;
}) {
  const data = result?.kind === 'ok' ? result.data : null;
  return <section className="masters-panel" aria-label="Opening explorer">
    <div className="masters-heading"><strong>Opening Book</strong></div>
    {result === null && <p role="status">Loading opening statistics…</p>}
    {result?.kind === 'error' && <p role="status">{result.message} <button type="button"
      className="secondary" onClick={onRetry}>Retry</button></p>}
    {data && (data.moves.length === 0 ? <p>No indexed games found for this position.</p>
      : <div className="masters-moves" role="list" aria-label="Opening candidate moves">
        <div className="book-columns" aria-hidden="true"><span>Move</span><span>Played %</span><span>Games</span><span>White / Draw / Black</span></div>
        {data.moves.map(move => <div role="listitem" key={move.uci}>
          <button type="button" className="masters-move" onClick={() => onExplore(move.uci)}
            title={`Explore ${move.san} as a local analysis variation`}><span className="book-san">{move.san}</span>
          <span>{playedPercentage(data.moves, move.games).toFixed(1)}%</span>
          <span aria-label={`${move.games.toLocaleString()} games`}>{move.games.toLocaleString()}</span>
          <span className="book-outcomes" role="img"
            aria-label={`White ${(move.white * 100 / move.games).toFixed(1)}%, Draw ${(move.draws * 100 / move.games).toFixed(1)}%, Black ${(move.black * 100 / move.games).toFixed(1)}%`}>
            <span className="book-outcome-bar" aria-hidden="true">{([['white', move.white], ['draw', move.draws], ['black', move.black]] as const).map(([side, count]) => {
              const percent = count * 100 / move.games;
              return <span key={side} className={`book-${side}`} style={{ width: `${percent}%` }}
                title={`${side === 'draw' ? 'Draw' : side === 'white' ? 'White wins' : 'Black wins'}: ${percent.toFixed(1)}%`}
                aria-hidden="true" />;
            })}</span>
            <span className="book-outcome-values" aria-hidden="true">
              {[move.white, move.draws, move.black].map((count, index) => <span key={index}>
                {Math.round(count * 100 / move.games)}%</span>)}
            </span></span></button>
        </div>)}</div>)}
    <small>Source: licensed TWIC games · statistics and limited game replay.</small>
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
  return <><ExplorerContent result={state?.fen === fen ? state.result : null}
    onExplore={onExplore} onRetry={() => { setState(null); setRetry(value => value + 1); }} />
    <details className="book-examples"><summary>Example games</summary>
      <ExplorerGames key={fen} fen={fen} onOpen={onOpenGame} /></details></>;
});
