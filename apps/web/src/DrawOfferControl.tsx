import { useEffect, useId, useRef, useState } from 'react';

export function DrawOfferControl({ ply, nextEligiblePly, busy, onOffer }: {
  ply: number; nextEligiblePly: number; busy: boolean; onOffer: () => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const remaining = nextEligiblePly - ply;
  const reason = ply < 2 ? 'Both players must make a move before offering a draw.'
    : remaining > 0 ? `You can offer another draw after ${remaining} more half-move${remaining === 1 ? '' : 's'}.` : null;

  function positionTooltip() {
    const bounds = anchor.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: bounds.left, top: bounds.top });
  }

  const positioned = position !== null;
  useEffect(() => {
    if (!positioned || !reason) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(null); };
    window.addEventListener('keydown', dismiss);
    window.addEventListener('scroll', positionTooltip, true);
    window.addEventListener('resize', positionTooltip);
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('scroll', positionTooltip, true);
      window.removeEventListener('resize', positionTooltip);
    };
  }, [positioned, reason]);

  const button = <button type="button" className="secondary" disabled={busy || reason !== null}
    aria-describedby={reason ? id : undefined} onClick={onOffer}>Offer draw</button>;
  if (!reason) return button;
  return <span ref={anchor} className="draw-offer-control" role="group" aria-label="Offer draw"
    aria-describedby={id} tabIndex={0} onFocus={positionTooltip} onPointerEnter={positionTooltip}
    onBlur={event => { if (!event.currentTarget.matches(':hover')) setPosition(null); }}
    onPointerLeave={event => { if (!event.currentTarget.matches(':focus-visible')) setPosition(null); }}>
    {button}
    <span id={id} role="tooltip" className="draw-offer-tooltip" hidden={!position}
      style={position ? { left: `clamp(8px, ${position.left}px, 100vw - min(260px, 100vw - 16px) - 8px)`, top: position.top } : undefined}>
      {reason}
    </span>
  </span>;
}
