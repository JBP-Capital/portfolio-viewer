import { addDays, eachDay, todayInTimeZone } from '@pv/core'
import type { FxHistoryProvider, ListingDetails, ListingRef, MarketDataProvider } from './types.ts'

interface DemoListing extends ListingDetails {
  exchangeName: string
  sector: string
  price: number
  /** Yearly growth of the price path (0 = flat). */
  drift?: number
  /** Shifts the wave so the demo lines do not move in step. */
  phase?: number
}

const LISTINGS: DemoListing[] = [
  { mic: 'XNYS', symbol: 'AEM', name: 'Agnico Eagle Mines', currency: 'USD', type: 'stock', exchangeName: 'NYSE', sector: 'Basic Materials', price: 150 },
  { mic: 'XETR', symbol: 'SAP', name: 'SAP SE', currency: 'EUR', type: 'stock', exchangeName: 'Xetra', sector: 'Technology', price: 200 },
  { mic: 'XLON', symbol: 'FRES', name: 'Fresnillo plc', currency: 'GBX', type: 'stock', exchangeName: 'London', sector: 'Basic Materials', price: 1500 },
  { mic: 'XTSX', symbol: 'LG', name: 'Lahontan Gold', currency: 'CAD', type: 'stock', exchangeName: 'TSX Venture', sector: 'Basic Materials', price: 0.38 },
  // The default benchmarks.
  { mic: 'XETR', symbol: 'EUNL', name: 'iShares Core MSCI World UCITS ETF', currency: 'EUR', type: 'etf', exchangeName: 'Xetra', sector: 'Funds', price: 100, drift: 0.09, phase: 1 },
  { mic: 'XETR', symbol: 'SXR8', name: 'iShares Core S&P 500 UCITS ETF', currency: 'EUR', type: 'etf', exchangeName: 'Xetra', sector: 'Funds', price: 560, drift: 0.11, phase: 2 },
  { mic: 'XETR', symbol: 'EXS1', name: 'iShares Core DAX UCITS ETF', currency: 'EUR', type: 'etf', exchangeName: 'Xetra', sector: 'Funds', price: 190, drift: 0.07, phase: 3 },
  { mic: 'XETR', symbol: '4GLD', name: 'Xetra-Gold', currency: 'EUR', type: 'etc', exchangeName: 'Xetra', sector: 'Funds', price: 110, drift: 0.1, phase: 4 },
]
const RATES: Record<string, number> = { USD: 1.14, GBP: 0.86, CAD: 1.61 }
const EPOCH = Date.UTC(2000, 0, 1)
/** Trending listings are at their base price on this date. */
const TREND_ANCHOR = Date.UTC(2026, 0, 1)
const YEAR_MS = 365.25 * 86_400_000

const find = (ref: ListingRef) => LISTINGS.find((l) => l.mic === ref.mic && l.symbol === ref.symbol)
/** A smooth, repeatable price path: ±10 % around the base price, optionally on a yearly trend. */
const priceOn = (l: DemoListing, date: string) => {
  const t = Date.parse(`${date}T00:00:00Z`)
  const wave = 1 + 0.1 * Math.sin((t - EPOCH) / 86_400_000 / 40 + (l.phase ?? 0))
  const trend = (1 + (l.drift ?? 0)) ** ((t - TREND_ANCHOR) / YEAR_MS)
  return Number((l.price * wave * trend).toFixed(4))
}
const isWeekday = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
const today = () => todayInTimeZone('UTC', new Date())

/** Fixed demo data: works offline and makes end-to-end tests independent of real markets. */
export function createDemoProvider(): MarketDataProvider {
  return {
    id: 'demo',
    async search(query) {
      const q = query.toLowerCase()
      return LISTINGS.filter((l) => l.name.toLowerCase().includes(q) || l.symbol.toLowerCase() === q).map((l) => ({
        mic: l.mic,
        symbol: l.symbol,
        name: l.name,
        type: l.type,
        exchangeName: l.exchangeName,
        sector: l.sector,
      }))
    },
    async describe(ref) {
      const l = find(ref)
      return l ? { mic: l.mic, symbol: l.symbol, name: l.name, currency: l.currency, type: l.type } : null
    },
    async quotes(refs) {
      const day = today()
      return refs.flatMap((ref) => {
        const l = find(ref)
        return l ? [{ ref, price: priceOn(l, day), previousClose: priceOn(l, addDays(day, -1)), asOf: new Date(), points: [] }] : []
      })
    },
    async dailyHistory(ref, from) {
      const l = find(ref)
      if (!l) return { bars: [], dividends: [], splits: [] }
      const bars = eachDay(from, today())
        .filter(isWeekday)
        .map((date) => ({ date, close: priceOn(l, date) }))
      return { bars, dividends: [], splits: [] }
    },
    async fxLatest(currencies) {
      return currencies.flatMap((currency) => {
        const perEur = RATES[currency]
        return perEur ? [{ currency, perEur, asOf: new Date() }] : []
      })
    },
  }
}

export function createDemoFxProvider(): FxHistoryProvider {
  return {
    id: 'demo',
    currencies: Object.keys(RATES),
    async dailyRates(currencies, from) {
      const days = eachDay(from, today()).filter(isWeekday)
      return currencies.flatMap((currency) => {
        const perEur = RATES[currency]
        return perEur ? days.map((date) => ({ currency, date, perEur })) : []
      })
    },
  }
}
