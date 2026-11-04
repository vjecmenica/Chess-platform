import { AppearanceLauncher } from './AppearanceSettings';
export function BoardUtilities({ downloadable, onDownload, onFlip }: {
  downloadable: boolean; onDownload: () => void; onFlip: () => void;
}) {
  return <div className="board-utilities" role="group" aria-label="Board and game tools">
    <AppearanceLauncher />
    {downloadable && <button type="button" aria-label="Download PGN"
      aria-description="Download this game's main line and available headers. Clocks and analysis comments are not included."
      onClick={onDownload}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
      </svg>
    </button>}
    <button type="button" aria-label="Flip board" data-board-display-control onClick={onFlip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 8h15l-4-4M20 16H5l4 4M4 8v4m16 4v-4" />
      </svg>
    </button>
  </div>;
}
