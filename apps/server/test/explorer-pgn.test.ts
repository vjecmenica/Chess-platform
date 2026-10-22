import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizedPositionKey, STANDARD_STARTING_FEN } from '@chess/domain';
import { prepareExplorerGame, streamPgnGames } from '../src/explorer-pgn.js';

const fixture = fileURLToPath(new URL('./fixtures/opening-book.pgn', import.meta.url));
describe('offline opening PGN preparation', () => {
  it('streams independent games, reuses legal replay, strips annotations, and merges transpositions', async () => {
    const games: string[] = [];
    for await (const game of streamPgnGames(fixture)) games.push(game);
    expect(games).toHaveLength(6);
    const a = prepareExplorerGame(games[0]!, 24)!;
    const b = prepareExplorerGame(games[1]!, 24)!;
    const draw = prepareExplorerGame(games[2]!, 24)!;
    expect(a.result).toBe('1-0'); expect(b.result).toBe('0-1'); expect(draw.result).toBe('1/2-1/2');
    expect(a.moves.at(-1)).toEqual(b.moves.at(-1));
    expect(a.moves.at(-1)).toEqual(draw.moves.at(-1));
    expect(() => prepareExplorerGame(games[3]!, 24)).toThrow();
    expect(prepareExplorerGame(games[4]!, 24)).toBeNull();
    expect(prepareExplorerGame(games[5]!, 24)).toBeNull();
    expect(prepareExplorerGame(games[0]!, 2)?.moves).toHaveLength(2);
  });

  it('ignores rating/ID additions for identity and counts repeated position/move pairs once', () => {
    const pgn = '[Event "Repeat"]\n[Result "1-0"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 1-0';
    const base = prepareExplorerGame(pgn, 24)!;
    expect(base.moves.filter(move => move.position === normalizedPositionKey(STANDARD_STARTING_FEN))).toHaveLength(1);
    expect(prepareExplorerGame('[WhiteFideId "123"]\n[WhiteElo "2400"]\n' + pgn, 24)?.fingerprint)
      .toBe(base.fingerprint);
    expect(() => prepareExplorerGame('[Result "1-0"]\n\n1. e4 {unclosed 1-0', 24)).toThrow();
  });

  it('normalizes counters and unusable en passant while preserving castling and legal en passant', () => {
    const fen = '4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1';
    expect(normalizedPositionKey(fen)).toBe(normalizedPositionKey(fen.replace('e3 0 1', '- 47 99')));
    const legal = '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1';
    expect(normalizedPositionKey(legal)).not.toBe(normalizedPositionKey(legal.replace('e3', '-')));
    const pinned = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(normalizedPositionKey(pinned)).toBe(normalizedPositionKey(pinned.replace('d6', '-')));
    expect(normalizedPositionKey(STANDARD_STARTING_FEN))
      .not.toBe(normalizedPositionKey(STANDARD_STARTING_FEN.replace('KQkq', '-')));
  });
});
