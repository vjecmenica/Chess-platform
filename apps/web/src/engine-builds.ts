export type EngineChoice = 'full' | 'lite';
export interface EnginePreference { readonly choice: EngineChoice; readonly threads: number }
export interface EngineVariant {
  readonly id: string; readonly label: string; readonly url: string; readonly multithreaded: boolean;
}
export const liteEngine: EngineVariant = { id: 'stockfish-19-lite-single',
  label: 'Stockfish 19 Lite · single-threaded', url: '/engine/stockfish-19-lite-single.js', multithreaded: false };
const fullRoot = '/engine/stockfish-19.0.0/';
export const fullEngine: EngineVariant = { id: 'stockfish-19.0.0-full-multi',
  label: 'Stockfish 19 Full', url: `${fullRoot}stockfish-19.js`, multithreaded: true };
export const fullSingleEngine: EngineVariant = { id: 'stockfish-19.0.0-full-single',
  label: 'Stockfish 19 Full · single-threaded', url: `${fullRoot}stockfish-19-single.js`, multithreaded: false };

export function resolveEngine(choice: EngineChoice, isolated: boolean): EngineVariant {
  return choice === 'lite' ? liteEngine : isolated ? fullEngine : fullSingleEngine;
}

export function browserSupportsEngineThreads(): boolean {
  if (typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated
    || typeof SharedArrayBuffer !== 'function') return false;
  try { return new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer; }
  catch { return false; }
}

/** Reserve capacity for the UI and the separately bounded, one-thread Lite review. */
export function maximumEngineThreads(hardwareConcurrency: number): number {
  return Math.max(1, Math.min(4, Math.floor(Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 2) - 2));
}
export function effectiveThreads(engine: EngineVariant, requested: number, maximum: number): number {
  return engine.multithreaded ? Math.max(1, Math.min(maximum, Math.floor(requested))) : 1;
}
export function engineCacheIdentity(engine: EngineVariant, threads: number): string {
  return engine.multithreaded ? `${engine.id}-threads${threads}` : engine.id;
}
export function engineDescription(engine: EngineVariant, threads: number): string {
  return engine.multithreaded ? `${engine.label} · ${threads} ${threads === 1 ? 'thread' : 'threads'}` : engine.label;
}
export const enginePreferenceKey = 'chess-engine-preference:v1';
interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readEnginePreference(storage?: PreferenceStorage): EnginePreference {
  try {
    const saved = JSON.parse(storage?.getItem(enginePreferenceKey) ?? 'null');
    if (saved && (saved.choice === 'full' || saved.choice === 'lite')
      && Number.isInteger(saved.threads) && saved.threads >= 1 && saved.threads <= 4) return saved;
  } catch { /* Preferences are optional; a private browser may deny storage. */ }
  return { choice: 'full', threads: 1 };
}
export function saveEnginePreference(storage: PreferenceStorage | undefined, preference: EnginePreference): void {
  try { storage?.setItem(enginePreferenceKey, JSON.stringify(preference)); } catch { /* Keep the session choice. */ }
}
