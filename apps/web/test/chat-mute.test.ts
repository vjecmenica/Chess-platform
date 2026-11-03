import { describe, expect, it } from 'vitest';
import { chatMuteKey, finishChatMuteRead, initialChatMute, mergeChatMessages, toggleChatMute, unreadEntries } from '../src/game-chat';
import type { GameChatMessage } from '@chess/contracts';

const message = (id: string, system = false): GameChatMessage => ({
  id, side: 'black', text: system ? 'offered a rematch.' : 'hello',
  sentAt: '2026-11-03T12:00:00Z', ...(system ? { kind: 'system' as const } : {}),
});

describe('personal game chat mute', () => {
  it('isolates the persisted key by player and game, ignoring the old collapse preference', () => {
    expect(chatMuteKey('one', 'white')).toBe('game-chat-muted:one:white');
    expect(chatMuteKey('one', 'black')).not.toBe(chatMuteKey('one', 'white'));
    expect(chatMuteKey('two', 'white')).not.toBe(chatMuteKey('one', 'white'));
    expect(initialChatMute(true)).toEqual({ muted: true, unmuting: false, epoch: 0 });
  });

  it('keeps history but ignores both user and system unread entries throughout mute', () => {
    const received = [message('2'), message('3', true)];
    const muted = toggleChatMute(initialChatMute(false));
    expect(unreadEntries([], received, 'white', '0', muted.muted)).toBe(0);
    const history = mergeChatMessages([message('1')], received);
    expect(history.map(item => item.id)).toEqual(['1', '2', '3']);
    const pending = toggleChatMute(muted);
    expect(pending.unmuting).toBe(true);
    // A read initiated before the unmute request cannot release the mute.
    expect(finishChatMuteRead(pending, muted.epoch)).toBe(pending);
    expect(toggleChatMute(pending)).toBe(pending);
    expect(unreadEntries(history, [message('4')], 'white', '3', pending.muted)).toBe(0);
    const enabled = finishChatMuteRead(pending, pending.epoch);
    expect(enabled.muted).toBe(false);
    // The caught-up watermark suppresses old muted traffic, not subsequent entries.
    expect(unreadEntries(history, [message('3', true), message('4'), message('5')], 'white', '4', enabled.muted)).toBe(1);
  });

  it('requires fresh catch-up after a reload and leaves failed catch-up safely muted for retry', () => {
    const restored = initialChatMute(true);
    const pending = toggleChatMute(restored);
    const failed = { ...pending, unmuting: false };
    expect(failed.muted).toBe(true);
    expect(finishChatMuteRead(failed, pending.epoch)).toBe(failed);
    const retry = toggleChatMute(failed);
    expect(retry.epoch).toBeGreaterThan(pending.epoch);
    expect(finishChatMuteRead(retry, pending.epoch)).toBe(retry);
    expect(finishChatMuteRead(retry, retry.epoch).muted).toBe(false);
  });
});
