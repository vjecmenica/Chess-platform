import { describe, expect, it } from 'vitest';
import { parsePgn } from '@chess/domain';
import { importPgn } from '../src/pgn-import';
import { canExportGame, exportGamePgn } from '../src/pgn-export';

describe('individual PGN export', () => {
  it('round-trips available headers, result, and the saved main line without claiming annotations', () => {
    const imported = importPgn('[Event "Club"]\n[White "Ada"]\n[Black "Ben"]\n'
      + '[TimeControl "300+3"]\n[Result "1-0"]\n\n1. e4 {Idea [%clk 0:04:59]} e5 2. Nf3 1-0', 'local');
    const text = exportGamePgn(imported.game, imported.headers);
    const again = parsePgn(text);
    expect(again.headers).toMatchObject({ Event: 'Club', White: 'Ada', Black: 'Ben',
      TimeControl: '300+3', Result: '1-0' });
    expect(again.moves.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(text).not.toContain('%clk');
    expect(text).not.toContain('Idea');
  });

  it('exports a site game with its actual time control and final result', () => {
    const imported = importPgn('1. e4 e5 0-1', 'source').game;
    const site = { ...imported, id: 'site', timeControl: { initialMs: 300_000, incrementMs: 3_000 } };
    const text = exportGamePgn(site);
    expect(text).toContain('[TimeControl "300+3"]');
    expect(parsePgn(text).result).toBe('0-1');
    expect(text).not.toContain('Clock');
  });

  it('does not expose replay-only source games or an empty analysis board', () => {
    const source = importPgn('1. e4 *', 'explorer-5').game;
    const blank = importPgn('*', 'blank-1').game;
    expect(canExportGame(source)).toBe(false);
    expect(() => exportGamePgn(source)).toThrow('not available');
    expect(canExportGame(blank)).toBe(false);
  });
});
