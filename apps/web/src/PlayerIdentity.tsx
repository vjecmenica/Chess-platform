import type { GamePlayerNames, GameSide } from '@chess/contracts';
import type { ImportedGame } from './pgn-import';
import { PlayerClockValue } from './ClockValue';
import { ProfileAvatar } from './ProfileAvatar';

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

export function PlayerIdentity({ side, name, rating, accountName, avatarUrl, status }: {
  side: GameSide; name: string; rating?: string | null;
  accountName?: string | null | undefined; avatarUrl?: string | undefined; status?: string | null;
}) {
  return <span className="player-label">
    <ProfileAvatar className="player-avatar" name={accountName ?? null} url={avatarUrl} />
    <span className="player-identity-text">
      <span className="visually-hidden">{side === 'white' ? 'White player: ' : 'Black player: '}</span>
      <span className="player-name" title={name}>{name}</span>
      <span className="player-meta">
        {rating && <span className="player-rating" aria-label={`Rating ${rating}`}>{rating}</span>}
        {status && <small>{status}</small>}
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
  return <div className={`clock clock-no-status imported-player${timed && isReplayTurn ? ' clock-replay-turn' : ''}`}
    aria-label={timed ? `${side} clock at selected move` : undefined}>
    <PlayerIdentity side={side} name={player.name} rating={player.rating} />
    {timed && <PlayerClockValue side={side} milliseconds={historicalMs} />}
  </div>;
}
