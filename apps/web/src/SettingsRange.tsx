import type { ComponentPropsWithoutRef, CSSProperties } from 'react';

type SettingsRangeProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'min' | 'max' | 'value'> & {
  min: number; max: number; value: number;
};

export function SettingsRange({ min, max, value, ...props }: SettingsRangeProps) {
  const progress = max === min ? 0 : 100 * (value - min) / (max - min);
  return <input {...props} className="settings-range" type="range" min={min} max={max} value={value}
    style={{ '--settings-range-fill': `${progress}%` } as CSSProperties} />;
}
