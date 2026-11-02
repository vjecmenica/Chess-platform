import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizedPositionKey, STANDARD_STARTING_FEN } from '@chess/domain';
import { explorerMainLine, prepareExplorerGame, streamPgnGames } from '../src/explorer-pgn.js';
import { classifyExplorerSource } from '../src/explorer-diagnostic.js';

const fixture = fileURLToPath(new URL('./fixtures/opening-book.pgn', import.meta.url));
describe('offline opening PGN preparation', () => {
  it('normalizes exact zero-castling spellings while preserving full legal play, tags, results and identity', () => {
    for (const body of [
      '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.0-0 Nf6 5.d3 0-0 1/2-1/2',
      '1.d4 d5 2.Nc3 Nc6 3.Bf4 Bf5 4.Qd2 Qd7 5.0-0-0 0-0-0 1/2-1/2',
    ]) {
      const source = '[Event "Synthetic 0-0"]\n[Custom "Keep 0-0-0"]\n[Result "1/2-1/2"]\n\n' + body;
      const canonical = source.replace(body, body.replaceAll('0-0-0', 'O-O-O').replaceAll('0-0', 'O-O'));
      const recovered = prepareExplorerGame(source, 24)!;
      const expected = prepareExplorerGame(canonical, 24)!;
      expect(recovered.originalPgn).toBe(source);
      expect(recovered.tags).toEqual(expected.tags);
      expect(recovered.tags.Custom).toBe('Keep 0-0-0');
      expect(recovered.fingerprint).toBe(expected.fingerprint);
      expect(recovered.positions).toEqual(expected.positions);
      expect(recovered.moves).toEqual(expected.moves);
      expect(recovered.positions.at(-1)?.ply).toBe(10);
      expect(recovered.result).toBe('1/2-1/2');
      expect(classifyExplorerSource(source)).toBe('valid');
    }
    expect(explorerMainLine('[Result "1-0"]\n\n8...0-0+ 9.0-0-0# 1-0')).toContain('8...O-O+ 9.O-O-O# 1-0');
    expect(explorerMainLine('[Result "1-0"]\n\n1.e4 score0-0 0-0word 1-0')).toContain('score0-0 0-0word');
  });

  it('still rejects illegal castling, bad suffixes, absent/multiple results and mismatching headers', () => {
    for (const source of [
      '[Result "1-0"]\n\n1.0-0 1-0',
      '[Result "1-0"]\n\n1.e4 e5',
      '[Result "1-0"]\n\n1.e4 e5 1-0\nUncommented synthetic footer\n----------------',
      '[Result "1-0"]\n\n1.e4 e5 1-0 2.Nf3 Nc6',
      '[Result "1-0"]\n\n1.e4 e5 0-1',
      '[Result "1-0"]\n\n1.e4 e5 (unclosed 0-0 1-0',
      '[Result "1-0"]\n\n1.e4 e5 1-0\n[[Event "Damaged next tag"]',
      '[Result "1-0"]\n\n1.Ng1f3 Nf6 1-0',
      '[Result "1/2-1/2"]\n\n1.e4 e5 2.Nf3 Nc6 1/2-1/2 3.Bc4 Bc5 4.0-0 Nf6 1/2-1/2',
    ]) {
      expect(() => prepareExplorerGame(source, 24)).toThrow();
      expect(() => classifyExplorerSource(source)).toThrow();
    }
  });
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
