import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameSide } from '@chess/contracts';
import { boardRows } from './board-model';
import { pieceImage } from './board-interaction';
import type { VariationMove } from './engine-variation';

export function EngineVariation({ fen, moves, orientation, onExplore }: {
  fen: string; moves: readonly VariationMove[]; orientation: GameSide;
  onExplore?: ((rootFen: string, moves: readonly string[]) => void) | undefined;
}) {
  const id = useId();
  const [preview, setPreview] = useState<{ index: number; fen: string; left: number; top: number } | null>(null);
  const show = (element: HTMLElement, index: number) => {
    const rect = element.getBoundingClientRect();
    setPreview({ index, fen: moves[index]!.fen, left: Math.max(8, Math.min(document.documentElement.clientWidth - 188, rect.left)),
      top: rect.bottom + 5 });
  };
  useEffect(() => {
    if (!preview) return;
    const hide = () => setPreview(null);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [preview !== null]);
  const current = preview && moves[preview.index]?.fen === preview.fen ? preview : null;
  return <>
    <span className="engine-line">{moves.length ? moves.map((move, index) => <button type="button"
      className={`engine-pv-move${index === 0 ? ' engine-first-move' : ''}`} key={`${index}:${move.uci}`}
      aria-label={`Explore ${move.san}, move ${index + 1} of this engine line`}
      aria-describedby={current?.index === index ? id : undefined}
      onPointerEnter={event => show(event.currentTarget, index)} onFocus={event => show(event.currentTarget, index)}
      onPointerLeave={() => setPreview(null)} onBlur={() => setPreview(null)}
      onClick={() => { setPreview(null); onExplore?.(fen, moves.slice(0, index + 1).map(item => item.uci)); }}>
      {move.san}</button>) : 'No legal move'}</span>
    {current && createPortal(<div id={id} className="engine-board-preview" role="tooltip"
      aria-label={`Position after ${moves[current.index]!.san}`} style={{ left: current.left, top: current.top }}>
      <div className="engine-preview-board" aria-hidden="true" data-orientation={orientation}>
        {boardRows(current.fen, orientation).flat().map(square => <span key={square.square} data-square={square.square}
          className={square.dark ? 'dark' : 'light'}>{square.piece && <img src={pieceImage(square.piece)} alt="" />}</span>)}
      </div>
    </div>, document.body)}
  </>;
}
