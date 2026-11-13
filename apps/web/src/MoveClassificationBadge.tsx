import type { CSSProperties } from 'react';
import { moveClassifications, type MoveClassification } from './move-classification';

export function MoveClassificationBadge({ classification, placement }: {
  classification: MoveClassification; placement: 'list' | 'board';
}) {
  const { color, label, path } = moveClassifications[classification];
  return <span className={`move-classification move-classification-${placement}`}
    data-classification={classification} aria-hidden="true" title={placement === 'list' ? label : undefined}
    style={{ '--move-classification-color': color } as CSSProperties}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d={path} />
    </svg>
  </span>;
}
