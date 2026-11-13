import type { CSSProperties } from 'react';
import { moveClassifications, type MoveClassification } from './move-classification';

export function MoveClassificationBadge({ classification, placement }: {
  classification: MoveClassification; placement: 'list' | 'board';
}) {
  const visual = moveClassifications[classification];
  return <span className={`move-classification move-classification-${placement}`}
    data-classification={classification} aria-hidden="true" title={placement === 'list' ? visual.label : undefined}
    style={{ '--move-classification-color': visual.color } as CSSProperties}>
    {'glyph' in visual ? <span className="move-classification-glyph">{visual.glyph}</span>
      : <svg viewBox="0 0 24 24" fill={'solid' in visual ? 'currentColor' : 'none'} stroke="currentColor"
        strokeWidth={'solid' in visual ? '1' : '2.8'} strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d={visual.path} />
      </svg>}
  </span>;
}
