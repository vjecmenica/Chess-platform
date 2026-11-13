import { useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { ChatUnreadBadge } from './GameChat';
import { initialWorkspaceView, workspaceView } from './workspace-view';

export interface GameRoomPresentation {
  visible: boolean;
  floating: boolean;
  info?: ReactNode;
  onCloseFloating: () => void;
  onUnreadChange: (count: number) => void;
}

/** Every pane stays mounted, including the Game Room's shared chat controller. */
export function AnalysisWorkspaceTabs({ enabled, children, reviewHost, gameRoom, gameInfo, footer }: {
  enabled: boolean; children: ReactNode; reviewHost: (element: HTMLDivElement | null) => void;
  gameRoom?: ((presentation: GameRoomPresentation) => ReactNode) | undefined;
  gameInfo?: ReactNode;
  footer?: ReactNode;
}) {
  const [view, dispatch] = useReducer(workspaceView, initialWorkspaceView);
  const [unread, setUnread] = useState(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const id = useId();
  const hasRoom = Boolean(gameRoom || gameInfo);
  const active = !enabled && view.active === 'review' ? 'main' : view.active;
  const inRoom = active === 'room';
  function closeFloating() {
    dispatch({ type: 'close-chat' });
    requestAnimationFrame(() => launcher.current?.focus());
  }
  const tabs = [
    { id: 'main' as const, label: enabled ? 'Analysis' : 'Moves' },
    ...(enabled ? [{ id: 'review' as const, label: 'Game Review' }] : []),
    ...(hasRoom ? [{ id: 'room' as const, label: 'Game Room' }] : []),
  ];
  return <div className="workspace-tabs-shell">
    <div className="workspace-tabs analysis-view-tabs" role="group" aria-label={enabled ? 'Analysis workspace' : 'Game workspace'}>
      {tabs.map(tab => <button key={tab.id} type="button"
        id={`${id}-${tab.id}-button`} aria-controls={`${id}-${tab.id}`} aria-pressed={active === tab.id}
        onClick={() => dispatch({ type: 'select', tab: tab.id })}>{tab.label}
        {tab.id === 'room' && <ChatUnreadBadge count={unread} />}</button>)}
    </div>
    <div className={enabled ? 'workspace-analysis-pane' : 'workspace-play-pane'} id={`${id}-main`} role="region"
      aria-labelledby={`${id}-main-button`} hidden={active !== 'main'}>{children}</div>
    {enabled && <div className="workspace-review-pane" id={`${id}-review`} role="region"
      aria-labelledby={`${id}-review-button`} hidden={active !== 'review'}>
      <div ref={reviewHost} className="review-host" />
    </div>}
    {hasRoom && (
      <div className="workspace-room-pane" id={`${id}-room`} role="region" aria-labelledby={`${id}-room-button`}
        data-overlay-only={!inRoom && view.floating} hidden={!inRoom && !view.floating}>
        <div className="workspace-room-layout" data-analysis={enabled} data-info-only={!gameRoom}>
          {gameRoom?.({
            visible: inRoom,
            floating: view.floating,
            info: enabled ? undefined : gameInfo,
            onCloseFloating: closeFloating,
            onUnreadChange: setUnread,
          })}
          {(enabled || !gameRoom) && <div className="workspace-room-info" hidden={!inRoom && view.floating}>{gameInfo}</div>}
        </div>
      </div>
    )}
    {gameRoom && (
      <button ref={launcher} className="floating-chat-launcher secondary" type="button"
        aria-label={view.floating ? 'Close floating chat' : 'Open floating chat'} aria-expanded={view.floating}
        onClick={() => dispatch({ type: 'toggle-chat' })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg>
        <ChatUnreadBadge count={unread} />
      </button>
    )}
    {footer && <footer className="workspace-footer" aria-label="Game status and actions">{footer}</footer>}
  </div>;
}
