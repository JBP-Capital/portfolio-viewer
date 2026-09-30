import { addDays, addMonths, eachDay, endOfPreviousMonth } from './dates.ts'
import { createLedger, sortTransactions, type LedgerTransaction } from './ledger.ts'

/** Close of one share in base currency on a date; null when unknown or stale. */
export type CloseLookup = (instrumentId: string, date: string) => number | null

export interface DailyPoint {
  date: string
  /** End-of-day value of all priced holdings, base currency. */
  value: number
  /** Money entering during the day, counted at the start of the day. */
  flowIn: number
  /** Money leaving during the day, counted at the end of the day. */
  flowOut: number
  /** (value + flowOut) / (previous value + flowIn) − 1, or 0 when nothing was invested. */
  dailyReturn: number
}

/**
 * Daily values and time-weighted daily returns of a set of transactions.
 * Holdings without a close are left out of value and flows; a holding that gains or loses its
 * price counts as money in or out at that moment, so it never creates a fake gain or loss.
 */
export function valuationSeries(txs: readonly LedgerTransaction[], from: string, to: string, close: CloseLookup): DailyPoint[] {
  const sorted = sortTransactions(txs)
  const ledger = createLedger()
  let next = 0
  while (next < sorted.length && sorted[next]!.tradeDate < from) ledger.apply(sorted[next++]!)

  const dayBefore = addDays(from, -1)
  let previousCloses = new Map<string, number>()
  let previousValue = 0
  for (const [id, p] of ledger.positions) {
    if (p.quantity <= 0) continue
    const c = close(id, dayBefore)
    if (c !== null) {
      previousCloses.set(id, c)
      previousValue += p.quantity * c
    }
  }

  const points: DailyPoint[] = []
  for (const date of eachDay(from, to)) {
    const startQuantities = new Map<string, number>()
    for (const [id, p] of ledger.positions) if (p.quantity > 0) startQuantities.set(id, p.quantity)

    const today: LedgerTransaction[] = []
    while (next < sorted.length && sorted[next]!.tradeDate === date) {
      const tx = sorted[next++]!
      ledger.apply(tx)
      today.push(tx)
    }

    const cache = new Map<string, number | null>()
    const closeOf = (id: string): number | null => {
      if (!cache.has(id)) cache.set(id, close(id, date))
      return cache.get(id) ?? null
    }

    let flowIn = 0
    let flowOut = 0
    for (const [id, quantity] of startQuantities) {
      const before = previousCloses.get(id)
      const now = closeOf(id)
      if (before === undefined && now !== null) flowIn += quantity * now
      if (before !== undefined && now === null) flowOut += quantity * before
    }
    for (const tx of today) {
      const c = closeOf(tx.instrumentId)
      if (c === null) continue
      const quantity = tx.quantity ?? 0
      switch (tx.type) {
        case 'buy':
          flowIn += (quantity * (tx.price ?? 0) + tx.fees + tx.taxes) * tx.fxRate
          break
        case 'transfer_in':
        case 'exchange_in':
          if (!tx.internal) flowIn += quantity * c
          break
        case 'sell':
          flowOut += (quantity * (tx.price ?? 0) - tx.fees) * tx.fxRate
          break
        case 'transfer_out':
        case 'exchange_out':
          if (!tx.internal) flowOut += quantity * c
          break
        case 'dividend':
          flowOut += ((tx.amount ?? 0) - tx.taxes) * tx.fxRate
          break
        case 'split':
          break
      }
    }

    let value = 0
    const closesToday = new Map<string, number>()
    for (const [id, p] of ledger.positions) {
      if (p.quantity <= 0) continue
      const c = closeOf(id)
      if (c === null) continue
      value += p.quantity * c
      closesToday.set(id, c)
    }

    const denominator = previousValue + flowIn
    const dailyReturn = denominator > 0 ? (value + flowOut) / denominator - 1 : 0
    points.push({ date, value, flowIn, flowOut, dailyReturn })
    previousValue = value
    previousCloses = closesToday
  }
  return points
}

export const PERIODS = ['1D', '1W', '1M', 'MTD', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const
export type Period = (typeof PERIODS)[number]

/** The base date of a period (its value is the starting value); null for MAX. */
export function periodStart(period: Period, asOf: string): string | null {
  switch (period) {
    case '1D':
      return addDays(asOf, -1)
    case '1W':
      return addDays(asOf, -7)
    case '1M':
      return addMonths(asOf, -1)
    case 'MTD':
      return endOfPreviousMonth(asOf)
    case 'YTD':
      return `${Number(asOf.slice(0, 4)) - 1}-12-31`
    case '1Y':
      return addMonths(asOf, -12)
    case '3Y':
      return addMonths(asOf, -36)
    case '5Y':
      return addMonths(asOf, -60)
    case 'MAX':
      return null
  }
}

/** True when every day strictly between the two dates is a weekend day or 1 January (no market was open). */
function onlyClosedDaysBetween(from: string, to: string): boolean {
  for (let day = addDays(from, 1), steps = 0; day < to; day = addDays(day, 1), steps += 1) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    if (steps > 4 || (weekday !== 0 && weekday !== 6 && !day.endsWith('-01-01'))) return false
  }
  return true
}

/**
 * Time-weighted return of a period, or null when the history does not reach back to its start. A
 * history that begins right after a weekend or New Year still covers a period starting before them.
 */
export function periodReturn(points: readonly DailyPoint[], period: Period, asOf: string): number | null {
  const first = points.find((p) => p.value > 0 || p.flowIn > 0)
  if (!first) return null
  const start = periodStart(period, asOf)
  if (start !== null && start < addDays(first.date, -1) && !onlyClosedDaysBetween(start, first.date)) return null
  let growth = 1
  for (const p of points) {
    if (p.date > asOf) break
    const inside = start === null ? p.date >= first.date : p.date > start
    if (inside) growth *= 1 + p.dailyReturn
  }
  return growth - 1
}
