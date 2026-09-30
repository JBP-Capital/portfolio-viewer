import { describe, expect, it } from 'vitest'
import { allocation } from '../src/allocation.ts'
import { NotFoundError } from '../src/errors.ts'
import type { Holding } from '../src/holdings.ts'
import { upsertListing } from '../src/instruments.ts'
import { saveDailyHistory, saveFxLatest, saveFxRates, saveQuotes } from '../src/market.ts'
import { archivePortfolio, createPortfolio } from '../src/portfolios.ts'
import { benchmarks } from '../src/schema.ts'
import { hypotheticalSeries, listingPrices, listingsPrices, memberSeries } from '../src/series.ts'
import { createTransaction } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()
const bars = (list: [string, number][]) => ({ bars: list.map(([date, close]) => ({ date, close })), dividends: [], splits: [] })

async function aemHolder(email = 'a@example.com') {
  const member = await makeMember(db, email)
  const portfolio = await createPortfolio(db, member.id, { name: 'Main' })
  const aem = await upsertListing(db, { name: 'Agnico', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
  await createTransaction(db, member.id, {
    portfolioId: portfolio.id, instrumentId: aem.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'USD', quantity: 10, price: 100, fxRate: 0.8,
  })
  await saveDailyHistory(db, aem.listingId, bars([['2026-01-05', 100], ['2026-01-06', 110], ['2026-01-09', 120]]), 't')
  await saveFxRates(db, [{ currency: 'USD', date: '2026-01-05', perEur: 1.25 }])
  return { member, portfolio, aem }
}

describe('memberSeries', () => {
  it('values every day from the first trade in base currency, carrying closes over the weekend', async () => {
    const { member, portfolio } = await aemHolder()
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-11' })
    expect(s.firstDate).toBe('2026-01-05')
    expect(s.baseCurrency).toBe('EUR')
    expect(s.points.map((p) => p.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11'])
    expect(s.points.map((p) => Number(p.value.toFixed(6)))).toEqual([800, 880, 880, 880, 960, 960, 960])
    expect(s.points[0]!.dailyReturn).toBeCloseTo(0, 9)
    expect(s.points[1]!.dailyReturn).toBeCloseTo(0.1, 9)
  })

  it("uses today's quote and the latest exchange rate for the last day", async () => {
    const { member, portfolio, aem } = await aemHolder()
    await saveQuotes(db, [{ listingId: aem.listingId, price: 130, previousClose: 120, asOf: new Date('2026-01-12T15:00:00Z'), source: 't', points: [] }])
    await saveFxLatest(db, [{ currency: 'USD', perEur: 1.3, asOf: new Date('2026-01-12T15:00:00Z'), source: 't' }])
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-12' })
    expect(s.points.at(-1)!.value).toBeCloseTo(1000, 6)
  })

  it("treats another member's portfolio as not found", async () => {
    const { portfolio } = await aemHolder()
    const other = await makeMember(db, 'b@example.com')
    await expect(memberSeries(db, other.id, portfolio.id, { to: '2026-01-11' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('combines all active portfolios when no portfolio is given', async () => {
    const { member } = await aemHolder()
    const second = await createPortfolio(db, member.id, { name: 'Second' })
    const archived = await createPortfolio(db, member.id, { name: 'Old' })
    const sap = await upsertListing(db, { name: 'SAP', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    await saveDailyHistory(db, sap.listingId, bars([['2026-01-02', 190], ['2026-01-06', 200]]), 't')
    await createTransaction(db, member.id, {
      portfolioId: second.id, instrumentId: sap.instrumentId, type: 'buy', tradeDate: '2026-01-06', currency: 'EUR', quantity: 5, price: 200,
    })
    await createTransaction(db, member.id, {
      portfolioId: archived.id, instrumentId: sap.instrumentId, type: 'buy', tradeDate: '2026-01-02', currency: 'EUR', quantity: 100, price: 190,
    })
    await archivePortfolio(db, member.id, archived.id)
    const s = await memberSeries(db, member.id, null, { to: '2026-01-06' })
    expect(s.firstDate).toBe('2026-01-05')
    expect(s.points.at(-1)!.value).toBeCloseTo(1880, 6)
  })

  it('applies a split once per portfolio when the same security is held in two portfolios', async () => {
    const member = await makeMember(db, 'split@example.com')
    const a = await createPortfolio(db, member.id, { name: 'A' })
    const b = await createPortfolio(db, member.id, { name: 'B' })
    const x = await upsertListing(db, { name: 'X', mic: 'XETR', symbol: 'XXX', currency: 'EUR' })
    await saveDailyHistory(db, x.listingId, bars([['2026-01-05', 100], ['2026-01-06', 100], ['2026-01-07', 25], ['2026-01-08', 25]]), 't')
    for (const portfolio of [a, b]) {
      await createTransaction(db, member.id, {
        portfolioId: portfolio.id, instrumentId: x.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 10, price: 100,
      })
      await createTransaction(db, member.id, { portfolioId: portfolio.id, instrumentId: x.instrumentId, type: 'split', tradeDate: '2026-01-07', currency: 'EUR', splitRatio: 4 })
    }
    const s = await memberSeries(db, member.id, null, { to: '2026-01-08' })
    expect(s.points.map((p) => Number(p.value.toFixed(6)))).toEqual([2000, 2000, 2000, 2000])
    expect(s.points.every((p) => Math.abs(p.dailyReturn) < 1e-9)).toBe(true)
  })

  it('values the last day with the same live rate and quote as the headline total', async () => {
    const { member, portfolio, aem } = await aemHolder()
    await saveFxRates(db, [{ currency: 'USD', date: '2026-01-12', perEur: 1.25 }])
    await saveFxLatest(db, [{ currency: 'USD', perEur: 1.3, asOf: new Date('2026-01-12T17:00:00Z'), source: 't' }])
    await saveQuotes(db, [{ listingId: aem.listingId, price: 130, previousClose: 120, asOf: new Date('2026-01-12T15:00:00Z'), source: 't', points: [] }])
    await saveDailyHistory(db, aem.listingId, bars([['2026-01-12', 128]]), 't')
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-12' })
    expect(s.points.at(-1)!.value).toBeCloseTo(1000, 6)
    expect(s.points.at(-2)!.value).toBeCloseTo(960, 6)
  })

  it("uses a quote dated after the member's today (UTC) for today, like the headline total", async () => {
    const { member, portfolio, aem } = await aemHolder()
    await saveQuotes(db, [{ listingId: aem.listingId, price: 130, previousClose: 120, asOf: new Date('2026-01-13T01:00:00Z'), source: 't', points: [] }])
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-12' })
    expect(s.points.at(-1)!.value).toBeCloseTo(1040, 6)
  })

  it('lists benchmarks and prices them by listing, without failing when they have no closes yet', async () => {
    const { member, portfolio } = await aemHolder()
    const world = await upsertListing(db, { name: 'World', mic: 'XETR', symbol: 'EUNL', currency: 'EUR' })
    const dax = await upsertListing(db, { name: 'DAX', mic: 'XETR', symbol: 'EXS1', currency: 'EUR' })
    await db.insert(benchmarks).values([
      { listingId: world.listingId, label: 'MSCI World', position: 0 },
      { listingId: dax.listingId, label: 'DAX', position: 1 },
    ])
    await saveDailyHistory(db, world.listingId, bars([['2021-01-04', 60], ['2026-01-09', 100]]), 't')
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-11' })
    expect(s.benchmarks.map((b) => b.label)).toEqual(['MSCI World', 'DAX'])
    expect(s.close(world.listingId, '2026-01-11')).toBe(100)
    expect(s.close(world.listingId, '2021-01-05')).toBe(60)
    expect(s.close(dax.listingId, '2026-01-11')).toBeNull()
  })

  it('returns an empty series for a portfolio without transactions', async () => {
    const member = await makeMember(db, 'c@example.com')
    const portfolio = await createPortfolio(db, member.id, { name: 'Empty' })
    const s = await memberSeries(db, member.id, portfolio.id, { to: '2026-01-11' })
    expect(s).toMatchObject({ firstDate: null, points: [] })
  })
})

describe('moves between own portfolios', () => {
  async function moved(quantityIn: number) {
    const member = await makeMember(db, 'move@example.com')
    const a = await createPortfolio(db, member.id, { name: 'A' })
    const b = await createPortfolio(db, member.id, { name: 'B' })
    const x = await upsertListing(db, { name: 'X', mic: 'XETR', symbol: 'XXX', currency: 'EUR' })
    await saveDailyHistory(db, x.listingId, bars([['2026-01-05', 100], ['2026-01-06', 110]]), 't')
    await createTransaction(db, member.id, {
      portfolioId: a.id, instrumentId: x.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 10, price: 100,
    })
    await createTransaction(db, member.id, {
      portfolioId: a.id, instrumentId: x.instrumentId, type: 'transfer_out', tradeDate: '2026-01-06', currency: 'EUR', quantity: 10,
    })
    await createTransaction(db, member.id, {
      portfolioId: b.id, instrumentId: x.instrumentId, type: 'transfer_in', tradeDate: '2026-01-06', currency: 'EUR', quantity: quantityIn, price: 100,
    })
    return { member, a, b }
  }

  it('shows the price change as the day return of all portfolios together', async () => {
    const { member, b } = await moved(10)
    const all = await memberSeries(db, member.id, null, { to: '2026-01-06' })
    expect(all.points.at(-1)!.dailyReturn).toBeCloseTo(0.1, 9)
    // Seen from portfolio B alone, the shares did come in from outside.
    const single = await memberSeries(db, member.id, b.id, { to: '2026-01-06' })
    expect(single.points.at(-1)!.flowIn).toBeCloseTo(1100, 9)
  })

  it('recognises a chain of moves on one day, in any order of the rows', async () => {
    const member = await makeMember(db, 'chain@example.com')
    const [a, b, c] = [await createPortfolio(db, member.id, { name: 'A' }), await createPortfolio(db, member.id, { name: 'B' }), await createPortfolio(db, member.id, { name: 'C' })]
    const x = await upsertListing(db, { name: 'X', mic: 'XETR', symbol: 'XXX', currency: 'EUR' })
    await saveDailyHistory(db, x.listingId, bars([['2026-01-05', 100], ['2026-01-06', 110]]), 't')
    const leg = (portfolioId: string, type: 'transfer_in' | 'transfer_out') =>
      createTransaction(db, member.id, { portfolioId, instrumentId: x.instrumentId, type, tradeDate: '2026-01-06', currency: 'EUR', quantity: 10, price: 100 })
    await createTransaction(db, member.id, { portfolioId: a.id, instrumentId: x.instrumentId, type: 'buy', tradeDate: '2026-01-05', currency: 'EUR', quantity: 10, price: 100 })
    await leg(a.id, 'transfer_out')
    await leg(c.id, 'transfer_in')
    await leg(b.id, 'transfer_in')
    await leg(b.id, 'transfer_out')
    const all = await memberSeries(db, member.id, null, { to: '2026-01-06' })
    expect(all.points.at(-1)!.dailyReturn).toBeCloseTo(0.1, 9)
  })

  it('keeps a transfer that has no matching counterpart a flow', async () => {
    const { member } = await moved(4)
    const all = await memberSeries(db, member.id, null, { to: '2026-01-06' })
    expect(all.points.at(-1)!.dailyReturn).toBeCloseTo((440 + 1100) / (1000 + 440) - 1, 9)
  })
})

describe('hypotheticalSeries', () => {
  it("values today's holdings at each past day's close in base currency, from the day all of them have a price", async () => {
    const { member, portfolio } = await aemHolder()
    const second = await createPortfolio(db, member.id, { name: 'Second' })
    const fres = await upsertListing(db, { name: 'Fresnillo', mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await saveDailyHistory(db, fres.listingId, bars([['2025-12-31', 1000], ['2026-01-06', 1200]]), 't')
    await saveFxRates(db, [{ currency: 'GBP', date: '2025-12-31', perEur: 0.8 }])
    await createTransaction(db, member.id, {
      portfolioId: second.id, instrumentId: fres.instrumentId, type: 'buy', tradeDate: '2026-01-06', currency: 'GBX', quantity: 100, price: 1200, fxRate: 0.0125,
    })
    // No price for weeks: it cannot be valued today, so it stays out of the whole line.
    const stale = await upsertListing(db, { name: 'Stale', mic: 'XETR', symbol: 'STL', currency: 'EUR' })
    await saveDailyHistory(db, stale.listingId, bars([['2025-12-01', 50]]), 't')
    await createTransaction(db, member.id, {
      portfolioId: portfolio.id, instrumentId: stale.instrumentId, type: 'buy', tradeDate: '2025-12-01', currency: 'EUR', quantity: 100, price: 50,
    })

    const h = await hypotheticalSeries(db, member.id, null, { from: '2025-12-31', to: '2026-01-06' })
    expect(h.baseCurrency).toBe('EUR')
    // AEM's first close is 5 January; Fresnillo is 100 × 10 GBP / 0.8 then.
    expect(h.points.map((p) => [p.date, Number(p.value.toFixed(6))])).toEqual([
      ['2026-01-05', 10 * 100 / 1.25 + 100 * 10 / 0.8],
      ['2026-01-06', 10 * 110 / 1.25 + 100 * 12 / 0.8],
    ])
    const single = await hypotheticalSeries(db, member.id, portfolio.id, { from: '2025-12-31', to: '2026-01-06' })
    expect(single.points.map((p) => Number(p.value.toFixed(6)))).toEqual([800, 880])
  })

  it("treats another member's portfolio as not found", async () => {
    const { portfolio } = await aemHolder()
    const other = await makeMember(db, 'other@example.com')
    await expect(hypotheticalSeries(db, other.id, portfolio.id, { from: '2026-01-01', to: '2026-01-06' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('listingPrices', () => {
  it("lists a listing's closes in its own currency, with a newer quote as the last day", async () => {
    const { aem } = await aemHolder()
    await saveQuotes(db, [{ listingId: aem.listingId, price: 130, previousClose: 120, asOf: new Date('2026-01-12T15:00:00Z'), source: 't', points: [] }])
    expect(await listingPrices(db, aem.listingId, '2026-01-06', '2026-01-12')).toEqual([
      { date: '2026-01-06', close: 110 },
      { date: '2026-01-09', close: 120 },
      { date: '2026-01-12', close: 130 },
    ])
    expect(await listingPrices(db, aem.listingId, '2026-01-01', '2026-01-08')).toEqual([
      { date: '2026-01-05', close: 100 },
      { date: '2026-01-06', close: 110 },
    ])
  })

  it('loads several listings at once, each with its own closes', async () => {
    const { aem } = await aemHolder()
    const sap = await upsertListing(db, { name: 'SAP', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    await saveDailyHistory(db, sap.listingId, bars([['2026-01-06', 200]]), 't')
    const prices = await listingsPrices(db, [aem.listingId, sap.listingId], '2026-01-06', '2026-01-08')
    expect(prices.get(aem.listingId)).toEqual([{ date: '2026-01-06', close: 110 }])
    expect(prices.get(sap.listingId)).toEqual([{ date: '2026-01-06', close: 200 }])
    expect(await listingsPrices(db, [], '2026-01-06', '2026-01-08')).toEqual(new Map())
  })
})

const holding = (values: Partial<Holding>): Holding => ({
  instrumentId: 'i', name: 'n', type: 'stock', sector: null, country: null, listingId: 'l', mic: 'XETR', symbol: 's', currency: 'EUR',
  quantity: 1, costBasis: 0, averageCost: null, realizedGain: 0, dividendsNet: 0, price: 1, previousClose: null, priceDate: null,
  fxRate: 1, value: 0, dayChange: null, unrealizedGain: null, ...values,
})

describe('allocation', () => {
  it('groups priced holdings by currency, pence together with pounds', () => {
    const slices = allocation(
      [holding({ currency: 'GBX', value: 30 }), holding({ currency: 'GBP', value: 20 }), holding({ currency: 'USD', value: 50 }), holding({ currency: 'EUR', value: null })],
      'currency',
    )
    expect(slices).toEqual([
      { key: 'GBP', kind: 'group', value: 50, share: 0.5 },
      { key: 'USD', kind: 'group', value: 50, share: 0.5 },
    ])
  })

  it('marks missing sectors as unknown and folds small groups into other', () => {
    const slices = allocation(
      [holding({ sector: 'Tech', value: 50 }), holding({ sector: null, value: 20 }), holding({ sector: 'Energy', value: 20 }), holding({ sector: 'Retail', value: 10 })],
      'sector',
      3,
    )
    expect(slices.map((s) => [s.kind, s.key, s.value])).toEqual([
      ['group', 'Tech', 50],
      ['unknown', '', 20],
      ['other', '', 30],
    ])
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 9)
  })
})
