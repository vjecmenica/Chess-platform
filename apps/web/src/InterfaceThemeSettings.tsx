import { useSyncExternalStore } from 'react';
import { getInterfaceTheme, interfaceThemes, selectInterfaceTheme, subscribeToInterfaceTheme } from './interface-theme';

export function InterfaceThemeSettings() {
  const selected = useSyncExternalStore(subscribeToInterfaceTheme, getInterfaceTheme, getInterfaceTheme);
  return <section className="settings-section" aria-labelledby="interface-theme-heading">
    <h3 id="interface-theme-heading">Interface Theme</h3>
    <div className="interface-theme-options" role="group" aria-labelledby="interface-theme-heading">
      {interfaceThemes.map(theme => <button type="button" key={theme.id} aria-pressed={selected === theme.id}
        onClick={() => selectInterfaceTheme(theme.id)}>
        <span className="interface-theme-swatches" data-theme={theme.id} aria-hidden="true">
          <span /><span /><span /><span />
        </span>
        <span>{theme.name}</span>
        {selected === theme.id && <svg className="interface-theme-check" viewBox="0 0 16 16" width="16" height="16"
          fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
      </button>)}
    </div>
  </section>;
}
