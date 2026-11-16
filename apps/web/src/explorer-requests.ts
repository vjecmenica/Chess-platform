export type ExplorerResult<T> = { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'error'; readonly message: string } | { readonly kind: 'cancelled' };

interface Request<T> {
  controller: AbortController;
  result: Promise<ExplorerResult<T>>;
  subscribers: number;
}

/** One transport at a time per resource, with deduplication and independently cancelable subscribers. */
export class ExplorerRequests<T> {
  private queue: Promise<void> = Promise.resolve();
  private pending = new Map<string, Request<T>>();
  private cache = new Map<string, { data: T; at: number }>();
  private cooldownUntil = 0;

  constructor(private readonly limit: number, private readonly now: () => number = Date.now) {}

  cached(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    if (this.now() - entry.at >= 300_000) return undefined;
    this.cache.set(key, entry);
    return entry.data;
  }

  lookup(key: string, signal: AbortSignal | undefined,
    load: (signal: AbortSignal) => Promise<Response>, parse: (value: unknown) => T,
    label: string): Promise<ExplorerResult<T>> {
    if (signal?.aborted) return Promise.resolve({ kind: 'cancelled' });
    const cached = this.cached(key);
    if (cached !== undefined) return Promise.resolve({ kind: 'ok', data: cached });
    let request = this.pending.get(key);
    if (!request) {
      const controller = new AbortController();
      const result = this.queue.then(() => this.perform(key, controller.signal, load, parse, label)).finally(() => {
        if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
      });
      this.queue = result.then(() => undefined);
      request = { controller, result, subscribers: 0 };
      this.pending.set(key, request);
    }
    const shared = request;
    shared.subscribers++;
    return new Promise(resolve => {
      const cancel = () => {
        if (--shared.subscribers === 0) {
          if (this.pending.get(key) === shared) this.pending.delete(key);
          shared.controller.abort();
        }
        resolve({ kind: 'cancelled' });
      };
      signal?.addEventListener('abort', cancel, { once: true });
      void shared.result.then(result => {
        signal?.removeEventListener('abort', cancel);
        resolve(result);
      });
    });
  }

  private async perform(key: string, signal: AbortSignal, load: (signal: AbortSignal) => Promise<Response>,
    parse: (value: unknown) => T, label: string): Promise<ExplorerResult<T>> {
    const error = (message: string): ExplorerResult<T> => ({ kind: 'error', message });
    const limited = () => error('Opening explorer is rate-limited. Try again in a minute.');
    if (signal.aborted) return { kind: 'cancelled' };
    if (this.now() < this.cooldownUntil) return limited();
    const timeout = AbortSignal.timeout(5_000);
    try {
      const response = await load(AbortSignal.any([signal, timeout]));
      if (response.status === 429) { this.cooldownUntil = this.now() + 60_000; return limited(); }
      if (response.status === 401) return error('Your guest session expired. Refresh the page to reconnect.');
      if (response.status === 403) return error('Opening explorer access was denied.');
      if (!response.ok) return error(`${label} unavailable.`);
      const data = parse(await response.json());
      if (signal.aborted) return { kind: 'cancelled' };
      this.cache.set(key, { at: this.now(), data });
      if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value!);
      return { kind: 'ok', data };
    } catch {
      if (signal.aborted) return { kind: 'cancelled' };
      return error(timeout.aborted ? `${label} timed out.` : `${label} unavailable.`);
    }
  }
}
