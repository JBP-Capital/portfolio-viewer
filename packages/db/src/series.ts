import {
  addDays,
  addMonths,
  applyLedger,
  createCloseLookup,
  eachDay,
  holdingsHistory,
  todayInTimeZone,
  toMajorUnit,
  valuationSeries,
  type CloseLookup,
  type DailyPoint,
  type DatedClose,
  type DatedRate,
} from '@pv/core'
import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { listBenchmarks, type Benchmark } from './benchmarks.ts'
import type { Db } from './client.ts'
import { getMember } from './members.ts'
import { getPortfolio, listPortfolios } from './portfolios.ts'
import { dailyPrices, fxLatest, fxRates, instruments, listings, quotes, transactions } from './schema.ts'
import { toLedgerTransaction, type TransactionRow } from './transactions.ts'

/** Benchmarks get this much history even for a young portfolio, for their own 5-year return. */
const BENCHMARK_MONTHS = 60
/** Extra days loaded before the start, so the first day can carry an earlier close forward. */
const LEAD_DAYS = 10

export interface SeriesResult {
  baseCurrency: string
  to: string
  /** First trade date in scope; null without transactions. */
  firstDate: string | null
  /** One point per calendar day from the first trade date to `to`. */
  points: DailyPoint[]
  /** Base-currency closes: instrument ids for held securities, listing ids for benchmarks. */
  close: CloseLookup
  benchmarks: Benchmark[]
}

/**
 * The latest quote or rate wins over a stored close of the same day, as in `valuePortfolio`. A row
 * dated one day after `to` (UTC ahead of the member's time zone) counts for `to`.
 */
function applyLatest<T extends { date: string }>(rows: T[], latest: T, to: string): void {
  if (latest.date > addDays(to, 1)) return
  const row = latest.date > to ? { ...latest, date: to } : latest
  const last = rows.at(-1)
  if (!last || row.date > last.date) rows.push(row)
  else if (row.date === last.date) rows[rows.length - 1] = row
}

interface PricedSeries {
  /** Lookup key: an instrument id (held securities) or a listing id (benchmarks). */
  key: string
  listingId: string
  currency: string
  /** First day whose close is needed. */
  from: string
}

/**
 * Closes (with the latest quote) and rates in the member's base currency for the given series, each
 * loaded from its own first day, up to `to`.
 */
async function loadCloseLookup(db: Db, baseCurrency: string, series: readonly PricedSeries[], to: string): Promise<CloseLookup> {
  const listingIds = [...new Set(series.map((s) => s.listingId))]
  const closesByListing = new Map<string, DatedClose[]>(listingIds.map((id) => [id, []]))
  const earliest = series.reduce((min, s) => (s.from < min ? s.from : min), to)
  if (listingIds.length > 0) {
    const byFrom = new Map<string, string[]>()
    for (const s of series) byFrom.set(s.from, [...(byFrom.get(s.from) ?? []), s.listingId])
    const windows = [...byFrom].map(([from, ids]) => and(inArray(dailyPrices.listingId, ids), gte(dailyPrices.date, from)))
    const stored = await db
      .select({ listingId: dailyPrices.listingId, date: dailyPrices.date, close: dailyPrices.close })
      .from(dailyPrices)
      .where(and(or(...windows), lte(dailyPrices.date, to)))
      .orderBy(asc(dailyPrices.date))
    for (const r of stored) closesByListing.get(r.listingId)!.push({ date: r.date, close: r.close })
    for (const q of await db.select().from(quotes).where(inArray(quotes.listingId, listingIds))) {
      applyLatest(closesByListing.get(q.listingId)!, { date: todayInTimeZone('UTC', q.asOf), close: q.price }, to)
    }
  }

  const currencies = [...new Set([baseCurrency, ...series.map((s) => toMajorUnit(s.currency, 1).currency)])].filter((c) => c !== 'EUR')
  const ratesByCurrency = new Map<string, DatedRate[]>(currencies.map((c) => [c, []]))
  if (currencies.length > 0) {
    const stored = await db
      .select()
      .from(fxRates)
      .where(and(inArray(fxRates.currency, currencies), gte(fxRates.date, earliest), lte(fxRates.date, to)))
      .orderBy(asc(fxRates.date))
    for (const r of stored) ratesByCurrency.get(r.currency)!.push({ date: r.date, perEur: r.perEur })
    for (const l of await db.select().from(fxLatest).where(inArray(fxLatest.currency, currencies))) {
      applyLatest(ratesByCurrency.get(l.currency)!, { date: todayInTimeZone('UTC', l.asOf), perEur: l.perEur }, to)
    }
  }

  return createCloseLookup(
    new Map(series.map((s) => [s.key, { currency: s.currency, closes: closesByListing.get(s.listingId)! }])),
    ratesByCurrency,
    baseCurrency,
  )
}

