import { useState, type ReactNode } from 'react';

const items = [
  ['Play', 'M5 3v18l15-9Z'], ['Puzzles', 'M4 4h6v4h4V4h6v6h-4v4h4v6h-6v-4h-4v4H4Z'],
  ['Learn', 'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3Zm9 2v15'],
  ['Watch', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0'],
  ['Analysis', 'M4 20V4m0 16h17M7 15l4-5 4 3 6-9'],
  ['Community', 'M8 10a3 3 0 1 0 0-6 3 3 0 1 0 0 6m8 2a3 3 0 1 0 0-6 3 3 0 1 0 0 6M2 21v-4a6 6 0 0 1 12 0v4m0-6a5 5 0 0 1 8 4v2'],
] as const;
function Icon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}
/** Unavailable destinations remain explicitly disabled, with no invented routes. */
export function AnalysisNavigation({ imported = false, accountControl, section = 'analysis' }: {
  imported?: boolean; accountControl?: ReactNode; section?: 'play' | 'analysis' | 'account';
}) {
  const [expanded, setExpanded] = useState(false);
  return <header className="analysis-navigation" data-expanded={expanded}>
    <div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a>
      <button className="navigation-menu" type="button" aria-label="Navigation" aria-expanded={expanded}
        aria-controls="site-navigation-items" onClick={() => setExpanded(value => !value)}><Icon path="M4 6h16M4 12h16M4 18h16"/></button>
      <nav id="site-navigation-items" aria-label="Main navigation">
        {items.map(([label, path]) => {
          const active = label.toLowerCase() === section;
          const content = <><Icon path={path}/><span className="rail-tooltip">{label}</span></>;
          return label === 'Play' || label === 'Analysis' ? <a key={label} href={label === 'Play' ? '/' : '/#pgn-import-title'}
            aria-label={label} aria-current={active ? 'page' : undefined}>{content}</a>
            : <span key={label} tabIndex={0} aria-disabled="true" aria-label={`${label} (not available yet)`}>{content}</span>;
        })}
      </nav>
      <a className="open-game" href="/" aria-label={imported ? 'Open another game' : 'Create another challenge'}>
        <Icon path="M12 4v16M4 12h16"/><span className="rail-tooltip">{imported ? 'Open another game' : 'Create another challenge'}</span></a>
      <div className="rail-account">{accountControl}</div>
    </div>
  </header>;
}
