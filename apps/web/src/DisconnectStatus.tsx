import { useEffect, useState } from 'react';

export function DisconnectStatus({ deadlineMs, serverNowMs }: { deadlineMs: number; serverNowMs: number }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - observedAt;
      setElapsedMs(elapsed);
      if (serverNowMs + elapsed >= deadlineMs) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadlineMs, serverNowMs]);
  const seconds = Math.max(0, Math.ceil((deadlineMs - serverNowMs - elapsedMs) / 1_000));
  return <p><span role="status">Opponent disconnected</span>{seconds > 0 && <span> · {seconds}s</span>}</p>;
}
