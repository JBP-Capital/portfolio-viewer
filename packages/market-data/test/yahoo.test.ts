import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../src/types.ts'
import { createYahooProvider } from '../src/yahoo.ts'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown

/** Serves recorded responses by URL fragment; any other request answers 404. */
function fakeFetch(routes: Record<string, string>): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const match = Object.keys(routes).find((fragment) => url.includes(fragment))
    if (!match) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    const body = fixture(routes[match]!)
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return Object.assign(fn, { calls })
}

describe('Yahoo provider', () => {
  it('finds listings by name with MIC, type and sector', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v1/finance/search': 'yahoo-search-agnico.json' }))
    const results = await yahoo.search('agnico')
    expect(results).toContainEqual(expect.objectContaining({ mic: 'XNYS', symbol: 'AEM', type: 'stock', sector: 'Basic Materials' }))
    expect(results).toContainEqual(expect.objectContaining({ mic: 'XTSE', symbol: 'AEM' }))
  })

  it('stores London prices in pence as GBX', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/chart/FRES.L': 'yahoo-chart-fres.json' }))
    expect(await yahoo.describe({ mic: 'XLON', symbol: 'FRES' })).toMatchObject({ currency: 'GBX', mic: 'XLON', symbol: 'FRES' })
  })

  it('returns real closes before a split (Apple 4:1 on 2020-08-31)', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/chart/AAPL': 'yahoo-chart-aapl-split.json' }))
    const history = await yahoo.dailyHistory({ mic: 'XNAS', symbol: 'AAPL' }, '2020-08-26')
    const close = (date: string) => history.bars.find((b) => b.date === date)?.close
    expect(close('2020-08-28')).toBeCloseTo(499.24, 1)
    expect(close('2020-08-31')).toBeCloseTo(129.04, 1)
    expect(history.splits).toEqual([{ date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 }])
  })

  it('handles a reverse split and spin-offs reported as splits (GE), including dividends', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/chart/GE': 'yahoo-chart-ge.json' }))
    const history = await yahoo.dailyHistory({ mic: 'XNYS', symbol: 'GE' }, '2021-07-26')
    expect(history.bars.find((b) => b.date === '2021-07-30')!.close).toBeCloseTo(12.95, 1)
    expect(history.dividends.find((d) => d.exDate === '2021-09-24')!.amount).toBeCloseTo(0.08, 3)
    expect(history.splits).toEqual([
      { date: '2021-08-02', numerator: 1, denominator: 8, ratio: 0.125 },
      { date: '2023-01-04', numerator: 1281, denominator: 1000, ratio: 1.281 },
      { date: '2024-04-02', numerator: 1253, denominator: 1000, ratio: 1.253 },
    ])
  })

  it('reads latest prices for several listings in one request', async () => {
    const fetch = fakeFetch({ '/v8/finance/spark': 'yahoo-spark-quotes.json' })
    const yahoo = createYahooProvider(fetch)
    const quotes = await yahoo.quotes([
      { mic: 'XNYS', symbol: 'AEM' },
      { mic: 'XTSX', symbol: 'LG' },
      { mic: 'XLON', symbol: 'FRES' },
    ])
    expect(fetch.calls).toHaveLength(1)
    const lahontan = quotes.find((q) => q.ref.symbol === 'LG')!
    expect(lahontan.ref.mic).toBe('XTSX')
    expect(lahontan.price).toBeGreaterThan(0)
    expect(lahontan.previousClose).toBeGreaterThan(0)
    expect(lahontan.points.length).toBeGreaterThan(0)
  })

  it('skips symbols the provider does not answer for', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/spark': 'yahoo-spark-quotes.json' }))
    const quotes = await yahoo.quotes([{ mic: 'XNYS', symbol: 'AEM' }, { mic: 'XNYS', symbol: 'NOPE' }])
    expect(quotes.map((q) => q.ref.symbol)).toEqual(['AEM'])
  })

  it('keeps the prices of other batches when Yahoo answers one batch with 404', async () => {
    const spark = fixture('yahoo-spark-quotes.json')
    // Yahoo answers 404 when no symbol of a batch is known (checked live).
    const fetch: FetchLike = async (url) =>
      url.includes('symbols=NOPE')
        ? { ok: false, status: 404, json: async () => ({}), text: async () => '' }
        : { ok: true, status: 200, json: async () => spark, text: async () => '' }
    const yahoo = createYahooProvider(fetch)
    const fillers = Array.from({ length: 17 }, (_, i) => ({ mic: 'XNYS', symbol: `FILL${i}` }))
    const refs = [{ mic: 'XNYS', symbol: 'AEM' }, { mic: 'XTSX', symbol: 'LG' }, { mic: 'XLON', symbol: 'FRES' }, ...fillers, { mic: 'XNYS', symbol: 'NOPE' }]
    const quotes = await yahoo.quotes(refs)
    expect(quotes.map((q) => q.ref.symbol).sort()).toEqual(['AEM', 'FRES', 'LG'])
  })

  it('asks nothing for listings on exchanges it does not know', async () => {
    const fetch = fakeFetch({ '/v8/finance/spark': 'yahoo-spark-quotes.json', '/v8/finance/chart': 'yahoo-chart-fres.json' })
    const yahoo = createYahooProvider(fetch)
    const teva = { mic: 'XTAE', symbol: 'TEVA' }
    expect(await yahoo.quotes([teva])).toEqual([])
    expect(await yahoo.dailyHistory(teva, '2026-01-01')).toEqual({ bars: [], dividends: [], splits: [] })
    expect(await yahoo.describe(teva)).toBeNull()
    expect(fetch.calls).toEqual([])
  })

  it('reads intraday exchange rates per euro', async () => {
    const yahoo = createYahooProvider(fakeFetch({ '/v8/finance/spark': 'yahoo-spark-fx.json' }))
    const rates = await yahoo.fxLatest(['USD', 'GBP'])
    expect(rates.map((r) => r.currency).sort()).toEqual(['GBP', 'USD'])
    expect(rates.find((r) => r.currency === 'USD')!.perEur).toBeGreaterThan(0.5)
  })
})
