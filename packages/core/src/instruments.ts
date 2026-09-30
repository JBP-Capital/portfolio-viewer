export const INSTRUMENT_TYPES = ['stock', 'etf', 'etc', 'fund', 'bond', 'index', 'other'] as const
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number]
