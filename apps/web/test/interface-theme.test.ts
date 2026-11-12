import { afterEach, describe, expect, it, vi } from 'vitest';

function browser(saved: string | null) {
  const localStorage = {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => { saved = value; }),
  };
  const window = Object.assign(new EventTarget(), { localStorage });
  const dataset: Record<string, string> = {};
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { documentElement: { dataset } });
  return { window, dataset, localStorage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('interface theme preference', () => {
  it.each([null, 'unknown-theme'])('starts with Classic Chess Club for stored value %s', async saved => {
    const { dataset } = browser(saved);
    const theme = await import('../src/interface-theme');
    theme.initializeInterfaceTheme();
    expect(dataset.theme).toBe('classic-chess-club');
  });

  it('applies a choice immediately and restores it on initialization', async () => {
    const { dataset, localStorage } = browser(null);
    const theme = await import('../src/interface-theme');
    theme.initializeInterfaceTheme();
    const unsubscribe = theme.subscribeToInterfaceTheme(() => expect(dataset.theme).toBe('old-library-dark'));
    theme.selectInterfaceTheme('old-library-dark');
    expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith(theme.interfaceThemeKey, 'old-library-dark');
    unsubscribe();
    vi.resetModules();
    const reloaded = await import('../src/interface-theme');
    reloaded.initializeInterfaceTheme();
    expect(reloaded.getInterfaceTheme()).toBe('old-library-dark');
  });

  it('follows cross-tab changes and resets when local storage is cleared', async () => {
    const { dataset, window, localStorage } = browser('old-library-dark');
    const theme = await import('../src/interface-theme');
    theme.initializeInterfaceTheme();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeToInterfaceTheme(listener);
    localStorage.getItem.mockReturnValue('modern-heritage-dark');
    window.dispatchEvent(Object.assign(new Event('storage'), {
      key: theme.interfaceThemeKey, storageArea: localStorage,
    }));
    expect(dataset.theme).toBe('modern-heritage-dark');
    expect(listener).toHaveBeenCalledOnce();
    localStorage.getItem.mockReturnValue(null);
    window.dispatchEvent(Object.assign(new Event('storage'), { key: null, storageArea: localStorage }));
    expect(dataset.theme).toBe('classic-chess-club');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('continues to apply themes when storage access fails', async () => {
    const { dataset, localStorage } = browser(null);
    localStorage.getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    localStorage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    const theme = await import('../src/interface-theme');
    theme.initializeInterfaceTheme();
    expect(dataset.theme).toBe('classic-chess-club');
    theme.selectInterfaceTheme('minimalist-dark');
    expect(dataset.theme).toBe('minimalist-dark');
  });
});
