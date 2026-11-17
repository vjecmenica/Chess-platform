import type { ReactNode } from 'react';
import { AppearanceLauncher } from './AppearanceSettings';

export function BoardUtilities({ onFlip, children }: {
  onFlip: () => void; children: ReactNode;
}) {
  return <div className="board-utilities" role="group" aria-label="Board controls">
    <AppearanceLauncher />
    <button type="button" aria-label="Flip board" data-board-display-control onClick={onFlip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 8h15l-4-4M20 16H5l4 4M4 8v4m16 4v-4" />
      </svg>
    </button>
    {children}
  </div>;
}
