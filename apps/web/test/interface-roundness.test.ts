import { afterEach, expect, it, vi } from 'vitest';

function browser(saved: string | null) {
  const localStorage = {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => { saved = value; }),
  };
  const window = Object.assign(new EventTarget(), { localStorage });
  const setProperty = vi.fn();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { documentElement: { style: { setProperty }, dataset: {} } });
  return { window, localStorage, setProperty };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([null, '', 'not-a-number', '-1', '13', '1.5', ' 6', 'NaN'])('uses the default for stored value %s', async saved => {
  const { setProperty } = browser(saved);
  const preference = await import('../src/interface-roundness');
  preference.initializeInterfaceRoundness();
  expect(preference.getInterfaceRoundness()).toBe(6);
  expect(setProperty).toHaveBeenCalledExactlyOnceWith('--ui-radius', '6px');
});

it('applies and persists slider extremes independently of the interface theme', async () => {
  const { setProperty, localStorage } = browser('0');
  const preference = await import('../src/interface-roundness');
  preference.initializeInterfaceRoundness();
  expect(preference.getInterfaceRoundness()).toBe(0);
  const listener = vi.fn();
  const unsubscribe = preference.subscribeToInterfaceRoundness(listener);
  preference.selectInterfaceRoundness(12);
  expect(setProperty).toHaveBeenLastCalledWith('--ui-radius', '12px');
  expect(localStorage.setItem).toHaveBeenCalledWith(preference.interfaceRoundnessKey, '12');
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  const theme = await import('../src/interface-theme');
  theme.selectInterfaceTheme('old-library-dark');
  expect(preference.getInterfaceRoundness()).toBe(12);
  expect(setProperty).toHaveBeenLastCalledWith('--ui-radius', '12px');
});

it('synchronizes changes and clears across tabs without echoing a write', async () => {
  const { localStorage, window, setProperty } = browser('3');
  const preference = await import('../src/interface-roundness');
  preference.initializeInterfaceRoundness();
  expect(setProperty).toHaveBeenLastCalledWith('--ui-radius', '3px');
  localStorage.getItem.mockReturnValue('12');
  window.dispatchEvent(Object.assign(new Event('storage'), {
    key: preference.interfaceRoundnessKey, storageArea: localStorage,
  }));
  expect(preference.getInterfaceRoundness()).toBe(12);
  localStorage.getItem.mockReturnValue(null);
  window.dispatchEvent(Object.assign(new Event('storage'), { key: null, storageArea: localStorage }));
  expect(preference.getInterfaceRoundness()).toBe(6);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('still applies selections when localStorage is blocked', async () => {
  const { localStorage, setProperty } = browser(null);
  localStorage.getItem.mockImplementation(() => { throw new Error('Blocked'); });
  localStorage.setItem.mockImplementation(() => { throw new Error('Blocked'); });
  const preference = await import('../src/interface-roundness');
  preference.initializeInterfaceRoundness();
  expect(preference.getInterfaceRoundness()).toBe(6);
  preference.selectInterfaceRoundness(9);
  expect(setProperty).toHaveBeenLastCalledWith('--ui-radius', '9px');
});
