import {
  createDb,
  createPortfolio,
  createTransaction,
  dailyPrices,
  fxLatest,
  fxRates,
  listingsInUse,
  members,
  quotes,
  saveDailyHistory,
  saveFxRates,
  upsertListing,
} from '@pv/db'
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { Backoff } from '../src/backoff.ts'
import { backfill, refreshFxDaily, refreshFxLatest, refreshHistory, refreshQuotes, type JobContext } from '../src/jobs.ts'
import { fakeProvider } from './fake-provider.ts'

const { db, sql } = createDb(inject('databaseUrl'))
afterAll(async () => {
  await sql.end()
})
beforeEach(async () => {
  await sql`truncate members, portfolios, instruments, listings, transactions, fx_rates, quotes, daily_prices, intraday_prices, fx_latest, reference_dividends, reference_splits, job_status restart identity cascade`
})

const MONDAY_NY_MORNING = new Date('2026-09-28T15:00:00Z') // 11:00 New York, 01:00 Sydney next day

async function hold(listings: { mic: string; symbol: string; currency: string }[]) {
  const [member] = await db.insert(members).values({ email: 'owner@example.com', status: 'active' }).returning()
  const portfolio = await createPortfolio(db, member!.id, { name: 'Main' })
  for (const l of listings) {
    const { instrumentId } = await upsertListing(db, { name: l.symbol, ...l })
    await createTransaction(db, member!.id, {
      portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: l.currency, quantity: 1, price: 1, fxRate: 1,
    })
  }
}

function context(fake: ReturnType<typeof fakeProvider>, now = MONDAY_NY_MORNING): JobContext {
  return { db, provider: fake.provider, fxHistory: fake.fxHistory, now: () => now, log: () => {}, backoff: new Backoff() }
}

