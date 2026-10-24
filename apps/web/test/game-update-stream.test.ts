import { describe, expect, it, vi } from 'vitest';
import { createPosition } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { mergeConfirmedGame } from '../src/board-model';
import { watchGameUpdates, type GameUpdateSource } from '../src/game-update-stream';
import { nextPremove, type Premove } from '../src/premove-model';

class FakeSource implements GameUpdateSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  ongame: ((event: Event) => void) | null = null;
  onchat: ((event: Event) => void) | null = null;
  onping: ((event: Event) => void) | null = null;
  closed = false;
  addEventListener(type: 'game' | 'chat' | 'ping', listener: (event: Event) => void) {
    if (type === 'chat') this.onchat = listener;
    else if (type === 'ping') this.onping = listener; else this.ongame = listener;
  }
  close() { this.closed = true; }
}

function confirmedGame(plies: number): GameReadResponse {
  const position = createPosition();
  if (plies === 1) position.submitMove({ side: 'white', from: 'e2', to: 'e4' });
  return { id: 'game', version: plies, status: 'active', yourSeat: 'black',
    position: position.getPosition(), history: position.getHistory(), result: null,
    drawOffer: null, drawOfferNextEligiblePly: { white: 2, black: 2 },
    clocks: null, clockStatus: 'not_integrated',
    timeControl: { initialMs: 300_000, incrementMs: 3_000 }, rated: false };
}

describe('confirmed game stream', () => {
  it('recovers a silent proxy connection while heartbeats avoid normal polling', async () => {
    vi.useFakeTimers();
    try {
      const first = new FakeSource(), second = new FakeSource();
      const create = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
      const game = vi.fn(async () => {}), chat = vi.fn();
      const stop = watchGameUpdates(create, game, () => null, 100, chat, 350);
      first.onopen?.(new Event('open'));
      await vi.advanceTimersByTimeAsync(300);
      first.onping?.(new Event('ping'));
      await vi.advanceTimersByTimeAsync(300);
      expect(create).toHaveBeenCalledTimes(1);
      expect(game).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(150);
      expect(first.closed).toBe(true);
      expect(create).toHaveBeenCalledTimes(2);
      second.onopen?.(new Event('open'));
      await Promise.resolve();
      expect(chat).toHaveBeenCalled();
      stop();
    } finally { vi.useRealTimers(); }
  });
  it('recreates a permanently closed connection after a proxy failure and stops fallback on recovery', async () => {
    vi.useFakeTimers();
    try {
      const first = new FakeSource(), second = new FakeSource();
      const create = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
      const game = vi.fn(async () => {}), chat = vi.fn();
      const stop = watchGameUpdates(create, game, () => null, 100, chat);
      first.onerror?.(new Event('error'));
      await vi.advanceTimersByTimeAsync(100);
      expect(create).toHaveBeenCalledTimes(2);
      expect(first.closed).toBe(true);
      second.onopen?.(new Event('open'));
      await Promise.resolve();
      const reads = game.mock.calls.length;
      await vi.advanceTimersByTimeAsync(400);
      expect(game).toHaveBeenCalledTimes(reads);
      const chats = chat.mock.calls.length;
      first.onchat?.(new Event('chat'));
      expect(chat).toHaveBeenCalledTimes(chats);
      second.onchat?.(new Event('chat'));
      expect(chat).toHaveBeenCalledTimes(chats + 1);
      stop();
      expect(second.closed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('refreshes chat separately from moves and catches up on reconnect or fallback', async () => {
    vi.useFakeTimers();
    try {
      const source = new FakeSource();
      const game = vi.fn(async () => {}), chat = vi.fn();
      const stop = watchGameUpdates(() => source, game, () => null, 100, chat);
      source.onchat?.(new Event('chat'));
      expect(chat).toHaveBeenCalledTimes(1);
      expect(game).not.toHaveBeenCalled();
      source.onerror?.(new Event('error'));
      await vi.advanceTimersByTimeAsync(200);
      expect(chat).toHaveBeenCalledTimes(4);
      source.onopen?.(new Event('open'));
      await vi.advanceTimersByTimeAsync(200);
      expect(chat).toHaveBeenCalledTimes(5);
      stop();
      source.onchat?.(new Event('chat'));
      expect(chat).toHaveBeenCalledTimes(5);
    } finally { vi.useRealTimers(); }
  });
  it('fetches a pushed opponent move immediately and releases a legal premove', async () => {
    const source = new FakeSource();
    const queue: Premove[] = [{ id: 'queued', from: 'e7', to: 'e5' }];
    let game = confirmedGame(0);
    const submitted: Premove[] = [];
    const stop = watchGameUpdates(() => source, async () => {
      game = mergeConfirmedGame(game, confirmedGame(1));
      if (game.position.sideToMove === game.yourSeat) {
        const next = nextPremove(game.position.fen, game.yourSeat, queue);
        if (next) submitted.push(next);
      }
    }, () => null);
    expect(submitted).toEqual([]);
    source.ongame?.(new Event('game'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(game.version).toBe(1);
    expect(submitted).toEqual(queue);
    stop();
    expect(source.closed).toBe(true);
  });

  it('re-reads after a reconnect and after an already-running read completes', async () => {
    const source = new FakeSource();
    let finishRead = () => {};
    const pending = new Promise<void>(resolve => { finishRead = resolve; });
    let inFlight: Promise<void> | null = pending;
    const refresh = vi.fn(async () => {});
    const stop = watchGameUpdates(() => source, refresh, () => inFlight);
    source.ongame?.(new Event('game'));
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    inFlight = null;
    finishRead();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);
    source.onopen?.(new Event('open'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('polls only while the stream is unavailable', async () => {
    vi.useFakeTimers();
    try {
      const source = new FakeSource();
      const refresh = vi.fn(async () => {});
      const stop = watchGameUpdates(() => source, refresh, () => null, 100);
      await vi.advanceTimersByTimeAsync(300);
      expect(refresh).not.toHaveBeenCalled();
      source.onerror?.(new Event('error'));
      await vi.advanceTimersByTimeAsync(200);
      expect(refresh).toHaveBeenCalledTimes(3);
      source.onopen?.(new Event('open'));
      await vi.advanceTimersByTimeAsync(200);
      expect(refresh).toHaveBeenCalledTimes(4);
      stop();
    } finally { vi.useRealTimers(); }
  });
});
