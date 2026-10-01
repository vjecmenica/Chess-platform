import type { GameService } from './game-service.js';

interface PollLogger {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export function startResignationPolling(service: GameService, logger: PollLogger,
  intervalMs = 1_000): () => void {
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const resolved = await service.pollPendingResignations();
      if (resolved > 0) logger.info({ resolved }, 'Pending resignations resolved.');
    } catch (error) {
      logger.error({ err: error }, 'Could not verify pending resignations; the next poll will retry.');
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => { void check(); }, intervalMs);
  void check();
  return () => clearInterval(timer);
}
