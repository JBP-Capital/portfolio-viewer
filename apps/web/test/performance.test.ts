import { addDays, eachDay, type CloseLookup, type DailyPoint } from '@pv/core'
import { describe, expect, it } from 'vitest'
import { buildPerformance } from '../lib/performance.ts'

/** A portfolio bought on `first` that grows 0.1 % every day, and one benchmark growing 0.2 % a day since 2020. */
function fixture(first: string, to: string) {
  const points: DailyPoint[] = eachDay(first, to).map((date, i) => ({
    date,
    value: 1000 * 1.001 ** i,
    flowIn: i === 0 ? 1000 : 0,
    flowOut: 0,
    dailyReturn: i === 0 ? 0 : 0.001,
  }))
  const days = (date: string) => (Date.parse(date) - Date.parse('2020-01-01')) / 86_400_000
  const close: CloseLookup = (id, date) => (id === 'world' && date >= '2020-01-01' ? 50 * 1.002 ** days(date) : null)
  return {
    to,
    firstDate: first,
    points,
    close,
    benchmarks: [
      { listingId: 'world', instrumentId: 'w', label: 'MSCI World', currency: 'EUR', position: 0 },
      { listingId: 'dax', instrumentId: 'd', label: 'DAX', currency: 'EUR', position: 1 },
    ],
  }
}

describe('buildPerformance', () => {
  it('shows the chosen range, both lines starting at 0 % on its first day', () => {
    const view = buildPerformance(fixture('2025-01-01', '2026-09-28'), '1M', 'Portfolio')!
    expect(view.value[0]!.date).toBe('2026-08-28')
    expect(view.value.at(-1)!.date).toBe('2026-09-28')
    const [portfolio, world, dax] = view.comparison
    expect(portfolio).toMatchObject({ id: 'portfolio', label: 'Portfolio', color: 'var(--series-1)' })
    expect(portfolio!.points[0]).toEqual({ date: '2026-08-28', value: 100 })
    expect(portfolio!.points.at(-1)!.value).toBeCloseTo(100 * 1.001 ** 31, 6)
    expect(world).toMatchObject({ label: 'MSCI World', color: 'var(--series-2)' })
    expect(world!.points[0]).toEqual({ date: '2026-08-28', value: 100 })
    expect(world!.points.at(-1)!.value).toBeCloseTo(100 * 1.002 ** 31, 6)
    expect(dax).toMatchObject({ color: 'var(--series-3)', points: [] })
  })

  it('starts a young portfolio the day before its first trade and leaves longer periods empty', () => {
    const view = buildPerformance(fixture('2026-07-01', '2026-09-28'), '5Y', 'Portfolio')!
    expect(view.value[0]!.date).toBe('2026-07-01')
    expect(view.comparison[0]!.points[0]).toEqual({ date: '2026-06-30', value: 100 })
    expect(view.columns).toEqual(['Portfolio', 'MSCI World', 'DAX'])
    const row = (period: string) => view.returns.find((r) => r.period === period)!.values
    expect(row('1Y')[0]).toBeNull()
    expect(row('1Y')[1]).toBeCloseTo(1.002 ** 365 - 1, 6)
    expect(row('1Y')[2]).toBeNull()
    expect(row('MAX')[0]).toBeCloseTo(1.001 ** 89 - 1, 6)
    expect(row('MAX')[1]).toBeCloseTo(1.002 ** 90 - 1, 6)
    expect(view.returns.map((r) => r.period)).toEqual(['1M', 'YTD', '1Y', '3Y', '5Y', 'MAX'])
  })

  it('keeps charts light: at most the point limit, always the latest day', () => {
    const view = buildPerformance(fixture('2021-01-01', '2026-09-28'), 'MAX', 'Portfolio', 100)!
    expect(view.value.length).toBeLessThanOrEqual(100)
    expect(view.value.at(-1)!.date).toBe('2026-09-28')
    expect(view.comparison[0]!.points.length).toBeLessThanOrEqual(101)
    expect(view.comparison[0]!.points.at(-1)!.date).toBe('2026-09-28')
  })

  it('lists the value at every month end of the range for the table view', () => {
    const view = buildPerformance(fixture('2026-07-15', '2026-09-28'), 'MAX', 'Portfolio')!
    expect(view.monthEnds.map((p) => p.date)).toEqual(['2026-07-31', '2026-08-31', '2026-09-28'])
  })

  it('keeps each benchmark on its own colour when another benchmark is missing', () => {
    const series = fixture('2026-07-15', '2026-09-28')
    series.benchmarks = [{ ...series.benchmarks[0]!, position: 0 }, { ...series.benchmarks[1]!, label: 'Gold', position: 3 }]
    const view = buildPerformance(series, '1Y', 'Portfolio')!
    expect(view.comparison.map((s) => s.color)).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-5)'])
    expect(view.colors).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-5)'])
  })

  it('has nothing to show without transactions', () => {
    expect(buildPerformance({ ...fixture('2026-07-15', '2026-09-28'), firstDate: null, points: [] }, '1Y', 'Portfolio')).toBeNull()
    expect(addDays('2026-01-01', 1)).toBe('2026-01-02')
  })
})
