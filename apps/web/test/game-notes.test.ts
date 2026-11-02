import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotesEditor, type GameNote } from '../src/game-notes';
import { GameNotes } from '../src/GameNotes';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  let owner = 'guest:white';
  let fail = false, uncertain = false;
  let hold: Promise<void> | null = null;
  const notes = new Map<string, GameNote>();
  const writes: { owner: string; version: number; text: string }[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const current = notes.get(owner) ?? { owner, scope: owner.startsWith('guest:') ? 'guest' : 'account', text: '', version: 0 };
    if (init?.method !== 'PUT') return Response.json(current);
    const sent = JSON.parse(init.body as string) as typeof writes[number]; writes.push(sent);
    await hold;
    if (fail) throw new Error('Offline');
    if (sent.owner !== owner) return Response.json({ error: 'note_owner_changed' }, { status: 409 });
    if (sent.version !== current.version) return Response.json({ error: 'note_conflict' }, { status: 409 });
    notes.set(owner, { ...current, text: sent.text, version: current.version + 1 });
    if (uncertain) throw new Error('Acknowledgement lost');
    return Response.json({ version: current.version + 1 });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, notes, writes, owner: (next: string) => { owner = next; },
    fail: (next: boolean) => { fail = next; }, uncertain: () => { uncertain = true; }, hold: (next: Promise<void> | null) => { hold = next; } };
}