describe('worker jobs', () => {
  it('polls only listings whose exchange is open', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XASX', symbol: 'RIO', currency: 'AUD' }])
    const fake = fakeProvider()
    expect(await refreshQuotes(context(fake))).toBe(1)
    expect(fake.calls.quotes.flat().map((r) => r.symbol)).toEqual(['AEM'])
    expect(await db.select().from(quotes)).toHaveLength(1)
  })

  it('polls nothing on a weekend', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    const fake = fakeProvider()
    expect(await refreshQuotes(context(fake, new Date('2026-09-26T15:00:00Z')))).toBe(0)
    expect(fake.calls.quotes).toEqual([])
  })

  it('keeps the quotes of the other listings when one symbol has no answer', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XNYS', symbol: 'GONE', currency: 'USD' }])
    const fake = fakeProvider({ failSymbols: ['GONE'] })
    expect(await refreshQuotes(context(fake))).toBe(1)
  })

  it('backfills ten years once per listing and continues past a failing listing', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XNYS', symbol: 'GONE', currency: 'USD' }])
    const fake = fakeProvider({ failSymbols: ['GONE'] })
    const first = await backfill(context(fake))
    expect(first).toEqual({ listings: 1, currencies: 1, failures: ['XNYS:GONE: no data for GONE'] })
    expect(fake.calls.history.find((c) => c.ref.symbol === 'AEM')!.from).toBe('2016-09-28')
    // The bar of 2026-09-28 is still trading at 11:00 New York and must not be stored as a close.
    expect((await db.select().from(dailyPrices)).map((p) => p.date)).toEqual(['2026-09-25'])
    expect(fake.fxCalls).toEqual([{ currencies: ['USD'], from: '2016-09-28' }])
    await backfill(context(fake))
    expect(fake.calls.history.filter((c) => c.ref.symbol === 'AEM')).toHaveLength(1)
    expect(fake.fxCalls).toHaveLength(1)
  })

  it('asks for a failing listing again only after a waiting time', async () => {
    await hold([{ mic: 'XNYS', symbol: 'GONE', currency: 'USD' }])
    const fake = fakeProvider({ failSymbols: ['GONE'] })
    const backoff = new Backoff()
    await backfill({ ...context(fake), backoff })
    await backfill({ ...context(fake, new Date(MONDAY_NY_MORNING.getTime() + 2 * 60_000)), backoff })
    expect(fake.calls.history).toHaveLength(1)
    await backfill({ ...context(fake, new Date(MONDAY_NY_MORNING.getTime() + 6 * 60_000)), backoff })
    expect(fake.calls.history).toHaveLength(2)
  })

  it('fills a gap when stored prices and rates end weeks ago (worker was down, listing held again)', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    const [listing] = await listingsInUse(db)
    await saveDailyHistory(db, listing!.id, { bars: [{ date: '2026-08-28', close: 90 }], dividends: [], splits: [] }, 'test')
    await saveFxRates(db, [{ currency: 'USD', date: '2026-08-28', perEur: 1.1 }])
    const fake = fakeProvider()
    await backfill(context(fake))
    expect(fake.calls.history).toEqual([{ ref: { mic: 'XNYS', symbol: 'AEM' }, from: '2026-08-28' }])
    expect(fake.fxCalls).toEqual([{ currencies: ['USD'], from: '2026-08-28' }])
  })

  it('stores the day’s close once the exchange has closed', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    await refreshHistory(context(fakeProvider(), new Date('2026-09-28T21:00:00Z')))
    expect((await db.select().from(dailyPrices)).map((p) => p.date).sort()).toEqual(['2026-09-25', '2026-09-28'])
  })

  it('refreshes the last days of history for every listing in use', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }])
    const fake = fakeProvider()
    expect(await refreshHistory(context(fake))).toEqual({ listings: 1, failures: [] })
    expect(fake.calls.history[0]!.from).toBe('2026-09-18')
  })

  it('keeps the rates of every currency its source publishes, before anything is held', async () => {
    // Otherwise a first purchase in dollars on a new instance finds no rate for its trade date.
    const fake = fakeProvider({ fxCurrencies: ['CHF', 'USD'] })
    expect(await backfill(context(fake))).toEqual({ listings: 0, currencies: 2, failures: [] })
    expect(fake.fxCalls).toEqual([{ currencies: ['CHF', 'USD'], from: '2016-09-28' }])
    await hold([{ mic: 'XLON', symbol: 'FRES', currency: 'GBX' }])
    expect(await refreshFxDaily(context(fake))).toBe(3)
    expect(fake.fxCalls.at(-1)).toEqual({ currencies: ['CHF', 'GBP', 'USD'], from: '2026-09-18' })
    // Intraday rates stay limited to the currencies in use.
    expect(await refreshFxLatest(context(fake))).toBe(1)
    expect(fake.calls.fxLatest).toEqual([['GBP']])
  })

  it('asks again for a currency whose source has stopped publishing only after a waiting time', async () => {
    // The ECB dropped currencies before; a rate that never comes must not be asked for every minute.
    const fake = fakeProvider({ fxCurrencies: ['CHF', 'USD'], fxSilent: ['CHF'] })
    const backoff = new Backoff()
    const first = await backfill({ ...context(fake), backoff })
    expect(first.failures).toEqual(['fx:CHF: no newer rates'])
    expect(await db.select().from(fxRates)).toHaveLength(1) // USD was stored
    const later = (minutes: number) => ({ ...context(fake, new Date(MONDAY_NY_MORNING.getTime() + minutes * 60_000)), backoff })
    await backfill(later(2))
    expect(fake.fxCalls).toEqual([{ currencies: ['CHF', 'USD'], from: '2016-09-28' }])
    await backfill(later(6))
    expect(fake.fxCalls.at(-1)).toEqual({ currencies: ['CHF'], from: '2016-09-28' })
    expect(fake.fxCalls).toHaveLength(2)
  })

  it('stores intraday and daily exchange rates for the currencies in use', async () => {
    await hold([{ mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, { mic: 'XLON', symbol: 'FRES', currency: 'GBX' }])
    const fake = fakeProvider()
    expect(await refreshFxLatest(context(fake))).toBe(2)
    expect(fake.calls.fxLatest).toEqual([['GBP', 'USD']])
    expect(await db.select().from(fxLatest)).toHaveLength(2)
    expect(await refreshFxDaily(context(fake))).toBe(2)
    expect(fake.fxCalls[0]).toEqual({ currencies: ['GBP', 'USD'], from: '2026-09-18' })
    expect(await db.select().from(fxRates)).toHaveLength(2)
  })
})
