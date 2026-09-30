import { toMajorUnit } from '@pv/core'
import { asc, eq, inArray, isNull, lt, max, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import {
  benchmarks,
  dailyPrices,
  fxLatest,
  fxRates,
  instruments,
  intradayPrices,
  listings,
  members,
  portfolios,
  quotes,
  referenceDividends,
  referenceSplits,
  transactions,
} from './schema.ts'

export interface ListingInUse {
  id: string
  mic: string
  symbol: string
  currency: string
}

/**
 * Listings needed for valuation: the listing of every transaction (or its instrument's default) in
 * active portfolios, plus the benchmark listings.
 */
export async function listingsInUse(db: Db): Promise<ListingInUse[]> {
  const used = db
    .selectDistinct({ id: sql<string>`coalesce(${transactions.listingId}, ${instruments.defaultListingId})`.as('used_listing_id') })
    .from(transactions)
    .innerJoin(instruments, eq(instruments.id, transactions.instrumentId))
    .innerJoin(portfolios, eq(portfolios.id, transactions.portfolioId))
    .where(isNull(portfolios.archivedAt))
    .union(db.select({ id: sql<string>`${benchmarks.listingId}`.as('used_listing_id') }).from(benchmarks))
    .as('used')
  return db
    .select({ id: listings.id, mic: listings.mic, symbol: listings.symbol, currency: listings.currency })
    .from(listings)
    .innerJoin(used, eq(used.id, listings.id))
    .orderBy(asc(listings.mic), asc(listings.symbol))
}

/**
 * Listings in use whose stored closes are missing or end before `staleBefore` (worker downtime, or a
 * listing held again after a pause). `lastDate` is where the gap starts; null means no history yet.
 */
export async function listingsNeedingHistory(db: Db, staleBefore: string): Promise<(ListingInUse & { lastDate: string | null })[]> {
  const inUse = await listingsInUse(db)
  if (inUse.length === 0) return []
  const last = await db
    .select({ id: dailyPrices.listingId, lastDate: max(dailyPrices.date) })
    .from(dailyPrices)
    .where(inArray(dailyPrices.listingId, inUse.map((l) => l.id)))
    .groupBy(dailyPrices.listingId)
  const lastById = new Map(last.map((r) => [r.id, r.lastDate]))
  return inUse
    .map((l) => ({ ...l, lastDate: lastById.get(l.id) ?? null }))
    .filter((l) => l.lastDate === null || l.lastDate < staleBefore)
}

/** Currencies to convert: listing currencies (major units) and members' base currencies, without EUR. */
export async function currenciesInUse(db: Db): Promise<string[]> {
  const codes = new Set<string>()
  for (const l of await listingsInUse(db)) codes.add(toMajorUnit(l.currency, 1).currency)
  for (const m of await db.selectDistinct({ currency: members.baseCurrency }).from(members)) codes.add(m.currency)
  codes.delete('EUR')
  return [...codes].sort()
}

/** Currencies whose stored reference rates are missing or end before `staleBefore`, with their last day. */
export async function currenciesNeedingFxHistory(
  db: Db,
  currencies: readonly string[],
  staleBefore: string,
): Promise<{ currency: string; lastDate: string | null }[]> {
  if (currencies.length === 0) return []
  const rows = await db
    .select({ currency: fxRates.currency, lastDate: max(fxRates.date) })
    .from(fxRates)
    .where(inArray(fxRates.currency, [...currencies]))
    .groupBy(fxRates.currency)
  const lastByCurrency = new Map(rows.map((r) => [r.currency, r.lastDate]))
  return currencies
    .map((currency) => ({ currency, lastDate: lastByCurrency.get(currency) ?? null }))
    .filter((c) => c.lastDate === null || c.lastDate < staleBefore)
}

export interface QuoteRow {
  listingId: string
  price: number
  previousClose: number | null
  asOf: Date
  source: string
  points: readonly { ts: Date; price: number }[]
}

export async function saveQuotes(db: Db, rows: readonly QuoteRow[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(quotes)
      .values({ listingId: row.listingId, price: row.price, previousClose: row.previousClose, asOf: row.asOf, source: row.source })
      .onConflictDoUpdate({
        target: quotes.listingId,
        set: { price: row.price, previousClose: row.previousClose, asOf: row.asOf, source: row.source, updatedAt: new Date() },
      })
    if (row.points.length > 0) {
      await db
        .insert(intradayPrices)
        .values(row.points.map((p) => ({ listingId: row.listingId, ts: p.ts, price: p.price })))
        .onConflictDoUpdate({ target: [intradayPrices.listingId, intradayPrices.ts], set: { price: sql`excluded.price` } })
    }
  }
}

export async function purgeIntraday(db: Db, before: Date): Promise<void> {
  await db.delete(intradayPrices).where(lt(intradayPrices.ts, before))
}

export interface HistoryRows {
  bars: readonly { date: string; close: number }[]
  dividends: readonly { exDate: string; amount: number }[]
  splits: readonly { date: string; numerator: number; denominator: number; ratio: number }[]
}

const CHUNK = 1000

/** Stores a history in one transaction, so an interruption never leaves a partial history behind. */
export async function saveDailyHistory(db: Db, listingId: string, history: HistoryRows, source: string): Promise<void> {
  await db.transaction(async (t) => {
    for (let i = 0; i < history.bars.length; i += CHUNK) {
      await t
        .insert(dailyPrices)
        .values(history.bars.slice(i, i + CHUNK).map((b) => ({ listingId, date: b.date, close: b.close, source })))
        .onConflictDoUpdate({ target: [dailyPrices.listingId, dailyPrices.date], set: { close: sql`excluded.close`, source: sql`excluded.source` } })
    }
    if (history.dividends.length > 0) {
      await t
        .insert(referenceDividends)
        .values(history.dividends.map((d) => ({ listingId, exDate: d.exDate, amount: d.amount })))
        .onConflictDoUpdate({ target: [referenceDividends.listingId, referenceDividends.exDate], set: { amount: sql`excluded.amount` } })
    }
    if (history.splits.length > 0) {
      await t
        .insert(referenceSplits)
        .values(history.splits.map((s) => ({ listingId, date: s.date, numerator: s.numerator, denominator: s.denominator, ratio: s.ratio })))
        .onConflictDoUpdate({
          target: [referenceSplits.listingId, referenceSplits.date],
          set: { numerator: sql`excluded.numerator`, denominator: sql`excluded.denominator`, ratio: sql`excluded.ratio` },
        })
    }
  })
}

export async function saveFxRates(db: Db, rows: readonly { currency: string; date: string; perEur: number }[]): Promise<void> {
  await db.transaction(async (t) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await t
        .insert(fxRates)
        .values(rows.slice(i, i + CHUNK).map((r) => ({ currency: r.currency, date: r.date, perEur: r.perEur })))
        .onConflictDoUpdate({ target: [fxRates.currency, fxRates.date], set: { perEur: sql`excluded.per_eur` } })
    }
  })
}

export async function saveFxLatest(db: Db, rows: readonly { currency: string; perEur: number; asOf: Date; source: string }[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(fxLatest)
      .values(row)
      .onConflictDoUpdate({ target: fxLatest.currency, set: { perEur: row.perEur, asOf: row.asOf, source: row.source } })
  }
}
