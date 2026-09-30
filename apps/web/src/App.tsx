import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChallengeSummary, GameReadResponse, GuestSessionResponse,
  MoveAcceptedResponse } from '@chess/contracts';
import { applyAcceptedMove, boardRows, mergeConfirmedGame, needsPromotion,
  pieceBelongsTo, type Piece, type Square } from './board-model';
import { ClockPanel } from './ClockPanel';

const challengeId = /^\/challenge\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null;
const pollIntervalMs = 4_000;
const glyphs: Record<Piece, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};
const pieceNames: Record<string, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

const errors: Record<string, string> = {
  guest_session_required: 'Your guest session expired. Refresh the page to start a new session.',
  invalid_csrf_token: 'Your guest session changed. Refresh the page and try again.',
  challenge_not_found: 'This challenge link does not exist.',
  game_not_found: 'The saved game could not be found.',
  not_a_participant: 'This challenge belongs to two other guests.',
  cannot_accept_own_challenge: 'Open this link in another browser or private window to join as a second guest.',
  seat_taken: 'Another guest has already accepted this challenge.',
  wrong_turn: 'It is not your turn. The position will be refreshed.',
  illegal_move: 'That move is not legal in the confirmed position.',
  promotion_required: 'Choose a promotion piece before moving.',
  game_finished: 'The game has finished. The position will be refreshed.',
  request_id_conflict: 'This retry ID was used for a different move. Refresh the page.',
  clock_not_started: 'Both guests must press Ready before White’s clock starts.',
  received_before_turn: 'This move arrived before your turn began. The position will be refreshed.',
  flag_fell: 'The server recorded a flag at the clock deadline. The position will be refreshed.',
  adjudication_pending: 'The clock flagged and the result is awaiting adjudication.',
  legacy_untimed_game: 'This earlier challenge remains an untimed preview.',
};

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

async function responseBody<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : '';
    const message = errors[code] ?? `The server returned ${response.status}.`;
    throw new ApiError(code, response.status, message);
  }
  return body as T;
}

let guestSessionRequest: Promise<GuestSessionResponse> | null = null;
function loadGuestSession(): Promise<GuestSessionResponse> {
  guestSessionRequest ??= fetch('/api/guest-session', { cache: 'no-store' })
    .then(response => responseBody<GuestSessionResponse>(response))
    .catch(cause => { guestSessionRequest = null; throw cause; });
  return guestSessionRequest;
}

