import { expect, it } from 'vitest';
import { embedFrame, embedReplayUrl, embedUrlForGame, readEmbedOptions } from '../src/embed-links';
import { analysisEntry, shareableGameUrl } from '../src/analysis-links';
import { publicReplay } from '../src/public-replays';

it('offers embed code only for the matching deliberately published replay', () => {
  const entry = analysisEntry(new URL('https://chess.example/analysis/public/scholars-mate?ply=3'));
  const path = embedUrlForGame(entry, 'public-scholars-mate', 'black', 3);
  expect(path).toBe('/embed/?game=scholars-mate&side=black&ply=3');
  expect(readEmbedOptions(new URL(path!, 'https://chess.example'))).toEqual({ id: 'scholars-mate', orientation: 'black', ply: 3 });
  expect(shareableGameUrl(entry, 'public-scholars-mate', 3)).toBe('/analysis/public/scholars-mate?ply=3');
  const snippet = embedFrame(new URL(path!, 'https://chess.example'));
  expect(snippet).toContain('src="https://chess.example/embed/?game=scholars-mate&amp;side=black&amp;ply=3"');
  expect(snippet).toContain('title="Chess game replay"');
  expect(embedFrame(new URL(path + '&token=private#secret', 'https://chess.example'))).toBe(snippet);
  expect(embedUrlForGame(entry, 'import-example', 'white', 0)).toBeNull();
  for (const kind of ['site', 'explorer', 'position'])
    expect(embedUrlForGame({ kind, id: 'scholars-mate' }, 'public-scholars-mate', 'white', 0)).toBeNull();
});

it('rejects unknown games, external inputs and invalid player-side or ply parameters', () => {
  for (const id of ['constructor', 'explorer-12', 'import-local', '00000000-0000-4000-8000-000000000001']) {
    expect(publicReplay(id)).toBeNull();
    expect(embedReplayUrl(id, 'white', 0)).toBeNull();
  }
  expect(publicReplay('scholars-mate')?.moves.at(-1)?.san).toBe('Qxf7#');
  expect(readEmbedOptions(new URL('https://chess.example/embed/?ply=-50&side=invalid')))
    .toMatchObject({ orientation: 'white', ply: 0 });
  expect(() => embedFrame(new URL('https://secret@chess.example/embed/'))).toThrow('Invalid');
  expect(() => embedFrame(new URL('https://chess.example/account'))).toThrow('Invalid');
});
