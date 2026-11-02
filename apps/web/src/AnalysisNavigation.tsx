import type { ReactNode } from 'react';

/** Future sections are explicitly unavailable, never links to invented destinations. */
export function AnalysisNavigation({ imported, accountControl, section = 'analysis' }: {
  imported: boolean; accountControl?: ReactNode; section?: 'play' | 'analysis';
}) {
  return <header className="analysis-navigation">
    <div className="analysis-navigation-inner">
      <a className="analysis-brand" href="/" aria-label="Chess Platform home">♞</a>
      <nav aria-label="Main navigation">
        <a href="/" aria-current={section === 'play' ? 'page' : undefined}>Play</a>
        {['Puzzles', 'Learn', 'Watch'].map(label => <span key={label} aria-disabled="true"
          title={`${label} is not available yet`}>{label}</span>)}
        {section === 'analysis' ? <span aria-current="page">Analysis</span> : <a href="/#pgn-import-title">Analysis</a>}
        <span aria-disabled="true" title="Community is not available yet">Community</span>
      </nav>
      <input className="navigation-search" disabled aria-label="Search (not available yet)"
        placeholder="Search games, players, openings…" title="Search is not available yet" />
      <a className="open-game" href="/">{imported ? 'Open another game' : 'Create another challenge'}</a>
      {accountControl}
    </div>
  </header>;
}
