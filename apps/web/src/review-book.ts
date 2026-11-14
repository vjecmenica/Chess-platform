import { explorerBookMaxPlies, type ExplorerBookCandidate, type ExplorerBookCount, type GameReadResponse } from '@chess/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewForGame, type GameReview } from './game-review';

// Counts are from the licensed Explorer sample of indexed opening positions.
export const reviewBookCriteria = { maxPlies: explorerBookMaxPlies, minPositionGames: 25, minMoveGames: 5, minPercent: 3 };
const noBookMoves: ReadonlySet<string> = new Set();

export function reviewBookCandidates(game: GameReadResponse | null, review: GameReview | null): ExplorerBookCandidate[] {
  if (!game || !review || !reviewForGame(game, review)) return [];
  const moves = game.history.slice(0, reviewBookCriteria.maxPlies);
  if (moves.some((move, index) => move.beforeFen !== review.evaluations[index]?.fen
    || move.afterFen !== review.evaluations[index + 1]?.fen)) return [];
  return moves.map(move => ({
    fen: move.beforeFen, uci: move.uci,
  }));
}

export function qualifyingBookPlies(counts: readonly ExplorerBookCount[], criteria = reviewBookCriteria): number {
  const firstNonBook = counts.findIndex(({ positionGames, moveGames }) =>
    !Number.isSafeInteger(positionGames) || !Number.isSafeInteger(moveGames) || moveGames > positionGames
    || positionGames < criteria.minPositionGames || moveGames < criteria.minMoveGames
    || moveGames * 100 < positionGames * criteria.minPercent);
  return firstNonBook < 0 ? counts.length : firstNonBook;
}

export async function fetchReviewBookPlies(body: string, count: number, csrfToken: string, signal: AbortSignal): Promise<number> {
  const response = await fetch('/api/opening-explorer/book-counts', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body, signal,
  });
  if (!response.ok) throw new Error('Book counts unavailable.');
  const payload = await response.json() as { counts?: ExplorerBookCount[] } | null;
  const counts = payload?.counts;
  if (!Array.isArray(counts) || counts.length !== count || counts.some(item => !item || typeof item !== 'object'))
    throw new Error('Invalid book counts.');
  return qualifyingBookPlies(counts);
}

export function useReviewBookMoves(game: GameReadResponse | null, review: GameReview | null,
  csrfToken: string | undefined): ReadonlySet<string> {
  const candidates = useMemo(() => reviewBookCandidates(game, review), [game, review]);
  const body = candidates.length ? JSON.stringify({ moves: candidates }) : '';
  const gameId = game?.id;
  // Hold the most recent successful lookup, including zero recognized plies.
  const [result, setResult] = useState<{ body: string; gameId: string; csrfToken: string; moves: ReadonlySet<string> }>();
  const cache = useRef(result);
  const count = candidates.length;
  useEffect(() => {
    if (!body || !gameId || !csrfToken) return;
    const cached = cache.current;
    if (cached?.body === body && cached.gameId === gameId && cached.csrfToken === csrfToken) {
      setResult(cached);
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    // Defer past React's provisional effect setup to avoid duplicate startup requests.
    queueMicrotask(async () => {
      if (signal.aborted) return;
      try {
        const plies = await fetchReviewBookPlies(body, count, csrfToken, signal);
        if (signal.aborted) return;
        const moves = new Set(Array.from({ length: plies }, (_, index) => `${gameId}:m${index + 1}`));
        cache.current = { body, gameId, csrfToken, moves };
        setResult(cache.current);
      } catch { /* Book is optional. The engine review stays available. */ }
    });
    return () => controller.abort();
  }, [body, count, gameId, csrfToken, review]);
  return body && result?.body === body && result.gameId === gameId && result.csrfToken === csrfToken
    ? result.moves : noBookMoves;
}
