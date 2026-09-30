import { downsample, type DatedClose } from '@pv/core'
import { allocation, type AllocationSlice, type Holding, type MemberValuation, type SeriesResult, type Valuation } from '@pv/db'
import type { ChartPoint } from '../components/charts/line-chart.tsx'
import { buildPerformance, type PerformanceView } from './performance.ts'
import { rangeStart } from './ranges.ts'

export interface TvCard {
  instrumentId: string
  listingId: string
  name: string
  symbol: string
  quantity: number
  currency: string
  price: number | null
  value: number | null
  dayChange: number | null
  dayChangePct: number | null
  /** Base currency. */
  unrealizedGain: number | null
  unrealizedPct: number | null
}

export const TV_RANGES = ['1M', '6M', '1Y', '5Y'] as const
export type TvRange = (typeof TV_RANGES)[number]
export const ALLOCATION_KINDS = ['sector', 'currency', 'country'] as const

/** Everything the TV shows, serializable for the client; built from the dashboard's repositories. */
export interface TvSnapshot {
  baseCurrency: string
  asOf: string
  memberName: string | null
  totals: Valuation['totals']
  holdings: TvCard[]
  portfolios: { id: string; name: string; value: number; dayChange: number; cards: TvCard[] }[]
  value1Y: ChartPoint[]
  performance: { range: TvRange; view: PerformanceView }[]
  allocation: { by: (typeof ALLOCATION_KINDS)[number]; slices: { label: string; share: number; value: number }[] }[]
  movers: { up: TvCard[]; down: TvCard[] }
  /** One year of closes per held listing, in the listing's currency, for the detail of a card. */
  prices: Record<string, ChartPoint[]>
}

const MOVERS = 3
/** Enough for a one-year line on a TV, small enough to reload every few minutes. */
const DETAIL_POINTS = 120

function card(h: Holding): TvCard {
  const before = h.value !== null && h.dayChange !== null ? h.value - h.dayChange : null
  return {
    instrumentId: h.instrumentId,
    listingId: h.listingId,
    name: h.name,
    symbol: h.symbol,
    quantity: h.quantity,
    currency: h.currency,
    price: h.price,
    value: h.value,
    dayChange: h.dayChange,
    dayChangePct: before !== null && before > 0 ? h.dayChange! / before : null,
    unrealizedGain: h.unrealizedGain,
    unrealizedPct: h.unrealizedGain !== null && h.costBasis > 0 ? h.unrealizedGain / h.costBasis : null,
  }
}

export function buildTvSnapshot(input: {
  total: MemberValuation
  portfolios: { id: string; name: string }[]
  series: SeriesResult
  /** Closes of held listings, by listing id. */
  prices: ReadonlyMap<string, readonly DatedClose[]>
  memberName: string | null
  portfolioLabel: string
  allocationLabel: (by: (typeof ALLOCATION_KINDS)[number], slice: AllocationSlice) => string
}): TvSnapshot {
  const { total, series } = input
  const holdings = total.holdings.map(card)
  const valuations = new Map(total.portfolios.map((v) => [v.portfolioId, v]))
  const portfolios = input.portfolios.flatMap((p) => {
    const v = valuations.get(p.id)
    return v ? [{ id: p.id, name: p.name, value: v.totals.value, dayChange: v.totals.dayChange, cards: v.holdings.map(card) }] : []
  })

  // A range the history does not cover would repeat the since-inception chart under another label.
  const first = series.firstDate
  const covered = first === null ? [] : TV_RANGES.filter((r) => rangeStart(r, series.to, null) >= first)
  const ranges: TvRange[] = first === null ? [] : covered.length > 0 ? covered : ['1M']
  const performance = ranges.flatMap((range) => {
    const view = buildPerformance(series, range, input.portfolioLabel, 300)
    return view ? [{ range, view }] : []
  })

  const moving = holdings.filter((c) => c.dayChangePct !== null)
  return {
    baseCurrency: total.baseCurrency,
    asOf: series.to,
    memberName: input.memberName,
    totals: total.totals,
    holdings,
    portfolios,
    value1Y: buildPerformance(series, '1Y', input.portfolioLabel, 300)?.value ?? [],
    performance,
    allocation: ALLOCATION_KINDS.map((by) => ({
      by,
      slices: allocation(total.holdings, by).map((slice) => ({ label: input.allocationLabel(by, slice), share: slice.share, value: slice.value })),
    })),
    movers: {
      up: moving.filter((c) => c.dayChangePct! > 0).sort((a, b) => b.dayChangePct! - a.dayChangePct!).slice(0, MOVERS),
      down: moving.filter((c) => c.dayChangePct! < 0).sort((a, b) => a.dayChangePct! - b.dayChangePct!).slice(0, MOVERS),
    },
    prices: Object.fromEntries(
      [...input.prices].map(([listingId, closes]) => [listingId, downsample(closes, DETAIL_POINTS).map((c) => ({ date: c.date, value: c.close }))]),
    ),
  }
}
