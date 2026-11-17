import { useId, useSyncExternalStore } from 'react';
import { SettingsRange } from './SettingsRange';
import {
  defaultInterfaceRoundness, getInterfaceRoundness, maximumInterfaceRoundness,
  selectInterfaceRoundness, subscribeToInterfaceRoundness,
} from './interface-roundness';

export function InterfaceRoundnessSettings() {
  const radius = useSyncExternalStore(subscribeToInterfaceRoundness, getInterfaceRoundness, getInterfaceRoundness);
  const id = useId();
  return <section className="settings-section" aria-labelledby={`${id}-heading`}>
    <div className="roundness-heading">
      <h3 id={`${id}-heading`}><label htmlFor={id}>Roundness</label></h3>
      <button type="button" className="secondary" onClick={() => selectInterfaceRoundness(defaultInterfaceRoundness)}
        disabled={radius === defaultInterfaceRoundness}>Reset to default</button>
    </div>
    <div className="roundness-slider">
      <SettingsRange id={id} min={0} max={maximumInterfaceRoundness} step={1} value={radius}
        onChange={event => selectInterfaceRoundness(event.currentTarget.valueAsNumber)} />
      <output htmlFor={id} aria-hidden="true">{radius}</output>
      <div className="roundness-endpoints" aria-hidden="true"><span>Square</span><span>Rounded</span></div>
    </div>
  </section>;
}
