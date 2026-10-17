// The preset order and pool assignments are documented in docs/product-spec.md.
export const timeControlPresets = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '3+0': { initialMs: 180_000, incrementMs: 0 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+3': { initialMs: 300_000, incrementMs: 3_000 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '10+2': { initialMs: 600_000, incrementMs: 2_000 },
  '10+5': { initialMs: 600_000, incrementMs: 5_000 },
  '15+0': { initialMs: 900_000, incrementMs: 0 },
  '15+2': { initialMs: 900_000, incrementMs: 2_000 },
  '15+5': { initialMs: 900_000, incrementMs: 5_000 },
  '20+0': { initialMs: 1_200_000, incrementMs: 0 },
  '20+10': { initialMs: 1_200_000, incrementMs: 10_000 },
  '25+0': { initialMs: 1_500_000, incrementMs: 0 },
  '25+10': { initialMs: 1_500_000, incrementMs: 10_000 },
  '30+0': { initialMs: 1_800_000, incrementMs: 0 },
  '30+10': { initialMs: 1_800_000, incrementMs: 10_000 },
} as const;

export type TimeControlId = keyof typeof timeControlPresets;
export const defaultTimeControl: TimeControlId = '5+3';

export function isTimeControlId(value: unknown): value is TimeControlId {
  return typeof value === 'string' && Object.hasOwn(timeControlPresets, value);
}
