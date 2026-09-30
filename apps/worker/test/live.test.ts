import { createEcbProvider, createYahooProvider } from '@pv/market-data'
import { describe, expect, it } from 'vitest'

// Talks to the real services. Run with: LIVE_MARKET_DATA=1 npm test -w @pv/worker -- live
describe.runIf(process.env.LIVE_MARKET_DATA === '1')('live market data', { timeout: 120_000 }, () => {
  const yahoo = createYahooProvider()

  it('finds Agnico Eagle on the NYSE', async () => {
    expect(await yahoo.search('Agnico Eagle')).toContainEqual(expect.objectContaining({ mic: 'XNYS', symbol: 'AEM' }))
  })

  it('prices the reference portfolio’s exchanges', async () => {
    const refs = [
      { mic: 'XNYS', symbol: 'AEM' },
      { mic: 'OTCM', symbol: 'LGCXF' },
      { mic: 'XTSX', symbol: 'LG' },
      { mic: 'XTSE', symbol: 'PEY' },
      { mic: 'XLON', symbol: 'FRES' },
      { mic: 'XASX', symbol: 'RIO' },
      { mic: 'XETR', symbol: '4GLD' },
      { mic: 'XFRA', symbol: 'AE9' },
    ]
    const quotes = await yahoo.quotes(refs)
    expect(quotes.map((q) => q.ref.symbol).sort()).toEqual(refs.map((r) => r.symbol).sort())
    expect(await yahoo.describe({ mic: 'XLON', symbol: 'FRES' })).toMatchObject({ currency: 'GBX' })
  })

  it('returns Apple’s real close before the 2020 split', async () => {
    const history = await yahoo.dailyHistory({ mic: 'XNAS', symbol: 'AAPL' }, '2020-08-20')
    expect(history.bars.find((b) => b.date === '2020-08-28')!.close).toBeCloseTo(499.24, 0)
  })

  it('reads ECB rates', async () => {
    const rates = await createEcbProvider().dailyRates(['USD', 'CAD', 'GBP', 'AUD'], '2026-09-01')
    expect(new Set(rates.map((r) => r.currency))).toEqual(new Set(['USD', 'CAD', 'GBP', 'AUD']))
  })
})
