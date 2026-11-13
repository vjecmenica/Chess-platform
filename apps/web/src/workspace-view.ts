export type WorkspaceView = { active: 'main' | 'review' | 'room'; floating: boolean };
export type WorkspaceViewAction = { type: 'select'; tab: WorkspaceView['active'] }
  | { type: 'toggle-chat' } | { type: 'close-chat' };
export const initialWorkspaceView: WorkspaceView = { active: 'main', floating: false };

/** Presentation only: no game, engine, chat or notes state lives in this reducer. */
export function workspaceView(state: WorkspaceView, action: WorkspaceViewAction): WorkspaceView {
  switch (action.type) {
    case 'select': return { ...state, active: action.tab };
    case 'toggle-chat': return { ...state, floating: !state.floating };
    case 'close-chat': return { ...state, floating: false };
  }
}
