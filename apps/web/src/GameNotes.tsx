import { useEffect, useRef, useState } from 'react';

interface Note { owner: string; scope: 'account' | 'guest'; text: string; version: number }
export function GameNotes({ gameId, csrfToken }: { gameId: string; csrfToken: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Loading notes…');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const snapshot = useRef({ note, text });
  snapshot.current = { note, text };
  const drafts = useRef(new Map<string, string>());
  const generation = useRef(0);
  const dirty = useRef(false);
  dirty.current = drafts.current.size > 0 || note !== null && text !== note.text;
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      const old = snapshot.current;
      if (old.note && old.text !== old.note.text) drafts.current.set(old.note.owner, old.text);
      const request = ++generation.current;
      setNote(null); setText(''); setStatus('Loading notes…');
      void fetch(`/api/games/${gameId}/notes`, { cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('Notes could not be loaded.');
        const value = await response.json() as Note;
        if (!controller.signal.aborted && request === generation.current) {
          const draft = drafts.current.get(value.owner);
          setNote(value); setText(draft ?? value.text); setStatus(draft === undefined ? '' : 'Unsaved changes');
        }
      }).catch(() => { if (!controller.signal.aborted && request === generation.current) setStatus('Notes could not be loaded.'); });
    };
    load(); window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, [gameId, csrfToken, retry]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function save() {
    if (!note || saving) return;
    const request = generation.current;
    setSaving(true); setStatus('Saving…');
    try {
      const response = await fetch(`/api/games/${gameId}/notes`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ owner: note.owner, version: note.version, text }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 409
        ? 'Notes or account changed. Copy your edits before reloading.' : 'Notes could not be saved. Your edits are still here.');
      const saved = await response.json() as { version: number };
      drafts.current.delete(note.owner);
      if (request !== generation.current) return;
      setNote({ ...note, text, version: saved.version }); setStatus('Saved');
    } catch (error) { if (request === generation.current) setStatus(error instanceof Error ? error.message : 'Save failed.'); }
    finally { setSaving(false); }
  }
  return <section className="game-notes" aria-label="Private game notes">
    {note?.scope === 'guest' && <small>Guest notes stay with this browser session; losing it may lose access.</small>}
    <label htmlFor={`notes-${gameId}`}>Private notes</label>
    <textarea id={`notes-${gameId}`} maxLength={10000} value={text} disabled={!note || saving}
      onChange={event => { setText(event.target.value); setStatus('Unsaved changes'); }} />
    <div><button className="secondary" disabled={!note || saving || !dirty.current}
      onClick={() => { void save(); }}>Save notes</button>
      {!note && <button className="secondary" onClick={() => setRetry(value => value + 1)}>Retry</button>}</div>
    <span role="status">{status}</span>
  </section>;
}