interface PendingMove {
  requestId: string;
  expectedVersion: number;
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export function App() {
  const [session, setSession] = useState<GuestSessionResponse | null>(null);
  const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState<GameReadResponse | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [gameInfo, setGameInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const createRequestId = useRef<string | null>(null);
  const promotionFocus = useRef<HTMLButtonElement | null>(null);
  const challengeFetch = useRef<Promise<void> | null>(null);
  const gameFetch = useRef<Promise<boolean> | null>(null);
  const posting = useRef(false);
  const gameRef = useRef<GameReadResponse | null>(null);
  const pendingRef = useRef<PendingMove | null>(null);

  useEffect(() => { if (promotion !== null) promotionFocus.current?.focus(); }, [promotion]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const guest = await loadGuestSession();
        if (active) setSession(guest);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The server is unavailable.');
      }
    })();
    return () => { active = false; };
  }, []);

  const refreshChallenge = useCallback((): Promise<void> => {
    if (challengeId === null || challengeFetch.current !== null) {
      return challengeFetch.current ?? Promise.resolve();
    }
    const work = (async () => {
      try {
        const found = await responseBody<ChallengeSummary>(
          await fetch(`/api/challenges/${challengeId}`, { cache: 'no-store' }),
        );
        setChallenge(current => current?.status === 'accepted' && found.status === 'open'
          ? current : found);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not refresh the challenge.');
      }
    })();
    challengeFetch.current = work;
    void work.then(() => { if (challengeFetch.current === work) challengeFetch.current = null; });
    return work;
  }, []);

  const refreshGame = useCallback((): Promise<boolean> => {
    if (challengeId === null || posting.current) return Promise.resolve(false);
    if (gameFetch.current !== null) return gameFetch.current;
    const work = (async () => {
      try {
        const found = await responseBody<GameReadResponse>(
          await fetch(`/api/games/${challengeId}`, { cache: 'no-store' }),
        );
        const previous = gameRef.current;
        const confirmed = mergeConfirmedGame(previous, found);
        if (confirmed !== previous) {
          gameRef.current = confirmed;
          setGame(confirmed);
          if (previous?.version !== confirmed.version) {
            setSelected(null);
            setPromotion(null);
          }
        }
        setGameError(null);
        return true;
      } catch (cause) {
        setGameError(cause instanceof Error ? cause.message : 'Could not refresh the game.');
        return false;
      }
    })();
    gameFetch.current = work;
    void work.then(() => { if (gameFetch.current === work) gameFetch.current = null; });
    return work;
  }, []);

  useEffect(() => {
    if (session === null || challengeId === null || challenge?.status === 'accepted') return;
    void refreshChallenge();
    const timer = window.setInterval(() => { void refreshChallenge(); }, pollIntervalMs);
    const onFocus = () => { void refreshChallenge(); };
    const onVisible = () => { if (!document.hidden) void refreshChallenge(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible); };
  }, [session, challenge?.status, refreshChallenge]);

  useEffect(() => {
    if (challenge?.status !== 'accepted' || challenge.yourSeat === null) return;
    void refreshGame();
    const timer = window.setInterval(() => { void refreshGame(); }, pollIntervalMs);
    const onFocus = () => { void refreshGame(); };
    const onVisible = () => { if (!document.hidden) void refreshGame(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible); };
  }, [challenge?.status, challenge?.yourSeat, refreshGame]);

  async function createChallenge() {
    if (session === null) return;
    setBusy(true);
    setError(null);
    createRequestId.current ??= crypto.randomUUID();
    try {
      const created = await responseBody<ChallengeSummary>(await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Idempotency-Key': createRequestId.current, 'X-CSRF-Token': session.csrfToken },
      }));
      window.location.assign(created.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the challenge.');
      setBusy(false);
    }
  }

  async function acceptChallenge() {
    if (session === null || challengeId === null) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await responseBody<ChallengeSummary>(await fetch(
        `/api/challenges/${challengeId}/accept`,
        { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken } },
      ));
      setChallenge(accepted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept the challenge.');
    } finally {
      setBusy(false);
    }
  }

  async function markReady() {
    if (session === null || challengeId === null || posting.current) return;
    posting.current = true;
    setReadyBusy(true);
    setGameError(null);
    if (gameFetch.current !== null) await gameFetch.current;
    try {
      const confirmed = await responseBody<GameReadResponse>(await fetch(
        `/api/games/${challengeId}/ready`, {
          method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken },
        },
      ));
      const merged = mergeConfirmedGame(gameRef.current, confirmed);
      gameRef.current = merged;
      setGame(merged);
      setSelected(null);
    } catch (cause) {
      setGameError(cause instanceof Error ? cause.message : 'Could not mark you ready. Try again.');
    } finally {
      posting.current = false;
      setReadyBusy(false);
    }
    void refreshGame();
  }

  function clearPending() {
    pendingRef.current = null;
    setPending(null);
  }

  async function submitMove(command: PendingMove, retry = false) {
    if (session === null || challengeId === null || posting.current || (!retry && pendingRef.current)) return;
    pendingRef.current = command;
    setPending(command);
    setSubmitting(true);
    setGameError(null);
    setGameInfo(null);
    posting.current = true;
    if (gameFetch.current !== null) await gameFetch.current;
    if (!retry && (gameRef.current?.version !== command.expectedVersion
      || gameRef.current.status !== 'active'
      || gameRef.current.position.sideToMove !== gameRef.current.yourSeat)) {
      clearPending();
      posting.current = false;
      setSubmitting(false);
      setGameInfo('The position changed before your move was sent. Review the confirmed board.');
      void refreshGame();
      return;
    }

    let shouldRefresh = false;
    let stale = false;
    try {
      const accepted = await responseBody<MoveAcceptedResponse>(await fetch(
        `/api/games/${challengeId}/moves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
            'Idempotency-Key': command.requestId },
          body: JSON.stringify({ expectedVersion: command.expectedVersion, from: command.from,
            to: command.to, ...(command.promotion ? { promotion: command.promotion } : {}) }),
        },
      ));
      const confirmed = applyAcceptedMove(gameRef.current, accepted);
      if (confirmed !== null && confirmed !== gameRef.current) {
        gameRef.current = confirmed;
        setGame(confirmed);
      }
      setSelected(null);
      setPromotion(null);
      clearPending();
      shouldRefresh = true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) {
        clearPending();
        stale = cause.code === 'stale_version';
        shouldRefresh = stale || ['wrong_turn', 'game_finished', 'flag_fell',
          'clock_not_started', 'received_before_turn', 'adjudication_pending'].includes(cause.code);
        if (!stale) setGameError(cause.message);
      } else {
        setGameError('The move was not confirmed. Retry it with the same request ID; the board has not changed.');
      }
    } finally {
      posting.current = false;
      setSubmitting(false);
    }
    const refreshed = shouldRefresh ? await refreshGame() : false;
    if (stale) setGameInfo(refreshed
      ? 'The position changed before your move was accepted. The confirmed game has been reloaded.'
      : 'The position changed before your move was accepted. Use Refresh position to reload the confirmed game.');
  }

  function chooseSquare(square: Square) {
    const current = gameRef.current;
    if (current === null || current.status !== 'active' || current.position.sideToMove !== current.yourSeat
      || pendingRef.current !== null || posting.current || promotion !== null) return;
    const rows = boardRows(current.position.fen, current.yourSeat);
    const piece = rows.flat().find(item => item.square === square)?.piece ?? null;
    if (selected === null) {
      if (pieceBelongsTo(piece, current.yourSeat)) setSelected(square);
      return;
    }
    if (selected === square) { setSelected(null); return; }
    if (pieceBelongsTo(piece, current.yourSeat)) { setSelected(square); return; }
    const selectedPiece = rows.flat().find(item => item.square === selected)?.piece ?? null;
    if (needsPromotion(selectedPiece, square)) { setPromotion({ from: selected, to: square }); return; }
    setSelected(null);
    void submitMove({ requestId: crypto.randomUUID(), expectedVersion: current.version,
      from: selected, to: square });
  }

  const link = challenge ? `${window.location.origin}${challenge.path}` : '';
  const canMove = game?.status === 'active' && game.position.sideToMove === game.yourSeat
    && pending === null && !submitting;
  const rows = game === null ? null : boardRows(game.position.fen, game.yourSeat);
  const result = game?.result;
  const resultText = result === null || result === undefined ? null
    : result.outcome === 'draw' ? `Draw by ${result.reason.replaceAll('_', ' ')}.`
      : `${result.winner === 'white' ? 'White' : 'Black'} won by ${result.reason.replaceAll('_', ' ')}.`;

  return (
    <main>
      <header><span className="mark" aria-hidden="true">♞</span><span>CHESS PLATFORM</span></header>
      <section className="intro">
        <p className="eyebrow">Guest challenge preview</p>
        <h1>{challengeId === null ? 'Challenge a friend.' : 'Your challenge.'}</h1>
        <p className="description">{challengeId === null
          ? 'Create a challenge and share its link with a second guest.'
          : 'The server confirms moves and controls the clock. This is still a development preview.'}</p>
      </section>
      <section className="notice" aria-labelledby="challenge-title">
        <div className="section-heading">
          <h2 id="challenge-title">{challengeId === null ? 'Create a challenge' : 'Challenge'}</h2>
          {challengeId !== null && <a href="/">Create another challenge</a>}
        </div>
        {session === null && error === null && <p role="status">Starting your guest session…</p>}
        {error !== null && <p className="error" role="alert">{error}</p>}
        {challengeId === null && session !== null && (
          <button type="button" disabled={busy} onClick={() => void createChallenge()}>
            {busy ? 'Creating…' : 'Create challenge'}
          </button>
        )}
        {challenge !== null && <>
          <p className="status">{challenge.status === 'open' ? 'Waiting for a second guest' : 'Both seats are filled'}</p>
          <div className="seats">
            <p>White <strong>{challenge.yourSeat === 'white' ? 'You' : 'Occupied'}</strong></p>
            <p>Black <strong>{challenge.yourSeat === 'black' ? 'You' : challenge.seats.black === 'open' ? 'Open' : 'Occupied'}</strong></p>
          </div>
          <label htmlFor="challenge-link">Shareable link</label>
          <input id="challenge-link" readOnly value={link} onFocus={event => event.currentTarget.select()} />
          {challenge.status === 'open' && challenge.yourSeat === 'white' &&
            <p>Open the link in another browser or private window to use a different guest session.</p>}
          {challenge.status === 'open' && challenge.yourSeat === null &&
            <button type="button" disabled={busy} onClick={() => void acceptChallenge()}>
              {busy ? 'Joining…' : 'Accept challenge as Black'}
            </button>}
        </>}
      </section>

      {challenge?.status === 'accepted' && challenge.yourSeat !== null && <section className="game-area" aria-labelledby="game-title">
        <div className="preview-warning" role="note">{challenge.game.clocks === 'not_integrated'
          ? <><strong>No clocks are running.</strong> This earlier challenge remains an untimed preview.</>
          : <><strong>5+3 server clock.</strong> Time continues during disconnects and server outages.
            The displayed countdown is an estimate; the server decides the deadline and result.</>}</div>
        <div className="game-heading">
          <h2 id="game-title">Saved game</h2>
          <button type="button" className="secondary" onClick={() => void refreshGame()}>Refresh position</button>
        </div>
        {game === null && gameError === null && <p role="status">Loading the confirmed position…</p>}
        {gameError !== null && <p className="error" role="alert">{gameError}</p>}
        {gameInfo !== null && <p className="info" role="status">{gameInfo}</p>}
        {game !== null && rows !== null && <>
          {game.clocks !== null && <ClockPanel clock={game.clocks} />}
          {game.status === 'waiting' && game.clocks !== null && <div className="readiness">
            <p>{game.clocks.ready[game.yourSeat]
              ? 'You are ready. Waiting for the other guest.'
              : 'Press Ready when you are prepared to start. White’s clock begins when both guests are ready.'}</p>
            {!game.clocks.ready[game.yourSeat] && <button type="button" disabled={readyBusy || submitting}
              onClick={() => void markReady()}>{readyBusy ? 'Confirming…' : 'Ready to start'}</button>}
          </div>}
          <p className="turn" role="status">{resultText ?? (game.status === 'pending_adjudication'
            ? 'A clock flagged. The game is frozen while its result awaits adjudication.'
            : game.status === 'waiting' ? 'Waiting for both guests to be ready.'
              : canMove ? `Your turn (${game.yourSeat}).`
                : `${game.position.sideToMove === 'white' ? 'White' : 'Black'} to move${game.position.sideToMove === game.yourSeat ? '.' : ' — waiting for your opponent.'}`)}</p>
          <div className="game-layout">
            <div>
              <div className="board" role="group" aria-label={`Chess board, ${game.yourSeat} side at the bottom`}>
                {rows.flat().map(({ square, piece, dark }) =>
                  <button key={square} type="button"
                    className={`square ${dark ? 'dark' : 'light'} ${selected === square ? 'selected' : ''}`}
                    aria-label={`${square}, ${piece === null ? 'empty' : `${piece === piece.toUpperCase() ? 'white' : 'black'} ${pieceNames[piece.toLowerCase()]}`}`}
                    aria-pressed={selected === square}
                    disabled={!canMove || promotion !== null}
                    onClick={() => chooseSquare(square)}>
                    <span className={`piece ${piece !== null && piece === piece.toUpperCase() ? 'white-piece' : ''}`}
                      aria-hidden="true">{piece === null ? '' : glyphs[piece]}</span>
                    <span className="coordinate" aria-hidden="true">{square}</span>
                  </button>)}
              </div>
              <p className="board-hint">{canMove ? 'Select one of your pieces, then its destination.'
                : game.status === 'finished' ? 'This game is finished.' : 'Move input is available on your turn.'}</p>
            </div>
            <aside className="moves" aria-label="Confirmed move list">
              <h3>Moves</h3>
              {game.history.length === 0 ? <p>No confirmed moves yet.</p>
                : <ol>{Array.from({ length: Math.ceil(game.history.length / 2) }, (_, index) =>
                  <li key={index}><span>{index + 1}.</span><span>{game.history[index * 2]?.san}</span>
                    <span>{game.history[index * 2 + 1]?.san ?? '…'}</span></li>)}</ol>}
            </aside>
          </div>
          {promotion !== null && <div className="promotion-choice" role="dialog" aria-label="Choose a promotion piece">
            <p>Promote your pawn to:</p>
            <div>{([['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']] as const).map(([piece, name]) =>
              <button key={piece} ref={piece === 'q' ? promotionFocus : undefined} type="button" onClick={() => {
                const current = gameRef.current;
                setPromotion(null);
                setSelected(null);
                if (current) void submitMove({ requestId: crypto.randomUUID(), expectedVersion: current.version,
                  from: promotion.from, to: promotion.to, promotion: piece });
              }}>{name}</button>)}</div>
            <button type="button" className="secondary" onClick={() => setPromotion(null)}>Cancel</button>
          </div>}
          {pending !== null && !submitting && <div className="retry">
            <p>The move has not been confirmed. Retry the same request to learn whether it was saved.</p>
            <button type="button" onClick={() => void submitMove(pending, true)}>Retry move</button>
          </div>}
          {submitting && <p role="status">Waiting for server confirmation…</p>}
        </>}
      </section>}
      <footer>Play with focus. Learn from every game.</footer>
    </main>
  );
}
