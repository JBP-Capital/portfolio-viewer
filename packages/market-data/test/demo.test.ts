import { describe, expect, it } from 'vitest'
import { createDemoFxProvider, createDemoProvider } from '../src/demo.ts'

describe('demo provider', () => {
  const demo = createDemoProvider()

  it('finds its securities by name and symbol', async () => {
    expect(await demo.search('agnico')).toEqual([expect.objectContaining({ mic: 'XNYS', symbol: 'AEM', type: 'stock' })])
    expect(await demo.describe({ mic: 'XLON', symbol: 'FRES' })).toMatchObject({ currency: 'GBX' })
    expect(await demo.describe({ mic: 'XNYS', symbol: 'NOPE' })).toBeNull()
  })

  it('returns the same history and quotes every time', async () => {
    const a = await demo.dailyHistory({ mic: 'XNYS', symbol: 'AEM' }, '2026-09-01')
    const b = await demo.dailyHistory({ mic: 'XNYS', symbol: 'AEM' }, '2026-09-01')
    expect(a).toEqual(b)
    expect(a.bars.length).toBeGreaterThan(10)
    expect((await demo.quotes([{ mic: 'XNYS', symbol: 'AEM' }]))[0]!.price).toBeGreaterThan(0)
  })

  it('knows the default benchmark ETFs, each on its own price path', async () => {
    for (const symbol of ['EUNL', 'SXR8', 'EXS1', '4GLD']) {
      expect(await demo.describe({ mic: 'XETR', symbol })).toMatchObject({ currency: 'EUR' })
    }
    const eunl = await demo.dailyHistory({ mic: 'XETR', symbol: 'EUNL' }, '2021-01-01')
    const gold = await demo.dailyHistory({ mic: 'XETR', symbol: '4GLD' }, '2021-01-01')
    const growth = (bars: { close: number }[]) => bars.at(-1)!.close / bars[0]!.close
    expect(growth(eunl.bars)).toBeGreaterThan(1.2)
    expect(growth(eunl.bars)).not.toBeCloseTo(growth(gold.bars), 2)
  })

  it('knows fixed exchange rates', async () => {
    expect(await demo.fxLatest(['USD'])).toEqual([expect.objectContaining({ currency: 'USD', perEur: 1.14 })])
    expect(createDemoFxProvider().currencies).toEqual(['USD', 'GBP', 'CAD'])
    const rates = await createDemoFxProvider().dailyRates(['USD'], '2026-09-21')
    expect(rates.length).toBeGreaterThan(0)
    expect(rates.every((r) => r.perEur === 1.14)).toBe(true)
  })
})
