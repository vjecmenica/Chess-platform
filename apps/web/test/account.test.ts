import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountForm, AccountMenu } from '../src/AccountMenu';
import { AccountSettings } from '../src/AccountSettings';

it('shows private account details and current-password settings without duplicating the archive', () => {
  const html = renderToStaticMarkup(createElement(AccountSettings, { busy: false, onAction: () => {},
    state: { account: { id: 'a', username: 'walnut' }, guestLinked: false, createdAt: '2026-10-28T10:00:00Z' } }));
  expect(html).toContain('Account session');
  expect(html).not.toContain('Link this browser'); expect(html).toContain('Log out');
  expect(html.match(/autoComplete="current-password"/g)).toHaveLength(3);
  expect(html).toContain('Confirm new password'); expect(html).toContain('minLength="15"');
  expect(html).not.toContain('archive-table');
  expect(html).toContain('No verified email.');
  const linked = renderToStaticMarkup(createElement(AccountSettings, { busy: true, onAction: () => {},
    state: { account: { id: 'a', username: 'walnut' }, guestLinked: true, createdAt: null } }));
  expect(linked).not.toContain('guest games are linked');
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
  expect(render('register')).toContain('Recovery requires a verified email in Account Settings.');
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

it('keeps authentication primary and account navigation secondary', () => {
  const form = renderToStaticMarkup(createElement(AccountForm, { mode: 'login', busy: false, onSubmit: () => {}, onMode: () => {} }));
  expect(form).toContain('class="primary">Log in</button>');
  expect(form).toContain('class="secondary">Create an account</button>');
  const menu = renderToStaticMarkup(createElement(AccountMenu, { csrfToken: 'test' }));
  expect(menu).not.toContain('Link games'); expect(menu).not.toContain('Playing as Guest');
});