it('debounces changes and persists with the existing owner/version and CSRF contract', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  editor.edit('first'); await vi.advanceTimersByTimeAsync(500);
  editor.edit('latest'); await vi.advanceTimersByTimeAsync(649); expect(f.writes).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.writes).toEqual([{ owner: 'guest:white', version: 0, text: 'latest' }]);
  expect(f.fetch.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf' } });
  expect(editor.snapshot()).toMatchObject({ status: 'Saved', text: 'latest', saving: false });
  expect(editor.dirty).toBe(false);
  const refreshed = new NotesEditor('game'); await refreshed.load('csrf'); expect(refreshed.snapshot().text).toBe('latest');
  editor.pause(); refreshed.pause();
});
it('flushes before the debounce, serializes edits made during a save and retains the newest draft', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  let release!: () => void; f.hold(new Promise<void>(resolve => { release = resolve; }));
  editor.edit('one'); const first = editor.flush();
  editor.edit('two'); const again = editor.flush(); expect(again).toBe(first);
  expect(editor.snapshot()).toMatchObject({ text: 'two', saving: true }); expect(f.writes).toHaveLength(1);
  f.hold(null); release(); await first; await vi.advanceTimersByTimeAsync(0);
  expect(f.writes).toEqual([{ owner: 'guest:white', version: 0, text: 'one' }, { owner: 'guest:white', version: 1, text: 'two' }]);
  expect(editor.dirty).toBe(false); expect(editor.snapshot().text).toBe('two'); editor.pause();
});
it('retains offline edits for retry and warns while a navigation flush is uncertain', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  f.fail(true); editor.edit('Do not lose this'); await editor.flush(true);
  expect(editor.dirty).toBe(true); expect(editor.snapshot()).toMatchObject({ error: 'save', text: 'Do not lose this' });
  expect(f.fetch.mock.calls.at(-1)?.[1]?.keepalive).toBe(true);
  await vi.advanceTimersByTimeAsync(5000); expect(f.writes).toHaveLength(1);
  f.fail(false); await editor.flush(); expect(editor.dirty).toBe(false); editor.pause();
});
it('confirms an uncertain committed save by read without overwriting it or resending', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  f.uncertain(); editor.edit('saved remotely'); await editor.flush(); expect(editor.dirty).toBe(true);
  await editor.load('csrf'); expect(editor.dirty).toBe(false);
  expect(editor.snapshot().text).toBe('saved remotely'); expect(f.writes).toHaveLength(1); editor.pause();
});
it('does not overwrite concurrent changes until the owner explicitly resolves a version conflict', async () => {
  const f = fixture(), a = new NotesEditor('game'), b = new NotesEditor('game'); await a.load('csrf'); await b.load('csrf');
  a.edit('other tab'); await a.flush(); b.edit('my edits'); await b.flush();
  expect(b.snapshot().error).toBe('conflict'); expect(b.dirty).toBe(true);
  await b.load('csrf'); expect(b.snapshot()).toMatchObject({ text: 'my edits', remote: { text: 'other tab', version: 1 } });
  await vi.advanceTimersByTimeAsync(2000); expect(f.writes).toHaveLength(2);
  b.resolveConflict(true); await b.flush(); expect(f.notes.get('guest:white')?.text).toBe('my edits');
  expect(f.writes.at(-1)).toMatchObject({ version: 1 });
  a.edit('old edits'); await a.load('csrf'); expect(a.snapshot().error).toBe('conflict');
  a.resolveConflict(false); expect(a.snapshot().text).toBe('my edits'); expect(a.dirty).toBe(false);
  a.pause(); b.pause();
});
it('isolates drafts and late saves across guest/account switches and restores only their original owner', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  f.fail(true); editor.edit('guest secret'); await editor.flush();
  f.owner('account:one'); await editor.load('next-csrf');
  expect(editor.snapshot()).toMatchObject({ note: { owner: 'account:one' }, text: '' }); expect(editor.dirty).toBe(true);
  f.fail(false); editor.edit('account one'); await editor.flush();
  expect(f.notes.get('account:one')?.text).toBe('account one');
  f.owner('account:two'); await editor.load('two-csrf'); expect(editor.snapshot().text).toBe('');
  f.owner('guest:white'); await editor.load('guest-csrf'); expect(editor.snapshot().text).toBe('guest secret');
  await editor.flush(); expect(f.notes.get('guest:white')?.text).toBe('guest secret'); editor.pause();
});
it('does not expose a previous owner while loading and ignores a superseded read', async () => {
  let release!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
    .mockResolvedValueOnce(Response.json({ owner: 'account:two', scope: 'account', text: 'current', version: 2 }));
  vi.stubGlobal('fetch', fetch);
  const editor = new NotesEditor('game'); const old = editor.load('one'); await Promise.resolve();
  const next = editor.load('two'); expect(editor.snapshot().text).toBe(''); await next;
  release(Response.json({ owner: 'account:one', scope: 'account', text: 'private old text', version: 1 })); await old;
  expect(editor.snapshot()).toMatchObject({ text: 'current', note: { owner: 'account:two' } }); editor.pause();
});
it('hides an old owner draft after an in-flight save detects an account switch, without transferring or losing it', async () => {
  const f = fixture(), editor = new NotesEditor('game'); await editor.load('csrf');
  let release!: () => void; f.hold(new Promise<void>(resolve => { release = resolve; }));
  editor.edit('guest draft'); const saving = editor.flush();
  f.owner('account:two'); release(); await saving; await vi.advanceTimersByTimeAsync(0);
  expect(editor.snapshot()).toMatchObject({ note: { owner: 'account:two' }, text: '' });
  expect(editor.dirty).toBe(true); expect(f.notes.has('account:two')).toBe(false);
  f.owner('guest:white'); f.hold(null); await editor.load('csrf');
  expect(editor.snapshot().text).toBe('guest draft'); await editor.flush(); expect(editor.dirty).toBe(false); editor.pause();
});
it('renders a primarily textarea editor with an accessible label and no manual Save button', () => {
  const html = renderToStaticMarkup(createElement(GameNotes, { gameId: 'game', csrfToken: 'csrf' }));
  expect(html).toContain('class="visually-hidden" for="notes-game">Private notes</label>');
  expect(html).toContain('maxLength="10000"'); expect(html).not.toContain('Save notes</button>');
  expect(html).toContain('role="status"'); expect(html).toContain('aria-label="Private game notes"');
});
