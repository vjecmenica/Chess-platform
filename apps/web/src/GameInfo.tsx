import type { GameReadResponse, GameState, SiteGameInfo } from '@chess/contracts';
import { sitePlayerName } from './PlayerIdentity';
import { resultDisplay } from './result-display';
import { timeControlLabel } from './TimeControlSelect';

const variantLabels: Record<SiteGameInfo['variant'], string> = { standard: 'Standard' };

export function gameInfoTimestamp(info: SiteGameInfo | undefined, timeZone?: string) {
  const at = info?.startedAt ?? info?.acceptedAt;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { at, label: info?.startedAt ? 'Started (local time)' : 'Challenge accepted (local time)',
    text: new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset',
      ...(timeZone ? { timeZone } : {}) }).format(new Date(at)) };
}

export function liveGameStatus(game: GameState, browsingHistory: boolean): string | null {
  if (game.status === 'pending_adjudication') return game.pending?.kind === 'resignation'
    ? `${game.pending.resigningSide === 'white' ? 'White' : 'Black'} resigned. Play and clocks are stopped while the result awaits a verified mating decision.`
    : game.timeoutAdjudication === 'unresolved' ? 'A clock flagged. Further adjudication is needed.'
      : 'A clock flagged. Checking the result.';
  if (game.status === 'waiting') return 'Waiting for both guests to be ready.';
  if (game.status === 'active' && game.clocks?.phase === 'awaiting_first_move') return 'Waiting for White’s first move.';
  return game.status === 'active' && browsingHistory ? 'Viewing an earlier position. Return to the latest move to play.' : null;
}

export function GameInfo({ game }: { game: GameReadResponse }) {
  const timestamp = gameInfoTimestamp(game.siteInfo);
  const result = game.status === 'finished' || game.status === 'aborted' ? resultDisplay(game.result) : null;
  const status = result ? `${result.score} · ${result.explanation}`
    : game.status === 'waiting' ? 'Waiting for players to be ready'
      : game.status === 'active' ? 'In progress'
        : game.status === 'aborted' ? 'Aborted · No win or loss recorded'
          : game.status === 'pending_adjudication' ? 'Result is being adjudicated' : 'Result unavailable';
  const control = game.clockStatus === 'not_integrated' ? 'Untimed'
    : game.timeControl === null ? 'Unavailable'
      : 'source' in game.timeControl ? game.timeControl.raw
        : timeControlLabel(game.timeControl.initialMs, game.timeControl.incrementMs);
  return <section className="game-info" aria-label="Game information">
    <dl>
      {(['white', 'black'] as const).map(side => <div key={side}>
        <dt>{side === 'white' ? 'White' : 'Black'}</dt>
        <dd><strong>{sitePlayerName(game.playerNames, side)}</strong>{' '}<small aria-label="Rating unavailable">Unrated</small></dd>
      </div>)}
      <div><dt>{result || game.status === 'finished' || game.status === 'aborted' ? 'Result' : 'Status'}</dt><dd>{status}</dd></div>
      <div><dt>{timestamp?.label ?? 'Start time'}</dt><dd>{timestamp
        ? <time dateTime={timestamp.at}>{timestamp.text}</time> : 'Unavailable'}</dd></div>
      <div><dt>Time control</dt><dd>{control}</dd></div>
      <div><dt>Rated</dt><dd>{game.rated === false ? 'Unrated' : 'Unavailable'}</dd></div>
      <div><dt>Variant</dt><dd>{game.siteInfo ? variantLabels[game.siteInfo.variant] : 'Unavailable'}</dd></div>
    </dl>
  </section>;
}
