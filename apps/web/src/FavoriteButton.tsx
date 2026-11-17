import { useEffect, useRef, useState } from 'react';
import { readGameFavorite, saveGameFavorite } from './game-favorites';

export function FavoriteButton({ favorite, pending, onToggle, description }: {
  favorite: boolean; pending: boolean; onToggle: () => void; description?: string;
}) {
  const label = favorite ? 'Remove from favorites' : 'Add to favorites';
  return <button type="button" className="favorite-button" aria-pressed={favorite}
    aria-label={label} aria-description={description} aria-disabled={pending || undefined}
    onClick={() => { if (!pending) onToggle(); }}>
    <svg viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20.5 4.3 13a4.9 4.9 0 0 1 6.9-6.9l.8.9.8-.9a4.9 4.9 0 0 1 6.9 6.9Z" />
    </svg>
  </button>;
}

export function GameFavorite({ gameId, owner, csrfToken }: { gameId: string; owner: string; csrfToken: string }) {
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void readGameFavorite(gameId, owner, controller.signal).then(value => {
      if (!controller.signal.aborted) setFavorite(value);
    }).catch(() => {});
    return () => controller.abort();
  }, [gameId, owner]);

  async function toggle() {
    if (favorite === null || pending.current) return;
    const previous = favorite;
    pending.current = true;
    setSaving(true);
    setError('');
    setFavorite(!previous);
    try {
      setFavorite(await saveGameFavorite(gameId, owner, csrfToken, !previous));
    } catch (cause) {
      setFavorite(previous);
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not update favorite. Try again.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return favorite === null ? null : <>
    {error && <span className="favorite-feedback" role="status">{error}</span>}
    <FavoriteButton favorite={favorite} pending={saving} onToggle={() => void toggle()} />
  </>;
}
