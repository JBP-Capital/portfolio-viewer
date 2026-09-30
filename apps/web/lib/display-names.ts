import type { AllocationSlice } from '@pv/db'

/** A display name from Intl (country or currency), falling back to the code. */
export function displayName(locale: string, type: 'region' | 'currency', code: string): string {
  try {
    return new Intl.DisplayNames([locale === 'de' ? 'de-DE' : 'en-US'], { type }).of(code) ?? code
  } catch {
    return code
  }
}

/** The label of an allocation slice: translated "unknown" / "other", a sector as given, a currency or country by name. */
export function allocationLabel(
  by: 'sector' | 'currency' | 'country',
  slice: AllocationSlice,
  locale: string,
  words: { unknown: string; other: string },
): string {
  if (slice.kind === 'unknown') return words.unknown
  if (slice.kind === 'other') return words.other
  if (by === 'currency') return `${slice.key} · ${displayName(locale, 'currency', slice.key)}`
  return by === 'country' ? displayName(locale, 'region', slice.key) : slice.key
}
