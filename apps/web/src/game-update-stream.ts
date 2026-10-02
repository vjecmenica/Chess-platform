export interface GameUpdateSource {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: 'game', listener: (event: Event) => void): void;
  close(): void;
}

export function watchGameUpdates(create: () => GameUpdateSource,
  refresh: () => Promise<unknown>, currentRead: () => Promise<unknown> | null,
  fallbackMs = 4_000): () => void {
  let active = true;
  let fallback: ReturnType<typeof setInterval> | null = null;
  let source: GameUpdateSource | null = null;
  const fetchLatest = () => {
    void (async () => {
      const pending = currentRead();
      if (pending !== null) await pending;
      if (active) await refresh();
    })();
  };
  const startFallback = () => {
    if (fallback === null) fallback = setInterval(fetchLatest, fallbackMs);
  };
  const stopFallback = () => {
    if (fallback !== null) clearInterval(fallback);
    fallback = null;
  };
  try {
    source = create();
    source.onopen = () => { stopFallback(); fetchLatest(); };
    source.onerror = () => { startFallback(); fetchLatest(); };
    source.addEventListener('game', fetchLatest);
  } catch { startFallback(); }
  return () => { active = false; source?.close(); stopFallback(); };
}
