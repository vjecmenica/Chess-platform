export const interfaceThemes = [
  { id: 'classic-chess-club', name: 'Classic Chess Club' },
  { id: 'old-library-dark', name: 'Old Library Dark' },
  { id: 'modern-heritage-dark', name: 'Modern Heritage Dark' },
  { id: 'minimalist-dark', name: 'Minimalist Dark' },
] as const;

export type InterfaceTheme = typeof interfaceThemes[number]['id'];
export const defaultInterfaceTheme = interfaceThemes[0].id;
export const interfaceThemeKey = 'chess.interface-theme.v1';

export function parseInterfaceTheme(value: string | null): InterfaceTheme {
  return interfaceThemes.find(theme => theme.id === value)?.id ?? defaultInterfaceTheme;
}

let currentTheme: InterfaceTheme = defaultInterfaceTheme;
const listeners = new Set<() => void>();

export const getInterfaceTheme = () => currentTheme;
export function subscribeToInterfaceTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function applyInterfaceTheme(theme: InterfaceTheme) {
  document.documentElement.dataset.theme = theme;
  if (theme === currentTheme) return;
  currentTheme = theme;
  for (const listener of listeners) listener();
}

function syncInterfaceTheme(event: StorageEvent) {
  if (event.key !== interfaceThemeKey && event.key !== null) return;
  try {
    const storage = window.localStorage;
    if (event.storageArea === storage) applyInterfaceTheme(parseInterfaceTheme(storage.getItem(interfaceThemeKey)));
  } catch { /* Storage may be blocked. Keep the current theme. */ }
}

export function initializeInterfaceTheme() {
  try { applyInterfaceTheme(parseInterfaceTheme(window.localStorage.getItem(interfaceThemeKey))); }
  catch { applyInterfaceTheme(defaultInterfaceTheme); }
  window.addEventListener('storage', syncInterfaceTheme);
}

export function selectInterfaceTheme(theme: InterfaceTheme) {
  applyInterfaceTheme(theme);
  try { window.localStorage.setItem(interfaceThemeKey, theme); }
  catch { /* The selection still applies in this tab. */ }
}
