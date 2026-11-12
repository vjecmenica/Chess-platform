import { useSyncExternalStore } from 'react';
import { getInterfaceTheme, interfaceThemes, selectInterfaceTheme, subscribeToInterfaceTheme } from './interface-theme';

export function InterfaceThemeSettings() {
  const selected = useSyncExternalStore(subscribeToInterfaceTheme, getInterfaceTheme, getInterfaceTheme);
  return <section className="interface-theme-settings" aria-labelledby="interface-theme-heading">
    <h3 id="interface-theme-heading">Interface Theme</h3>
    <p id="interface-theme-hint">Applies immediately in this browser.</p>
    <div className="interface-theme-options" role="group" aria-labelledby="interface-theme-heading"
      aria-describedby="interface-theme-hint">
      {interfaceThemes.map(theme => <button type="button" key={theme.id} aria-pressed={selected === theme.id}
        onClick={() => selectInterfaceTheme(theme.id)}>
        <span className="interface-theme-swatches" data-theme={theme.id} aria-hidden="true">
          <span /><span /><span /><span />
        </span>
        <span>{theme.name}</span>
      </button>)}
    </div>
  </section>;
}
