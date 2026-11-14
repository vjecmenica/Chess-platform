import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppearanceLauncher } from './AppearanceSettings';
import { ShareExportDialog, type ShareExportOptions } from './ShareExportDialog';

export function BoardUtilities({ share, onFlip }: {
  share: ShareExportOptions | null; onFlip: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  return <div className="board-utilities" role="group" aria-label="Board and game tools">
    <AppearanceLauncher />
    {share && <button ref={launcher} type="button" aria-label="Share & Export" aria-haspopup="dialog"
      onClick={() => setSharing(true)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m8.7 10.7 6.6-3.4m-6.6 6 6.6 3.4" />
        <circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" />
      </svg>
    </button>}
    <button type="button" aria-label="Flip board" data-board-display-control onClick={onFlip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 8h15l-4-4M20 16H5l4 4M4 8v4m16 4v-4" />
      </svg>
    </button>
    {sharing && share && createPortal(<ShareExportDialog options={share} onClose={() => {
      setSharing(false);
      launcher.current?.focus({ preventScroll: true });
    }} />, document.body)}
  </div>;
}
