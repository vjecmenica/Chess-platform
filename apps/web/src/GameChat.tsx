import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GameChatHistory, GameChatMessage, GamePlayerNames, GameSide, GameState } from '@chess/contracts';
import { sitePlayerName } from './PlayerIdentity';
import { GameNotes } from './GameNotes';
import { chatComposerState, chatEnterSubmits, chatMessageLimit, chatPresets, chatResponse, mergeChatMessages, nearChatBottom,
  chatMuteKey, initialChatMute, toggleChatMute, finishChatMuteRead,
  unreadEntries, type ChatPermission, type ChatMuteState } from './game-chat';

interface Props { gameId: string; side: GameSide; gameStatus: GameState['status']; csrfToken: string; revision: number;
  playerNames?: GamePlayerNames | undefined; analysisOpen?: boolean; info?: ReactNode }

export function ChatUnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="chat-unread" aria-label={`${count} unread entries`}>{count}</span> : null;
}

export function QuickChatPresets({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  return <div className="game-chat-presets" role="group" aria-label="Quick chat messages">
    {chatPresets.map(preset => <button className="secondary" type="button" key={preset.label}
      disabled={disabled} aria-label={`${preset.label}: send ${preset.text}`}
      onClick={() => onSend(preset.text)}>{preset.label}</button>)}
  </div>;
}

export function ChatMessage({ item, side, playerNames }: { item: GameChatMessage; side: GameSide;
  playerNames?: GamePlayerNames | undefined }) {
  const name = sitePlayerName(playerNames, item.side);
  const label = playerNames?.[item.side] ? name : `${name} (${item.side === 'white' ? 'White' : 'Black'})`;
  if (item.kind === 'system') return <li className="game-chat-system"><em>{label} {item.text.replace(/\.$/, '')}</em><time dateTime={item.sentAt}>{new Date(item.sentAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></li>;
  return <li className="game-chat-message">
    <p><strong aria-label={`${label}, ${item.side === side ? 'you' : 'opponent'}`}>{label}</strong>{': '}<span>{item.text}</span></p>
    <time dateTime={item.sentAt} title={new Date(item.sentAt).toLocaleString()}>
      {new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
  </li>;
}

export function ChatComposer({ gameId, state, text, sending, retrying, onSend, onText }: {
  gameId: string; state: ReturnType<typeof chatComposerState>; text: string; sending: boolean; retrying: boolean;
  onSend: (preset?: string) => void; onText: (text: string) => void;
}) {
  const composing = useRef(false);
  if (state === 'loading') return null;
  if (state === 'read_only') return <p className="game-chat-read-only">Chat is read-only</p>;
  return <form aria-busy={sending || state === 'refreshing'} onSubmit={event => event.preventDefault()}>
    <label className="visually-hidden" htmlFor={`chat-${gameId}`}>Chat message</label>
    <input id={`chat-${gameId}`} value={text} maxLength={chatMessageLimit} autoComplete="off"
      aria-describedby={`chat-send-status-${gameId}`} readOnly={retrying || sending}
      disabled={state !== 'allowed'} onChange={event => onText(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (chatEnterSubmits(event.nativeEvent, composing.current, state === 'allowed' && !sending && Boolean(text.trim()))) {
          event.preventDefault(); onSend();
        }
      }} />
    <small id={`chat-send-status-${gameId}`} className={sending || retrying ? 'game-chat-send-status' : 'visually-hidden'} role="status">
      {sending ? 'Sending…' : retrying ? 'Delivery uncertain. Press Enter in the input to retry the same message.' : 'Press Enter to send.'}</small>
    <QuickChatPresets disabled={sending || retrying || state !== 'allowed'} onSend={onSend} />
  </form>;
}

export function GameChat({ gameId, side, gameStatus, csrfToken, revision, playerNames, analysisOpen = false, info }: Props) {
  const [activePanel, setActivePanel] = useState<'info' | 'chat' | 'notes'>('chat');
  const [unreadChat, setUnreadChat] = useState(0);
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const messagesRef = useRef(messages);
  // Send acknowledgements can arrive before older opponent messages are fetched.
  // Advance this cursor only from a history read, never from a send acknowledgement.
  const historyCursor = useRef('0');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [permission, setPermission] = useState<ChatPermission | null>(null);
  const statusRef = useRef(gameStatus);
  statusRef.current = gameStatus;
  const composerState = chatComposerState(permission, gameStatus);
  const [newMessages, setNewMessages] = useState(false);
  const storageKey = chatMuteKey(gameId, side);
  const [mute, setMute] = useState(() => {
    try { return initialChatMute(localStorage.getItem(storageKey) === 'true'); } catch { return initialChatMute(false); }
  });
  const muteRef = useRef(mute);
  const [muteError, setMuteError] = useState<string | null>(null);
  const view = useRef({ activePanel });
  view.current = { activePanel };
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const pending = useRef<{ requestId: string; text: string; preset: boolean } | null>(null);
  const posting = useRef(false);
  const mounted = useRef(false);
  const reading = useRef(false);
  const requested = useRef(false);

  const readKey = `game-chat-read:${gameId}:${side}`;
  const readThrough = useRef('0');
  useEffect(() => { try { const stored=localStorage.getItem(readKey); if(stored && /^\d{1,19}$/.test(stored)) readThrough.current=stored; } catch {} }, [readKey]);
  const markRead = useCallback((id: string | undefined) => {
    if (!id || BigInt(id) <= BigInt(readThrough.current)) return;
    readThrough.current = id;
    try { localStorage.setItem(readKey, id); } catch { /* Storage is optional. */ }
  }, [readKey]);
  const updateMute = useCallback((next: ChatMuteState) => {
    const changed = next.muted !== muteRef.current.muted;
    muteRef.current = next;
    setMute(next);
    if (changed) try { localStorage.setItem(storageKey, String(next.muted)); } catch { /* Muting still works without storage. */ }
  }, [storageKey]);
  const receive = useCallback((incoming: readonly GameChatMessage[]) => {
    const muted = muteRef.current.muted;
    if (view.current.activePanel !== 'chat' || muted) {
      const added = unreadEntries(messagesRef.current, incoming, side, readThrough.current, muted);
      setUnreadChat(count => muted ? 0 : count + added);
    }
    const next = mergeChatMessages(messagesRef.current, incoming);
    const changed = next.at(-1)?.id !== messagesRef.current.at(-1)?.id;
    messagesRef.current = next;
    setMessages(next);
    if (muted) markRead(next.at(-1)?.id);
    if (!muted && changed && !following.current) setNewMessages(true);
  }, [side, markRead]);
  const refresh = useCallback(async () => {
    requested.current = true;
    if (reading.current) return;
    reading.current = true;
    try {
      while (requested.current && mounted.current) {
        requested.current = false;
        const statusAtRead = statusRef.current;
        const muteEpoch = muteRef.current.epoch;
        const after = historyCursor.current;
        const history = await chatResponse<GameChatHistory>(await fetch(
          `/api/games/${gameId}/chat?after=${after}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }));
        if (!mounted.current) return;
        historyCursor.current = history.messages.at(-1)?.id ?? after;
        receive(history.messages);
        updateMute(finishChatMuteRead(muteRef.current, muteEpoch));
        setPermission({ status: statusAtRead, canSend: history.canSend });
        setLoaded(true);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current && muteRef.current.unmuting) {
        updateMute({ ...muteRef.current, unmuting: false });
        setMuteError('Chat could not refresh. Try unmuting again.');
      }
      if (mounted.current) setError(cause instanceof Error && 'definitive' in cause
        ? cause.message : 'Chat could not connect. Please retry.');
    } finally { reading.current = false; }
  }, [gameId, receive, updateMute]);

  useEffect(() => {
    mounted.current = true;
    const onFocus = () => { void refresh(); };
    const timer = window.setInterval(onFocus, 4000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); mounted.current = false; window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => { void refresh(); }, [revision, gameStatus, refresh]);
  useLayoutEffect(() => {
    if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, mute.muted, activePanel]);
  useEffect(() => {
    if (mute.muted || activePanel === 'chat') { setUnreadChat(0); markRead(messages.at(-1)?.id); }
  }, [mute.muted, activePanel, messages, markRead]);

  function toggleMute() {
    const next = toggleChatMute(muteRef.current);
    updateMute(next);
    setUnreadChat(0); setNewMessages(false); setMuteError(null);
    markRead(messagesRef.current.at(-1)?.id);
    if (next.unmuting) void refresh();
  }
  async function send(preset?: string) {
    if (muteRef.current.muted || posting.current || composerState !== 'allowed' || preset !== undefined && pending.current !== null) return;
    const body = pending.current ?? { requestId: crypto.randomUUID(), text: preset ?? text.trim(), preset: preset !== undefined };
    if (!body.text) return;
    pending.current = body;
    posting.current = true;
    setSending(true);
    setSendError(null);
    try {
      const sent = await chatResponse<GameChatMessage>(await fetch(`/api/games/${gameId}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
          'Idempotency-Key': body.requestId }, body: JSON.stringify({ text: body.text }), signal: AbortSignal.timeout(10_000),
      }));
      pending.current = null;
      if (!mounted.current) return;
      receive([sent]);
      if (!body.preset) setText('');
      void refresh();
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'definitive' in cause && cause.definitive) pending.current = null;
      if (mounted.current) setSendError(cause instanceof Error && 'definitive' in cause
        ? cause.message : 'Message delivery is uncertain. Press Enter to retry.');
    } finally {
      posting.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const tabs = <div className="analysis-view-tabs" role="group" aria-label="Game information, chat and private notes">
    <button type="button" aria-pressed={activePanel === 'info'} onClick={() => setActivePanel('info')}>Info</button>
    <button type="button" aria-pressed={activePanel === 'chat'}
      aria-label={!mute.muted && unreadChat > 0 ? `Chat, ${unreadChat} unread entries` : 'Chat'} onClick={() => setActivePanel('chat')}>Chat
      <ChatUnreadBadge count={mute.muted ? 0 : unreadChat} /></button>
    <button type="button" aria-pressed={activePanel === 'notes'} onClick={() => setActivePanel('notes')}>Notes</button>
  </div>;
  return <aside className="game-chat" data-muted={mute.muted} data-analysis={analysisOpen}
    aria-label="Game information, chat and private notes">
    <div className="game-chat-header">{tabs}
      <button className="secondary chat-mute" type="button" onClick={toggleMute} aria-pressed={mute.muted}
        aria-label={mute.muted ? 'Unmute chat' : 'Mute chat'} aria-busy={mute.unmuting} disabled={mute.unmuting}
        aria-controls={`chat-conversation-${gameId}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 8a6 6 0 0 0-12 0c0 6-3 6-3 9h18c0-3-3-3-3-9M10 21h4" />
          {mute.muted && <path d="m3 3 18 18" />}
        </svg>
      </button></div>
    <div className="game-chat-content" id={`chat-content-${gameId}`}>
    <div className="game-info-tab" tabIndex={0} role="region" aria-label="Game facts" hidden={activePanel !== 'info'}>
      {info ?? <p>Game information unavailable.</p>}</div>
    <div className="game-notes-tab" hidden={activePanel !== 'notes'}><GameNotes gameId={gameId} csrfToken={csrfToken}
      active={activePanel === 'notes'} /></div>
    <div className="game-chat-tab" hidden={activePanel !== 'chat'}>
      {mute.muted && <div className="game-chat-muted-notice" role="status"><em>You muted the chat</em>
        {muteError && <p role="alert">{muteError}</p>}</div>}
      <div className="game-chat-conversation" id={`chat-conversation-${gameId}`} data-muted={mute.muted}
        inert={mute.muted} aria-hidden={mute.muted}>
      <ol className="game-chat-messages" aria-label="Game chat messages" role="log" aria-live="polite"
        aria-relevant="additions" tabIndex={0} ref={list} onScroll={event => {
          following.current = nearChatBottom(event.currentTarget);
          if (following.current) setNewMessages(false);
        }}>
        {!loaded && !error && <li className="game-chat-empty">Loading chat…</li>}
        {loaded && messages.length === 0 && <li className="game-chat-empty">No messages yet.</li>}
        {messages.map(item => <ChatMessage key={item.id} item={item} side={side} playerNames={playerNames} />)}
      </ol>
      {newMessages && <button className="secondary" type="button" onClick={() => {
        following.current = true; setNewMessages(false);
        if (list.current) list.current.scrollTop = list.current.scrollHeight;
      }}>New messages ↓</button>}
      {error && <div className="game-chat-error"><p role="alert">{error}</p>
        <button className="secondary" type="button" onClick={() => { void refresh(); }}>Reconnect chat</button></div>}
      {sendError && <small className="game-chat-error" role="alert">{sendError}</small>}
      <ChatComposer gameId={gameId} state={composerState} text={pending.current?.text ?? text} sending={sending} retrying={pending.current !== null}
        onSend={preset => { void send(preset); }} onText={value => { if (!pending.current) setText(value); }} />
      </div>
    </div>
    </div>
  </aside>;
}
