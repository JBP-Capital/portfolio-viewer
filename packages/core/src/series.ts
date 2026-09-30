import { toMajorUnit } from './currency.ts'
import { addDays } from './dates.ts'
import { periodStart, type CloseLookup, type DailyPoint, type Period } from './returns.ts'

export interface DatedClose {
  date: string
  close: number
}

export interface DatedRate {
  date: string
  /** Units of the currency per one euro. */
  perEur: number
}

/** Instrument id → its listing currency and closes, ascending by date. */
export type PriceTable = ReadonlyMap<string, { currency: string; closes: readonly DatedClose[] }>

/** Currency (major unit) → reference rates, ascending by date. */
export type RateTable = ReadonlyMap<string, readonly DatedRate[]>

/** Index of the last row dated on or before `date`, or -1. */
function lastAtOrBefore<T extends { date: string }>(rows: readonly T[], date: string): number {
  let lo = 0
  let hi = rows.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.date <= date) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * Closes in base currency with carry-forward: the last close on or before the date, if it is at most
 * `staleDays` old (weekends, holidays). Older closes and missing rates give null.
 */
export function createCloseLookup(prices: PriceTable, rates: RateTable, baseCurrency: string, staleDays = 7): CloseLookup {
  // Every close needs up to three lookups for the same date; date arithmetic is the costly part.
  const oldest = new Map<string, string>()
  const oldestFor = (date: string): string => {
    let limit = oldest.get(date)
    if (limit === undefined) {
      limit = addDays(date, -staleDays)
      oldest.set(date, limit)
    }
    return limit
  }
  const fresh = <T extends { date: string }>(rows: readonly T[] | undefined, date: string): T | null => {
    if (!rows) return null
    const row = rows[lastAtOrBefore(rows, date)]
    return row && row.date >= oldestFor(date) ? row : null
  }
  const perEur = (currency: string, date: string): number | null => (currency === 'EUR' ? 1 : (fresh(rates.get(currency), date)?.perEur ?? null))
  return (instrumentId, date) => {
    const series = prices.get(instrumentId)
    const row = fresh(series?.closes, date)
    if (!series || !row) return null
    const { currency: major, amount: factor } = toMajorUnit(series.currency, 1)
    if (major === baseCurrency) return row.close * factor
    const base = perEur(baseCurrency, date)
    const quote = perEur(major, date)
    return base === null || quote === null ? null : (row.close * factor * base) / quote
  }
}

/** 100 × the chained daily returns after `from`; the value at `from` is 100. */
export function cumulativeIndex(points: readonly DailyPoint[], from: string): { date: string; value: number }[] {
  let level = 100
  const out: { date: string; value: number }[] = []
  for (const p of points) {
    if (p.date < from) continue
    if (p.date > from) level *= 1 + p.dailyReturn
    out.push({ date: p.date, value: level })
  }
  return out
}

/** A benchmark's close relative to its first available close among `dates`, as an index starting at 100. */
export function benchmarkIndex(close: CloseLookup, instrumentId: string, dates: readonly string[]): { date: string; value: number }[] {
  let base: number | null = null
  const out: { date: string; value: number }[] = []
  for (const date of dates) {
    const c = close(instrumentId, date)
    if (c === null) continue
    base ??= c
    out.push({ date, value: (100 * c) / base })
  }
  return out
}

/** A benchmark's return over a period (MAX starts at `firstDate`); null when its closes do not cover the start. */
export function benchmarkReturn(close: CloseLookup, instrumentId: string, period: Period, asOf: string, firstDate?: string): number | null {
  const start = periodStart(period, asOf) ?? firstDate
  if (!start) return null
  const from = close(instrumentId, start)
  const to = close(instrumentId, asOf)
  return from === null || to === null ? null : to / from - 1
}

/** At most `max` points: the last point of each equal-sized bucket, so the latest value is always kept. */
export function downsample<T extends { date: string }>(points: readonly T[], max = 400): T[] {
  if (points.length <= max) return [...points]
  const size = Math.ceil(points.length / max)
  const out: T[] = []
  for (let end = points.length; end > 0; end -= size) out.push(points[end - 1]!)
  return out.reverse()
}

/**
 * Value of fixed quantities at each date's close. Only securities with a close on the last date count, and
 * only dates on which every one of them has a close are kept, so the line moves with prices alone.
 */
export function holdingsHistory(
  quantities: ReadonlyMap<string, number>,
  dates: readonly string[],
  close: CloseLookup,
): { date: string; value: number }[] {
  const last = dates.at(-1)
  const priced = last === undefined ? [] : [...quantities].filter(([instrumentId]) => close(instrumentId, last) !== null)
  if (priced.length === 0) return []
  const out: { date: string; value: number }[] = []
  for (const date of dates) {
    let value = 0
    for (const [instrumentId, quantity] of priced) {
      const c = close(instrumentId, date)
      if (c === null) {
        value = Number.NaN
        break
      }
      value += quantity * c
    }
    if (!Number.isNaN(value)) out.push({ date, value })
  }
  return out
}
