import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameReadResponse } from '@chess/contracts';
import { canExportGame, exportGamePgn, pgnFile } from './pgn-export';
import { positionAnalysisUrl } from './analysis-links';
import { downloadBlob } from './download';

const tabs = ['PGN', 'FEN', 'Image'] as const;
type Tab = typeof tabs[number];

export interface ShareExportOptions {
  readonly game: GameReadResponse;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly fen: string;
  readonly gameUrl: string | null;
  readonly exportImage: (coordinates: boolean) => Promise<Blob>;
}

export function ShareExportDialog({ options, onClose }: { options: ShareExportOptions; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>(() => canExportGame(options.game) ? 'PGN' : 'FEN');
  const [coordinates, setCoordinates] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const action = useRef(0);
  const pgn = useMemo(() => canExportGame(options.game) ? exportGamePgn(options.game, options.headers)
    : null, [options.game, options.headers]);
  const positionUrl = useMemo(() => positionAnalysisUrl(options.fen), [options.fen]);
  const absoluteUrl = (path: string) => new URL(path, window.location.origin).href;
  const gameLink = options.gameUrl && absoluteUrl(options.gameUrl);

  useLayoutEffect(() => {
    dialog.current?.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => { action.current++; };
  }, []);

  function selectTab(next: Tab) {
    if (next === tab) return;
    action.current++;
    setFeedback(null);
    setTab(next);
  }

  async function copy(value: string, label: string) {
    const request = ++action.current;
    try {
      await navigator.clipboard.writeText(value);
      if (request === action.current) setFeedback({ text: `${label} copied.` });
    } catch {
      if (request === action.current) setFeedback({ text: `Could not copy ${label}. Select and copy it manually.`, error: true });
    }
  }

  function downloadPgn(text: string) {
    action.current++;
    try {
      downloadBlob(pgnFile(text), `chess-platform-${options.game.id}.pgn`);
      setFeedback({ text: 'PGN download started.' });
    } catch { setFeedback({ text: 'Could not download PGN. Try copying it instead.', error: true }); }
  }

  async function downloadImage() {
    const request = ++action.current;
    setExporting(true);
    setFeedback(null);
    try {
      const blob = await options.exportImage(coordinates);
      if (!dialog.current?.open) return;
      downloadBlob(blob, 'chess-platform-position.png');
      if (request === action.current) setFeedback({ text: 'PNG download started.' });
    } catch {
      if (request === action.current) setFeedback({ text: 'Could not create the board image. Try again.', error: true });
    } finally { if (dialog.current?.open) setExporting(false); }
  }

  return <dialog ref={dialog} className="shared-settings-dialog share-export-dialog"
    aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); dialog.current?.close(); }}
    onClose={onClose}>
    <header>
      <h2 id={`${id}-title`}>Share &amp; Export</h2>
      <button ref={closeButton} type="button" aria-label="Close Share & Export" onClick={() => dialog.current?.close()}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
          strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div className="share-export-body">
      {gameLink ? <div className="share-export-link">
        <label htmlFor={`${id}-game-link`}>Game link</label>
        <div><input id={`${id}-game-link`} readOnly value={gameLink} />
          <button type="button" onClick={() => void copy(gameLink, 'Game link')}>Copy link</button></div>
        <p>Opens the recorded line in Opening Explorer using the recipient’s guest session.</p>
      </div> : <p>{options.game.id.startsWith('import-') && pgn !== null
        ? 'This imported game is local to this session. Share it using PGN.'
        : options.headers === undefined
          ? 'The site-game replay requires participant access. Share a single position from the FEN tab.'
          : 'Share a single position from the FEN tab.'}</p>}
      <div className="share-export-tabs" role="tablist" aria-label="Export format">
        {tabs.map((name, index) => <button type="button" key={name} id={`${id}-${name}-tab`} role="tab"
          aria-selected={tab === name} aria-controls={`${id}-${name}-panel`} tabIndex={tab === name ? 0 : -1}
          onClick={() => selectTab(name)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            selectTab(tabs[next]!);
            event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
          }}>{name}</button>)}
      </div>
      <section role="tabpanel" id={`${id}-PGN-panel`} aria-labelledby={`${id}-PGN-tab`} hidden={tab !== 'PGN'}>
        {pgn === null ? <p>PGN export is unavailable for this game.</p> : <>
          <label className="visually-hidden" htmlFor={`${id}-pgn`}>PGN preview</label>
          <textarea id={`${id}-pgn`} rows={6} readOnly value={pgn} spellCheck={false} />
          <p>Includes the recorded main line, available headers, and result. Analysis variations, annotations, evaluations, and per-move clock times are omitted.</p>
          <div className="share-export-actions">
            <button type="button" onClick={() => void copy(pgn, 'PGN')}>Copy PGN</button>
            <button type="button" className="primary" onClick={() => downloadPgn(pgn)}>Download PGN</button>
          </div>
        </>}
      </section>
      <section role="tabpanel" id={`${id}-FEN-panel`} aria-labelledby={`${id}-FEN-tab`} hidden={tab !== 'FEN'}>
        <label htmlFor={`${id}-fen`}>Current position</label>
        <textarea id={`${id}-fen`} readOnly rows={2} value={options.fen} spellCheck={false} />
        {positionUrl && <div className="share-export-link">
          <label htmlFor={`${id}-position-link`}>Position link</label>
          <div><input id={`${id}-position-link`} readOnly value={absoluteUrl(positionUrl)} />
            <button type="button" onClick={() => void copy(absoluteUrl(positionUrl), 'Position link')}>Copy position link</button></div>
          <p>Opens this position as a new analysis. Only the FEN is shared.</p>
        </div>}
        <div className="share-export-actions">
          <button type="button" className="primary" onClick={() => void copy(options.fen, 'FEN')}>Copy FEN</button>
        </div>
      </section>
      <section role="tabpanel" id={`${id}-Image-panel`} aria-labelledby={`${id}-Image-tab`} hidden={tab !== 'Image'}>
        <p>Save the displayed position as a 1024 × 1024 PNG with the current board appearance, pieces, and orientation.</p>
        <label className="share-export-checkbox"><input type="checkbox" checked={coordinates}
          onChange={event => setCoordinates(event.target.checked)} />Include coordinates</label>
        <div className="share-export-actions">
          <button type="button" className="primary" disabled={exporting} onClick={() => void downloadImage()}>
            {exporting ? 'Creating PNG…' : 'Download PNG'}</button>
        </div>
      </section>
      <p className={`share-export-feedback${feedback?.error ? ' error' : ''}`} role="status">{feedback?.text}</p>
    </div>
  </dialog>;
}
