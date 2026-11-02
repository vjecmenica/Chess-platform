export interface GameNote { owner: string; scope: 'account' | 'guest'; text: string; version: number }
interface Draft { note: GameNote; text: string }
interface NotesState {
  note: GameNote | null; text: string; status: string; saving: boolean;
  error: 'load' | 'save' | 'conflict' | null; remote: GameNote | null;
}

/** One editor per game. Drafts are kept separately by server-confirmed owner, never transferred. */
export class NotesEditor {
  private state: NotesState = { note: null, text: '', status: 'Loading notes…', saving: false, error: null, remote: null };
  private listeners = new Set<() => void>();
  private drafts = new Map<string, Draft>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private read: AbortController | undefined;
  private generation = 0;
  private csrf = '';
  private inFlight: Promise<void> | null = null;
  private flushAgain = false;
  constructor(private readonly gameId: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  get dirty() { return this.drafts.size > 0; }
  private publish(next: Partial<NotesState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(fn => fn()); }
  private cancelTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private schedule(delay = 650) {
    this.cancelTimer();
    if (this.state.note && this.state.text !== this.state.note.text && !this.state.error)
      this.timer = setTimeout(() => { void this.flush(); }, delay);
  }
  pause() { this.cancelTimer(); this.read?.abort(); this.generation++; }

  async load(csrf = this.csrf) {
    this.csrf = csrf; this.cancelTimer(); this.read?.abort();
    const controller = this.read = new AbortController(), request = ++this.generation;
    // Do not leave another account's draft visible while determining the current owner.
    this.publish({ note: null, text: '', status: 'Loading notes…', error: null, remote: null, saving: false });
    await this.inFlight;
    if (controller.signal.aborted || request !== this.generation) return;
    try {
      const response = await fetch(`/api/games/${this.gameId}/notes`, { cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error('Notes could not be loaded.');
      const remote = await response.json() as GameNote;
      if (controller.signal.aborted || request !== this.generation) return;
      let draft = this.drafts.get(remote.owner);
      // An uncertain PUT may have committed. A read can confirm it without another write.
      if (draft?.text === remote.text) { this.drafts.delete(remote.owner); draft = undefined; }
      const conflict = draft !== undefined && draft.note.version !== remote.version;
      this.publish({ note: conflict ? draft!.note : remote, text: draft?.text ?? remote.text,
        status: conflict ? 'Notes changed elsewhere. Your edits are kept.' : draft ? 'Unsaved changes' : '',
        error: conflict ? 'conflict' : null, remote: conflict ? remote : null });
      this.schedule();
    } catch {
      if (!controller.signal.aborted && request === this.generation)
        this.publish({ status: 'Notes could not be loaded. Unsaved edits are retained for their owner.', error: 'load' });
    }
  }
  edit(text: string) {
    const note = this.state.note;
    if (!note) return;
    if (text === note.text) this.drafts.delete(note.owner);
    else this.drafts.set(note.owner, { note, text });
    this.publish({ text, status: this.state.error === 'conflict' ? this.state.status : 'Unsaved changes',
      error: this.state.error === 'conflict' ? 'conflict' : null });
    this.schedule();
  }
  flush(keepalive = false): Promise<void> {
    this.cancelTimer();
    if (this.inFlight) { this.flushAgain = true; return this.inFlight; }
    const { note, text, error } = this.state;
    if (!note || text === note.text || error === 'conflict') return Promise.resolve();
    const request = this.generation, csrf = this.csrf;
    let ownerChanged = false;
    this.publish({ saving: true, status: 'Saving…', error: null });
    this.inFlight = (async () => {
      try {
        const response = await fetch(`/api/games/${this.gameId}/notes`, { method: 'PUT', cache: 'no-store', keepalive,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ owner: note.owner, version: note.version, text }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          const problem = await response.json().catch(() => null) as { error?: string } | null;
          ownerChanged = problem?.error === 'note_owner_changed';
          throw Object.assign(new Error(response.status === 409
            ? 'Notes or account changed. Reload to compare; your edits are kept.'
            : 'Notes could not be saved. Your edits are kept.'), { conflict: response.status === 409 });
        }
        const saved = { ...note, text, version: (await response.json() as { version: number }).version };
        const draft = this.drafts.get(note.owner);
        if (draft?.text === text) this.drafts.delete(note.owner);
        else if (draft?.note.version === note.version) this.drafts.set(note.owner, { ...draft, note: saved });
        if (request !== this.generation) return;
        this.publish({ note: saved, status: this.state.text === text ? 'Saved' : 'Unsaved changes' });
      } catch (cause) {
        if (request === this.generation) this.publish({ status: cause instanceof Error ? cause.message : 'Save failed. Your edits are kept.',
          error: typeof cause === 'object' && cause !== null && 'conflict' in cause && cause.conflict ? 'conflict' : 'save' });
      } finally {
        this.inFlight = null;
        if (request === this.generation) {
          this.publish({ saving: false }); this.schedule(this.flushAgain ? 0 : 650);
          if (ownerChanged) void this.load();
        }
        this.flushAgain = false;
      }
    })();
    return this.inFlight;
  }
  resolveConflict(useEdits: boolean) {
    const { remote, text } = this.state;
    if (!remote) return;
    this.drafts.delete(remote.owner);
    if (useEdits && text !== remote.text) this.drafts.set(remote.owner, { note: remote, text });
    this.publish({ note: remote, text: useEdits ? text : remote.text, remote: null, error: null,
      status: useEdits ? 'Unsaved changes' : 'Saved' });
    if (useEdits) void this.flush();
  }
}
