import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BoardAppearance, GameReadResponse, GameSide } from '@chess/contracts';
import type { Piece } from './board-model';
import { gifFrameDelay, gifFrames, gifSize } from './gif-frames';

interface Props {
  board: RefObject<HTMLDivElement | null>;
  game: GameReadResponse;
  orientation: GameSide;
  appearance: BoardAppearance;
  delay: number;
  children: ReactNode;
}

type Replay = { count: number; draw: (ply: number) => void };

export function ShareGifPreview({ board, game, orientation, appearance, delay, children }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState<Replay | 'error' | null>(null);
  const [playing, setPlaying] = useState(true);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setReplay(null);
    setPly(0);
    void import('./board-image').then(async ({ snapshotBoardSurfaces, loadBoardImages, paintBoardSurface, paintReplayFrame }) => {
      if (signal.aborted) return;
      const ctx = canvas.current?.getContext('2d');
      const background = document.createElement('canvas');
      background.width = background.height = gifSize;
      const surface = background.getContext('2d');
      if (!board.current || !ctx || !surface) throw new Error('Board unavailable.');
      const frames = gifFrames(game);
      const squares = snapshotBoardSurfaces(board.current, orientation, frames[0]!.fen);
      const images = await loadBoardImages(squares, [...'pnbrqkPNBRQK'] as Piece[], appearance, async image => image, signal);
      if (signal.aborted) return;
      paintBoardSurface(surface, squares, images, appearance, gifSize);
      const draw = (index: number) => paintReplayFrame(ctx, background, frames[index]!,
        orientation, images, appearance, gifSize);
      draw(0);
      setReplay({ count: frames.length, draw });
    }).catch(() => { if (!signal.aborted) setReplay('error'); });
    return () => controller.abort();
  }, [board, game, orientation, appearance]);

  useEffect(() => {
    if (!replay || replay === 'error') return;
    replay.draw(ply);
    if (!playing) return;
    const final = ply === replay.count - 1;
    const timer = window.setTimeout(() => setPly(final ? 0 : ply + 1), gifFrameDelay(delay, final));
    return () => window.clearTimeout(timer);
  }, [replay, ply, playing, delay]);

  const ready = !!replay && replay !== 'error';
  return <>
    <div className="share-board-preview">
      <canvas ref={canvas} width={gifSize} height={gifSize} hidden={!ready} role="img"
        aria-label={`GIF board preview, ${orientation} at the bottom`} />
      {!ready && (replay === 'error' ? <p role="alert">Could not load the GIF preview.</p>
        : <p role="status">Preparing preview…</p>)}
    </div>
    <div className="share-preview-actions">
      <button type="button" disabled={replay === 'error'} onClick={() => setPlaying(value => !value)}
        aria-label={playing ? 'Pause preview' : 'Play preview'}>{playing ? 'Pause' : 'Play'}</button>
      {children}
    </div>
  </>;
}
