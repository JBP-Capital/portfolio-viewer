import { addDays, applyLedger, averageCost, EXCHANGES, isRegularSplit, todayInTimeZone, toMajorUnit, type InstrumentType } from '@pv/core'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import type { Db } from './client.ts'
import { getMember } from './members.ts'
import { getPortfolio, listPortfolios } from './portfolios.ts'
import { dailyPrices, dismissedSplits, fxLatest, fxRates, instruments, listings, quotes, referenceSplits, transactions } from './schema.ts'
import { toLedgerTransaction } from './transactions.ts'

/** A price older than this many days counts as no price. */
const STALE_DAYS = 7

export interface Holding {
  instrumentId: string
  name: string
  type: InstrumentType
  sector: string | null
  /** ISO country of the issuer, else of the listing's exchange. */
  country: string | null
  listingId: string
  mic: string
  symbol: string
  currency: string
  quantity: number
  /** Base currency. */
  costBasis: number
  /** Base currency per share. */
  averageCost: number | null
  realizedGain: number
  dividendsNet: number
  /** Listing currency. */
  price: number | null
  previousClose: number | null
  priceDate: string | null
  /** Base currency units per one unit of the listing currency (minor units included). */
  fxRate: number | null
  value: number | null
  dayChange: number | null
  unrealizedGain: number | null
}

export interface Valuation {
  baseCurrency: string
  /** Quantity > 0, by value descending; positions without a price last. */
  holdings: Holding[]
  /** Sold-out positions, for realized gains and dividends. */
  closed: Holding[]
  totals: {
    value: number
    costOfPriced: number
    unrealizedGain: number
    dayChange: number
    realizedGain: number
    dividendsNet: number
    /** Positions left out of value and gains because they have no current price. */
    unpriced: number
    /** Unrealized gain of priced positions, realized gains and net dividends together. */
    totalReturn: number
  }
}

export interface PortfolioValuation extends Valuation {
  portfolioId: string
}

/** All active portfolios of a member: holdings merged per security, and each portfolio on its own. */
export interface MemberValuation extends Valuation {
  portfolios: PortfolioValuation[]
}

async function perEur(db: Db, currency: string): Promise<number | null> {
  if (currency === 'EUR') return 1
  const [latest] = await db.select({ perEur: fxLatest.perEur }).from(fxLatest).where(eq(fxLatest.currency, currency))
  if (latest) return latest.perEur
  const [daily] = await db.select({ perEur: fxRates.perEur }).from(fxRates).where(eq(fxRates.currency, currency)).orderBy(desc(fxRates.date)).limit(1)
  return daily?.perEur ?? null
}

/** Base units per one unit of `currency` (minor units such as GBX included), or null without a rate. */
async function baseRate(db: Db, currency: string, baseCurrency: string): Promise<number | null> {
  const { currency: major, amount: factor } = toMajorUnit(currency, 1)
  if (major === baseCurrency) return factor
  const [base, quote] = await Promise.all([perEur(db, baseCurrency), perEur(db, major)])
  return base === null || quote === null ? null : (factor * base) / quote
}

/** The newest price: an intraday quote when it is at least as recent as the last daily close. */
async function latestPrice(db: Db, listingId: string, today: string): Promise<{ price: number; previousClose: number | null; date: string } | null> {
  const closes = await db
    .select({ date: dailyPrices.date, close: dailyPrices.close })
    .from(dailyPrices)
    .where(and(eq(dailyPrices.listingId, listingId), lte(dailyPrices.date, today)))
    .orderBy(desc(dailyPrices.date))
    .limit(2)
  const [quote] = await db.select().from(quotes).where(eq(quotes.listingId, listingId))
  const last = closes[0]
  const quoteDate = quote ? todayInTimeZone('UTC', quote.asOf) : null
  if (quote && quoteDate && (!last || quoteDate >= last.date)) {
    const fallbackPrevious = last && last.date < quoteDate ? last.close : (closes[1]?.close ?? null)
    return { price: quote.price, previousClose: quote.previousClose ?? fallbackPrevious, date: quoteDate }
  }
  if (last) return { price: last.close, previousClose: closes[1]?.close ?? null, date: last.date }
  return null
}

