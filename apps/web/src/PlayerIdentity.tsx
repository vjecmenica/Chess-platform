import type { GamePlayerNames, GameSide } from '@chess/contracts';
import type { ImportedGame } from './pgn-import';
import { PlayerClockValue } from './ClockValue';

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

export function PlayerIdentity({ side, name, rating }: {
  side: GameSide; name: string; rating?: string | null;
}) {
  return <span className="player-label">
    <span className="player-name-line"><span className="player-name" title={name}>{name}</span>
      {rating && <span className="player-rating" aria-label={`Rating ${rating}`}>{rating}</span>}
    </span>
    {name.toLowerCase() !== side && <b>{side === 'white' ? 'White' : 'Black'}</b>}
  </span>;
}

export function ImportedPlayerRow({ imported, side, historicalMs }: {
  imported: ImportedGame; side: GameSide; historicalMs?: number | null | undefined;
}) {
  const player = importedPlayer(imported, side);
  const timed = historicalMs !== undefined && historicalMs !== null;
  return <div className={`clock clock-no-status imported-player${timed && historicalMs <= 30_000 ? ' clock-warning' : ''}`}
    aria-label={timed ? `${side} clock at selected move` : undefined}>
    <PlayerIdentity side={side} name={player.name} rating={player.rating} />
    {timed && <PlayerClockValue side={side} milliseconds={historicalMs} />}
  </div>;
}
