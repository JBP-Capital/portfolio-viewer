import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../src/errors.ts'
import { dismissSplit, splitSuggestions, valueMember, valuePortfolio } from '../src/holdings.ts'
import { upsertListing } from '../src/instruments.ts'
import { saveDailyHistory, saveFxLatest, saveFxRates, saveQuotes } from '../src/market.ts'
import { archivePortfolio, createPortfolio } from '../src/portfolios.ts'
import { createTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()
const NOW = new Date('2026-09-28T15:00:00Z')

async function portfolioWith(listing: { mic: string; symbol: string; currency: string; name?: string }) {
  const member = await makeMember(db, `${listing.symbol.toLowerCase()}@example.com`)
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const ids = await upsertListing(db, { name: listing.name ?? listing.symbol, ...listing })
  return { member, portfolio, ...ids }
}

describe('valuePortfolio', () => {
  it('values a US position with the latest quote and the intraday dollar rate', async () => {
    const p = await portfolioWith({ mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    await createTransaction(db, p.member.id, {
      portfolioId: p.portfolio.id, instrumentId: p.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'USD', quantity: 10, price: 100, fxRate: 0.9,
    })
    await saveDailyHistory(db, p.listingId, { bars: [{ date: '2026-09-24', close: 118 }, { date: '2026-09-25', close: 120 }], dividends: [], splits: [] }, 't')
    await saveQuotes(db, [{ listingId: p.listingId, price: 123, previousClose: 120, asOf: new Date('2026-09-28T14:55:00Z'), source: 't', points: [] }])
    await saveFxLatest(db, [{ currency: 'USD', perEur: 1.25, asOf: NOW, source: 't' }])
    const v = await valuePortfolio(db, p.member.id, p.portfolio.id, NOW)
    const h = v.holdings[0]!
    expect(h).toMatchObject({ quantity: 10, price: 123, previousClose: 120, priceDate: '2026-09-28' })
    expect(h.fxRate).toBeCloseTo(0.8, 9)
    expect(h.value).toBeCloseTo(984, 6)
    expect(h.dayChange).toBeCloseTo(24, 6)
    expect(h.unrealizedGain).toBeCloseTo(84, 6)
    expect(v.totals.value).toBeCloseTo(984, 6)
  })

  it('values London pence with the pound rate divided by 100', async () => {
    const p = await portfolioWith({ mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await createTransaction(db, p.member.id, {
      portfolioId: p.portfolio.id, instrumentId: p.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'GBX', quantity: 100, price: 1000, fxRate: 0.0115,
    })
    await saveDailyHistory(db, p.listingId, { bars: [{ date: '2026-09-25', close: 1500 }], dividends: [], splits: [] }, 't')
    await saveFxRates(db, [{ currency: 'GBP', date: '2026-09-25', perEur: 0.8 }])
    const h = (await valuePortfolio(db, p.member.id, p.portfolio.id, NOW)).holdings[0]!
    expect(h.fxRate).toBeCloseTo(0.0125, 9)
    expect(h.value).toBeCloseTo(1875, 6)
  })

  it('shows no value for a position whose last price is older than 7 days and keeps it out of totals', async () => {
    const p = await portfolioWith({ mic: 'XETR', symbol: 'OLD', currency: 'EUR' })
    await createTransaction(db, p.member.id, {
      portfolioId: p.portfolio.id, instrumentId: p.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 5, price: 10,
    })
    await saveDailyHistory(db, p.listingId, { bars: [{ date: '2026-09-01', close: 12 }], dividends: [], splits: [] }, 't')
    const v = await valuePortfolio(db, p.member.id, p.portfolio.id, NOW)
    expect(v.holdings[0]).toMatchObject({ price: null, value: null })
    expect(v.totals).toMatchObject({ value: 0, unpriced: 1 })
  })

  it('lists sold-out positions separately with their realized gain', async () => {
    const p = await portfolioWith({ mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    const base = { portfolioId: p.portfolio.id, instrumentId: p.instrumentId, currency: 'EUR' }
    await createTransaction(db, p.member.id, { ...base, type: 'buy', tradeDate: '2026-01-05', quantity: 5, price: 100 })
    await createTransaction(db, p.member.id, { ...base, type: 'sell', tradeDate: '2026-02-05', quantity: 5, price: 120 })
    const v = await valuePortfolio(db, p.member.id, p.portfolio.id, NOW)
    expect(v.holdings).toEqual([])
    expect(v.closed[0]!.realizedGain).toBeCloseTo(100, 9)
    expect(v.totals.realizedGain).toBeCloseTo(100, 9)
  })

  it('treats another member’s portfolio as not found', async () => {
    const p = await portfolioWith({ mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    const other = await makeMember(db, 'other@example.com')
    await expect(valuePortfolio(db, other.id, p.portfolio.id, NOW)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('splitSuggestions', () => {
  it('suggests regular splits after the first purchase until booked or dismissed', async () => {
    const p = await portfolioWith({ mic: 'XNAS', symbol: 'AAPL', currency: 'USD', name: 'Apple' })
    const base = { portfolioId: p.portfolio.id, instrumentId: p.instrumentId, currency: 'USD', fxRate: 0.9 }
    await createTransaction(db, p.member.id, { ...base, type: 'buy', tradeDate: '2020-01-06', quantity: 10, price: 300 })
    await saveDailyHistory(
      db,
      p.listingId,
      {
        bars: [],
        dividends: [],
        splits: [
          { date: '2014-06-09', numerator: 7, denominator: 1, ratio: 7 },
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
          { date: '2023-01-04', numerator: 1281, denominator: 1000, ratio: 1.281 },
        ],
      },
      't',
    )
    expect(await splitSuggestions(db, p.member.id, p.portfolio.id)).toEqual([
      { instrumentId: p.instrumentId, name: 'Apple', date: '2020-08-31', numerator: 4, denominator: 1 },
    ])
    await dismissSplit(db, p.member.id, p.portfolio.id, p.instrumentId, '2020-08-31')
    expect(await splitSuggestions(db, p.member.id, p.portfolio.id)).toEqual([])
  })

  it('does not suggest a split that is already booked', async () => {
    const p = await portfolioWith({ mic: 'XNAS', symbol: 'AAPL', currency: 'USD', name: 'Apple' })
    const base = { portfolioId: p.portfolio.id, instrumentId: p.instrumentId, currency: 'USD', fxRate: 0.9 }
    await createTransaction(db, p.member.id, { ...base, type: 'buy', tradeDate: '2020-01-06', quantity: 10, price: 300 })
    await createTransaction(db, p.member.id, { ...base, type: 'split', tradeDate: '2020-08-31', splitRatio: 4 })
    await saveDailyHistory(db, p.listingId, { bars: [], dividends: [], splits: [{ date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 }] }, 't')
    expect(await splitSuggestions(db, p.member.id, p.portfolio.id)).toEqual([])
  })
})

describe('valueMember', () => {
  it('merges a security held in two portfolios and sums the totals of all active portfolios', async () => {
    const p = await portfolioWith({ mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    const second = await createPortfolio(db, p.member.id, { name: 'Second' })
    const archived = await createPortfolio(db, p.member.id, { name: 'Old' })
    for (const [portfolioId, quantity, price] of [[p.portfolio.id, 10, 100], [second.id, 5, 160], [archived.id, 50, 100]] as const) {
      await createTransaction(db, p.member.id, {
        portfolioId, instrumentId: p.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity, price,
      })
    }
    await archivePortfolio(db, p.member.id, archived.id)
    await saveDailyHistory(db, p.listingId, { bars: [{ date: '2026-09-24', close: 190 }, { date: '2026-09-25', close: 200 }], dividends: [], splits: [] }, 't')
    const v = await valueMember(db, p.member.id, NOW)
    expect(v.portfolios.map((x) => x.portfolioId)).toEqual([p.portfolio.id, second.id])
    expect(v.holdings).toHaveLength(1)
    expect(v.holdings[0]).toMatchObject({ quantity: 15, costBasis: 1800, averageCost: 120, value: 3000, dayChange: 150, unrealizedGain: 1200, country: 'DE' })
    expect(v.totals).toMatchObject({ value: 3000, costOfPriced: 1800, unrealizedGain: 1200, dayChange: 150, unpriced: 0, totalReturn: 1200 })
  })
})
