import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameChatHistory, GameChatMessage, GamePlayerNames, GameSide, GameState } from '@chess/contracts';
import { sitePlayerName } from './PlayerIdentity';
import { GameNotes } from './GameNotes';
import { chatComposerState, chatEnterSubmits, chatMessageLimit, chatPresets, chatResponse, mergeChatMessages, nearChatBottom,
  type ChatPermission } from './game-chat';

interface Props { gameId: string; side: GameSide; gameStatus: GameState['status']; csrfToken: string; revision: number;
  playerNames?: GamePlayerNames | undefined; analysisOpen?: boolean }

export function ChatMessage({ item, side, playerNames }: { item: GameChatMessage; side: GameSide;
  playerNames?: GamePlayerNames | undefined }) {
  const name = sitePlayerName(playerNames, item.side);
  const label = playerNames?.[item.side] ? name : `${name} (${item.side === 'white' ? 'White' : 'Black'})`;
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
    <div className="game-chat-presets" role="group" aria-label="Quick chat messages">
      {chatPresets.map(preset => <button className="secondary" type="button" key={preset}
        disabled={sending || retrying || state !== 'allowed'} aria-label={`Send ${preset}`}
        onClick={() => onSend(preset)}>{preset}</button>)}
    </div>
  </form>;
}

export function GameChat({ gameId, side, gameStatus, csrfToken, revision, playerNames, analysisOpen = false }: Props) {
  const [activePanel, setActivePanel] = useState<'chat' | 'notes'>('chat');
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
  const storageKey = `game-chat-hidden:${gameId}:${side}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'true'; } catch { return false; }
  });
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const pending = useRef<{ requestId: string; text: string; preset: boolean } | null>(null);
  const posting = useRef(false);
  const mounted = useRef(false);
  const reading = useRef(false);
  const requested = useRef(false);

  const receive = useCallback((incoming: readonly GameChatMessage[]) => {
    const next = mergeChatMessages(messagesRef.current, incoming);
    const changed = next.at(-1)?.id !== messagesRef.current.at(-1)?.id;
    messagesRef.current = next;
    setMessages(next);
    if (changed && !following.current) setNewMessages(true);
  }, []);
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
        receive(history.messages);
        setPermission({ status: statusAtRead, canSend: history.canSend });
        setLoaded(true);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && 'definitive' in cause
        ? cause.message : 'Chat could not connect. Please retry.');
    } finally { reading.current = false; }
  }, [gameId, receive]);

  useEffect(() => {
    mounted.current = true;
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => { void refresh(); }, [revision, gameStatus, refresh]);
  useLayoutEffect(() => {
    if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, hidden]);

  function toggleHidden() {
    setHidden(value => {
      try { localStorage.setItem(storageKey, String(!value)); } catch { /* Hiding still works without storage. */ }
      return !value;
    });
  }
  async function send(preset?: string) {
    if (posting.current || composerState !== 'allowed' || preset !== undefined && pending.current !== null) return;
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

  const tabs = <div className="analysis-view-tabs" role="group" aria-label="Game conversation and private notes">
    <button type="button" aria-pressed={activePanel === 'chat'} onClick={() => setActivePanel('chat')}>Chat</button>
    <button type="button" aria-pressed={activePanel === 'notes'} onClick={() => setActivePanel('notes')}>Notes</button>
  </div>;
  return <aside className="game-chat" data-hidden={hidden} data-analysis={analysisOpen}
    aria-label="Game conversation and private notes">
    <div className="game-chat-header">{tabs}
      <button className="secondary" type="button" onClick={toggleHidden} aria-expanded={!hidden}
        aria-controls={`chat-content-${gameId}`}>{hidden ? 'Show' : 'Hide'}</button></div>
    <div className="game-chat-content" id={`chat-content-${gameId}`} hidden={hidden}>
    <div className="game-notes-tab" hidden={hidden || activePanel !== 'notes'}><GameNotes gameId={gameId} csrfToken={csrfToken}
      active={!hidden && activePanel === 'notes'} /></div>
    <div className="game-chat-tab" hidden={hidden || activePanel !== 'chat'}>
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
  </aside>;
}
