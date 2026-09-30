import { normalizeCurrencyCode, todayInTimeZone, type InstrumentType } from '@pv/core'
import { defaultFetch, getJson, ProviderError } from './http.ts'
import type { DailyHistory, FetchLike, FxQuote, ListingCandidate, ListingDetails, ListingRef, MarketDataProvider, Quote, QuotePoint } from './types.ts'
import { fromYahooSymbol, toYahooSymbol } from './yahoo-symbols.ts'

const BASE = 'https://query1.finance.yahoo.com'
const HEADERS = { 'User-Agent': 'Mozilla/5.0' }
const SPARK_BATCH = 20

interface SearchResponse {
  quotes?: { symbol: string; exchange: string; quoteType: string; shortname?: string; longname?: string; exchDisp?: string; sector?: string }[]
}

interface ChartResult {
  meta: { currency: string; instrumentType: string; longName?: string; shortName?: string; exchangeTimezoneName: string }
  timestamp?: number[]
  events?: {
    splits?: Record<string, { date: number; numerator: number; denominator: number }>
    dividends?: Record<string, { date: number; amount: number }>
  }
  indicators: { quote: { close?: (number | null)[] }[] }
}

interface ChartResponse {
  chart: { result: ChartResult[] | null }
}

type SparkEntry = { timestamp?: number[]; close?: (number | null)[]; previousClose?: number | null; chartPreviousClose?: number | null }
type SparkResponse = Record<string, SparkEntry>

const TYPES: Record<string, InstrumentType> = { EQUITY: 'stock', ETF: 'etf', MUTUALFUND: 'fund', INDEX: 'index' }

const epochSeconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)

function sessionPoints(entry: SparkEntry): QuotePoint[] {
  return (entry.timestamp ?? []).flatMap((t, i) => {
    const price = entry.close?.[i]
    return typeof price === 'number' && Number.isFinite(price) ? [{ ts: new Date(t * 1000), price }] : []
  })
}

/** Yahoo Finance: free and unofficial; fine for private self-hosting, not licensed for commercial display. */
export function createYahooProvider(fetchImpl: FetchLike = defaultFetch): MarketDataProvider {
  const get = (path: string) => getJson(`${BASE}${path}`, fetchImpl, HEADERS)

  async function chart(ref: ListingRef, query: string): Promise<ChartResult | null> {
    const symbol = toYahooSymbol(ref)
    if (!symbol) return null
    const body = (await get(`/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`)) as ChartResponse
    return body.chart.result?.[0] ?? null
  }

  /**
   * Latest prices in batches. Yahoo answers 404 when it knows no symbol of a batch; such a batch
   * simply has no prices. Other failures only fail the call when no batch succeeded.
   */
  async function spark(symbols: readonly string[], interval: string): Promise<SparkResponse> {
    const result: SparkResponse = {}
    let firstError: unknown
    let succeeded = 0
    for (let i = 0; i < symbols.length; i += SPARK_BATCH) {
      const batch = symbols.slice(i, i + SPARK_BATCH)
      try {
        Object.assign(result, await get(`/v8/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=1d&interval=${interval}`))
        succeeded += 1
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) {
          succeeded += 1
          continue
        }
        firstError ??= error
      }
    }
    if (succeeded === 0 && firstError !== undefined) throw firstError
    return result
  }

  return {
    id: 'yahoo',

    async search(query) {
      const body = (await get(`/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`)) as SearchResponse
      const candidates: ListingCandidate[] = []
      for (const q of body.quotes ?? []) {
        const type = TYPES[q.quoteType]
        const ref = fromYahooSymbol(q.symbol, q.exchange)
        if (!type || !ref) continue
        candidates.push({ ...ref, name: q.longname ?? q.shortname ?? q.symbol, type, exchangeName: q.exchDisp ?? q.exchange, sector: q.sector ?? null })
      }
      return candidates
    },

    async describe(ref) {
      const result = await chart(ref, 'range=5d&interval=1d')
      if (!result) return null
      const details: ListingDetails = {
        ...ref,
        name: result.meta.longName ?? result.meta.shortName ?? ref.symbol,
        currency: normalizeCurrencyCode(result.meta.currency),
        type: TYPES[result.meta.instrumentType] ?? 'other',
      }
      return details
    },

    async quotes(refs) {
      const bySymbol = new Map(refs.flatMap((ref) => {
        const symbol = toYahooSymbol(ref)
        return symbol ? [[symbol, ref] as const] : []
      }))
      if (bySymbol.size === 0) return []
      const body = await spark([...bySymbol.keys()], '5m')
      const quotes: Quote[] = []
      for (const [symbol, ref] of bySymbol) {
        const entry = body[symbol]
        const points = entry ? sessionPoints(entry) : []
        const last = points.at(-1)
        if (!entry || !last) continue
        quotes.push({ ref, price: last.price, previousClose: entry.previousClose ?? entry.chartPreviousClose ?? null, asOf: last.ts, points })
      }
      return quotes
    },

    async dailyHistory(ref, from) {
      const now = Math.floor(Date.now() / 1000)
      const result = await chart(ref, `period1=${epochSeconds(from)}&period2=${now}&interval=1d&events=div%2Csplit`)
      const history: DailyHistory = { bars: [], dividends: [], splits: [] }
      if (!result) return history
      const localDate = (seconds: number) => todayInTimeZone(result.meta.exchangeTimezoneName, new Date(seconds * 1000))
      history.splits = Object.values(result.events?.splits ?? {})
        .filter((s) => Number.isFinite(s.numerator) && Number.isFinite(s.denominator) && s.numerator > 0 && s.denominator > 0)
        .map((s) => ({ date: localDate(s.date), numerator: s.numerator, denominator: s.denominator, ratio: s.numerator / s.denominator }))
        .sort((a, b) => a.date.localeCompare(b.date))
      // Yahoo divides closes before a split by its ratio (for all splits up to today, whatever the
      // requested period); multiplying back gives the real close of that day. The request always
      // runs to today, so every later split is among the events.
      const factorAfter = (date: string) => history.splits.filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1)
      const closes = result.indicators.quote[0]?.close ?? []
      const byDate = new Map<string, number>()
      for (const [i, t] of (result.timestamp ?? []).entries()) {
        const close = closes[i]
        if (typeof close !== 'number' || !Number.isFinite(close)) continue
        const date = localDate(t)
        byDate.set(date, close * factorAfter(date))
      }
      history.bars = [...byDate].map(([date, close]) => ({ date, close }))
      history.dividends = Object.values(result.events?.dividends ?? {}).map((d) => {
        const exDate = localDate(d.date)
        return { exDate, amount: d.amount * factorAfter(exDate) }
      })
      return history
    },

    async fxLatest(currencies) {
      const wanted = currencies.filter((c) => c !== 'EUR')
      if (wanted.length === 0) return []
      const body = await spark(wanted.map((c) => `EUR${c}=X`), '15m')
      const rates: FxQuote[] = []
      for (const currency of wanted) {
        const entry = body[`EUR${currency}=X`]
        const last = entry ? sessionPoints(entry).at(-1) : undefined
        if (last) rates.push({ currency, perEur: last.price, asOf: last.ts })
      }
      return rates
    },
  }
}