export async function valuePortfolio(db: Db, memberId: string, portfolioId: string, now: Date = new Date()): Promise<PortfolioValuation> {
  await getPortfolio(db, memberId, portfolioId)
  const member = await getMember(db, memberId)
  const today = todayInTimeZone(member.timezone, now)
  const rows = await db.select().from(transactions).where(eq(transactions.portfolioId, portfolioId))
  const positions = applyLedger(rows.map(toLedgerTransaction))
  const ids = [...positions.keys()]
  const meta =
    ids.length === 0
      ? []
      : await db
          .select({
            id: instruments.id,
            name: instruments.name,
            type: instruments.type,
            sector: instruments.sector,
            country: instruments.country,
            listingId: listings.id,
            mic: listings.mic,
            symbol: listings.symbol,
            currency: listings.currency,
          })
          .from(instruments)
          .innerJoin(listings, eq(listings.id, instruments.defaultListingId))
          .where(inArray(instruments.id, ids))
  const byId = new Map(meta.map((m) => [m.id, m]))
  const rates = new Map<string, number | null>()
  const all: Holding[] = []
  for (const [instrumentId, p] of positions) {
    const m = byId.get(instrumentId)
    if (!m) continue
    if (!rates.has(m.currency)) rates.set(m.currency, await baseRate(db, m.currency, member.baseCurrency))
    const fxRate = rates.get(m.currency) ?? null
    const latest = p.quantity > 0 ? await latestPrice(db, m.listingId, today) : null
    const fresh = latest && latest.date >= addDays(today, -STALE_DAYS) ? latest : null
    const value = fresh && fxRate !== null ? p.quantity * fresh.price * fxRate : null
    const dayChange = fresh && fxRate !== null && fresh.previousClose !== null ? p.quantity * (fresh.price - fresh.previousClose) * fxRate : null
    all.push({
      instrumentId,
      name: m.name,
      type: m.type,
      sector: m.sector,
      country: m.country ?? EXCHANGES[m.mic]?.country ?? null,
      listingId: m.listingId,
      mic: m.mic,
      symbol: m.symbol,
      currency: m.currency,
      quantity: p.quantity,
      costBasis: p.costBasis,
      averageCost: averageCost(p),
      realizedGain: p.realizedGain,
      dividendsNet: p.dividendsNet,
      price: fresh?.price ?? null,
      previousClose: fresh?.previousClose ?? null,
      priceDate: fresh?.date ?? null,
      fxRate,
      value,
      dayChange,
      unrealizedGain: value === null ? null : value - p.costBasis,
    })
  }
  return { portfolioId, ...summarize(all, member.baseCurrency) }
}

function summarize(all: Holding[], baseCurrency: string): Valuation {
  const holdings = all.filter((h) => h.quantity > 0).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  const closed = all.filter((h) => h.quantity === 0)
  const priced = holdings.filter((h) => h.value !== null)
  const sum = (xs: Holding[], f: (h: Holding) => number) => xs.reduce((s, h) => s + f(h), 0)
  return {
    baseCurrency,
    holdings,
    closed,
    totals: {
      value: sum(priced, (h) => h.value ?? 0),
      costOfPriced: sum(priced, (h) => h.costBasis),
      unrealizedGain: sum(priced, (h) => h.unrealizedGain ?? 0),
      dayChange: sum(priced, (h) => h.dayChange ?? 0),
      realizedGain: sum(all, (h) => h.realizedGain),
      dividendsNet: sum(all, (h) => h.dividendsNet),
      unpriced: holdings.length - priced.length,
      totalReturn: sum(priced, (h) => h.unrealizedGain ?? 0) + sum(all, (h) => h.realizedGain + h.dividendsNet),
    },
  }
}

