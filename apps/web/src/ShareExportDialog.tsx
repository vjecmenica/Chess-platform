import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { BoardAppearance, GameReadResponse, GameSide } from '@chess/contracts';
import { canExportGame, exportGamePgn, pgnFile } from './pgn-export';
import { positionAnalysisUrl } from './analysis-links';
import { downloadBlob } from './download';
import { embedFrame, embedHeight, embedWidth } from './embed-links';
import { gifMaxPlies, gifSpeeds } from './gif-frames';
import { ShareGifPreview } from './ShareGifPreview';
import { SharePngPreview } from './SharePngPreview';

const tabs = ['PGN', 'FEN', 'Image', 'GIF', 'Embed'] as const;
type Tab = typeof tabs[number];

export interface ShareExportOptions {
  readonly game: GameReadResponse;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly fen: string;
  readonly gameUrl: string | null;
  readonly embedUrl: string | null;
  readonly board: RefObject<HTMLDivElement | null>;
  readonly appearance: BoardAppearance;
  readonly orientation: GameSide;
}

export function ShareExportDialog({ options, onClose }: { options: ShareExportOptions; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>(() => canExportGame(options.game) ? 'PGN' : 'FEN');
  const [showImage, setShowImage] = useState(false);
  const [speed, setSpeed] = useState<keyof typeof gifSpeeds>('Normal');
  const [progress, setProgress] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const action = useRef(0);
  const gifRequest = useRef<AbortController | null>(null);
  const pgn = useMemo(() => canExportGame(options.game) ? exportGamePgn(options.game, options.headers)
    : null, [options.game, options.headers]);
  const positionUrl = useMemo(() => positionAnalysisUrl(options.fen), [options.fen]);
  const absoluteUrl = (path: string) => new URL(path, window.location.origin).href;
  const gameLink = options.gameUrl && absoluteUrl(options.gameUrl);
  const embedUrl = options.embedUrl ? new URL(options.embedUrl, window.location.origin) : null;
  const embedCode = embedUrl && embedFrame(embedUrl);
  const frameCount = options.game.history.length + 1;

  useLayoutEffect(() => {
    dialog.current?.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => { action.current++; gifRequest.current?.abort(); };
  }, []);

  function selectTab(next: Tab) {
    if (next === tab) return;
    action.current++;
    setFeedback(null);
    if (next === 'Image') setShowImage(true);
    setTab(next);
  }

  function cancelGif() {
    if (gifRequest.current === null) return;
    gifRequest.current.abort();
    gifRequest.current = null;
    setProgress(null);
    setFeedback({ text: 'GIF export canceled.' });
  }

  async function downloadGif() {
    if (gifRequest.current !== null) return;
    const controller = new AbortController();
    gifRequest.current = controller;
    setProgress(0);
    setFeedback(null);
    try {
      const board = options.board.current;
      if (!board) throw new Error('The board is no longer available.');
      const { exportGameGif } = await import('./gif-export');
      const blob = await exportGameGif(board, options.game, options.orientation, options.appearance, gifSpeeds[speed],
        controller.signal, setProgress);
      if (controller.signal.aborted || !dialog.current?.open) return;
      downloadBlob(blob, 'chess-platform-replay.gif');
      setFeedback({ text: 'GIF download started.' });
    } catch (error) {
      if (!controller.signal.aborted)
        setFeedback({ text: error instanceof Error ? error.message : 'Could not create the GIF.', error: true });
    } finally {
      if (gifRequest.current === controller) {
        gifRequest.current = null;
        setProgress(null);
      }
    }
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

  function downloadImage(blob: Blob) {
    action.current++;
    try {
      downloadBlob(blob, 'chess-platform-position.png');
      setFeedback({ text: 'PNG download started.' });
    } catch {
      setFeedback({ text: 'Could not download the PNG. Try again.', error: true });
    }
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
      {gameLink && <div className="share-export-link">
        <label htmlFor={`${id}-game-link`}>Game link</label>
        <div><input id={`${id}-game-link`} readOnly value={gameLink} />
          <button type="button" onClick={() => void copy(gameLink, 'Game link')}>Copy link</button></div>
      </div>}
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
        </div>}
        <div className="share-export-actions">
          <button type="button" className="primary" onClick={() => void copy(options.fen, 'FEN')}>Copy FEN</button>
        </div>
      </section>
      <section role="tabpanel" id={`${id}-Image-panel`} aria-labelledby={`${id}-Image-tab`} hidden={tab !== 'Image'}>
        {showImage && <SharePngPreview {...options} onDownload={downloadImage} />}
      </section>
      <section role="tabpanel" id={`${id}-GIF-panel`} aria-labelledby={`${id}-GIF-tab`} hidden={tab !== 'GIF'}>
        {pgn === null ? <p>GIF export is unavailable for this game.</p> : options.game.history.length > gifMaxPlies
          ? <p>GIF export supports up to {gifMaxPlies} half-moves.</p> : tab === 'GIF'
            && <ShareGifPreview {...options} delay={gifSpeeds[speed]}>
              <label className="share-gif-speed">
                <span>Speed</span>
                <select aria-label="Playback speed" value={speed} disabled={progress !== null}
                  onChange={event => setSpeed(event.target.value as keyof typeof gifSpeeds)}>
                  {Object.keys(gifSpeeds).map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <button type="button" className="primary" disabled={progress !== null} onClick={() => void downloadGif()}>
                Download GIF
              </button>
            </ShareGifPreview>}
      </section>
      <section role="tabpanel" id={`${id}-Embed-panel`} aria-labelledby={`${id}-Embed-tab`} hidden={tab !== 'Embed'}>
        {embedUrl && embedCode ? <>
          <label htmlFor={`${id}-embed-code`}>Embed code</label>
          <textarea id={`${id}-embed-code`} readOnly rows={3} value={embedCode} spellCheck={false} />
          <div className="share-export-actions">
            <button type="button" className="primary" onClick={() => void copy(embedCode, 'Embed code')}>Copy Embed Code</button>
          </div>
          {tab === 'Embed' && <iframe className="share-embed-preview" src={embedUrl.href} title="Embed preview"
            width={embedWidth - 96} height={embedHeight - 96} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />}
        </> : <p>Embedding is unavailable for this game.</p>}
      </section>
      {progress !== null && <div className="share-export-progress">
        <label htmlFor={`${id}-gif-progress`}>{progress === 0 ? 'Preparing GIF…' : `Encoding frame ${progress} of ${frameCount}`}</label>
        <progress id={`${id}-gif-progress`} value={progress} max={frameCount} />
        <button type="button" onClick={cancelGif}>Cancel GIF</button>
      </div>}
      <p className={`share-export-feedback${feedback?.error ? ' error' : ''}`} role="status">{feedback?.text}</p>
    </div>
  </dialog>;
}
