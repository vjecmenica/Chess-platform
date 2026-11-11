import { useId, useState, type ReactNode } from 'react';

/** Content stays mounted so collapsing never discards a chat or notes draft. */
export function CompanionPanel({ analysis, children, utilities }: {
  analysis: boolean; children: (visible: boolean) => ReactNode; utilities: ReactNode;
}) {
  const [choices, setChoices] = useState<Partial<Record<'play' | 'analysis', boolean>>>({});
  const mode = analysis ? 'analysis' : 'play';
  const collapsed = choices[mode] ?? analysis;
  const id = useId();
  return <div className="game-companion-column" data-collapsed={collapsed}>
    <button className="companion-toggle secondary" type="button" aria-expanded={!collapsed}
      aria-controls={id} aria-label={collapsed ? 'Expand Info, Chat and Notes' : 'Collapse Info, Chat and Notes'}
      onClick={() => setChoices(current => ({ ...current, [mode]: !collapsed }))}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d={collapsed ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} /></svg>
      {collapsed && <span>Info / Chat / Notes</span>}
    </button>
    <div className="companion-content" id={id} hidden={collapsed}>{children(!collapsed)}</div>
    {utilities}
  </div>;
}
