import { useLayoutEffect, useState, type RefObject } from 'react';
import type { BoardAppearance, GameSide } from '@chess/contracts';

interface Props {
  board: RefObject<HTMLDivElement | null>;
  fen: string;
  orientation: GameSide;
  appearance: BoardAppearance;
  onDownload: (blob: Blob) => void;
}

type Preview = { url: string; blob: Blob } | 'error' | null;

export function SharePngPreview({ board, fen, orientation, appearance, onDownload }: Props) {
  const [coordinates, setCoordinates] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview>(null);

  useLayoutEffect(() => {
    let current = true;
    let url: string | undefined;
    setPreview(null);
    void import('./board-image').then(async ({ exportBoardImage }) => {
      if (!current) return;
      if (!board.current) throw new Error('Board unavailable.');
      const blob = await exportBoardImage(board.current, fen, orientation, appearance, coordinates);
      if (!current) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, blob });
    }).catch(() => { if (current) setPreview('error'); });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [board, fen, orientation, appearance, coordinates, attempt]);

  const image = typeof preview === 'object' ? preview : null;
  return <>
    <div className="share-board-preview">
      {image ? <img src={image.url} alt={`PNG board preview, ${orientation} at the bottom`} />
        : preview === 'error'
          ? <div role="alert"><p>Could not create the PNG preview.</p>
            <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
          : <p role="status">Preparing preview…</p>}
    </div>
    <div className="share-preview-actions">
      <label className="share-export-checkbox"><input type="checkbox" checked={coordinates}
        onChange={event => setCoordinates(event.target.checked)} />Include coordinates</label>
      <button type="button" className="primary" disabled={!image} onClick={() => image && onDownload(image.blob)}>
        Download PNG
      </button>
    </div>
  </>;
}
