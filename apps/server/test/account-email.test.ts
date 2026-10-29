import { describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})), create: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: transport.create.mockReturnValue({ sendMail: transport.sendMail }) } }));
import { accountEmailFromEnvironment } from '../src/account-email.js';

describe('account email configuration', () => {
  it('is disabled by default and rejects unsafe origins and development delivery in production', () => {
    expect(accountEmailFromEnvironment({})).toBeUndefined();
    for (const origin of ['http://public.example', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?token=bad'])
      expect(() => accountEmailFromEnvironment({ MAIL_TRANSPORT: 'smtp', PUBLIC_ORIGIN: origin })).toThrow();
    expect(() => accountEmailFromEnvironment({ MAIL_TRANSPORT: 'local', PUBLIC_ORIGIN: 'http://localhost:5173', NODE_ENV: 'production' })).toThrow();
    expect(() => accountEmailFromEnvironment({ MAIL_TRANSPORT: 'local', PUBLIC_ORIGIN: 'http://localhost:5173', HOST: '0.0.0.0' })).toThrow();
    expect(accountEmailFromEnvironment({ MAIL_TRANSPORT: 'local', PUBLIC_ORIGIN: 'http://localhost:5173' })?.publicOrigin).toBe('http://localhost:5173');
  });
  it('uses configured SMTP, mandatory TLS, no protocol logging, and no external content access', async () => {
    const mail = accountEmailFromEnvironment({ MAIL_TRANSPORT: 'smtp', PUBLIC_ORIGIN: 'https://chess.example',
      SMTP_HOST: 'smtp.example', SMTP_USER: 'synthetic', SMTP_PASSWORD: 'synthetic', MAIL_FROM: 'Chess <mail@example.test>' })!;
    expect(transport.create).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true }));
    await mail.send({ to: 'test@example.test', subject: 'Test', text: 'Synthetic content' });
    expect(transport.sendMail).toHaveBeenCalledWith({ from: 'Chess <mail@example.test>', to: 'test@example.test', subject: 'Test', text: 'Synthetic content' });
  });
});
