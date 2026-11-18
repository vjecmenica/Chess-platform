import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, it } from 'vitest';
import { ClockPanel } from '../src/ClockPanel';
import { AccountProfileHeader } from '../src/MyGames';
import { ImportedPlayerRow } from '../src/PlayerIdentity';
import { ProfilePictureCropDialog } from '../src/ProfilePictureCropDialog';
import { importPgn } from '../src/pgn-import';

const avatarUrl = '/api/avatars/versioned-image.webp';

it('uses the same avatar in the account header and a saved site-game player row', () => {
  const account = { id: '1', username: 'ada', avatarUrl };
  const header = renderToStaticMarkup(createElement(AccountProfileHeader, {
    section: 'overview', state: { account, createdAt: null, guestLinked: false },
  }));
  const clock = renderToStaticMarkup(createElement(ClockPanel, {
    clock: null, side: 'white', isYou: false, historicalMs: 5000,
    playerNames: { white: 'ada', black: null }, avatar: { accountId: account.id, url: avatarUrl },
  }));
  for (const html of [header, clock]) expect(html).toContain(`<img src="${avatarUrl}" alt=""`);
});

it('uses initials for accounts, a neutral guest symbol and no site avatar for PGN players', () => {
  const named = renderToStaticMarkup(createElement(ClockPanel, {
    clock: null, side: 'white', isYou: false, playerNames: { white: 'ada', black: null },
  }));
  expect(named).toContain('player-avatar" aria-hidden="true">AD</span>');
  const guest = renderToStaticMarkup(createElement(ClockPanel, { clock: null, side: 'white', isYou: false }));
  expect(guest).toContain('player-avatar" aria-hidden="true"><svg');
  expect(guest).not.toContain('<img ');
  const imported = importPgn('[White "ada"]\n\n1. e4 *', 'game');
  const row = renderToStaticMarkup(createElement(ImportedPlayerRow, { imported, side: 'white' }));
  expect(row).toContain('player-avatar" aria-hidden="true"><svg');
  expect(row).not.toContain('<img ');
});

it('keeps the crop dialog actions limited to the close icon, Cancel and Save', () => {
  const html = renderToStaticMarkup(createElement(ProfilePictureCropDialog, {
    file: new File([], 'profile.jpeg'), onClose: () => {}, onSave: async () => {},
  }));
  expect(html).toContain('Crop profile picture');
  expect(html).toMatch(/aria-label="Close crop dialog"[^>]*><svg/);
  expect(html).toContain('>Cancel</button>');
  expect(html).toContain('>Save</button>');
  expect(html.match(/<button /g)).toHaveLength(3);
  expect(html).not.toMatch(/type="range"|Reset crop|Drag the photo/);
});
