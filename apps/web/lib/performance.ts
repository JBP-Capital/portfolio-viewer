import { addDays, benchmarkIndex, benchmarkReturn, cumulativeIndex, downsample, periodReturn, type Period } from '@pv/core'
import type { SeriesResult } from '@pv/db'
import type { ChartPoint, ChartSeries } from '../components/charts/line-chart.tsx'
import { seriesColor } from './chart-palette.ts'
import { rangeStart, type Range } from './ranges.ts'

export const RETURN_PERIODS = ['1M', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const satisfies readonly Period[]

export interface PerformanceView {
  /** Value in base currency over the range. */
  value: ChartPoint[]
  /** The portfolio and every benchmark as an index (100 on the range's base day), in palette order. */
  comparison: ChartSeries[]
  /** Column labels of the returns table: the portfolio, then the benchmarks. */
  columns: string[]
  /** Series colour of each column, the same as in the comparison chart. */
  colors: string[]
  /** One row per period; null where the history does not reach back far enough. */
  returns: { period: (typeof RETURN_PERIODS)[number]; values: (number | null)[] }[]
  /** Value at the end of every month in the range, and on the last day. */
  monthEnds: ChartPoint[]
}

/** Chart and table data for one range; null when there is nothing to show yet. */
export function buildPerformance(
  series: Pick<SeriesResult, 'to' | 'firstDate' | 'points' | 'close' | 'benchmarks'>,
  range: Range,
  portfolioLabel: string,
  maxPoints = 400,
): PerformanceView | null {
  const { to, firstDate, points, close, benchmarks } = series
  if (firstDate === null || points.length === 0) return null
  const start = rangeStart(range, to, firstDate)
  // A range that begins with the first trade compares from the day before it, so the first day's gain counts.
  const base = start === firstDate ? addDays(firstDate, -1) : start
  const shown = points.filter((p) => p.date >= start)
  const sampled = new Set(downsample(shown, maxPoints).map((p) => p.date))
  const pick = (list: ChartPoint[]) => list.filter((p) => p.date === base || sampled.has(p.date))

  const portfolioIndex = cumulativeIndex(points, base)
  if (portfolioIndex[0]?.date !== base) portfolioIndex.unshift({ date: base, value: 100 })
  const dates = portfolioIndex.map((p) => p.date)
  const comparison: ChartSeries[] = [
    { id: 'portfolio', label: portfolioLabel, color: seriesColor(0), points: pick(portfolioIndex) },
    // A benchmark keeps the colour of its slot, even when another benchmark is missing.
    ...benchmarks.map((b) => ({ id: b.listingId, label: b.label, color: seriesColor(b.position + 1), points: pick(benchmarkIndex(close, b.listingId, dates)) })),
  ]

  const beforeFirst = addDays(firstDate, -1)
  const returns = RETURN_PERIODS.map((period) => ({
    period,
    values: [periodReturn(points, period, to), ...benchmarks.map((b) => benchmarkReturn(close, b.listingId, period, to, beforeFirst))],
  }))

  return {
    value: shown.filter((p) => sampled.has(p.date)).map((p) => ({ date: p.date, value: p.value })),
    comparison,
    columns: [portfolioLabel, ...benchmarks.map((b) => b.label)],
    colors: comparison.map((s) => s.color),
    returns,
    monthEnds: monthEnds(shown),
  }
}

/** The value at the end of every month, and on the last day. */
export function monthEnds(points: readonly ChartPoint[]): ChartPoint[] {
  return points
    .filter((p, i) => i === points.length - 1 || points[i + 1]!.date.slice(0, 7) !== p.date.slice(0, 7))
    .map((p) => ({ date: p.date, value: p.value }))
}
