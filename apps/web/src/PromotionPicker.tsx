import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameSide } from '@chess/contracts';
import type { Piece, Square } from './board-model';
import { pieceImage } from './board-interaction';

export interface PromotionRequest {
  from: Square; to: Square; side: GameSide; gameId: string; fen: string;
  mode: 'analysis' | 'live' | 'premove';
}
export function promotionIsCurrent(request: PromotionRequest, gameId: string | undefined,
  fen: string | null, analysisOpen: boolean, active: boolean): boolean {
  return request.gameId === gameId && (request.mode === 'analysis' ? analysisOpen && request.fen === fen
    : !analysisOpen && active && (request.mode === 'premove' || request.fen === fen));
}

/** Outside the sidebar tabs: a hidden Moves tab must never hide the only way to finish a move. */
export function PromotionPicker({ request, anchor, onChoose, onCancel }: {
  request: PromotionRequest; anchor: HTMLElement | null;
  onChoose: (piece: 'q' | 'r' | 'b' | 'n') => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const cancel = useRef(onCancel); cancel.current = onCancel;
  useLayoutEffect(() => {
    const update = () => {
      if (!anchor?.isConnected || !ref.current) { cancel.current(); return; }
      const square = anchor.getBoundingClientRect(), picker = ref.current.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(document.documentElement.clientWidth - picker.width - 8,
        square.left + (square.width - picker.width) / 2)), top: Math.max(8, square.top - picker.height - 6) });
    };
    update();
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) cancel.current(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); cancel.current(); anchor?.focus({ preventScroll: true });
    } };
    const leaving = (event: FocusEvent) => {
      if (event.relatedTarget && !ref.current?.contains(event.relatedTarget as Node)) cancel.current();
    };
    const picker = ref.current;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    picker?.addEventListener('focusout', leaving);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
      picker?.removeEventListener('focusout', leaving);
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);
  return createPortal(<div ref={ref} className="promotion-choice" role="dialog" aria-label="Choose a promotion piece"
    style={position}>
    <div>{([['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']] as const).map(([piece, name]) =>
      <button type="button" key={piece} aria-label={`Promote to ${name.toLowerCase()}`} onClick={() => onChoose(piece)}>
        <img src={pieceImage((request.side === 'white' ? piece.toUpperCase() : piece) as Piece)} alt="" draggable={false} />
      </button>)}</div>
    <button type="button" className="secondary promotion-cancel" onClick={onCancel}>Cancel</button>
  </div>, document.body);
}
