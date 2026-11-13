import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GameChatPreset, GameChatHistory, GameChatMessage, GamePlayerNames, GameSide, GameState } from '@chess/contracts';
import { sitePlayerName } from './PlayerIdentity';
import { GameNotes } from './GameNotes';
import { chatComposerState, chatEnterSubmits, chatMessageLimit, chatPresets, chatResponse, mergeChatMessages, nearChatBottom,
  chatMuteKey, syncChatMute,
  unreadEntries, type ChatPermission, type ChatMuteState } from './game-chat';

interface Props { gameId: string; side: GameSide; gameStatus: GameState['status']; csrfToken: string; revision: number;
  playerNames?: GamePlayerNames | undefined; visible?: boolean; floating?: boolean; info?: ReactNode;
  onCloseFloating?: () => void; onUnreadChange?: (count: number) => void }

export function ChatUnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="chat-unread" aria-label={`${count} unread entries`}>{count}</span> : null;
}

export function QuickChatPresets({ disabled, used = [], onSend }: { disabled: boolean; used?: readonly GameChatPreset[]; onSend: (text: string) => void }) {
  return <div className="game-chat-presets" role="group" aria-label="Quick chat messages">
    {chatPresets.map(preset => <button className="secondary" type="button" key={preset.label}
      disabled={disabled || used.includes(preset.text)} aria-label={`${preset.label}: send ${preset.text}`}
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

export function ChatComposer({ gameId, state, text, sending, retrying, usedPresets = [], announce = true, onSend, onText }: {
  gameId: string; state: ReturnType<typeof chatComposerState>; text: string; sending: boolean; retrying: boolean;
  usedPresets?: readonly GameChatPreset[]; announce?: boolean;
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
    <small id={`chat-send-status-${gameId}`} className={sending || retrying ? 'game-chat-send-status' : 'visually-hidden'} role={announce ? 'status' : undefined}>
      {sending ? 'Sending…' : retrying ? 'Delivery uncertain. Press Enter in the input to retry the same message.' : 'Press Enter to send.'}</small>
    <QuickChatPresets used={usedPresets} disabled={sending || retrying || state !== 'allowed'} onSend={onSend} />
  </form>;
}

function ChatConversation({ id, active, announce, muted, messages, loaded, error, sendError, side, playerNames, refresh, children }: {
  id: string; active: boolean; announce: boolean; muted: boolean; messages: readonly GameChatMessage[];
  loaded: boolean; error: string | null; sendError: string | null; side: GameSide;
  playerNames: GamePlayerNames | undefined; refresh: () => Promise<void>; children: ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const latest = messages.at(-1)?.id ?? '0';
  useLayoutEffect(() => {
    if (muted) setPausedAt(null);
    if (active && !muted && pausedAt === null && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [active, messages, muted, pausedAt]);

  return <>
    {muted && <div className="game-chat-muted-notice" role={announce ? 'status' : undefined}><em>You muted the chat</em></div>}
    <div className="game-chat-conversation" id={`chat-conversation-${id}`} data-muted={muted} inert={muted} aria-hidden={muted}>
      <ol className="game-chat-messages" aria-label="Game chat messages" role={announce ? 'log' : undefined}
        aria-live={announce ? 'polite' : undefined} aria-relevant={announce ? 'additions' : undefined}
        tabIndex={0} ref={list} onScroll={event => {
          const nearBottom = nearChatBottom(event.currentTarget);
          setPausedAt(current => nearBottom ? null : current ?? latest);
        }}>
        {!loaded && !error && <li className="game-chat-empty">Loading chat…</li>}
        {loaded && messages.length === 0 && <li className="game-chat-empty">No messages yet.</li>}
        {messages.map(item => <ChatMessage key={item.id} item={item} side={side} playerNames={playerNames} />)}
      </ol>
      {pausedAt !== null && pausedAt !== latest && <button className="secondary" type="button" onClick={() => setPausedAt(null)}>
        New messages ↓</button>}
      {error && <div className="game-chat-error"><p role={announce ? 'alert' : undefined}>{error}</p>
        <button className="secondary" type="button" onClick={() => { void refresh(); }}>Reconnect chat</button></div>}
      {sendError && <small className="game-chat-error" role={announce ? 'alert' : undefined}>{sendError}</small>}
      {children}
    </div>
  </>;
}

export function GameChat({ gameId, side, gameStatus, csrfToken, revision, playerNames, visible = true, floating = false, info, onCloseFloating, onUnreadChange }: Props) {
  const [activePanel, setActivePanel] = useState<'info' | 'chat' | 'notes'>('chat');
  const panel = activePanel === 'info' && !info ? 'chat' : activePanel;
  const dockedChatVisible = visible && panel === 'chat';
  const chatVisible = floating || dockedChatVisible;
  const floatingId = `${gameId}-floating`;
  const closeFloating = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (floating) {
      const input = document.getElementById(`chat-${floatingId}`);
      input?.focus();
      // Muted/loading conversations have no focusable composer.
      if (!input || document.activeElement !== input) closeFloating.current?.focus();
    }
  }, [floating, floatingId]);
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
  const [usedPresets, setUsedPresets] = useState<readonly GameChatPreset[]>([]);
  const [permission, setPermission] = useState<ChatPermission | null>(null);
  const statusRef = useRef(gameStatus);
  statusRef.current = gameStatus;
  const composerState = chatComposerState(permission, gameStatus);
  const storageKey = chatMuteKey(gameId, side);
  const [mute, setMute] = useState(() => {
    try { return { muted: localStorage.getItem(storageKey) === 'true', version: -1 }; } catch { return { muted: false, version: -1 }; }
  });
  const muteRef = useRef(mute);
  const [mutating, setMutating] = useState(false);
  const mutePending = useRef<{ requestId: string; muted: boolean } | null>(null);
  const mutePosting = useRef(false);
  const [muteError, setMuteError] = useState<string | null>(null);
  const chatVisibleRef = useRef(chatVisible);
  chatVisibleRef.current = chatVisible;
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
  const receive = useCallback((incoming: readonly GameChatMessage[], suppressUnread = false) => {
    const muted = muteRef.current.muted || suppressUnread;
    if (!chatVisibleRef.current || muted) {
      const added = unreadEntries(messagesRef.current, incoming, side, readThrough.current, muted);
      setUnreadChat(count => muted ? 0 : count + added);
    }
    const next = mergeChatMessages(messagesRef.current, incoming);
    messagesRef.current = next;
    setMessages(next);
    if (muted) markRead(next.at(-1)?.id);
  }, [side, markRead]);
  const receiveHistory = useCallback((history: GameChatHistory) => {
    const nextMute = syncChatMute(muteRef.current, { muted: history.muted, version: history.muteVersion });
    receive(history.messages, nextMute.muted);
    updateMute(nextMute);
    setUsedPresets(current => [...new Set([...current, ...history.usedPresets])]);
  }, [receive, updateMute]);
  const refresh = useCallback(async () => {
    requested.current = true;
    if (reading.current) return;
    reading.current = true;
    try {
      while (requested.current && mounted.current) {
        requested.current = false;
        const statusAtRead = statusRef.current;
        const after = historyCursor.current;
        const history = await chatResponse<GameChatHistory>(await fetch(
          `/api/games/${gameId}/chat?after=${after}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }));
        if (!mounted.current) return;
        historyCursor.current = history.messages.at(-1)?.id ?? after;
        receiveHistory(history);
        setPermission({ status: statusAtRead, canSend: history.canSend });
        setLoaded(true);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && 'definitive' in cause
        ? cause.message : 'Chat could not connect. Please retry.');
    } finally { reading.current = false; }
  }, [gameId, receiveHistory]);

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
  useEffect(() => {
    if (mute.muted || chatVisible) { setUnreadChat(0); markRead(messages.at(-1)?.id); }
  }, [mute.muted, chatVisible, messages, markRead]);

  useEffect(() => { onUnreadChange?.(mute.muted ? 0 : unreadChat); }, [mute.muted, unreadChat, onUnreadChange]);

  async function toggleMute() {
    if (mutePosting.current || !loaded) return;
    const command = mutePending.current ?? { requestId: crypto.randomUUID(), muted: !muteRef.current.muted };
    mutePending.current = command; mutePosting.current = true; setMutating(true); setMuteError(null);
    try {
      const history = await chatResponse<GameChatHistory>(await fetch(`/api/games/${gameId}/chat/mute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
          'Idempotency-Key': command.requestId }, body: JSON.stringify({ muted: command.muted }), signal: AbortSignal.timeout(10_000),
      }));
      mutePending.current = null;
      if (!mounted.current) return;
      receiveHistory(history);
      setUnreadChat(0); markRead(history.messages.at(-1)?.id);
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'definitive' in cause && cause.definitive) mutePending.current = null;
      if (mounted.current) setMuteError('Chat preference could not be confirmed. Use the bell to retry.');
    } finally { mutePosting.current = false; if (mounted.current) setMutating(false); }
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
      const used = chatPresets.find(item => item.text === sent.text);
      if (used) setUsedPresets(current => [...new Set([...current, used.text])]);
      if (!body.preset) setText('');
      void refresh();
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'definitive' in cause && cause.definitive) pending.current = null;
      if (mounted.current) void refresh();
      if (mounted.current) setSendError(cause instanceof Error && 'definitive' in cause
        ? cause.message : 'Message delivery is uncertain. Press Enter to retry.');
    } finally {
      posting.current = false;
      if (mounted.current) setSending(false);
    }
  }

  function muteButton(id: string) {
    return <button className="chat-mute" type="button" onClick={() => { void toggleMute(); }} aria-pressed={mute.muted}
        aria-label={mute.muted ? 'Unmute chat' : 'Mute chat'} aria-busy={mutating} disabled={mutating || !loaded}
        aria-controls={`chat-conversation-${id}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 8a6 6 0 0 0-12 0c0 6-3 6-3 9h18c0-3-3-3-3-9M10 21h4" />
          {mute.muted && <path d="m3 3 18 18" />}
        </svg>
      </button>;
  }

  function conversation(id: string, active: boolean, announce: boolean) {
    return <ChatConversation id={id} active={active} announce={announce} muted={mute.muted} messages={messages}
      loaded={loaded} error={error} sendError={sendError} side={side} playerNames={playerNames} refresh={refresh}>
      <ChatComposer gameId={id} state={composerState} text={pending.current?.text ?? text} usedPresets={usedPresets}
        sending={sending} retrying={pending.current !== null} announce={announce}
        onSend={preset => { void send(preset); }} onText={value => { if (!pending.current) setText(value); }} />
    </ChatConversation>;
  }

  return <>
    <aside className="game-chat" data-muted={mute.muted} data-floating={false} hidden={!visible}
      aria-label="Game chat and private notes">
      <div className="game-chat-header">
        <div className="analysis-view-tabs" role="group" aria-label={info ? 'Game Room views' : 'Chat and private notes'}>
          {info && <button type="button" aria-pressed={panel === 'info'} onClick={() => setActivePanel('info')}>Info</button>}
          <button type="button" aria-pressed={panel === 'chat'}
            aria-label={!mute.muted && unreadChat > 0 ? `Chat, ${unreadChat} unread entries` : 'Chat'} onClick={() => setActivePanel('chat')}>
            Chat<ChatUnreadBadge count={mute.muted ? 0 : unreadChat} /></button>
          <button type="button" aria-pressed={panel === 'notes'} onClick={() => setActivePanel('notes')}>Notes</button>
        </div>
        <div className="game-chat-header-actions">{muteButton(gameId)}</div>
      </div>
      {muteError && <small className="game-chat-error" role={floating ? undefined : 'alert'}>{muteError}</small>}
      <div className="game-chat-content">
        {info && <div className="game-chat-info" tabIndex={0} hidden={panel !== 'info'}>{info}</div>}
        <div className="game-notes-tab" hidden={panel !== 'notes'}><GameNotes gameId={gameId} csrfToken={csrfToken}
          active={visible && panel === 'notes'} /></div>
        <div className="game-chat-tab" hidden={panel !== 'chat'}>
          {conversation(gameId, dockedChatVisible, !floating)}
        </div>
      </div>
    </aside>
    {floating && <aside className="game-chat" data-muted={mute.muted} data-floating={true} aria-label="Floating game chat"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCloseFloating?.(); } }}>
      <div className="game-chat-header"><strong>Chat</strong>
        <div className="game-chat-header-actions">{muteButton(floatingId)}
          <button ref={closeFloating} className="chat-close secondary" type="button" aria-label="Close floating chat" onClick={onCloseFloating}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </div>
      {muteError && <small className="game-chat-error" role="alert">{muteError}</small>}
      <div className="game-chat-content"><div className="game-chat-tab">{conversation(floatingId, true, true)}</div></div>
    </aside>}
  </>;
}
