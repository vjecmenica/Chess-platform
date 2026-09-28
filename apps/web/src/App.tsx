import { useEffect, useState } from 'react';
import type { ReadinessResponse } from '@chess/contracts';

type Connection = ReadinessResponse | { status: 'checking' | 'offline' };

export function App() {
  const [connection, setConnection] = useState<Connection>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let active = true;
    setConnection({ status: 'checking' });
    void fetch('/api/health/ready', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null || !('status' in body) || !('database' in body)) {
          throw new Error('Unexpected health response');
        }
        if (active && response.ok && body.status === 'ok' && body.database === 'connected') {
          setConnection({ status: 'ok', database: 'connected' });
        } else if (active && response.status === 503 && body.status === 'error' && body.database === 'unavailable') {
          setConnection({ status: 'error', database: 'unavailable' });
        } else if (active) {
          throw new Error('Unexpected health response');
        }
      })
      .catch(() => { if (active) setConnection({ status: 'offline' }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  const messages = {
    checking: 'Checking connection…',
    ok: 'Server and database are connected.',
    error: 'The server is running, but the database is unavailable.',
    offline: 'The server is unavailable. Please try again shortly.',
  };

  return (
    <main>
      <header><span className="mark" aria-hidden="true">♞</span><span>CHESS PLATFORM</span></header>
      <section className="intro">
        <p className="eyebrow">A place to play and learn</p>
        <h1>Every move.<br />A new perspective.</h1>
        <p className="description">Competitive chess and thoughtful game analysis, with the board at the center.</p>
      </section>
      <section className="notice" aria-labelledby="progress-title">
        <h2 id="progress-title">The first moves are still ahead.</h2>
        <p>We’re building the foundation. Games and analysis are not available yet.</p>
        <div className="connection">
          <p role="status" aria-live="polite"><span className={`dot ${connection.status}`} aria-hidden="true" />{messages[connection.status]}</p>
          <button type="button" disabled={connection.status === 'checking'} onClick={() => setAttempt(value => value + 1)}>Check again</button>
        </div>
      </section>
      <footer>Play with focus. Learn from every game.</footer>
    </main>
  );
}
