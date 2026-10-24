export interface GameUpdateSource {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: 'game' | 'chat' | 'ping', listener: (event: Event) => void): void;
  close(): void;
}

export function watchGameUpdates(create: () => GameUpdateSource,
  refresh: () => Promise<unknown>, currentRead: () => Promise<unknown> | null,
  fallbackMs = 4_000, refreshChat: () => void = () => {}, heartbeatMs = 35_000): () => void {
  let active = true;
  let fallback: ReturnType<typeof setInterval> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setTimeout> | null = null;
  let source: GameUpdateSource | null = null;
  const fetchLatest = () => {
    void (async () => {
      const pending = currentRead();
      if (pending !== null) await pending;
      if (active) await refresh();
    })();
  };
  const startFallback = () => {
    if (fallback === null) fallback = setInterval(() => { fetchLatest(); refreshChat(); }, fallbackMs);
  };
  const stopFallback = () => {
    if (fallback !== null) clearInterval(fallback);
    fallback = null;
  };
  const stopReconnect = () => {
    if (reconnect !== null) clearTimeout(reconnect);
    reconnect = null;
  };
  const stopHeartbeat = () => {
    if (heartbeat !== null) clearTimeout(heartbeat);
    heartbeat = null;
  };
  const retry = () => {
    if (reconnect === null && active) reconnect = setTimeout(() => {
      reconnect = null;
      connect();
    }, fallbackMs);
  };
  function connect() {
    stopHeartbeat();
    source?.close();
    source = null;
    try {
      const connection = create();
      source = connection;
      const touch = () => {
        if (!active || source !== connection) return;
        stopHeartbeat();
        heartbeat = setTimeout(() => {
          // Some proxies leave a dead SSE response open instead of raising an error.
          connection.close(); source = null;
          startFallback(); fetchLatest(); refreshChat(); retry();
        }, heartbeatMs);
      };
      touch();
      connection.onopen = () => {
        if (!active || source !== connection) return;
        touch(); stopFallback(); stopReconnect(); fetchLatest(); refreshChat();
      };
      connection.onerror = () => {
        if (!active || source !== connection) return;
        stopHeartbeat(); startFallback(); fetchLatest(); refreshChat(); retry();
      };
      connection.addEventListener('game', () => { if (active && source === connection) { touch(); fetchLatest(); } });
      connection.addEventListener('chat', () => { if (active && source === connection) { touch(); refreshChat(); } });
      connection.addEventListener('ping', touch);
    } catch { startFallback(); retry(); }
  }
  connect();
  return () => { active = false; source?.close(); stopFallback(); stopReconnect(); stopHeartbeat(); };
}
