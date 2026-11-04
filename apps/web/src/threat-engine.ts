import { liteEngine, type EngineVariant } from './engine-builds';

export interface ThreatDevice { cores: number; memoryGb?: number }
export function browserThreatDevice(): ThreatDevice {
  if (typeof navigator === 'undefined') return { cores: 2 };
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { cores: navigator.hardwareConcurrency || 2, ...(memoryGb === undefined ? {} : { memoryGb }) };
}

/** Two Full runtimes can be large even with a small UCI Hash. Hints are conservative gates, not RAM guarantees. */
export function threatEnginePlan(selected: EngineVariant, device: ThreatDevice, failedId: string | null = null): {
  engine: EngineVariant; reason: string | null;
} {
  if (selected.id === liteEngine.id) return { engine: liteEngine, reason: null };
  if (!Number.isFinite(device.cores) || device.cores < 6)
    return { engine: liteEngine, reason: 'Threat uses Lite: fewer than six logical cores are reported.' };
  if (device.memoryGb === undefined || !Number.isFinite(device.memoryGb))
    return { engine: liteEngine, reason: 'Threat uses Lite: browser memory capacity is not reported.' };
  if (device.memoryGb < 8)
    return { engine: liteEngine, reason: 'Threat uses Lite: less than 8 GB of device memory is reported.' };
  if (failedId === selected.id)
    return { engine: liteEngine, reason: 'Full Threat could not run; using Lite.' };
  return { engine: selected, reason: null };
}
