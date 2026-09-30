import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChallengeSummary, GameReadResponse, GuestSessionResponse,
  MoveAcceptedResponse } from '@chess/contracts';
import { applyAcceptedMove, boardRows, mergeConfirmedGame, replayFen, replayPly,
  pieceBelongsTo, type Piece, type Square } from './board-model';
import { boardMove, pieceAt, pieceImage } from './board-interaction';
import { analysisStorageKey, createAnalysisTree, cursorFen, cursorSide, deleteVariation,
  mainAncestorPly, nextPosition, playAnalysisMove, previousPosition, restoreAnalysis,
  selectBranch, selectMain, serializeAnalysis, type AnalysisCursor, type AnalysisTree } from './analysis-model';
import { ClockPanel } from './ClockPanel';
import { MoveTree } from './MoveTree';

const challengeId = /^\/challenge\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null;
const pollIntervalMs = 4_000;
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
  const [selectedReplayPly, setSelectedReplayPly] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisTree | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisWarning, setAnalysisWarning] = useState<string | null>(null);
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
  const boardRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<{ id: number; from: Square; piece: Piece; x: number; y: number;
    moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ from: Square; piece: Piece; x: number; y: number } | null>(null);

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
    if (game?.status !== 'finished' || analysis?.gameId === game.id) return;
    try {
      const raw = window.localStorage.getItem(analysisStorageKey(game.id));
      const restored = raw === null ? null : restoreAnalysis(game, raw);
      setAnalysis(restored ?? createAnalysisTree(game));
      setAnalysisWarning(raw !== null && restored === null
        ? 'Older or invalid local analysis was reset. The saved game is unchanged.' : null);
    } catch {
      setAnalysis(createAnalysisTree(game));
      setAnalysisWarning('Browser storage is unavailable; analysis may not survive a refresh.');
    }
  }, [game?.id, game?.status, analysis?.gameId]);

  useEffect(() => {
    if (game?.status !== 'finished' || analysis?.gameId !== game.id) return;
    try { window.localStorage.setItem(analysisStorageKey(game.id), serializeAnalysis(analysis)); }
    catch { setAnalysisWarning('Browser storage is unavailable; analysis may not survive a refresh.'); }
  }, [game?.id, game?.status, analysis]);

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

  function inputPosition() {
    const current = gameRef.current;
    if (current === null || promotion !== null
      || (!analysisOpen && (pendingRef.current !== null || posting.current))) return null;
    if (!analysisOpen && (current.status !== 'active'
      || current.position.sideToMove !== current.yourSeat)) return null;
    if (analysisOpen && (current.status !== 'finished' || analysis === null)) return null;
    const positionFen = analysisOpen && analysis !== null ? cursorFen(analysis, current)
      : current.position.fen;
    const sideToMove = analysisOpen && analysis !== null ? cursorSide(analysis, current)
      : current.position.sideToMove;
    return { current, positionFen, sideToMove };
  }

  function attemptBoardMove(from: Square, target: Square | null) {
    const input = inputPosition();
    if (input === null) return;
    const move = boardMove(input.positionFen, input.sideToMove, from, target);
    setSelected(null);
    if (move.kind === 'invalid') return;
    if (move.kind === 'promotion') { setPromotion({ from: move.from, to: move.to }); return; }
    if (analysisOpen && analysis !== null) submitAnalysisMove(analysis, input.current, move.from, move.to);
    else void submitMove({ requestId: crypto.randomUUID(), expectedVersion: input.current.version,
      from: move.from, to: move.to });
  }

  function chooseSquare(square: Square) {
    if (suppressClick.current) return;
    const input = inputPosition();
    if (input === null) return;
    const piece = pieceAt(input.positionFen, square);
    if (selected === null) {
      if (pieceBelongsTo(piece, input.sideToMove)) setSelected(square);
      return;
    }
    if (selected === square) { setSelected(null); return; }
    if (pieceBelongsTo(piece, input.sideToMove)
      && boardMove(input.positionFen, input.sideToMove, selected, square).kind === 'invalid') {
      setSelected(square);
      return;
    }
    attemptBoardMove(selected, square);
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, square: Square, piece: Piece | null) {
    const input = inputPosition();
    if (event.button !== 0 || input === null || !pieceBelongsTo(piece, input.sideToMove)) return;
    pointer.current = { id: event.pointerId, from: square, piece: piece!,
      x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const active = pointer.current;
    if (active === null || active.id !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 6) return;
    active.moved = true;
    setDrag({ from: active.from, piece: active.piece, x: event.clientX, y: event.clientY });
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const active = pointer.current;
    if (active === null || active.id !== event.pointerId) return;
    pointer.current = null;
    setDrag(null);
    if (!active.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>('[data-square]');
    if (target === null || target === undefined || !boardRef.current?.contains(target)) {
      attemptBoardMove(active.from, null);
      return;
    }
    attemptBoardMove(active.from, target.dataset.square as Square);
  }

  function cancelDrag() {
    pointer.current = null;
    setDrag(null);
  }

  function submitAnalysisMove(tree: AnalysisTree, current: GameReadResponse, from: Square, to: Square,
    promotionPiece?: 'q' | 'r' | 'b' | 'n') {
    const result = playAnalysisMove(tree, current, from, to, promotionPiece);
    if (result.accepted) {
      setAnalysis(result.tree);
      setAnalysisError(null);
    } else setAnalysisError(result.result.message);
  }

  function selectMove(cursor: AnalysisCursor) {
    if (cursor.kind === 'branch') {
      if (analysis !== null) setAnalysis(selectBranch(analysis, cursor.id));
    } else if (analysisOpen && analysis !== null && game !== null) {
      setAnalysis(selectMain(analysis, game, cursor.ply));
    } else setSelectedReplayPly(cursor.ply);
    setSelected(null);
    setAnalysisError(null);
  }

  function removeVariation(id: number, notation: string) {
    if (analysis !== null && window.confirm(`Delete ${notation} and all moves after it in this branch?`)) {
      setAnalysis(deleteVariation(analysis, id));
      setSelected(null);
      setAnalysisError(null);
    }
  }

  const link = challenge ? `${window.location.origin}${challenge.path}` : '';
  const canMove = game?.status === 'active' && game.position.sideToMove === game.yourSeat
    && pending === null && !submitting;
  const replaying = game?.status === 'finished';
  const displayedPly = game === null ? 0 : replayPly(
    analysisOpen && analysis !== null ? mainAncestorPly(analysis)
      : selectedReplayPly ?? game.history.length, game.history.length);
  const rows = game === null ? null : boardRows(
    analysisOpen && analysis !== null ? cursorFen(analysis, game)
      : replaying ? replayFen(game, displayedPly) : game.position.fen, game.yourSeat);
  const canSelectSquare = analysisOpen && analysis !== null || canMove;
  const activeBranchId = analysis?.cursor.kind === 'branch' ? analysis.cursor.id : null;
  const result = game?.result;
  const resultText = result === null || result === undefined ? null
    : result.outcome === 'draw' ? `Draw by ${result.reason.replaceAll('_', ' ')}.`
      : `${result.winner === 'white' ? 'White' : 'Black'} won by ${result.reason.replaceAll('_', ' ')}.`;

  return (
    <main className={challengeId === null ? 'home-page' : 'challenge-page'}>
      <header><span className="mark" aria-hidden="true">♞</span><span>CHESS PLATFORM</span>
        {challenge?.status === 'accepted' && <a className="new-challenge" href="/">Create another challenge</a>}
      </header>
      {challengeId === null && <section className="intro">
        <p className="eyebrow">Guest challenge preview</p>
        <h1>Challenge a friend.</h1>
        <p className="description">Create a challenge and share its link with a second guest.</p>
      </section>}
      {challenge?.status !== 'accepted' && <section className="notice"
        aria-labelledby="challenge-title">
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
        {challenge !== null && <details className="challenge-details" open>
          <summary>Challenge details</summary>
          <p className="status">Waiting for a second guest</p>
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
        </details>}
      </section>}

      {challenge?.status === 'accepted' && challenge.yourSeat !== null && <section className="game-area" aria-labelledby="game-title">
        <h1 id="game-title" className="visually-hidden">Chess game</h1>
        {game === null && gameError === null && <p role="status">Loading the confirmed position…</p>}
        {game === null && gameError !== null && <p className="error" role="alert">{gameError}</p>}
        {game !== null && rows !== null && <>
          <div className="game-layout">
            <div className="play-column">
              <div className="board" role="group" ref={boardRef} aria-label={`Chess board, ${game.yourSeat} side at the bottom`}>
                {rows.flat().map(({ square, piece, dark }) =>
                  <button key={square} type="button"
                    className={`square ${dark ? 'dark' : 'light'} ${selected === square ? 'selected' : ''} ${drag?.from === square ? 'drag-origin' : ''}`}
                    data-square={square}
                    aria-label={`${square}, ${piece === null ? 'empty' : `${piece === piece.toUpperCase() ? 'white' : 'black'} ${pieceNames[piece.toLowerCase()]}`}`}
                    aria-pressed={selected === square}
                    disabled={!canSelectSquare || promotion !== null}
                    onPointerDown={event => beginDrag(event, square, piece)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                    onClick={() => chooseSquare(square)}>
                    {piece !== null && <img className="piece" src={pieceImage(piece)} alt="" draggable={false} />}
                    <span className="coordinate" aria-hidden="true">{square}</span>
                  </button>)}
              </div>
              {drag !== null && <img className="drag-piece" src={pieceImage(drag.piece)} alt=""
                style={{ left: drag.x, top: drag.y, width: (boardRef.current?.clientWidth ?? 512) / 8,
                  height: (boardRef.current?.clientWidth ?? 512) / 8 }} aria-hidden="true" draggable={false} />}
              <p className="board-hint">{analysisOpen
                ? `Analysis: ${analysis !== null && cursorSide(analysis, game) === 'white' ? 'White' : 'Black'} to move. Select or drag a piece.`
                : canMove ? 'Select or drag one of your pieces.'
                  : game.status === 'finished' ? 'Select Analysis to explore legal alternatives.'
                    : 'Move input is available on your turn.'}</p>
              <p className="clock-policy" role="note">{challenge.game.clocks === 'not_integrated'
                ? 'This earlier challenge is untimed.'
                : '5+3 server clock · Time continues through disconnects and server outages. The server decides deadlines.'}</p>
            </div>
            <aside className="game-sidebar" aria-label="Game controls and moves">
              <ClockPanel clock={game.clocks} side={game.yourSeat === 'white' ? 'black' : 'white'} isYou={false} />
              <div className="move-panel">
                {replaying && <div className="replay" aria-label="Saved game replay">
                  <p className="replay-position" aria-live="polite">{analysisOpen && activeBranchId !== null
                    ? `Variation after ${analysis?.nodes.find(item => item.id === activeBranchId)?.san}`
                    : displayedPly === 0 ? 'Starting position'
                      : `After ${Math.ceil(displayedPly / 2)}${displayedPly % 2 === 1 ? '.' : '...'} ${game.history[displayedPly - 1]?.san}`}</p>
                  <div className="replay-controls">
                    <button type="button" className="secondary" disabled={displayedPly === 0 && !analysisOpen}
                      onClick={() => { if (analysisOpen && analysis !== null) setAnalysis(selectMain(analysis, game, 0));
                        else setSelectedReplayPly(0); setSelected(null); }} aria-label="Starting position">Start</button>
                    <button type="button" className="secondary"
                      disabled={analysisOpen ? analysis?.cursor.kind === 'main' && analysis.cursor.ply === 0 : displayedPly === 0}
                      onClick={() => { if (analysisOpen && analysis !== null) setAnalysis(previousPosition(analysis));
                        else setSelectedReplayPly(displayedPly - 1); setSelected(null); }}
                      aria-label="Previous move">Previous</button>
                    <button type="button" className="secondary"
                      disabled={analysisOpen ? analysis !== null && nextPosition(analysis, game) === analysis
                        : displayedPly === game.history.length}
                      onClick={() => { if (analysisOpen && analysis !== null) setAnalysis(nextPosition(analysis, game));
                        else setSelectedReplayPly(displayedPly + 1); setSelected(null); }}
                      aria-label="Next move">Next</button>
                    <button type="button" className="secondary" disabled={displayedPly === game.history.length && !analysisOpen}
                      onClick={() => { if (analysisOpen && analysis !== null)
                        setAnalysis(selectMain(analysis, game, game.history.length));
                      else setSelectedReplayPly(game.history.length); setSelected(null); }}
                      aria-label="Final position">End</button>
                  </div>
                  {analysisOpen && <p className="analysis-local">Variations are saved only in this browser.
                    The game and clocks never change.</p>}
                  {analysisWarning !== null && <p className="info" role="status">{analysisWarning}</p>}
                </div>}
                {replaying && <p className="move-legend">Saved line{analysisOpen ? ' · Indented moves are local variations' : ''}</p>}
                {analysisError !== null && <p className="error" role="alert">{analysisError}</p>}
                <MoveTree game={game} tree={analysisOpen ? analysis : null} interactive={replaying}
                  selected={analysisOpen && analysis !== null ? analysis.cursor
                    : { kind: 'main', ply: displayedPly }}
                  onSelect={selectMove} onDelete={removeVariation} />
              </div>
              <div className="game-controls">
                {gameError !== null && <p className="error" role="alert">{gameError}</p>}
                {gameInfo !== null && <p className="info" role="status">{gameInfo}</p>}
                <p className="turn" role="status">{resultText ?? (game.status === 'pending_adjudication'
                  ? 'A clock flagged. The game is frozen while its result awaits adjudication.'
                  : game.clocks?.phase === 'awaiting_first_move'
                    ? 'Waiting for White’s first move. Both clocks stay at 5:00; Black’s clock starts after that move is saved.'
                  : game.status === 'waiting' ? 'Waiting for both guests to be ready.'
                    : canMove ? `Your turn (${game.yourSeat}).`
                      : `${game.position.sideToMove === 'white' ? 'White' : 'Black'} to move${game.position.sideToMove === game.yourSeat ? '.' : ' — waiting for your opponent.'}`)}</p>
                {game.status === 'waiting' && game.clocks !== null && <div className="readiness">
                  <p>{game.clocks.ready[game.yourSeat]
                    ? 'You are ready. Waiting for the other guest.'
                    : 'Press Ready when you are prepared to start. White’s clock begins when both guests are ready.'}</p>
                  {!game.clocks.ready[game.yourSeat] && <button type="button" disabled={readyBusy || submitting}
                    onClick={() => void markReady()}>{readyBusy ? 'Confirming…' : 'Ready to start'}</button>}
                </div>}
                <div className="game-actions">
                  {game.status === 'finished' && <button type="button" aria-pressed={analysisOpen}
                    onClick={() => {
                      if (analysisOpen && analysis !== null) setSelectedReplayPly(mainAncestorPly(analysis));
                      else if (analysis !== null && selectedReplayPly !== null)
                        setAnalysis(selectMain(analysis, game, selectedReplayPly));
                      setAnalysisOpen(!analysisOpen);
                      setSelected(null); setPromotion(null); setAnalysisError(null);
                    }}>{analysisOpen ? 'Close analysis' : 'Analysis'}</button>}
                  <button type="button" className="secondary" onClick={() => void refreshGame()}>Refresh position</button>
                </div>
                {promotion !== null && <div className="promotion-choice" role="dialog" aria-label="Choose a promotion piece">
                  <p>Promote your pawn to:</p>
                  <div>{([['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']] as const).map(([piece, name]) =>
                    <button key={piece} ref={piece === 'q' ? promotionFocus : undefined} type="button" onClick={() => {
                      const current = gameRef.current;
                      setPromotion(null);
                      setSelected(null);
                      if (analysisOpen && analysis !== null && current)
                        submitAnalysisMove(analysis, current, promotion.from, promotion.to, piece);
                      else if (current) void submitMove({ requestId: crypto.randomUUID(), expectedVersion: current.version,
                        from: promotion.from, to: promotion.to, promotion: piece });
                    }}>{name}</button>)}</div>
                  <button type="button" className="secondary" onClick={() => setPromotion(null)}>Cancel</button>
                </div>}
                {pending !== null && !submitting && <div className="retry">
                  <p>The move has not been confirmed. Retry the same request to learn whether it was saved.</p>
                  <button type="button" onClick={() => void submitMove(pending, true)}>Retry move</button>
                </div>}
                {submitting && <p role="status">Waiting for server confirmation…</p>}
                <details className="share-menu">
                  <summary>Challenge link</summary>
                  <label htmlFor="challenge-link">Shareable link</label>
                  <input id="challenge-link" readOnly value={link}
                    onFocus={event => event.currentTarget.select()} />
                </details>
              </div>
              <ClockPanel clock={game.clocks} side={game.yourSeat} isYou />
            </aside>
          </div>
        </>}
      </section>}
      {challenge?.status !== 'accepted' && <footer>Play with focus. Learn from every game.</footer>}
    </main>
  );
}
