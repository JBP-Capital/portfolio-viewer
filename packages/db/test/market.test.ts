import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { upsertListing } from '../src/instruments.ts'
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
} from '../src/market.ts'
import { archivePortfolio, createPortfolio } from '../src/portfolios.ts'
import { dailyPrices, fxLatest, intradayPrices, quotes, referenceDividends, referenceSplits } from '../src/schema.ts'
import { createTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

async function holding(email: string, listing: { mic: string; symbol: string; currency: string }, baseCurrency = 'EUR') {
  const member = await makeMember(db, email, { baseCurrency })
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const { instrumentId, listingId } = await upsertListing(db, { name: listing.symbol, ...listing })
  await createTransaction(db, member.id, {
    portfolioId: portfolio.id, instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: listing.currency, quantity: 1, price: 1, fxRate: 1,
  })
  return { member, portfolio, listingId }
}

describe('market repositories', () => {
  it('lists the listings of securities held in active portfolios only', async () => {
    const aem = await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const fres = await holding('b@example.com', { mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await upsertListing(db, { name: 'Unused', mic: 'XETR', symbol: 'UNU', currency: 'EUR' })
    await archivePortfolio(db, fres.member.id, fres.portfolio.id)
    expect((await listingsInUse(db)).map((l) => l.id)).toEqual([aem.listingId])
  })

  it('collects the currencies in use as major units, without the euro, including base currencies', async () => {
    await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' }, 'CHF')
    await holding('b@example.com', { mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await holding('c@example.com', { mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    expect(await currenciesInUse(db)).toEqual(['CHF', 'GBP', 'USD'])
  })

  it('stores latest quotes with their intraday points and purges old points', async () => {
    const { listingId } = await holding('a@example.com', { mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const asOf = new Date('2026-09-28T15:00:00Z')
    const old = new Date('2026-09-10T15:00:00Z')
    await saveQuotes(db, [{ listingId, price: 101, previousClose: 100, asOf, source: 'test', points: [{ ts: old, price: 99 }, { ts: asOf, price: 101 }] }])
    await saveQuotes(db, [{ listingId, price: 102, previousClose: 100, asOf, source: 'test', points: [{ ts: asOf, price: 102 }] }])
    expect((await db.select().from(quotes))[0]).toMatchObject({ price: 102, previousClose: 100 })
    await purgeIntraday(db, new Date('2026-09-21T00:00:00Z'))
    expect(await db.select().from(intradayPrices)).toHaveLength(1)
  })

  it('stores daily history, dividends and splits and overwrites corrected closes', async () => {
    const { listingId } = await holding('a@example.com', { mic: 'XNAS', symbol: 'AAPL', currency: 'USD' })
    expect(await listingsNeedingHistory(db, '2026-09-18')).toEqual([expect.objectContaining({ id: listingId, lastDate: null })])
    await saveDailyHistory(
      db,
      listingId,
      {
        bars: [{ date: '2020-08-28', close: 499 }],
        dividends: [{ exDate: '2020-08-07', amount: 0.82 }],
        splits: [{ date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 }],
      },
      'test',
    )
    await saveDailyHistory(db, listingId, { bars: [{ date: '2020-08-28', close: 499.23 }], dividends: [], splits: [] }, 'test')
    expect(await db.select().from(dailyPrices).where(eq(dailyPrices.listingId, listingId))).toEqual([{ listingId, date: '2020-08-28', close: 499.23, source: 'test' }])
    expect(await db.select().from(referenceDividends)).toHaveLength(1)
    expect(await db.select().from(referenceSplits)).toEqual([{ listingId, date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 }])
    // History ending in 2020 is a gap to fill, reported with its last stored day.
    expect(await listingsNeedingHistory(db, '2026-09-18')).toEqual([expect.objectContaining({ id: listingId, lastDate: '2020-08-28' })])
    await saveDailyHistory(db, listingId, { bars: [{ date: '2026-09-25', close: 250 }], dividends: [], splits: [] }, 'test')
    expect(await listingsNeedingHistory(db, '2026-09-18')).toEqual([])
  })

  it('stores exchange rates and reports currencies without recent history', async () => {
    await saveFxRates(db, [{ currency: 'USD', date: '2026-09-25', perEur: 1.1403 }])
    await saveFxRates(db, [{ currency: 'USD', date: '2026-09-25', perEur: 1.1404 }])
    await saveFxRates(db, [{ currency: 'CAD', date: '2026-08-01', perEur: 1.6 }])
    await saveFxLatest(db, [{ currency: 'USD', perEur: 1.1392, asOf: new Date(), source: 'test' }])
    expect(await currenciesNeedingFxHistory(db, ['USD', 'GBP', 'CAD'], '2026-09-18')).toEqual([
      { currency: 'GBP', lastDate: null },
      { currency: 'CAD', lastDate: '2026-08-01' },
    ])
    expect((await db.select().from(fxLatest))[0]).toMatchObject({ currency: 'USD', perEur: 1.1392 })
  })
})
