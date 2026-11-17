import { isTimeControlId, timeControlPresets, type TimeControlId } from '@chess/contracts';

export function TimeControlSelect({ value, disabled, onChange }: {
  value: TimeControlId; disabled: boolean; onChange: (value: TimeControlId) => void;
}) {
  return <label>Time control{' '}
    <select value={value} disabled={disabled} onChange={event => {
      if (isTimeControlId(event.target.value)) onChange(event.target.value);
    }}>
      {Object.keys(timeControlPresets).map(id => <option key={id} value={id}>{id}</option>)}
    </select>
  </label>;
}

export function timeControlLabel(initialMs: number, incrementMs: number): string {
  return `${initialMs / 60_000}+${incrementMs / 1_000}`;
}

export function ChallengeModeSelect({ rated, ratedAvailable, disabled, onChange }: {
  rated: boolean; ratedAvailable: boolean; disabled: boolean; onChange: (rated: boolean) => void;
}) {
  return <label>Mode{' '}
    <select value={rated ? 'rated' : 'casual'} disabled={disabled}
      onChange={event => onChange(event.target.value === 'rated')}>
      <option value="casual">Casual</option>
      <option value="rated" disabled={!ratedAvailable}>Rated</option>
    </select>
  </label>;
}
