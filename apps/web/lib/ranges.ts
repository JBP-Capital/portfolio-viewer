import { addMonths } from '@pv/core'

export const RANGES = ['1M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const
export type Range = (typeof RANGES)[number]
export const DEFAULT_RANGE: Range = '1Y'

/** Prices are stored for ten years, so no chart of past prices reaches further back. */
const PRICE_HISTORY_MONTHS = 120

/** The `?range=` value of a page, or the default when it is missing or unknown. */
export function parseRange(value: string | string[] | undefined): Range {
  const raw = Array.isArray(value) ? value[0] : value
  return (RANGES as readonly string[]).includes(raw ?? '') ? (raw as Range) : DEFAULT_RANGE
}

function calendarStart(range: Exclude<Range, 'MAX'>, asOf: string): string {
  const months: Record<Exclude<Range, 'YTD' | 'MAX'>, number> = { '1M': 1, '6M': 6, '1Y': 12, '5Y': 60 }
  return range === 'YTD' ? `${Number(asOf.slice(0, 4)) - 1}-12-31` : addMonths(asOf, -months[range])
}

/** First day shown for a range: its calendar start, but never before the first trade. */
export function rangeStart(range: Range, asOf: string, firstDate: string | null): string {
  const start = range === 'MAX' ? (firstDate ?? asOf) : calendarStart(range, asOf)
  return firstDate !== null && firstDate > start ? firstDate : start
}

/** First day of the hypothetical chart: the calendar start, as it does not depend on when a security was bought. */
export function hypotheticalStart(range: Range, asOf: string): string {
  return range === 'MAX' ? addMonths(asOf, -PRICE_HISTORY_MONTHS) : calendarStart(range, asOf)
}
