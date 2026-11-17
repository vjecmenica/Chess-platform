import { useState } from 'react';

export function ProfileAvatar({ name, url, className = '' }: {
  name: string | null; url?: string | null | undefined; className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={className ? `profile-avatar ${className}` : 'profile-avatar'} aria-hidden="true">
    {url && url !== failed ? <img src={url} alt="" decoding="async" onError={() => setFailed(url)} />
      : name ? name.slice(0, 2).toUpperCase() : <svg viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8" r="3.2"/><path d="M5 20v-1.5a7 7 0 0 1 14 0V20z"/>
      </svg>}
  </span>;
}
