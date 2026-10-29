import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type SidebarTab = 'moves' | 'book';
export function nextSidebarTab(current: SidebarTab, key: string): SidebarTab | null {
  if (key === 'Home') return 'moves';
  if (key === 'End') return 'book';
  return key === 'ArrowLeft' || key === 'ArrowRight' ? current === 'moves' ? 'book' : 'moves' : null;
}

/** Keep both panes mounted: visibility changes must not discard trees, requests or scroll offsets. */
export function AnalysisSidebarTabs({ enabled, book, children }: {
  enabled: boolean; book: ReactNode; children: ReactNode;
}) {
  const [active, setActive] = useState<SidebarTab>('moves');
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!enabled) setActive('moves'); }, [enabled]);
  if (!enabled) return children;
  return <div className="sidebar-tabs-shell">
    <div className="sidebar-tabs" role="tablist" aria-label="Analysis sidebar" ref={tabs}>
      {(['moves', 'book'] as const).map(tab => <button key={tab} type="button" role="tab"
        id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`}
        aria-selected={active === tab} tabIndex={active === tab ? 0 : -1}
        onClick={() => setActive(tab)} onKeyDown={event => {
          const next = nextSidebarTab(tab, event.key);
          if (next === null) return;
          event.preventDefault(); setActive(next);
          tabs.current?.querySelector<HTMLButtonElement>(`[id="${id}-${next}-tab"]`)?.focus();
        }}>{tab === 'moves' ? 'Moves' : 'Opening Book'}</button>)}
    </div>
    <div className="sidebar-tab-content sidebar-moves" role="tabpanel" tabIndex={0}
      id={`${id}-moves-panel`} aria-labelledby={`${id}-moves-tab`} hidden={active !== 'moves'}>{children}</div>
    <div className="sidebar-tab-content sidebar-book" role="tabpanel" tabIndex={0}
      id={`${id}-book-panel`} aria-labelledby={`${id}-book-tab`} hidden={active !== 'book'}>{book}</div>
  </div>;
}
