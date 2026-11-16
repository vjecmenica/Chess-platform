export function formatClock(milliseconds: number): string {
  const hundredths = Math.ceil(Math.max(0, milliseconds) / 10);
  const seconds = milliseconds > 30_000 ? Math.ceil(milliseconds / 1000)
    : Math.floor(hundredths / 100);
  const main = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return milliseconds <= 30_000 ? `${main}.${String(hundredths % 100).padStart(2, '0')}` : main;
}

export function ClockValue({ milliseconds }: { milliseconds: number }) {
  const value = formatClock(milliseconds);
  const [main, fraction] = value.split('.');
  return <><span>{main}</span>
    <span className="clock-hundredths" data-reserved={fraction === undefined ? '' : undefined}
      aria-hidden={fraction === undefined ? true : undefined}>.{fraction ?? '00'}</span></>;
}

export function PlayerClockValue({ milliseconds, fallback }: { milliseconds: number | null; fallback: string }) {
  const lowTime = milliseconds !== null && milliseconds <= 30_000;
  return <strong className="player-clock-value" aria-live="off">
    {milliseconds === null ? fallback : <>
      <span className="low-time-marker" hidden={!lowTime} aria-hidden="true">!</span>
      {lowTime && <span className="visually-hidden">Low time </span>}
      <ClockValue milliseconds={milliseconds} />
    </>}
  </strong>;
}
