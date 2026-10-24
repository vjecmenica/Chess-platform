import type { GameSide } from '@chess/contracts';
import type { ImportedGame } from './pgn-import';
import { ClockValue } from './ClockValue';

export function importedPlayer(imported: ImportedGame, side: GameSide): {
  name: string; rating: string | null;
} {
  const name = imported.headers[side === 'white' ? 'White' : 'Black']?.trim();
  const elo = imported.headers[side === 'white' ? 'WhiteElo' : 'BlackElo']?.trim();
  return { name: name || 'Unknown player', rating: elo && /^\d{1,5}$/.test(elo) ? elo : null };
}

export function PlayerIdentity({ side, name, rating }: {
  side: GameSide; name: string; rating?: string | null;
}) {
  return <span className="player-label">
    <span className="player-name-line"><span className="player-name">{name}</span>
      {rating && <span className="player-rating" aria-label={`Rating ${rating}`}>{rating}</span>}
    </span>
    {name.toLowerCase() !== side && <b>{side === 'white' ? 'White' : 'Black'}</b>}
  </span>;
}

export function ImportedPlayerRow({ imported, side, historicalMs }: {
  imported: ImportedGame; side: GameSide; historicalMs?: number | null | undefined;
}) {
  const player = importedPlayer(imported, side);
  return <div className={`clock clock-no-status imported-player${historicalMs !== undefined && historicalMs !== null && historicalMs <= 30_000 ? ' clock-warning' : ''}`}
    aria-label={historicalMs === undefined ? undefined : `${side} clock at selected move`}>
    <PlayerIdentity side={side} name={player.name} rating={player.rating} />
    {historicalMs !== undefined && <strong aria-live="off">{historicalMs === null
      ? '—' : <ClockValue milliseconds={historicalMs} />}</strong>}
  </div>;
}
