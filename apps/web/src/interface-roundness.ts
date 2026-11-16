export const defaultInterfaceRoundness = 6;
export const maximumInterfaceRoundness = 12;
export const interfaceRoundnessKey = 'chess.interface-roundness.v1';

export function parseInterfaceRoundness(value: string | null): number {
  if (value === null || !/^\d{1,2}$/.test(value)) return defaultInterfaceRoundness;
  const radius = Number(value);
  return radius <= maximumInterfaceRoundness ? radius : defaultInterfaceRoundness;
}

let currentRoundness = defaultInterfaceRoundness;
const listeners = new Set<() => void>();

export const getInterfaceRoundness = () => currentRoundness;
export function subscribeToInterfaceRoundness(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function applyInterfaceRoundness(radius: number) {
  document.documentElement.style.setProperty('--ui-radius', `${radius}px`);
  if (radius === currentRoundness) return;
  currentRoundness = radius;
  for (const listener of listeners) listener();
}

function syncInterfaceRoundness(event: StorageEvent) {
  if (event.key !== interfaceRoundnessKey && event.key !== null) return;
  try {
    const storage = window.localStorage;
    if (event.storageArea === storage) applyInterfaceRoundness(parseInterfaceRoundness(storage.getItem(interfaceRoundnessKey)));
  } catch { /* Keep the current setting when storage is unavailable. */ }
}

export function initializeInterfaceRoundness() {
  try { applyInterfaceRoundness(parseInterfaceRoundness(window.localStorage.getItem(interfaceRoundnessKey))); }
  catch { applyInterfaceRoundness(defaultInterfaceRoundness); }
  window.addEventListener('storage', syncInterfaceRoundness);
}

export function selectInterfaceRoundness(value: number) {
  const radius = parseInterfaceRoundness(String(value));
  applyInterfaceRoundness(radius);
  try { window.localStorage.setItem(interfaceRoundnessKey, String(radius)); }
  catch { /* The setting still applies in this tab. */ }
}
