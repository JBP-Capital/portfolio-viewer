import { addDays, addMonths, exchangeDate, hasSessionEnded, isExchangeOpen, todayInTimeZone } from '@pv/core'
import {
  currenciesInUse,
  currenciesNeedingFxHistory,
  listingsInUse,
  listingsNeedingHistory,
  purgeIntraday,
  saveDailyHistory,
  saveFxLatest,
  saveFxRates,
  saveQuotes,
  type Db,
  type ListingInUse,
} from '@pv/db'
import type { DailyHistory, FxHistoryProvider, MarketDataProvider } from '@pv/market-data'
import type { Backoff } from './backoff.ts'

export interface JobContext {
  db: Db
  provider: MarketDataProvider
  fxHistory: FxHistoryProvider
  now: () => Date
  log: (message: string) => void
  /** Keeps failing listings from being asked for every minute. */
  backoff: Backoff
}

const INTRADAY_KEEP_MS = 7 * 86_400_000
/** Data older than this many days is a gap for the backfill; the nightly refresh covers the days after it. */
const STALE_DAYS = 10
const today = (ctx: JobContext) => todayInTimeZone('UTC', ctx.now())
const refOf = (l: ListingInUse) => ({ mic: l.mic, symbol: l.symbol })
const key = (ref: { mic: string; symbol: string }) => `${ref.mic}:${ref.symbol}`
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Drops the bar of a session that is still running: providers report its live price as "close". */
export function completedHistory(history: DailyHistory, mic: string, now: Date): DailyHistory {
  const today = exchangeDate(mic, now)
  const ended = hasSessionEnded(mic, now)
  return { ...history, bars: history.bars.filter((b) => b.date < today || (b.date === today && ended)) }
}

/** Latest prices for held listings whose exchange is open (plus a grace period after the close). */
export async function refreshQuotes(ctx: JobContext): Promise<number> {
  const open = (await listingsInUse(ctx.db)).filter((l) => isExchangeOpen(l.mic, ctx.now()))
  let received = 0
  if (open.length > 0) {
    const byKey = new Map(open.map((l) => [key(l), l]))
    const quotes = await ctx.provider.quotes(open.map(refOf))
    await saveQuotes(
      ctx.db,
      quotes.flatMap((q) => {
        const listing = byKey.get(key(q.ref))
        return listing ? [{ listingId: listing.id, price: q.price, previousClose: q.previousClose, asOf: q.asOf, source: ctx.provider.id, points: q.points }] : []
      }),
    )
    received = quotes.length
    ctx.log(`quotes: ${received} of ${open.length} open listings`)
  }
  await purgeIntraday(ctx.db, new Date(ctx.now().getTime() - INTRADAY_KEEP_MS))
  return received
}

export async function refreshFxLatest(ctx: JobContext): Promise<number> {
  const currencies = await currenciesInUse(ctx.db)
  if (currencies.length === 0) return 0
  const rates = await ctx.provider.fxLatest(currencies)
  await saveFxLatest(ctx.db, rates.map((r) => ({ ...r, source: ctx.provider.id })))
  return rates.length
}

/** Currencies whose daily reference rates are kept: all the source publishes, and any other in use. */
async function referenceCurrencies(ctx: JobContext): Promise<string[]> {
  return [...new Set([...ctx.fxHistory.currencies, ...(await currenciesInUse(ctx.db))])].filter((c) => c !== 'EUR').sort()
}

export async function refreshFxDaily(ctx: JobContext, days = STALE_DAYS): Promise<number> {
  const currencies = await referenceCurrencies(ctx)
  if (currencies.length === 0) return 0
  const rates = await ctx.fxHistory.dailyRates(currencies, addDays(today(ctx), -days))
  await saveFxRates(ctx.db, rates)
  return rates.length
}

/**
 * Fills missing history: ten years for listings and currencies without any, and from the last
 * stored day for those whose data ends more than ten days ago.
 */
export async function backfill(ctx: JobContext, years = 10): Promise<{ listings: number; currencies: number; failures: string[] }> {
  const tenYearsAgo = addMonths(today(ctx), -12 * years)
  const staleBefore = addDays(today(ctx), -STALE_DAYS)
  const failures: string[] = []
  const fail = (what: string, message: string) => {
    ctx.backoff.failed(what, ctx.now())
    failures.push(`${what}: ${message}`)
    ctx.log(`backfill ${what} failed: ${message}`)
  }

  let listings = 0
  for (const listing of await listingsNeedingHistory(ctx.db, staleBefore)) {
    const what = key(listing)
    if (!ctx.backoff.ready(what, ctx.now())) continue
    try {
      const raw = await ctx.provider.dailyHistory(refOf(listing), listing.lastDate ?? tenYearsAgo)
      const history = completedHistory(raw, listing.mic, ctx.now())
      const lastDate = listing.lastDate
      if (!history.bars.some((b) => lastDate === null || b.date > lastDate)) {
        fail(what, lastDate === null ? 'no prices' : `no prices after ${lastDate}`)
        continue
      }
      await saveDailyHistory(ctx.db, listing.id, history, ctx.provider.id)
      ctx.backoff.succeeded(what)
      listings += 1
    } catch (error) {
      fail(what, reason(error))
    }
  }

  const stale = await currenciesNeedingFxHistory(ctx.db, await referenceCurrencies(ctx), staleBefore)
  const lastDates = new Map(stale.map((c) => [c.currency, c.lastDate ?? '']))
  const byStart = new Map<string, string[]>()
  for (const c of stale) {
    const from = c.lastDate ?? tenYearsAgo
    byStart.set(from, [...(byStart.get(from) ?? []), c.currency])
  }
  for (const [from, group] of byStart) {
    // A currency is asked for again after its own waiting time, whatever else is asked with it.
    const currencies = group.filter((c) => ctx.backoff.ready(`fx:${c}`, ctx.now()))
    if (currencies.length === 0) continue
    try {
      const rates = await ctx.fxHistory.dailyRates(currencies, from)
      await saveFxRates(ctx.db, rates)
      for (const currency of currencies) {
        // A source that stopped publishing a currency answers without error but with nothing new.
        if (rates.some((r) => r.currency === currency && r.date > lastDates.get(currency)!)) ctx.backoff.succeeded(`fx:${currency}`)
        else fail(`fx:${currency}`, 'no newer rates')
      }
    } catch (error) {
      for (const currency of currencies) fail(`fx:${currency}`, reason(error))
    }
  }
  return { listings, currencies: stale.length, failures }
}

/** Re-reads the last days of every listing in use, picking up late corrections. */
export async function refreshHistory(ctx: JobContext, days = STALE_DAYS): Promise<{ listings: number; failures: string[] }> {
  const from = addDays(today(ctx), -days)
  const failures: string[] = []
  let listings = 0
  for (const listing of await listingsInUse(ctx.db)) {
    try {
      const history = completedHistory(await ctx.provider.dailyHistory(refOf(listing), from), listing.mic, ctx.now())
      await saveDailyHistory(ctx.db, listing.id, history, ctx.provider.id)
      listings += 1
    } catch (error) {
      failures.push(`${key(listing)}: ${reason(error)}`)
      ctx.log(`history ${key(listing)} failed: ${reason(error)}`)
    }
  }
  return { listings, failures }
}
