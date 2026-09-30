import { describe, expect, it } from 'vitest'
import { eachDay } from '../src/dates.ts'
import type { DailyPoint } from '../src/returns.ts'
import { benchmarkIndex, benchmarkReturn, createCloseLookup, cumulativeIndex, downsample, holdingsHistory } from '../src/series.ts'

const prices = new Map([
  ['usd', { currency: 'USD', closes: [{ date: '2026-01-02', close: 100 }, { date: '2026-01-05', close: 110 }] }],
  ['gbx', { currency: 'GBX', closes: [{ date: '2026-01-02', close: 1500 }] }],
  ['eur', { currency: 'EUR', closes: [{ date: '2025-01-02', close: 80 }, { date: '2026-01-02', close: 100 }] }],
])
const rates = new Map([
  ['USD', [{ date: '2026-01-02', perEur: 1.25 }]],
  ['GBP', [{ date: '2026-01-02', perEur: 0.8 }]],
])
const rounded = (points: { value: number }[]) => points.map((p) => Number(p.value.toFixed(6)))

describe('createCloseLookup', () => {
  it('converts closes into the base currency, pence through the pound rate', () => {
    const close = createCloseLookup(prices, rates, 'EUR')
    expect(close('usd', '2026-01-02')).toBeCloseTo(80, 9)
    expect(close('gbx', '2026-01-02')).toBeCloseTo(18.75, 9)
    expect(close('eur', '2026-01-02')).toBe(100)
  })

  it('carries the last close over weekends and holidays, but not beyond 7 days', () => {
    const close = createCloseLookup(prices, rates, 'EUR')
    expect(close('usd', '2026-01-04')).toBeCloseTo(80, 9) // Sunday: Friday's close
    expect(close('gbx', '2026-01-09')).toBeCloseTo(18.75, 9)
    expect(close('gbx', '2026-01-10')).toBeNull()
    expect(close('usd', '2026-01-01')).toBeNull()
    expect(close('unknown', '2026-01-02')).toBeNull()
  })

  it('converts into another base currency through the euro', () => {
    const close = createCloseLookup(prices, rates, 'USD')
    expect(close('eur', '2026-01-02')).toBeCloseTo(125, 9)
    expect(close('usd', '2026-01-05')).toBe(110)
  })

  it('has no value without a rate', () => {
    expect(createCloseLookup(prices, new Map(), 'EUR')('usd', '2026-01-02')).toBeNull()
  })
})

describe('index series', () => {
  it('chains daily returns into an index starting at 100', () => {
    const points: DailyPoint[] = [
      { date: '2026-01-01', value: 0, flowIn: 0, flowOut: 0, dailyReturn: 0 },
      { date: '2026-01-02', value: 1010, flowIn: 1000, flowOut: 0, dailyReturn: 0.01 },
      { date: '2026-01-03', value: 1111, flowIn: 0, flowOut: 0, dailyReturn: 0.1 },
    ]
    expect(rounded(cumulativeIndex(points, '2026-01-01'))).toEqual([100, 101, 111.1])
    expect(rounded(cumulativeIndex(points, '2026-01-02'))).toEqual([100, 110])
  })

  it('indexes a benchmark to 100 from its first available close', () => {
    const close = createCloseLookup(prices, rates, 'EUR')
    const index = benchmarkIndex(close, 'usd', ['2026-01-01', '2026-01-02', '2026-01-05'])
    expect(index.map((p) => p.date)).toEqual(['2026-01-02', '2026-01-05'])
    expect(rounded(index)).toEqual([100, 110])
  })

  it('returns a benchmark period only when its history reaches the start', () => {
    const close = createCloseLookup(prices, rates, 'EUR')
    expect(benchmarkReturn(close, 'eur', '1Y', '2026-01-02')).toBeCloseTo(0.25, 9)
    expect(benchmarkReturn(close, 'usd', '1Y', '2026-01-05')).toBeNull()
    expect(benchmarkReturn(close, 'usd', 'MAX', '2026-01-05', '2026-01-02')).toBeCloseTo(0.1, 9)
    expect(benchmarkReturn(close, 'usd', 'MAX', '2026-01-05')).toBeNull()
  })

  it('downsamples to at most the given number of points, keeping the last', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ date: `d${String(i).padStart(4, '0')}`, value: i }))
    const sampled = downsample(points, 400)
    expect(sampled.length).toBeLessThanOrEqual(400)
    expect(sampled.at(-1)).toEqual(points.at(-1))
    expect(sampled.map((p) => p.date)).toEqual([...sampled.map((p) => p.date)].sort())
    expect(downsample(points.slice(0, 10), 400)).toHaveLength(10)
  })
})

describe('close lookup speed', () => {
  it('answers ten years of daily lookups for 60 dollar positions in well under a second', () => {
    const days = eachDay('2016-01-01', '2025-12-31')
    const closes = days.map((date, i) => ({ date, close: 100 + (i % 50) }))
    const table = new Map(Array.from({ length: 60 }, (_, i) => [`i${i}`, { currency: 'USD', closes }]))
    const close = createCloseLookup(table, new Map([['USD', days.map((date) => ({ date, perEur: 1.1 }))]]), 'EUR')
    const started = performance.now()
    let sum = 0
    for (const date of days) for (let i = 0; i < 60; i += 1) sum += close(`i${i}`, date) ?? 0
    expect(sum).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('holdingsHistory', () => {
  const close = createCloseLookup(prices, rates, 'EUR')

  it('values fixed quantities on the days on which every security has a close', () => {
    const history = holdingsHistory(new Map([['usd', 10], ['gbx', 100]]), ['2026-01-01', '2026-01-02', '2026-01-05'], close)
    expect(history.map((p) => p.date)).toEqual(['2026-01-02', '2026-01-05'])
    expect(history[0]!.value).toBeCloseTo(10 * 80 + 100 * 18.75, 9)
    expect(history[1]!.value).toBeCloseTo(10 * 88 + 100 * 18.75, 9)
  })

  it('leaves out a security without a close on the last day, so it cannot drop out of the line', () => {
    const table = new Map([
      ['fresh', { currency: 'EUR', closes: [{ date: '2026-01-02', close: 10 }, { date: '2026-01-12', close: 11 }] }],
      // Its close of 2 January is too old on 12 January.
      ['gone', { currency: 'EUR', closes: [{ date: '2026-01-02', close: 5 }] }],
    ])
    const history = holdingsHistory(new Map([['fresh', 1], ['gone', 2]]), ['2026-01-02', '2026-01-05', '2026-01-12'], createCloseLookup(table, new Map(), 'EUR'))
    expect(history).toEqual([{ date: '2026-01-02', value: 10 }, { date: '2026-01-05', value: 10 }, { date: '2026-01-12', value: 11 }])
  })

  it('starts where the shortest history starts, so a late listing adds no jump', () => {
    const late = createCloseLookup(new Map([...prices, ['late', { currency: 'EUR', closes: [{ date: '2026-01-05', close: 50 }] }]]), rates, 'EUR')
    const history = holdingsHistory(new Map([['usd', 10], ['late', 1]]), ['2026-01-02', '2026-01-05'], late)
    expect(history.map((p) => p.date)).toEqual(['2026-01-05'])
    expect(history[0]!.value).toBeCloseTo(880 + 50, 9)
  })
})
