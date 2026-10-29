import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountSettings } from '../src/AccountSettings';
import { RecoveryForm, RecoveryPage } from '../src/AccountRecovery';
import { AccountForm } from '../src/AccountMenu';

it('distinguishes pending and verified addresses and requires current credentials to change them', () => {
  const render = (verified: string | null, pending: string | null, deliveryEnabled = true) => renderToStaticMarkup(createElement(AccountSettings,
    { state: { account: { id: 'a', username: 'walnut' }, guestLinked: false, createdAt: null,
      email: { verified, pending, deliveryEnabled } }, busy: false, onAction: () => {} }));
  const pending = render(null, 'pending@example.test');
  expect(pending).toContain('Pending verification:'); expect(pending).toContain('cannot recover your password yet');
  expect(pending).toContain('Resend verification'); expect(pending).toContain('for="email-password"');
  expect(render('verified@example.test', null)).toContain('Password recovery is available.');
  expect(render(null, null, false)).toContain('Email delivery is not configured');
  expect(render(null, null)).toContain('No verified email.');
});

it('keeps registration email-optional and provides a signed-out recovery entry', () => {
  const form = (mode: 'register' | 'login') => renderToStaticMarkup(createElement(AccountForm, { mode, busy: false, onMode: () => {}, onSubmit: () => {} }));
  expect(form('register')).not.toContain('type="email"');
  expect(form('login')).toContain('href="/account/recover"');
  expect(form('register')).toContain('Recovery requires a verified email');
});

it('uses password-manager fields and confirmation without rendering a token into the form', () => {
  const html = renderToStaticMarkup(createElement(RecoveryForm, { mode: 'reset-password', busy: false, onSubmit: () => {} }));
  expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
  expect(html.match(/minLength="15" maxLength="128"/g)).toHaveLength(2);
  expect(html).toContain('Confirm new password'); expect(html).toContain('All account sessions');
  const token = 'a'.repeat(64);
  const page = renderToStaticMarkup(createElement(RecoveryPage, { mode: 'reset-password', token }));
  expect(page).not.toContain(token); expect(page).not.toContain('name="token"');
  expect(renderToStaticMarkup(createElement(RecoveryPage, { mode: 'reset-password', token: '' }))).toContain('link is missing or invalid');
});
