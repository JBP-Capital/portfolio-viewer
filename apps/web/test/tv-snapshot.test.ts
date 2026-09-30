import { eachDay, type CloseLookup, type DatedClose } from '@pv/core'
import type { Holding, MemberValuation, PortfolioValuation, SeriesResult } from '@pv/db'
import { describe, expect, it } from 'vitest'
import { buildTvSnapshot } from '../lib/tv-snapshot.ts'

const holding = (values: Partial<Holding>): Holding => ({
  instrumentId: 'i', name: 'n', type: 'stock', sector: null, country: null, listingId: 'l', mic: 'XETR', symbol: 's', currency: 'EUR',
  quantity: 1, costBasis: 0, averageCost: null, realizedGain: 0, dividendsNet: 0, price: 1, previousClose: null, priceDate: null,
  fxRate: 1, value: 0, dayChange: null, unrealizedGain: null, ...values,
})
const totals = { value: 0, costOfPriced: 0, unrealizedGain: 0, dayChange: 0, realizedGain: 0, dividendsNet: 0, unpriced: 0, totalReturn: 0 }

const sap = holding({
  instrumentId: 'sap', listingId: 'l-sap', name: 'SAP', symbol: 'SAP', sector: 'Technology', country: 'DE', value: 2000, dayChange: 40, costBasis: 1500, unrealizedGain: 500,
})
const aem = holding({ instrumentId: 'aem', name: 'Agnico', symbol: 'AEM', currency: 'USD', sector: 'Basic Materials', country: 'US', value: 1000, dayChange: -50 })
const lg = holding({ instrumentId: 'lg', name: 'Lahontan', symbol: 'LG', currency: 'CAD', price: null, value: null })

function input(first: string | null, to = '2026-09-28', prices: ReadonlyMap<string, DatedClose[]> = new Map()) {
  const main: PortfolioValuation = { portfolioId: 'p1', baseCurrency: 'EUR', holdings: [sap, lg], closed: [], totals: { ...totals, value: 2000, dayChange: 40 } }
  const second: PortfolioValuation = { portfolioId: 'p2', baseCurrency: 'EUR', holdings: [aem], closed: [], totals: { ...totals, value: 1000, dayChange: -50 } }
  const total: MemberValuation = { baseCurrency: 'EUR', holdings: [sap, aem, lg], closed: [], totals: { ...totals, value: 3000, dayChange: -10 }, portfolios: [main, second] }
  const points = first === null ? [] : eachDay(first, to).map((date) => ({ date, value: 3000, flowIn: date === first ? 3000 : 0, flowOut: 0, dailyReturn: 0 }))
  const close: CloseLookup = () => null
  const series: SeriesResult = { baseCurrency: 'EUR', to, firstDate: first, points, close, benchmarks: [] }
  return {
    total,
    portfolios: [{ id: 'p2', name: 'Second' }, { id: 'p1', name: 'Main' }],
    series,
    prices,
    memberName: 'Jim',
    portfolioLabel: 'Portfolio',
    allocationLabel: (by: string, slice: { key: string; kind: string }) => `${by}:${slice.kind}:${slice.key}`,
  }
}

describe('buildTvSnapshot', () => {
  it('turns holdings into cards with the day change in percent', () => {
    const tv = buildTvSnapshot(input('2025-01-01'))
    expect(tv.holdings.map((c) => c.symbol)).toEqual(['SAP', 'AEM', 'LG'])
    expect(tv.holdings[0]!.dayChangePct).toBeCloseTo(40 / 1960, 9)
    expect(tv.holdings[1]!.dayChangePct).toBeCloseTo(-50 / 1050, 9)
    expect(tv.holdings[2]!.dayChangePct).toBeNull()
    expect(tv).toMatchObject({ baseCurrency: 'EUR', asOf: '2026-09-28', memberName: 'Jim' })
  })

  it('lists portfolios in the member’s order with their own cards', () => {
    const tv = buildTvSnapshot(input('2025-01-01'))
    expect(tv.portfolios.map((p) => [p.name, p.value, p.cards.length])).toEqual([
      ['Second', 1000, 1],
      ['Main', 2000, 2],
    ])
  })

  it('offers only the ranges the history covers, at least one', () => {
    expect(buildTvSnapshot(input('2025-01-01')).performance.map((p) => p.range)).toEqual(['1M', '6M', '1Y'])
    expect(buildTvSnapshot(input('2026-09-20')).performance.map((p) => p.range)).toEqual(['1M'])
    const value1Y = buildTvSnapshot(input('2025-01-01')).value1Y
    expect(value1Y.length).toBeLessThanOrEqual(300)
    expect([value1Y[0]!.date <= '2025-09-29', value1Y.at(-1)!.date]).toEqual([true, '2026-09-28'])
  })

  it('shows today’s three largest moves each way and the allocation with labels', () => {
    const tv = buildTvSnapshot(input('2025-01-01'))
    expect(tv.movers.up.map((c) => c.symbol)).toEqual(['SAP'])
    expect(tv.movers.down.map((c) => c.symbol)).toEqual(['AEM'])
    const byCurrency = tv.allocation.find((a) => a.by === 'currency')!
    expect(byCurrency.slices.map((s) => s.label)).toEqual(['currency:group:EUR', 'currency:group:USD'])
    expect(byCurrency.slices[0]!.share).toBeCloseTo(2 / 3, 9)
  })

  it('gives each card its unrealized gain and each held listing a thinned-out year of prices', () => {
    const year = eachDay('2025-09-28', '2026-09-28').map((date, i) => ({ date, close: 100 + i }))
    const tv = buildTvSnapshot(input('2025-01-01', '2026-09-28', new Map([['l-sap', year]])))
    expect(tv.holdings[0]).toMatchObject({ listingId: 'l-sap', unrealizedGain: 500, unrealizedPct: 500 / 1500 })
    // No cost (AEM) or no price (LG): no percentage.
    expect(tv.holdings.slice(1).map((c) => c.unrealizedPct)).toEqual([null, null])
    const prices = tv.prices['l-sap']!
    expect(prices.length).toBeLessThanOrEqual(120)
    expect(prices.at(-1)).toEqual({ date: '2026-09-28', value: 100 + year.length - 1 })
    expect(Object.keys(tv.prices)).toEqual(['l-sap'])
  })

  it('does not fail for a member without transactions', () => {
    const tv = buildTvSnapshot(input(null))
    expect(tv.performance).toEqual([])
    expect(tv.value1Y).toEqual([])
  })
})
