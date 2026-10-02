import type { GameSide } from '@chess/contracts';
import type { Square } from './board-model';
import { toggleArrow, type BoardArrow } from './board-arrows';

export const annotationColors = {
  orange: { fill: 'rgba(162, 77, 31, .8)', wash: 'rgba(162, 77, 31, .18)' },
  green: { fill: 'rgba(51, 113, 72, .8)', wash: 'rgba(51, 113, 72, .18)' },
  blue: { fill: 'rgba(47, 101, 154, .8)', wash: 'rgba(47, 101, 154, .18)' },
} as const;
export type AnnotationColor = keyof typeof annotationColors;
export interface BoardMark { readonly square: Square; readonly color: AnnotationColor }
export interface PositionAnnotations {
  readonly arrows: readonly BoardArrow[];
  readonly marks: readonly BoardMark[];
}
export interface AnalysisBoardState {
  readonly gameId: string;
  readonly flipped: boolean;
  readonly color: AnnotationColor;
  readonly positions: Readonly<Record<string, PositionAnnotations>>;
}

const empty: PositionAnnotations = { arrows: [], marks: [] };
const squarePattern = /^[a-h][1-8]$/;

export function analysisBoardStorageKey(gameId: string): string {
  return `chess-analysis-board:${gameId}:v1`;
}

export function createAnalysisBoard(gameId: string): AnalysisBoardState {
  return { gameId, flipped: false, color: 'orange', positions: {} };
}

export function boardOrientation(seat: GameSide, flipped: boolean): GameSide {
  return flipped ? seat === 'white' ? 'black' : 'white' : seat;
}

export function positionAnnotations(state: AnalysisBoardState | null, fen: string): PositionAnnotations {
  return state?.positions[fen] ?? empty;
}

function withPosition(state: AnalysisBoardState, fen: string,
  update: (current: PositionAnnotations) => PositionAnnotations): AnalysisBoardState {
  const next = update(positionAnnotations(state, fen));
  const positions = { ...state.positions };
  if (next.arrows.length === 0 && next.marks.length === 0) delete positions[fen];
  else positions[fen] = next;
  return { ...state, positions };
}

export function toggleAnalysisArrow(state: AnalysisBoardState, fen: string,
  from: Square, to: Square): AnalysisBoardState {
  if (from === to) return state;
  return withPosition(state, fen, current => ({ ...current,
    arrows: toggleArrow(current.arrows, from, to, state.color) }));
}

export function toggleAnalysisMark(state: AnalysisBoardState, fen: string,
  square: Square): AnalysisBoardState {
  return withPosition(state, fen, current => ({ ...current,
    marks: current.marks.some(mark => mark.square === square)
      ? current.marks.filter(mark => mark.square !== square)
      : [...current.marks, { square, color: state.color }] }));
}

export function clearPositionAnnotations(state: AnalysisBoardState, fen: string): AnalysisBoardState {
  if (!(fen in state.positions)) return state;
  const positions = { ...state.positions };
  delete positions[fen];
  return { ...state, positions };
}

export function serializeAnalysisBoard(state: AnalysisBoardState): string {
  return JSON.stringify({ version: 1, ...state });
}

export function restoreAnalysisBoard(gameId: string, raw: string): AnalysisBoardState | null {
  if (raw.length > 1_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || value.gameId !== gameId
      || typeof value.flipped !== 'boolean' || !color(value.color) || !object(value.positions)
      || Object.keys(value.positions).length > 500) return null;
    const positions: Record<string, PositionAnnotations> = {};
    for (const [fen, entry] of Object.entries(value.positions)) {
      if (fen.length < 10 || fen.length > 128 || !object(entry)
        || !Array.isArray(entry.arrows) || entry.arrows.length > 64
        || !Array.isArray(entry.marks) || entry.marks.length > 64) return null;
      if (!entry.arrows.every((arrow: unknown) => object(arrow)
        && square(arrow.from) && square(arrow.to) && color(arrow.color))
        || !entry.marks.every((mark: unknown) => object(mark)
          && square(mark.square) && color(mark.color))) return null;
      positions[fen] = { arrows: entry.arrows as BoardArrow[], marks: entry.marks as BoardMark[] };
    }
    return { gameId, flipped: value.flipped, color: value.color, positions };
  } catch { return null; }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function color(value: unknown): value is AnnotationColor {
  return typeof value === 'string' && Object.hasOwn(annotationColors, value);
}
function square(value: unknown): value is Square {
  return typeof value === 'string' && squarePattern.test(value);
}
