import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChallengeSummary, GameReadResponse, GuestSessionResponse,
  GameActionAcceptedResponse, GameClaimAcceptedResponse, MoveAcceptedResponse } from '@chess/contracts';
import { applyAcceptedAction, applyAcceptedMove, boardRows, mergeConfirmedGame, replayFen, replayPly,
  pieceBelongsTo, type Piece, type Square } from './board-model';
import { availableClaimForPlayer } from './draw-claim-control';
import { boardMove, isLeftPointerPress, keepsPremovesOnLeftPress,
  legalMoveHints, pieceAt, pieceImage } from './board-interaction';
import { boardCoordinates, highlightedMove, materialAdvantage } from './board-display';
import { toggleArrow, type BoardArrow } from './board-arrows';
import { BoardArrows } from './BoardArrows';
import { addPremove, consumePremove, nextPremove, premoveChoice, projectedPieces,
  type Premove } from './premove-model';
import { confirmMoveWithRetry } from './move-confirmation';
import { watchGameUpdates } from './game-update-stream';
import { resultDisplay } from './result-display';
import { analysisStorageKey, createAnalysisTree, cursorFen, cursorSide, deleteVariation,
  lastMainPosition, mainAncestorPly, nextPosition, playAnalysisMove, previousPosition, promoteVariation, restoreAnalysis,
  selectBranch, selectMain, serializeAnalysis, setMoveNote,
  type AnalysisCursor, type AnalysisTree, type MoveNote } from './analysis-model';
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
  draw_too_early: 'Both players must make a move before agreeing to a draw.',
  draw_offer_too_early: 'Both players must make a move before either can offer a draw.',
  draw_offer_cooldown: 'Wait for more moves before offering another draw. The game will refresh.',
  draw_offer_pending: 'There is already an outstanding draw offer.',
  no_draw_offer: 'The draw offer is no longer available. The position will be refreshed.',
  own_draw_offer: 'Only your opponent can respond to your offer.',
  claim_not_available: 'The claim was incorrect; the server has applied the time penalty and draw offer.',
  invalid_claim: 'Choose threefold repetition or the fifty-move rule.',
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
  premoveId?: string;
}
type GameAction = 'resign' | 'offer_draw' | 'accept_draw' | 'decline_draw' | 'claim_draw';
interface PendingAction { requestId: string; expectedVersion: number; kind: GameAction;
  rule?: 'threefold_repetition' | 'fifty_move';
  intendedMove?: { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' } }
const actionPaths: Record<GameAction, string> = {
  resign: 'resign', offer_draw: 'draw-offer', accept_draw: 'draw-accept',
  decline_draw: 'draw-decline', claim_draw: 'draw-claim',
};

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
  const [promotion, setPromotion] = useState<{ from: Square; to: Square; mode: 'analysis' | 'live' | 'premove' } | null>(null);
  const [premoves, setPremoves] = useState<Premove[]>([]);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [arrowPreview, setArrowPreview] = useState<BoardArrow | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resignConfirmationVersion, setResignConfirmationVersion] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [readyBusy, setReadyBusy] = useState(false);
  const createRequestId = useRef<string | null>(null);
  const promotionFocus = useRef<HTMLButtonElement | null>(null);
  const resignFocus = useRef<HTMLButtonElement | null>(null);
  const challengeFetch = useRef<Promise<void> | null>(null);
  const gameFetch = useRef<Promise<boolean> | null>(null);
  const posting = useRef(false);
  const gameRef = useRef<GameReadResponse | null>(null);
  const pendingRef = useRef<PendingMove | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const premovesRef = useRef<Premove[]>([]);
  const premoveAttemptedVersion = useRef<number | null>(null);
  const rightPointer = useRef<{ id: number; from: Square } | null>(null);
  const suppressArrowMenu = useRef(false);
  const arrowMenuReset = useRef<number | null>(null);
  const pointer = useRef<{ id: number; from: Square; piece: Piece; x: number; y: number;
    moved: boolean; canSubmit: boolean; version: number; fen: string | null } | null>(null);
  const suppressClick = useRef(false);
  const suppressDragMenu = useRef(false);
  const dragMenuReset = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ from: Square; piece: Piece; x: number; y: number } | null>(null);

  function updatePremoves(update: Premove[] | ((queue: readonly Premove[]) => Premove[])) {
    const next = typeof update === 'function' ? update(premovesRef.current) : update;
    premovesRef.current = next;
    setPremoves(next);
  }

  function cancelPremoves() {
    updatePremoves([]);
    premoveAttemptedVersion.current = null;
  }

  useEffect(() => { if (promotion !== null) promotionFocus.current?.focus(); }, [promotion]);

  useEffect(() => { setResignConfirmationVersion(null); },
    [game?.id, game?.version, game?.status, challenge?.status, analysisOpen]);

  useEffect(() => {
    if (game?.status !== 'active') {
      updatePremoves([]);
    }
  }, [game?.id, game?.status]);

  useEffect(() => {
    const clearOnLeftDown = (event: PointerEvent) => {
      if (!isLeftPointerPress(event.button, event.pointerType)) return;
      setArrows([]);
      setArrowPreview(null);
      const target = event.target instanceof Element ? event.target : null;
      const square = target?.closest('[data-square]');
      const boardSquare = square !== null && square !== undefined && !!boardRef.current?.contains(square);
      const current = gameRef.current;
      const canQueue = current?.status === 'active' && current.position.sideToMove !== current.yourSeat
        && pendingRef.current === null && pendingActionRef.current === null && !posting.current;
      if (!keepsPremovesOnLeftPress(boardSquare,
        !!target?.closest('.promotion-choice'), canQueue)) {
        premovesRef.current = [];
        setPremoves([]);
        premoveAttemptedVersion.current = null;
      }
    };
    window.addEventListener('pointerdown', clearOnLeftDown, true);
    return () => window.removeEventListener('pointerdown', clearOnLeftDown, true);
  }, []);

  useEffect(() => {
    const cancelWithRightButton = (event: MouseEvent) => {
      if (event.button !== 2 || pointer.current === null) return;
      event.preventDefault();
      armDragMenuSuppression();
      cancelDrag();
      setSelected(null);
      suppressClick.current = true;
    };
    const cancelWithRightClick = (event: MouseEvent) => {
      if (rightPointer.current !== null || (suppressArrowMenu.current
        && boardRef.current?.contains(event.target as Node))) {
        event.preventDefault();
        return;
      }
      if (pointer.current === null && !suppressDragMenu.current) return;
      event.preventDefault();
      cancelDrag();
      setSelected(null);
      suppressClick.current = true;
      suppressDragMenu.current = false;
    };
    const releaseCancelledClick = (event: MouseEvent) => {
      if (event.button === 0 && suppressClick.current) {
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    window.addEventListener('mousedown', cancelWithRightButton, true);
    window.addEventListener('contextmenu', cancelWithRightClick, true);
    window.addEventListener('mouseup', releaseCancelledClick, true);
    return () => {
      window.removeEventListener('mousedown', cancelWithRightButton, true);
      window.removeEventListener('contextmenu', cancelWithRightClick, true);
      window.removeEventListener('mouseup', releaseCancelledClick, true);
      if (dragMenuReset.current !== null) window.clearTimeout(dragMenuReset.current);
      if (arrowMenuReset.current !== null) window.clearTimeout(arrowMenuReset.current);
    };
  }, []);

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
    const stopUpdates = watchGameUpdates(
      () => new EventSource(`/api/games/${challengeId}/events`),
      refreshGame, () => gameFetch.current, pollIntervalMs);
    const onFocus = () => { void refreshGame(); };
    const onVisible = () => { if (!document.hidden) void refreshGame(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopUpdates(); window.removeEventListener('focus', onFocus);
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
    if (session === null || challengeId === null || posting.current || pendingActionRef.current
      || (!retry && pendingRef.current)) return;
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
      const accepted = await confirmMoveWithRetry(async () => responseBody<MoveAcceptedResponse>(await fetch(
        `/api/games/${challengeId}/moves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
            'Idempotency-Key': command.requestId },
          body: JSON.stringify({ expectedVersion: command.expectedVersion, from: command.from,
            to: command.to, ...(command.promotion ? { promotion: command.promotion } : {}) }),
        },
      )), cause => cause instanceof ApiError
        ? cause.code === 'receipt_pending' || cause.status >= 500 : cause instanceof TypeError,
      () => setGameInfo('The server is still confirming this move. Retrying the same request safely…'));
      const confirmed = applyAcceptedMove(gameRef.current, accepted);
      if (confirmed !== null && confirmed !== gameRef.current) {
        gameRef.current = confirmed;
        setGame(confirmed);
      }
      setSelected(null);
      setPromotion(null);
      setGameInfo(null);
      const premoveId = command.premoveId;
      if (premoveId !== undefined) {
        updatePremoves(queue => consumePremove(queue, premoveId));
        premoveAttemptedVersion.current = null;
      }
      clearPending();
      shouldRefresh = true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) {
        clearPending();
        stale = cause.code === 'stale_version';
        shouldRefresh = stale || ['wrong_turn', 'game_finished', 'flag_fell',
          'clock_not_started', 'received_before_turn', 'adjudication_pending'].includes(cause.code);
        if (command.premoveId !== undefined && !stale
          && !['wrong_turn', 'received_before_turn'].includes(cause.code)) updatePremoves([]);
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

  function clearPendingAction() {
    pendingActionRef.current = null;
    setPendingAction(null);
  }

  async function submitAction(command: PendingAction, retry = false) {
    if (session === null || challengeId === null || posting.current || pendingRef.current
      || (!retry && pendingActionRef.current)) return;
    pendingActionRef.current = command;
    setPendingAction(command);
    setSubmitting(true);
    setGameError(null);
    setGameInfo(null);
    posting.current = true;
    if (gameFetch.current !== null) await gameFetch.current;
    if (!retry && (gameRef.current?.version !== command.expectedVersion
      || gameRef.current.status !== 'active')) {
      clearPendingAction();
      posting.current = false;
      setSubmitting(false);
      setGameInfo('The game changed before your action was sent. Review the confirmed state.');
      void refreshGame();
      return;
    }
    let shouldRefresh = false;
    try {
      const accepted = await responseBody<GameActionAcceptedResponse | GameClaimAcceptedResponse>(await fetch(
        `/api/games/${challengeId}/${actionPaths[command.kind]}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
            'Idempotency-Key': command.requestId },
          body: JSON.stringify({ expectedVersion: command.expectedVersion,
            ...(command.kind === 'claim_draw' ? { rule: command.rule,
              ...(command.intendedMove ? { intendedMove: command.intendedMove } : {}) } : {}) }),
        },
      ));
      if (command.kind === 'claim_draw') {
        const claim = accepted as GameClaimAcceptedResponse;
        setGameInfo(claim.claimCorrect ? 'Draw claim accepted.'
          : `Incorrect claim: your opponent received one minute${claim.move
            ? ' and your declared move was played.' : '; your draw offer is pending.'}`);
      } else {
        const confirmed = applyAcceptedAction(gameRef.current, accepted);
        if (confirmed !== null && confirmed !== gameRef.current) {
          gameRef.current = confirmed;
          setGame(confirmed);
        }
      }
      clearPendingAction();
      shouldRefresh = true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) {
        clearPendingAction();
        setGameError(cause.message);
        shouldRefresh = cause.status === 409;
      } else setGameError('The action was not confirmed. Retry it with the same request ID.');
    } finally {
      posting.current = false;
      setSubmitting(false);
    }
    if (shouldRefresh) void refreshGame();
  }

  function beginAction(kind: GameAction) {
    const current = gameRef.current;
    if (current === null || current.status !== 'active' || pendingRef.current
      || pendingActionRef.current || posting.current) return;
    setResignConfirmationVersion(null);
    void submitAction({ requestId: crypto.randomUUID(), expectedVersion: current.version, kind });
  }

  function beginClaim() {
    const current = gameRef.current;
    const rule = current === null ? null : availableClaimForPlayer(current);
    if (current === null || rule === null
      || pendingRef.current || pendingActionRef.current || posting.current) return;
    void submitAction({ requestId: crypto.randomUUID(), expectedVersion: current.version,
      kind: 'claim_draw', rule });
  }

  function confirmResignation() {
    if (gameRef.current?.version !== resignConfirmationVersion) {
      setResignConfirmationVersion(null);
      return;
    }
    beginAction('resign');
  }

  function inputPosition() {
    const current = gameRef.current;
    if (current === null || promotion !== null
      || (!analysisOpen && (pendingRef.current !== null || pendingActionRef.current !== null
        || posting.current))) return null;
    if (!analysisOpen && current.status !== 'active') return null;
    if (analysisOpen && (current.status !== 'finished' || analysis === null)) return null;
    const positionFen = analysisOpen && analysis !== null ? cursorFen(analysis, current)
      : current.position.fen;
    const sideToMove = analysisOpen && analysis !== null ? cursorSide(analysis, current)
      : current.position.sideToMove;
    const mode: 'analysis' | 'live' | 'premove' = analysisOpen ? 'analysis' : current.position.sideToMove === current.yourSeat
      ? 'live' : 'premove';
    return { current, positionFen, sideToMove: mode === 'premove' ? current.yourSeat : sideToMove, mode };
  }

  function attemptBoardMove(from: Square, target: Square | null) {
    const input = inputPosition();
    if (input === null) return;
    const move = input.mode === 'premove'
      ? premoveChoice(input.positionFen, input.sideToMove,
        premovesRef.current, from, target)
      : boardMove(input.positionFen, input.sideToMove, from, target);
    setSelected(null);
    if (move.kind === 'invalid') {
      if (input.mode === 'premove') cancelPremoves();
      return;
    }
    if (move.kind === 'promotion') {
      setPromotion({ from: move.from, to: move.to, mode: input.mode }); return;
    }
    if (input.mode === 'premove') queuePremove(move.from, move.to);
    else if (input.mode === 'analysis' && analysis !== null)
      submitAnalysisMove(analysis, input.current, move.from, move.to);
    else {
      updatePremoves([]);
      void submitMove({ requestId: crypto.randomUUID(), expectedVersion: input.current.version,
        from: move.from, to: move.to });
    }
  }

  function queuePremove(from: Square, to: Square, promotionPiece?: 'q' | 'r' | 'b' | 'n') {
    const move: Premove = { id: crypto.randomUUID(), from, to,
      ...(promotionPiece === undefined ? {} : { promotion: promotionPiece }) };
    updatePremoves(queue => addPremove(queue, move));
    premoveAttemptedVersion.current = null;
  }

  function chooseSquare(square: Square) {
    if (suppressClick.current) return;
    const input = inputPosition();
    if (input === null) return;
    const piece = input.mode === 'premove'
      ? projectedPieces(input.positionFen, input.sideToMove,
        premovesRef.current).get(square) ?? null
      : pieceAt(input.positionFen, square);
    if (selected === null) {
      if (pieceBelongsTo(piece, input.sideToMove)) setSelected(square);
      else if (input.mode === 'premove') cancelPremoves();
      return;
    }
    if (selected === square) {
      setSelected(null);
      if (input.mode === 'premove') cancelPremoves();
      return;
    }
    if (pieceBelongsTo(piece, input.sideToMove)
      && (input.mode === 'premove'
        ? premoveChoice(input.positionFen, input.sideToMove,
          premovesRef.current, selected, square)
        : boardMove(input.positionFen, input.sideToMove, selected, square)).kind === 'invalid') {
      setSelected(square);
      return;
    }
    attemptBoardMove(selected, square);
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, square: Square, piece: Piece | null) {
    const input = inputPosition();
    const planned = input?.mode === 'premove'
      ? projectedPieces(input.positionFen, input.sideToMove, premovesRef.current).get(square) ?? null : null;
    const dragPiece = input?.mode === 'premove'
      ? pieceBelongsTo(planned, input.sideToMove) ? planned : pieceAt(input.positionFen, square) : piece;
    if (event.button !== 0 || dragPiece === null || promotion !== null || pendingRef.current !== null
      || pendingActionRef.current !== null || posting.current) return;
    pointer.current = { id: event.pointerId, from: square, piece: dragPiece,
      x: event.clientX, y: event.clientY, moved: false,
      canSubmit: input !== null && pieceBelongsTo(dragPiece, input.sideToMove),
      version: gameRef.current?.version ?? -1, fen: input?.positionFen ?? null };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function boardSquareAt(x: number, y: number): Square | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-square]');
    return target && boardRef.current?.contains(target) ? target.dataset.square as Square : null;
  }

  function armArrowMenuSuppression() {
    suppressArrowMenu.current = true;
    if (arrowMenuReset.current !== null) window.clearTimeout(arrowMenuReset.current);
    arrowMenuReset.current = window.setTimeout(() => { suppressArrowMenu.current = false; }, 1_000);
  }

  function beginArrow(event: React.PointerEvent<HTMLButtonElement>, square: Square) {
    if (event.button !== 2 || pointer.current !== null || suppressDragMenu.current) return;
    rightPointer.current = { id: event.pointerId, from: square };
    armArrowMenuSuppression();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveArrow(event: React.PointerEvent<HTMLButtonElement>) {
    const active = rightPointer.current;
    if (active === null || active.id !== event.pointerId) return;
    const to = boardSquareAt(event.clientX, event.clientY);
    setArrowPreview(to !== null && to !== active.from ? { from: active.from, to } : null);
  }

  function endArrow(event: React.PointerEvent<HTMLButtonElement>) {
    const active = rightPointer.current;
    if (active === null || active.id !== event.pointerId) return;
    rightPointer.current = null;
    setArrowPreview(null);
    const to = boardSquareAt(event.clientX, event.clientY);
    if (to !== null) setArrows(current => toggleArrow(current, active.from, to));
    armArrowMenuSuppression();
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
    const input = inputPosition();
    if (!active.canSubmit || input === null || input.current.version !== active.version
      || input.positionFen !== active.fen) {
      if (input?.mode === 'premove') cancelPremoves();
      return;
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>('[data-square]');
    if (target === null || target === undefined || !boardRef.current?.contains(target)) {
      attemptBoardMove(active.from, null);
      return;
    }
    attemptBoardMove(active.from, target.dataset.square as Square);
  }

  function cancelDrag() {
    const active = pointer.current;
    pointer.current = null;
    setDrag(null);
    if (active !== null) {
      const origin = boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${active.from}"]`);
      if (origin?.hasPointerCapture(active.id)) origin.releasePointerCapture(active.id);
    }
  }

  function armDragMenuSuppression() {
    suppressDragMenu.current = true;
    if (dragMenuReset.current !== null) window.clearTimeout(dragMenuReset.current);
    dragMenuReset.current = window.setTimeout(() => { suppressDragMenu.current = false; }, 1_000);
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

  function removeVariation(id: number) {
    if (analysis !== null) {
      setAnalysis(deleteVariation(analysis, id));
      setSelected(null);
      setAnalysisError(null);
    }
  }

  useEffect(() => {
    const queue = premovesRef.current;
    if (game?.status !== 'active' || game.position.sideToMove !== game.yourSeat
      || queue.length === 0 || analysisOpen || promotion !== null
      || pending !== null || pendingAction !== null || submitting || posting.current
      || game.clocks?.phase === 'handoff'
      || premoveAttemptedVersion.current === game.version) return;
    const next = nextPremove(game.position.fen, game.yourSeat, queue);
    if (next === null) {
      updatePremoves([]);
      return;
    }
    premoveAttemptedVersion.current = game.version;
    void submitMove({ requestId: next.id, premoveId: next.id, expectedVersion: game.version,
      from: next.from, to: next.to, ...(next.promotion ? { promotion: next.promotion } : {}) });
  }, [game, premoves, analysisOpen, promotion, pending, pendingAction, submitting]);

  const link = challenge ? `${window.location.origin}${challenge.path}` : '';
  const canMove = game?.status === 'active' && game.position.sideToMove === game.yourSeat
    && pending === null && pendingAction === null && !submitting;
  const replaying = game?.status === 'finished';
  const displayedPly = game === null ? 0 : replayPly(
    analysisOpen && analysis !== null ? mainAncestorPly(analysis)
      : selectedReplayPly ?? game.history.length, game.history.length);
  const displayedFen = game === null ? null :
    analysisOpen && analysis !== null ? cursorFen(analysis, game)
      : replaying ? replayFen(game, displayedPly) : game.position.fen;
  const rows = game === null || displayedFen === null ? null : boardRows(displayedFen, game.yourSeat);
  const premovePieces = game?.status === 'active' && game.position.sideToMove !== game.yourSeat
    ? projectedPieces(game.position.fen, game.yourSeat, premoves) : null;
  const visibleArrows = arrowPreview === null ? arrows : [...arrows, arrowPreview];
  const material = displayedFen === null ? null : materialAdvantage(displayedFen);
  const coordinates = game === null ? null : boardCoordinates(game.yourSeat);
  const lastMove = game === null ? null : highlightedMove(game, replaying ? displayedPly : game.history.length,
    analysisOpen ? analysis : null);
  const activeBranchId = analysis?.cursor.kind === 'branch' ? analysis.cursor.id : null;
  const result = resultDisplay(game?.result ?? null);
  const hintSide = game === null ? null : analysisOpen && analysis !== null
    ? cursorSide(analysis, game) : game.position.sideToMove;
  const showHints = selected !== null && displayedFen !== null && hintSide !== null
    && (analysisOpen ? game?.status === 'finished' : canMove);
  const moveHints = useMemo(() => showHints && selected !== null && displayedFen !== null
    && hintSide !== null ? legalMoveHints(displayedFen, hintSide, selected) : new Map<Square, boolean>(),
  [showHints, selected, displayedFen, hintSide]);
  const offerNextPly = game?.drawOfferNextEligiblePly[game.yourSeat] ?? 2;
  const offerPliesRemaining = game === null ? 0 : Math.max(0, offerNextPly - game.history.length);

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
              <div className="board-frame">
                <div className="board" role="group" ref={boardRef} aria-label={`Chess board, ${game.yourSeat} side at the bottom`}>
                  {rows.flat().map(({ square, piece, dark }) => {
                    const planned = premovePieces?.get(square) ?? null;
                    const ghost = planned !== null && planned !== piece ? planned : null;
                    return <button key={square} type="button"
                      className={`square ${dark ? 'dark' : 'light'} ${lastMove?.from === square || lastMove?.to === square ? 'last-move' : ''} ${selected === square ? 'selected' : ''} ${moveHints.has(square) ? moveHints.get(square) ? 'legal-capture' : 'legal-destination' : ''} ${drag?.from === square ? 'drag-origin' : ''} ${premoves.some(move => move.to === square) ? 'premove-target' : ''}`}
                      data-square={square}
                      aria-label={`${square}, ${piece === null ? 'empty' : `${piece === piece.toUpperCase() ? 'white' : 'black'} ${pieceNames[piece.toLowerCase()]}`}`}
                      aria-pressed={selected === square}
                      disabled={promotion !== null || pending !== null || pendingAction !== null || submitting}
                      onPointerDown={event => { beginArrow(event, square); beginDrag(event, square, piece); }}
                      onPointerMove={event => { moveArrow(event); moveDrag(event); }}
                      onPointerUp={event => { endArrow(event); endDrag(event); }}
                      onPointerCancel={event => {
                        if (rightPointer.current?.id === event.pointerId) {
                          rightPointer.current = null;
                          setArrowPreview(null);
                          armArrowMenuSuppression();
                        }
                        if (pointer.current !== null && event.pointerType === 'mouse' && (event.buttons & 2)) {
                          armDragMenuSuppression();
                        }
                        cancelDrag();
                      }}
                      onClick={() => chooseSquare(square)}>
                      {piece !== null && <img className="piece" src={pieceImage(piece)} alt="" draggable={false} />}
                      {ghost !== null && <img className="premove-ghost" src={pieceImage(ghost)} alt=""
                        aria-hidden="true" draggable={false} />}
                    </button>})}
                  <BoardArrows arrows={visibleArrows} orientation={game.yourSeat} />
                </div>
                <div className="board-ranks" aria-hidden="true">{coordinates?.ranks.map(rank =>
                  <span key={rank}>{rank}</span>)}</div>
                <div className="board-files" aria-hidden="true">{coordinates?.files.map(file =>
                  <span key={file}>{file}</span>)}</div>
              </div>
              {drag !== null && <img className="drag-piece" src={pieceImage(drag.piece)} alt=""
                style={{ left: drag.x, top: drag.y, width: (boardRef.current?.clientWidth ?? 512) / 8,
                  height: (boardRef.current?.clientWidth ?? 512) / 8 }} aria-hidden="true" draggable={false} />}
              {(analysisOpen || canMove || game.status === 'finished') && <p className="board-hint">{analysisOpen
                ? `Analysis: ${analysis !== null && cursorSide(analysis, game) === 'white' ? 'White' : 'Black'} to move. Select or drag a piece.`
                : canMove ? 'Select or drag one of your pieces.'
                  : 'Select Analysis to explore legal alternatives.'}</p>}
              <p className="clock-policy" role="note">{challenge.game.clocks === 'not_integrated'
                ? 'This earlier challenge is untimed.'
                : '5+3 server clock · Time continues through disconnects and server outages. The server decides deadlines.'}</p>
            </div>
            <aside className="game-sidebar" aria-label="Game controls and moves">
              <ClockPanel clock={game.clocks} side={game.yourSeat === 'white' ? 'black' : 'white'}
                isYou={false} materialAdvantage={material?.side === game.yourSeat ? null : material?.points ?? null} />
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
                      aria-label="Previous move" title="Previous move">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="m15 5-7 7 7 7" />
                      </svg></button>
                    <button type="button" className="secondary"
                      disabled={analysisOpen ? analysis !== null && nextPosition(analysis, game) === analysis
                        : displayedPly === game.history.length}
                      onClick={() => { if (analysisOpen && analysis !== null) setAnalysis(nextPosition(analysis, game));
                        else setSelectedReplayPly(displayedPly + 1); setSelected(null); }}
                      aria-label="Next move" title="Next move">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="m9 5 7 7-7 7" />
                      </svg></button>
                    <button type="button" className="secondary" disabled={displayedPly === game.history.length && !analysisOpen}
                      onClick={() => { if (analysisOpen && analysis !== null)
                        setAnalysis(lastMainPosition(analysis, game));
                      else setSelectedReplayPly(game.history.length); setSelected(null); }}
                      aria-label="Final position">End</button>
                  </div>
                  {analysisWarning !== null && <p className="info" role="status">{analysisWarning}</p>}
                </div>}
                {analysisError !== null && <p className="error" role="alert">{analysisError}</p>}
                <MoveTree game={game} tree={analysisOpen ? analysis : null} interactive={replaying}
                  selected={analysisOpen && analysis !== null ? analysis.cursor
                    : { kind: 'main', ply: displayedPly }}
                  onSelect={selectMove} onDelete={removeVariation}
                  onPromote={id => setAnalysis(current => current === null ? null : promoteVariation(current, id))}
                  onNote={(cursor: AnalysisCursor, note: MoveNote) => setAnalysis(current =>
                    current === null ? null : setMoveNote(current, cursor, note))} />
              </div>
              <div className="game-controls">
                {gameError !== null && <p className="error" role="alert">{gameError}</p>}
                {gameInfo !== null && <p className="info" role="status">{gameInfo}</p>}
                {result !== null ? <div className="final-result" role="status">
                  <strong>{result.score}</strong><span>{result.explanation}</span>
                </div> : <p className="turn" role="status">{game.status === 'pending_adjudication'
                  ? game.pending?.kind === 'resignation'
                    ? `${game.pending.resigningSide === 'white' ? 'White' : 'Black'} resigned. Play and clocks are stopped while the result awaits a verified mating decision.`
                    : game.timeoutAdjudication === 'unresolved'
                      ? 'A clock flagged. Further adjudication is needed.'
                      : 'A clock flagged. Checking the result.'
                  : game.clocks?.phase === 'awaiting_first_move'
                    ? 'Waiting for White’s first move. Both clocks stay at 5:00; Black’s clock starts after that move is saved.'
                  : game.status === 'waiting' ? 'Waiting for both guests to be ready.'
                    : canMove ? `Your turn (${game.yourSeat}).`
                      : `${game.position.sideToMove === 'white' ? 'White' : 'Black'} to move${game.position.sideToMove === game.yourSeat ? '.' : ' — waiting for your opponent.'}`}</p>}
                {game.status === 'waiting' && game.clocks !== null && <div className="readiness">
                  <p>{game.clocks.ready[game.yourSeat]
                    ? 'You are ready. Waiting for the other guest.'
                    : 'Press Ready when you are prepared to start. White’s clock begins when both guests are ready.'}</p>
                  {!game.clocks.ready[game.yourSeat] && <button type="button" disabled={readyBusy || submitting}
                    onClick={() => void markReady()}>{readyBusy ? 'Confirming…' : 'Ready to start'}</button>}
                </div>}
                <div className="game-actions">
                  {game.status === 'active' && <>
                    {(game.drawOffer === game.yourSeat || game.claimDrawOffer === game.yourSeat)
                      && <p className="draw-offer" role="status">Your draw offer is awaiting a response.</p>}
                    {(game.drawOffer !== null && game.drawOffer !== game.yourSeat
                      || game.claimDrawOffer !== null && game.claimDrawOffer !== game.yourSeat)
                      && <div className="draw-offer">
                      <p>Your opponent offered a draw.</p>
                      {game.history.length < 2 && <p>Both players must make a move before a draw can be agreed.</p>}
                      <button type="button" disabled={submitting || pending !== null || pendingAction !== null || game.history.length < 2}
                        onClick={() => beginAction('accept_draw')}>Accept draw</button>
                      <button type="button" className="secondary" disabled={submitting || pending !== null || pendingAction !== null}
                        onClick={() => beginAction('decline_draw')}>Decline</button>
                    </div>}
                    {game.drawOffer === null && game.claimDrawOffer === null
                      && game.history.length >= 2 && (offerPliesRemaining === 0
                      ? <button type="button" className="secondary"
                        disabled={submitting || pending !== null || pendingAction !== null}
                        onClick={() => beginAction('offer_draw')}>Offer draw</button>
                      : <p className="draw-offer" role="status">You can offer another draw after {offerPliesRemaining} more half-move{offerPliesRemaining === 1 ? '' : 's'}.</p>)}
                    {availableClaimForPlayer(game) !== null && <button type="button" className="secondary"
                      disabled={submitting || pending !== null || pendingAction !== null}
                      onClick={beginClaim}>Claim draw</button>}
                    {resignConfirmationVersion === game.version
                      ? <div className="resign-confirmation" role="group" aria-label="Confirm resignation">
                        <p>Resign this game? This cannot be undone.</p>
                        <button type="button" className="danger"
                          disabled={submitting || pending !== null || pendingAction !== null}
                          autoFocus onClick={confirmResignation}>Confirm resignation</button>
                        <button type="button" className="secondary" onClick={() => {
                          setResignConfirmationVersion(null);
                          requestAnimationFrame(() => resignFocus.current?.focus());
                        }}>Cancel</button>
                      </div>
                      : <button type="button" className="secondary" ref={resignFocus}
                        disabled={submitting || pending !== null || pendingAction !== null}
                        onClick={() => setResignConfirmationVersion(game.version)}>Resign</button>}
                  </>}
                  {game.status === 'finished' && <button type="button" aria-pressed={analysisOpen}
                    title="Analysis notes stay in this browser and do not affect the game."
                    onClick={() => {
                      if (analysisOpen && analysis !== null) setSelectedReplayPly(mainAncestorPly(analysis));
                      else if (analysis !== null && selectedReplayPly !== null)
                        setAnalysis(selectMain(analysis, game, selectedReplayPly));
                      setAnalysisOpen(!analysisOpen);
                      setSelected(null); setPromotion(null); setAnalysisError(null);
                    }}>{analysisOpen ? 'Close analysis' : 'Analysis'}</button>}
                </div>
                {promotion !== null && <div className="promotion-choice" role="dialog" aria-label="Choose a promotion piece">
                  <p>Promote your pawn to:</p>
                  <div>{([['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']] as const).map(([piece, name]) =>
                    <button key={piece} ref={piece === 'q' ? promotionFocus : undefined} type="button" onClick={() => {
                      const current = gameRef.current;
                      setPromotion(null);
                      setSelected(null);
                      if (promotion.mode === 'premove') queuePremove(promotion.from, promotion.to, piece);
                      else if (analysisOpen && analysis !== null && current)
                        submitAnalysisMove(analysis, current, promotion.from, promotion.to, piece);
                      else if (current) {
                        updatePremoves([]);
                        void submitMove({ requestId: crypto.randomUUID(), expectedVersion: current.version,
                          from: promotion.from, to: promotion.to, promotion: piece });
                      }
                    }}>{name}</button>)}</div>
                  <button type="button" className="secondary" onClick={() => {
                    if (promotion.mode === 'premove') cancelPremoves();
                    setPromotion(null);
                  }}>Cancel</button>
                </div>}
                {pending !== null && !submitting && <div className="retry">
                  <p>The move has not been confirmed. Retry the same request to learn whether it was saved.</p>
                  <button type="button" onClick={() => void submitMove(pending, true)}>Retry move</button>
                </div>}
                {pendingAction !== null && !submitting && <div className="retry">
                  <p>The action has not been confirmed. Retry the same request to learn whether it was saved.</p>
                  <button type="button" onClick={() => void submitAction(pendingAction, true)}>Retry action</button>
                </div>}
                {submitting && <p role="status">Waiting for server confirmation…</p>}
                <button type="button" className="refresh-position" onClick={() => void refreshGame()}>Refresh position</button>
                <details className="share-menu">
                  <summary>Challenge link</summary>
                  <label htmlFor="challenge-link">Shareable link</label>
                  <input id="challenge-link" readOnly value={link}
                    onFocus={event => event.currentTarget.select()} />
                </details>
              </div>
              <ClockPanel clock={game.clocks} side={game.yourSeat} isYou
                materialAdvantage={material?.side === game.yourSeat ? material.points : null} />
            </aside>
          </div>
        </>}
      </section>}
      {challenge?.status !== 'accepted' && <footer>Play with focus. Learn from every game.</footer>}
    </main>
  );
}
