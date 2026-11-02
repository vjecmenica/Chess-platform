import { cursorKey, type AnalysisCursor } from './analysis-model';

/** Selection belongs to the open move list, not the immutable rendered tree structure. */
export class MoveSelection {
  private selected = '';
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor(cursor: AnalysisCursor) { this.update(cursor); }

  snapshot(key: string): number { return key === this.selected ? 1 : 0; }
  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  update(cursor: AnalysisCursor): void {
    const selected = cursorKey(cursor);
    if (selected === this.selected) return;
    const previous = this.selected; this.selected = selected;
    for (const key of [previous, selected]) for (const listener of this.listeners.get(key) ?? []) listener();
  }
}
