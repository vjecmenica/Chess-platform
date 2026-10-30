import { useEffect, useId, useState, type ReactNode } from 'react';

export type SidebarTab = 'moves' | 'book';
/** Keep both panes mounted: visibility changes must not discard trees, requests or scroll offsets. */
export function AnalysisSidebarTabs({ enabled, book, children }: {
  enabled: boolean; book: ReactNode; children: ReactNode;
}) {
  const [active, setActive] = useState<SidebarTab>('moves');
  const id = useId();
  useEffect(() => { if (!enabled) setActive('moves'); }, [enabled]);
  if (!enabled) return children;
  return <div className="sidebar-tabs-shell">
    {/* Native pressed buttons reserve Left/Right for workspace move navigation. */}
    <div className="sidebar-tabs" role="group" aria-label="Analysis sidebar">
      {(['moves', 'book'] as const).map(tab => <button key={tab} type="button"
        id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`}
        aria-pressed={active === tab} onClick={() => setActive(tab)}>{tab === 'moves' ? 'Moves' : 'Opening Book'}</button>)}
    </div>
    <div className="sidebar-tab-content sidebar-moves" role="region" tabIndex={0}
      id={`${id}-moves-panel`} aria-labelledby={`${id}-moves-tab`} hidden={active !== 'moves'}>{children}</div>
    <div className="sidebar-tab-content sidebar-book" role="region" tabIndex={0}
      id={`${id}-book-panel`} aria-labelledby={`${id}-book-tab`} hidden={active !== 'book'}>{book}</div>
  </div>;
}
