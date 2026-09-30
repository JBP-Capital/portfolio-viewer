import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEcbProvider, parseEcbCsv } from '../src/ecb.ts'

const csv = readFileSync(new URL('./fixtures/ecb-usd-gbp.csv', import.meta.url), 'utf8')

describe('ECB reference rates', () => {
  it('parses one rate per currency and day', () => {
    const rows = parseEcbCsv(csv)
    expect(rows).toContainEqual({ currency: 'USD', date: '2026-09-25', perEur: 1.1403 })
    expect(rows).toContainEqual({ currency: 'GBP', date: '2026-09-25', perEur: 0.86045 })
    expect(new Set(rows.map((r) => r.currency))).toEqual(new Set(['USD', 'GBP']))
  })

  it('asks only for currencies the ECB publishes and never for the euro', async () => {
    const urls: string[] = []
    const ecb = createEcbProvider(async (url) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({}), text: async () => csv }
    })
    await ecb.dailyRates(['USD', 'EUR', 'GBP'], '2026-09-21')
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('D.USD+GBP.EUR.SP00.A')
    expect(urls[0]).toContain('startPeriod=2026-09-21')
    expect(await ecb.dailyRates(['EUR'], '2026-09-21')).toEqual([])
  })

  it('names the 29 currencies it publishes, without the euro', () => {
    const { currencies } = createEcbProvider()
    expect(currencies).toHaveLength(29)
    expect(currencies).toEqual(expect.arrayContaining(['USD', 'GBP', 'CHF', 'CAD', 'JPY', 'ZAR']))
    expect(currencies).not.toContain('EUR')
  })
})
