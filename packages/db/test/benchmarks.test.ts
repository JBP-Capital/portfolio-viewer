import { describe, expect, it } from 'vitest'
import { DEFAULT_BENCHMARKS, listBenchmarks, seedDefaultBenchmarks } from '../src/benchmarks.ts'
import { listingsInUse } from '../src/market.ts'
import { useTestDb } from './helpers.ts'

const { db } = useTestDb()

const known = new Set(['EUNL', 'SXR8', '4GLD'])
const describeKnown = async (ref: { mic: string; symbol: string }) =>
  known.has(ref.symbol) ? { name: `${ref.symbol} ETF`, currency: 'EUR', type: 'etf' as const } : null

describe('benchmarks', () => {
  it('seeds the defaults the provider knows, in their order, and lists them', async () => {
    expect(DEFAULT_BENCHMARKS.map((b) => b.label)).toEqual(['MSCI World', 'S&P 500', 'DAX', 'Gold'])
    expect(await seedDefaultBenchmarks(db, describeKnown)).toBe(3)
    const list = await listBenchmarks(db)
    expect(list.map((b) => b.label)).toEqual(['MSCI World', 'S&P 500', 'Gold'])
    expect(list[0]).toMatchObject({ currency: 'EUR', listingId: expect.any(String), instrumentId: expect.any(String) })
  })

  it('adds only missing defaults on later runs and survives a provider error', async () => {
    let calls = 0
    const flaky = async (ref: { mic: string; symbol: string }) => {
      calls += 1
      if (ref.symbol === 'SXR8') throw new Error('network')
      return describeKnown(ref)
    }
    expect(await seedDefaultBenchmarks(db, flaky)).toBe(2)
    calls = 0
    expect(await seedDefaultBenchmarks(db, describeKnown)).toBe(1)
    expect(calls).toBe(0)
    expect((await listBenchmarks(db)).map((b) => b.label)).toEqual(['MSCI World', 'S&P 500', 'Gold'])
  })

  it('prices benchmark listings even when nobody holds them', async () => {
    await seedDefaultBenchmarks(db, describeKnown)
    expect((await listingsInUse(db)).map((l) => l.symbol)).toEqual(['4GLD', 'EUNL', 'SXR8'])
  })
})
