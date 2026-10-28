import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountForm, AccountMenu, GuestSeatLink } from '../src/AccountMenu';
import { AccountSettings } from '../src/AccountSettings';

it('shows private account details and current-password settings without duplicating the archive', () => {
  const html = renderToStaticMarkup(createElement(AccountSettings, { busy: false, onAction: () => {},
    state: { account: { id: 'a', username: 'walnut' }, guestLinked: false, createdAt: '2026-10-28T10:00:00Z' } }));
  expect(html).toContain('Guest game access');
  expect(html).toContain('New games created or accepted while signed in belong to your account automatically.');
  expect(html).toContain('Earlier guest games stay separate.');
  expect(html).toContain('Link this browser'); expect(html).toContain('Log out');
  expect(html.match(/autoComplete="current-password"/g)).toHaveLength(2);
  expect(html).toContain('Confirm new password'); expect(html).toContain('minLength="15"');
  expect(html).not.toContain('archive-table');
  expect(html).toContain('Password recovery is not available');
  const linked = renderToStaticMarkup(createElement(AccountSettings, { busy: true, onAction: () => {},
    state: { account: { id: 'a', username: 'walnut' }, guestLinked: true, createdAt: null } }));
  expect(linked).toContain('guest games are linked');
  expect(linked).not.toContain('>Link this browser');
  expect(linked).toContain('disabled=""');
});

it('uses password-manager fields and clearly states the recovery limit', () => {
  const render = (mode: 'register' | 'login', busy = false) => renderToStaticMarkup(createElement(AccountForm,
    { mode, busy, onSubmit: () => {}, onMode: () => {} }));
  expect(render('register')).toContain('autoComplete="new-password"');
  expect(render('login')).toContain('autoComplete="current-password"');
  expect(render('login')).toContain('type="password"');
  expect(render('register')).toContain('minLength="15" maxLength="128"');
  expect(render('register')).toContain('Password recovery is not available yet.');
  expect(render('register')).not.toContain('type="email"');
  expect(render('login', true)).toContain('Please wait…');
});
it('offers an accessible account dialog without blocking guest play', () => {
  const html = renderToStaticMarkup(createElement(AccountMenu, { csrfToken: undefined }));
  expect(html).toContain('disabled="">Account</button>');
  expect(html).toContain('aria-labelledby="account-heading"');
  expect(html).toContain('class="account-dialog"');
  expect(html).toContain('Close');
});

it('offers explicit linking only for an authenticated, unlinked guest seat', () => {
  const state = { account: { id: 'a', username: 'walnut' }, guestLinked: false, createdAt: null };
  const render = (value: typeof state | null, guestSeat: boolean) => renderToStaticMarkup(
    createElement(GuestSeatLink, { state: value, guestSeat }));
  expect(render(state, true)).toContain('href="/account#settings" target="_blank"');
  expect(render(state, true)).toContain('Signing in does not link this guest seat');
  expect(render(state, true)).toContain('Playing as Guest');
  // An account-owned seat needs no linking hint even when this browser's older guest games are unlinked.
  expect(render(state, false)).toBe('');
  expect(render({ ...state, guestLinked: true }, true)).toBe('');
  expect(render(null, true)).toBe('');
});
