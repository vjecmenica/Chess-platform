const retryDelaysMs = [200, 400, 800, 1_200] as const;

export async function confirmMoveWithRetry<T>(send: () => Promise<T>,
  retryable: (error: unknown) => boolean, onRetry: () => void,
  pause: (milliseconds: number) => Promise<void> = milliseconds =>
    new Promise(resolve => window.setTimeout(resolve, milliseconds))): Promise<T> {
  for (const delay of retryDelaysMs) {
    try { return await send(); }
    catch (error) {
      if (!retryable(error)) throw error;
      onRetry();
      await pause(delay);
    }
  }
  return send();
}