/**
 * Transfers that cancel out across the member's portfolios: pairs of a transfer out and a transfer in of
 * the same security, day and quantity, such as a move from one portfolio to another (also along a chain
 * of portfolios on one day). Returns their ids.
 */
function offsettingTransfers(rows: readonly TransactionRow[]): Set<string> {
  const key = (r: TransactionRow) => `${r.instrumentId}|${r.tradeDate}|${r.quantity}`
  const legs = new Map<string, { out: string[]; in: string[] }>()
  for (const r of rows) {
    if (r.type !== 'transfer_out' && r.type !== 'transfer_in') continue
    const entry = legs.get(key(r)) ?? { out: [], in: [] }
    entry[r.type === 'transfer_out' ? 'out' : 'in'].push(r.id)
    legs.set(key(r), entry)
  }
  const moves = new Set<string>()
  for (const { out, in: incoming } of legs.values()) {
    const pairs = Math.min(out.length, incoming.length)
    for (let i = 0; i < pairs; i += 1) moves.add(out[i]!).add(incoming[i]!)
  }
  return moves
}

/** The portfolios in scope: one of the member's, or all active ones when `portfolioId` is null. */
async function portfoliosInScope(db: Db, memberId: string, portfolioId: string | null): Promise<string[]> {
  return portfolioId === null ? (await listPortfolios(db, memberId)).map((p) => p.id) : [(await getPortfolio(db, memberId, portfolioId)).id]
}

async function defaultListings(db: Db, instrumentIds: readonly string[]) {
  if (instrumentIds.length === 0) return []
  return db
    .select({ instrumentId: instruments.id, listingId: listings.id, currency: listings.currency })
    .from(instruments)
    .innerJoin(listings, eq(listings.id, instruments.defaultListingId))
    .where(inArray(instruments.id, [...instrumentIds]))
}

/** Ledger keys per portfolio, so a split booked in each portfolio splits only that portfolio's shares. */
const ledgerKey = (portfolioId: string, instrumentId: string) => `${portfolioId}|${instrumentId}`
const instrumentOf = (key: string) => key.slice(key.indexOf('|') + 1)

/**
 * Daily values and returns of one portfolio, or of all active portfolios of the member when
 * `portfolioId` is null. A foreign portfolio id is not found.
 */
export async function memberSeries(
  db: Db,
  memberId: string,
  portfolioId: string | null,
  options: { to?: string; now?: Date } = {},
): Promise<SeriesResult> {
  const member = await getMember(db, memberId)
  const portfolioIds = await portfoliosInScope(db, memberId, portfolioId)
  const to = options.to ?? todayInTimeZone(member.timezone, options.now ?? new Date())
  const rows = portfolioIds.length === 0 ? [] : await db.select().from(transactions).where(inArray(transactions.portfolioId, portfolioIds))
  // Seen across all portfolios, a security moved from one portfolio to another is no money in or out.
  const moves = portfolioId === null ? offsettingTransfers(rows) : new Set<string>()
  const txs = rows.map((r) => ({ ...toLedgerTransaction(r), instrumentId: ledgerKey(r.portfolioId, r.instrumentId), internal: moves.has(r.id) }))
  const firstDate = rows.reduce<string | null>((min, r) => (min === null || r.tradeDate < min ? r.tradeDate : min), null)

  const held = await defaultListings(db, [...new Set(rows.map((r) => r.instrumentId))])
  const benchmarkList = await listBenchmarks(db)
  // Held securities need closes from the first trade; benchmarks also for their own 5-year return.
  const heldFrom = addDays(firstDate ?? to, -LEAD_DAYS)
  const benchmarkStart = addDays(addMonths(to, -BENCHMARK_MONTHS), -LEAD_DAYS)
  const benchmarkFrom = heldFrom < benchmarkStart ? heldFrom : benchmarkStart
  const close = await loadCloseLookup(
    db,
    member.baseCurrency,
    [
      ...held.map((h) => ({ key: h.instrumentId, listingId: h.listingId, currency: h.currency, from: heldFrom })),
      ...benchmarkList.map((b) => ({ key: b.listingId, listingId: b.listingId, currency: b.currency, from: benchmarkFrom })),
    ],
    to,
  )
  const byPortfolio: CloseLookup = (key, date) => close(instrumentOf(key), date)
  const points = firstDate !== null && firstDate <= to ? valuationSeries(txs, firstDate, to, byPortfolio) : []
  return { baseCurrency: member.baseCurrency, to, firstDate, points, close, benchmarks: benchmarkList }
}

