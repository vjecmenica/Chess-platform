import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppearanceSettings } from './AppearanceSettings';
import { EngineSettings } from './EngineSettings';
import { InterfaceThemeSettings } from './InterfaceThemeSettings';
import { InterfaceRoundnessSettings } from './InterfaceRoundnessSettings';

type Category = 'appearance' | 'engine';
const Context = createContext({ open: (_category: Category) => {}, isOpen: false });
export const useSettings = () => useContext(Context);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [category, setCategory] = useState<Category>('appearance');
  const [isOpen, setOpen] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);

  function open(category: Category) {
    trigger.current = document.activeElement as HTMLElement;
    setCategory(category);
    setOpen(true);
  }
  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => { if (isOpen) dialog.current?.showModal(); }, [isOpen]);
  useLayoutEffect(() => { if (content.current) content.current.scrollTop = 0; }, [category]);

  return <Context.Provider value={{ isOpen, open }}>
    {children}
    {isOpen && createPortal(<dialog id="engine-settings" className="shared-settings-dialog settings-dialog" ref={dialog}
      aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); close(); }}>
      <header>
        <h2 id="settings-title">Settings</h2>
        <button type="button" className="secondary" aria-label="Close settings" onClick={close}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="settings-layout">
        <nav aria-label="Settings categories">
          {(['appearance', 'engine'] as const).map(item => <button type="button" key={item}
            aria-current={category === item ? 'page' : undefined} onClick={() => setCategory(item)}>
            {item === 'appearance' ? 'Appearance' : 'Engine'}
          </button>)}
          <a href="/account#settings">Account settings</a>
        </nav>
        <div className="settings-sections" ref={content}>
          <div className="settings-category" hidden={category !== 'appearance'}>
            <InterfaceThemeSettings />
            <InterfaceRoundnessSettings />
            <AppearanceSettings actionTarget={category === 'appearance' ? footer : null} />
          </div>
          <div hidden={category !== 'engine'}>
            <EngineSettings actionTarget={category === 'engine' ? footer : null} />
          </div>
        </div>
      </div>
      <div className="settings-footer" ref={setFooter} />
    </dialog>, document.body)}
  </Context.Provider>;
}
