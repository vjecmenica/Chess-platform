import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

export interface AccountMail { to: string; subject: string; text: string }
export interface AccountEmail { publicOrigin: string; send: (mail: AccountMail) => Promise<void> }

export function accountEmailFromEnvironment(env: NodeJS.ProcessEnv = process.env): AccountEmail | undefined {
  const mode = env.MAIL_TRANSPORT ?? 'disabled';
  if (mode === 'disabled') return undefined;
  let origin: URL;
  try { origin = new URL(env.PUBLIC_ORIGIN ?? ''); } catch { throw new Error('PUBLIC_ORIGIN must be configured for email.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && origin.protocol === 'http:')))
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (local HTTP is allowed only in development).');
  if (mode === 'local') {
    if (env.NODE_ENV === 'production' || !local || !['127.0.0.1', 'localhost', '::1'].includes(env.HOST ?? '127.0.0.1'))
      throw new Error('Local email is available only on a loopback development server.');
    const directory = fileURLToPath(new URL('../../../.local/account-mail/', import.meta.url));
    return { publicOrigin: origin.origin, send: async mail => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Test email content is a secret, not a log. Never serve this directory over HTTP.
      await writeFile(`${directory}/${randomUUID()}.json`, JSON.stringify(mail), { mode: 0o600, flag: 'wx' });
    } };
  }
  if (mode !== 'smtp' || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.MAIL_FROM
    || /[\r\n]/.test(env.MAIL_FROM)) throw new Error('Configure MAIL_TRANSPORT and SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM.');
  const port = Number(env.SMTP_PORT ?? '587');
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 or 587.');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  return { publicOrigin: origin.origin, send: async mail => {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
  } };
}
