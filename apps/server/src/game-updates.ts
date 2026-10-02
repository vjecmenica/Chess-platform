import type pg from 'pg';

export interface GameUpdateHub {
  start(): Promise<void>;
  subscribe(gameId: string, onUpdate: (version: number) => void,
    onUnavailable: () => void): () => void;
  stop(): Promise<void>;
}

const channel = 'chess_game_updates';

export function createGameUpdateHub(pool: pg.Pool): GameUpdateHub {
  const subscribers = new Map<string, Set<{
    update: (version: number) => void; unavailable: () => void;
  }>>();
  let listener: pg.PoolClient | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;

  async function start(): Promise<void> {
    if (stopped) throw new Error('Game updates are shutting down.');
    if (listener !== null) return;
    if (starting !== null) return starting;
    const work = (async () => {
      const client = await pool.connect();
      listener = client;
      const fail = (error: Error) => {
        if (listener !== client) return;
        listener = null;
        client.release(true);
        console.error('The game-update listener disconnected:', error);
        for (const group of subscribers.values()) {
          for (const subscriber of group) subscriber.unavailable();
        }
        subscribers.clear();
      };
      client.on('error', fail);
      client.on('end', () => fail(new Error('The PostgreSQL notification connection ended.')));
      client.on('notification', message => {
        if (message.channel !== channel || !message.payload) return;
        try {
          const event: unknown = JSON.parse(message.payload);
          if (typeof event !== 'object' || event === null || !('id' in event)
            || !('version' in event) || typeof event.id !== 'string'
            || typeof event.version !== 'number') return;
          for (const subscriber of subscribers.get(event.id) ?? []) subscriber.update(event.version);
        } catch { /* Ignore malformed notifications; a reconnect read remains authoritative. */ }
      });
      try { await client.query(`LISTEN ${channel}`); }
      catch (error) {
        if (listener === client) { listener = null; client.release(true); }
        throw error;
      }
    })();
    starting = work;
    try { await work; } finally { if (starting === work) starting = null; }
  }

  function subscribe(gameId: string, update: (version: number) => void,
    unavailable: () => void): () => void {
    const subscriber = { update, unavailable };
    const group = subscribers.get(gameId) ?? new Set<typeof subscriber>();
    group.add(subscriber);
    subscribers.set(gameId, group);
    return () => {
      group.delete(subscriber);
      if (group.size === 0) subscribers.delete(gameId);
    };
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (starting !== null) await starting.catch(() => undefined);
    for (const group of subscribers.values()) {
      for (const subscriber of group) subscriber.unavailable();
    }
    subscribers.clear();
    if (listener !== null) {
      const client = listener;
      listener = null;
      await client.query(`UNLISTEN ${channel}`).catch(() => undefined);
      client.release();
    }
  }

  return { start, subscribe, stop };
}
