import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { NotesEditor } from './game-notes';

export function GameNotes({ gameId, csrfToken, active = true }: { gameId: string; csrfToken: string; active?: boolean }) {
  const editor = useMemo(() => new NotesEditor(gameId), [gameId]);
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  useEffect(() => {
    void editor.load(csrfToken);
    const load = () => { void editor.load(csrfToken); };
    const warn = (event: BeforeUnloadEvent) => {
      if (editor.dirty) { void editor.flush(true); event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('focus', load); window.addEventListener('beforeunload', warn);
    return () => {
      void editor.flush(true); editor.pause();
      window.removeEventListener('focus', load); window.removeEventListener('beforeunload', warn);
    };
  }, [editor, csrfToken]);
  useEffect(() => { if (!active) void editor.flush(); }, [editor, active]);
  return <section className="game-notes" aria-label="Private game notes">
    {state.note?.scope === 'guest' && <small>Guest notes stay with this browser session.</small>}
    <label className="visually-hidden" htmlFor={`notes-${gameId}`}>Private notes</label>
    <textarea id={`notes-${gameId}`} maxLength={10000} value={state.text} disabled={!state.note}
      onChange={event => editor.edit(event.target.value)} onBlur={() => { void editor.flush(); }} />
    <div className="game-notes-feedback">
      <small role="status" aria-live="polite">{state.status || '\u00a0'}</small>
      {state.error && !state.remote && <button className="secondary" type="button" onClick={() => {
        if (state.error === 'save') void editor.flush(); else void editor.load(csrfToken);
      }}>{state.error === 'save' ? 'Retry save' : 'Reload notes'}</button>}
      {state.remote && <div className="game-notes-conflict">
        <details><summary>Saved notes</summary><p>{state.remote.text || 'Empty notes'}</p></details>
        <button className="secondary" type="button" aria-description="Replace the saved notes with these edits."
          onClick={() => editor.resolveConflict(true)}>Keep my edits</button>
        <button className="secondary" type="button" onClick={() => editor.resolveConflict(false)}>Use saved notes</button>
      </div>}
    </div>
  </section>;
}
