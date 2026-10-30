import type { EngineWorker } from './engine-analysis';

/** Adapt upstream's download-progress MessagePort without changing its engine files. */
export function createBrowserEngineWorker(url: string,
  makeWorker: (url: string) => Worker = url => new Worker(url),
  makeChannel: () => MessageChannel = () => new MessageChannel()): EngineWorker {
  const raw = makeWorker(url);
  let channel: MessageChannel;
  try { channel = makeChannel(); } catch (error) { raw.terminate(); throw error; }
  let closed = false;
  let lastProgress = -1;
  const finishLoading = () => { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); };
  const timeout = setTimeout(() => {
    if (!closed) {
      finishLoading(); raw.terminate();
      adapter.onerror?.({} as ErrorEvent);
    }
  }, 120_000);
  const adapter: EngineWorker = {
    onmessage: null, onerror: null, onprogress: null,
    postMessage: message => { if (!closed) raw.postMessage(message); },
    terminate: () => { closed = true; finishLoading(); raw.terminate(); },
  };
  raw.onmessage = event => {
    if (closed) return;
    if (typeof event.data === 'string' && event.data.split(/\r?\n/).includes('uciok')) finishLoading();
    adapter.onmessage?.(event);
  };
  raw.onerror = event => { if (!closed) { finishLoading(); adapter.onerror?.(event); } };
  channel.port1.onmessage = event => {
    const progress = event.data?.percent;
    if (!closed && typeof progress === 'number' && Number.isFinite(progress)) {
      const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
      if (percent !== lastProgress) { lastProgress = percent; adapter.onprogress?.(percent); }
    }
  };
  try { raw.postMessage({ progressPort: channel.port2 }, [channel.port2]); }
  catch (error) { adapter.terminate(); throw error; }
  return adapter;
}
