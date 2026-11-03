import { describe, expect, it } from 'vitest';
import { chatMuteKey, syncChatMute, mergeChatMessages, unreadEntries } from '../src/game-chat';
import type { GameChatMessage } from '@chess/contracts';
const message = (id: string, side: 'white' | 'black' = 'black', system = false): GameChatMessage => ({
  id,side,text:system?'has muted the chat':'hello',sentAt:'2026-11-03T12:00:00Z',...(system?{kind:'system' as const}:{})
});
describe('shared history with personal mute', () => {
  it('keeps the browser cache scoped by game and side', () => {
    expect(chatMuteKey('one','white')).toBe('game-chat-muted:one:white');
    expect(chatMuteKey('one','black')).not.toBe(chatMuteKey('one','white'));
    expect(chatMuteKey('two','white')).not.toBe(chatMuteKey('one','white'));
  });
  it('ignores an old refresh arriving after a confirmed mute or unmute', () => {
    const muted={muted:true,version:1};
    expect(syncChatMute(muted,{muted:false,version:0})).toBe(muted);
    const enabled=syncChatMute(muted,{muted:false,version:2});
    expect(syncChatMute(enabled,muted)).toBe(enabled);
  });
  it('retains identical history including own events and muted traffic, without a notification backlog', () => {
    const events=[message('1','white',true),message('2'),message('3','white',true)];
    const history=mergeChatMessages([],events);
    expect(history).toEqual(events);
    expect(unreadEntries([],events,'white','0',true)).toBe(0);
    expect(unreadEntries(history,[...events,message('4')],'white','3',false)).toBe(1);
    expect(unreadEntries([],events,'black','0',false)).toBe(2);
  });
});
