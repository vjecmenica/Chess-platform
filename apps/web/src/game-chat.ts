import type { GameChatMessage, GameState } from '@chess/contracts';

export const chatMessageLimit = 500;
export const chatHistoryLimit = 100;
export const chatPresets = ['GG', 'WP', 'TY', 'GTG', 'BYE'] as const;

export function chatEnterSubmits(event: { key: string; isComposing: boolean; keyCode: number; repeat: boolean },
  composing: boolean, allowed: boolean) {
  return allowed && event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229 && !event.repeat;
}

export interface ChatPermission { status: GameState['status']; canSend: boolean }
export function chatComposerState(permission: ChatPermission | null, status: GameState['status']) {
  if (permission?.status === status) return permission.canSend ? 'allowed' : 'read_only';
  return permission?.canSend ? 'refreshing' : 'loading';
}

export function mergeChatMessages(current: readonly GameChatMessage[], incoming: readonly GameChatMessage[]) {
  const messages = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) messages.set(item.id, item);
  return [...messages.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).slice(-chatHistoryLimit);
}

export function nearChatBottom(element: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
}

const errors: Record<string, string> = {
  guest_session_required: 'Your guest session expired. Refresh to reconnect.',
  invalid_csrf_token: 'Your guest session changed. Refresh to reconnect.',
  not_a_participant: 'Chat is only available to this game’s two players.',
  empty_message: 'Enter a message before sending.',
  chat_read_only: 'Chat is read-only for this game state.',
  chat_rate_limited: 'Please wait 10 seconds before sending more messages.',
  request_id_conflict: 'This retry belongs to a different message.',
};
export async function chatResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok || body === null) {
    const error = new Error(errors[body?.error ?? ''] ?? 'Chat could not connect. Please retry.');
    // Only uncertain network/server failures should keep the original retry key.
    Object.assign(error, { definitive: response.status >= 400 && response.status < 500 });
    throw error;
  }
  return body as T;
}

export function unreadEntries(current: readonly GameChatMessage[], incoming: readonly GameChatMessage[], side: GameChatMessage['side'], readThrough = '0'): number {
 const seen = new Set(current.map(item => item.id)); let count=0;
 for(const item of incoming){ if(!seen.has(item.id)&&item.side!==side&&BigInt(item.id)>BigInt(readThrough))count++; seen.add(item.id); }
 return count;
}
