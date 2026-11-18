import type { GamePlayerNames, GameSide } from '@chess/contracts';
import type { ImportedGame } from './pgn-import';
import { PlayerClockValue } from './ClockValue';
import { ProfileAvatar } from './ProfileAvatar';
import { SiteRating, type SitePlayerRating } from './rating-display';

export function sitePlayerName(names: GamePlayerNames | undefined, side: GameSide): string {
  return names?.[side] ?? 'Guest';
}

export function importedPlayer(imported: ImportedGame, side: GameSide): {
  name: string; rating: string | null;
} {
  const name = imported.headers[side === 'white' ? 'White' : 'Black']?.trim();
  const elo = imported.headers[side === 'white' ? 'WhiteElo' : 'BlackElo']?.trim();
  return { name: name || 'Unknown player', rating: elo && /^\d{1,5}$/.test(elo) ? elo : null };
}

export function PlayerIdentity({ side, name, rating, accountName, avatarUrl }: {
  side: GameSide; name: string; rating?: string | SitePlayerRating | null | undefined;
  accountName?: string | null | undefined; avatarUrl?: string | undefined;
}) {
  return <span className="player-label">
    <ProfileAvatar className="player-avatar" name={accountName ?? null} url={avatarUrl} />
    <span className="player-identity-text">
      <span className="visually-hidden">{side === 'white' ? 'White player: ' : 'Black player: '}</span>
      <span className="player-name" title={name}>{name}</span>
      <span className="player-meta">
        {typeof rating === 'string' ? <span className="player-rating" aria-label={`Rating ${rating}`}>{rating}</span>
          : rating !== undefined && <span className="player-rating"><SiteRating value={rating} /></span>}
      </span>
    </span>
  </span>;
}

export function ImportedPlayerRow({ imported, side, historicalMs, isReplayTurn = false }: {
  imported: ImportedGame; side: GameSide; historicalMs?: number | null | undefined;
  isReplayTurn?: boolean;
}) {
  const player = importedPlayer(imported, side);
  const timed = historicalMs !== undefined && historicalMs !== null;
  return <div className={`clock imported-player${timed && isReplayTurn ? ' clock-replay-turn' : ''}`}
    aria-label={timed ? `${side} clock at selected move` : undefined}>
    <PlayerIdentity side={side} name={player.name} rating={player.rating ?? undefined} />
    {timed && <PlayerClockValue side={side} milliseconds={historicalMs} />}
  </div>;
}