/**
 * Hypothetical: today's holdings valued at each day's close from `from` to `to`, in base currency. Buys,
 * sells and dividends in between are ignored — it shows how the current portfolio would have moved.
 */
export async function hypotheticalSeries(
  db: Db,
  memberId: string,
  portfolioId: string | null,
  options: { from: string; to?: string; now?: Date },
): Promise<{ baseCurrency: string; points: { date: string; value: number }[] }> {
  const member = await getMember(db, memberId)
  const portfolioIds = await portfoliosInScope(db, memberId, portfolioId)
  const to = options.to ?? todayInTimeZone(member.timezone, options.now ?? new Date())
  const rows = portfolioIds.length === 0 ? [] : await db.select().from(transactions).where(inArray(transactions.portfolioId, portfolioIds))
  const quantities = new Map<string, number>()
  for (const [key, position] of applyLedger(rows.map((r) => ({ ...toLedgerTransaction(r), instrumentId: ledgerKey(r.portfolioId, r.instrumentId) })))) {
    if (position.quantity > 0) quantities.set(instrumentOf(key), (quantities.get(instrumentOf(key)) ?? 0) + position.quantity)
  }
  if (quantities.size === 0 || options.from > to) return { baseCurrency: member.baseCurrency, points: [] }
  const held = await defaultListings(db, [...quantities.keys()])
  const from = addDays(options.from, -LEAD_DAYS)
  const close = await loadCloseLookup(
    db,
    member.baseCurrency,
    held.map((h) => ({ key: h.instrumentId, listingId: h.listingId, currency: h.currency, from })),
    to,
  )
  return { baseCurrency: member.baseCurrency, points: holdingsHistory(quantities, eachDay(options.from, to), close) }
}

/** Closes of one listing in its own currency from `from` to `to`, and the latest quote when it is newer. */
export async function listingPrices(db: Db, listingId: string, from: string, to: string): Promise<DatedClose[]> {
  return (await listingsPrices(db, [listingId], from, to)).get(listingId)!
}

/** `listingPrices` for several listings in two queries, by listing id. */
export async function listingsPrices(db: Db, listingIds: readonly string[], from: string, to: string): Promise<Map<string, DatedClose[]>> {
  const closes = new Map<string, DatedClose[]>(listingIds.map((id) => [id, []]))
  if (listingIds.length === 0) return closes
  const stored = await db
    .select({ listingId: dailyPrices.listingId, date: dailyPrices.date, close: dailyPrices.close })
    .from(dailyPrices)
    .where(and(inArray(dailyPrices.listingId, [...listingIds]), gte(dailyPrices.date, from), lte(dailyPrices.date, to)))
    .orderBy(asc(dailyPrices.date))
  for (const r of stored) closes.get(r.listingId)!.push({ date: r.date, close: r.close })
  for (const q of await db.select().from(quotes).where(inArray(quotes.listingId, [...listingIds]))) {
    applyLatest(closes.get(q.listingId)!, { date: todayInTimeZone('UTC', q.asOf), close: q.price }, to)
  }
  return closes
}