/** One security's positions in several portfolios as one holding (same listing, so same price and rate). */
function mergeHoldings(parts: Holding[]): Holding {
  const open = parts.filter((h) => h.quantity > 0)
  const first = open[0] ?? parts[0]!
  const total = (xs: Holding[], f: (h: Holding) => number | null): number | null =>
    xs.length > 0 && xs.every((h) => f(h) !== null) ? xs.reduce((s, h) => s + f(h)!, 0) : null
  const quantity = parts.reduce((s, h) => s + h.quantity, 0)
  const costBasis = parts.reduce((s, h) => s + h.costBasis, 0)
  const value = total(open, (h) => h.value)
  return {
    ...first,
    quantity,
    costBasis,
    averageCost: quantity > 0 ? costBasis / quantity : null,
    realizedGain: parts.reduce((s, h) => s + h.realizedGain, 0),
    dividendsNet: parts.reduce((s, h) => s + h.dividendsNet, 0),
    value,
    dayChange: total(open, (h) => h.dayChange),
    unrealizedGain: value === null ? null : value - costBasis,
  }
}

export async function valueMember(db: Db, memberId: string, now: Date = new Date()): Promise<MemberValuation> {
  const member = await getMember(db, memberId)
  const portfolios: PortfolioValuation[] = []
  for (const p of await listPortfolios(db, memberId)) portfolios.push(await valuePortfolio(db, memberId, p.id, now))
  const byInstrument = new Map<string, Holding[]>()
  for (const h of portfolios.flatMap((p) => [...p.holdings, ...p.closed])) byInstrument.set(h.instrumentId, [...(byInstrument.get(h.instrumentId) ?? []), h])
  return { ...summarize([...byInstrument.values()].map(mergeHoldings), member.baseCurrency), portfolios }
}

export interface SplitSuggestion {
  instrumentId: string
  name: string
  date: string
  numerator: number
  denominator: number
}

/** Regular splits reported by the provider after a security was first recorded here, not yet booked or dismissed. */
export async function splitSuggestions(db: Db, memberId: string, portfolioId: string): Promise<SplitSuggestion[]> {
  await getPortfolio(db, memberId, portfolioId)
  const rows = await db.select().from(transactions).where(eq(transactions.portfolioId, portfolioId))
  if (rows.length === 0) return []
  const firstDate = new Map<string, string>()
  const booked = new Set<string>()
  for (const r of rows) {
    const current = firstDate.get(r.instrumentId)
    if (!current || r.tradeDate < current) firstDate.set(r.instrumentId, r.tradeDate)
    if (r.type === 'split') booked.add(`${r.instrumentId}:${r.tradeDate}`)
  }
  const dismissed = new Set(
    (await db.select().from(dismissedSplits).where(eq(dismissedSplits.portfolioId, portfolioId))).map((d) => `${d.instrumentId}:${d.date}`),
  )
  const candidates = await db
    .select({
      instrumentId: instruments.id,
      name: instruments.name,
      date: referenceSplits.date,
      numerator: referenceSplits.numerator,
      denominator: referenceSplits.denominator,
    })
    .from(referenceSplits)
    .innerJoin(instruments, eq(instruments.defaultListingId, referenceSplits.listingId))
    .where(inArray(instruments.id, [...firstDate.keys()]))
  return candidates
    .filter((c) => isRegularSplit(c.numerator, c.denominator))
    .filter((c) => c.date > (firstDate.get(c.instrumentId) ?? '9999-12-31'))
    .filter((c) => !booked.has(`${c.instrumentId}:${c.date}`) && !dismissed.has(`${c.instrumentId}:${c.date}`))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function dismissSplit(db: Db, memberId: string, portfolioId: string, instrumentId: string, date: string): Promise<void> {
  await getPortfolio(db, memberId, portfolioId)
  await db.insert(dismissedSplits).values({ portfolioId, instrumentId, date }).onConflictDoNothing()
}
