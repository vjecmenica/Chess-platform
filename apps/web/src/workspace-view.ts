export type WorkspaceView = { active: 'main' | 'review' | 'room'; floating: boolean };
export type WorkspaceViewAction = { type: 'select'; tab: WorkspaceView['active'] }
  | { type: 'float' } | { type: 'close-chat' };
export const initialWorkspaceView: WorkspaceView = { active: 'main', floating: false };

/** Presentation only: no game, engine, chat or notes state lives in this reducer. */
export function workspaceView(state: WorkspaceView, action: WorkspaceViewAction): WorkspaceView {
  switch (action.type) {
    case 'select': return { active: action.tab, floating: action.tab === 'room' ? false : state.floating };
    case 'float': return { active: state.active === 'room' ? 'main' : state.active, floating: true };
    case 'close-chat': return { ...state, floating: false };
  }
}
