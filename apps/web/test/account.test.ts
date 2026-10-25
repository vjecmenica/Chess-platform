import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountForm, AccountMenu } from '../src/AccountMenu';

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
