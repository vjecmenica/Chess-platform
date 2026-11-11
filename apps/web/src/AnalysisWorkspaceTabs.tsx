import { useId, useState, type ReactNode } from 'react';

/** Hide panes rather than unmounting the engine, explorer or review portal. */
export function AnalysisWorkspaceTabs({ enabled, children, reviewHost }: {
  enabled: boolean; children: ReactNode; reviewHost: (element: HTMLDivElement | null) => void;
}) {
  const [active, setActive] = useState<'analysis' | 'review'>('analysis');
  const id = useId();
  if (!enabled) return children;
  return <div className="workspace-tabs-shell">
    <div className="workspace-tabs analysis-view-tabs" role="group" aria-label="Analysis workspace">
      {(['analysis', 'review'] as const).map(tab => <button key={tab} type="button"
        id={`${id}-${tab}-button`} aria-controls={`${id}-${tab}`} aria-pressed={active === tab}
        onClick={() => setActive(tab)}>{tab === 'analysis' ? 'Analysis' : 'Game Review'}</button>)}
    </div>
    <div className="workspace-analysis-pane" id={`${id}-analysis`} role="region"
      aria-labelledby={`${id}-analysis-button`} hidden={active !== 'analysis'}>{children}</div>
    <div className="workspace-review-pane" id={`${id}-review`} role="region"
      aria-labelledby={`${id}-review-button`} hidden={active !== 'review'}>
      <div ref={reviewHost} className="review-host" />
    </div>
  </div>;
}
