import type { DailyHistory, FxHistoryProvider, ListingRef, MarketDataProvider, Quote } from '@pv/market-data'

/** A provider that answers from memory and records every call. */
export function fakeProvider(options: { failSymbols?: string[]; fxCurrencies?: string[]; fxSilent?: string[] } = {}) {
  const calls = { quotes: [] as ListingRef[][], history: [] as { ref: ListingRef; from: string }[], fxLatest: [] as string[][] }
  const fails = (symbol: string) => options.failSymbols?.includes(symbol) ?? false
  const provider: MarketDataProvider = {
    id: 'fake',
    search: async () => [],
    describe: async () => null,
    async quotes(refs) {
      calls.quotes.push([...refs])
      return refs
        .filter((ref) => !fails(ref.symbol))
        .map(
          (ref): Quote => ({
            ref,
            price: 101,
            previousClose: 100,
            asOf: new Date('2026-09-28T15:00:00Z'),
            points: [{ ts: new Date('2026-09-28T15:00:00Z'), price: 101 }],
          }),
        )
    },
    async dailyHistory(ref, from): Promise<DailyHistory> {
      calls.history.push({ ref, from })
      if (fails(ref.symbol)) throw new Error(`no data for ${ref.symbol}`)
      return { bars: [{ date: '2026-09-25', close: 100 }, { date: '2026-09-28', close: 101 }], dividends: [], splits: [] }
    },
    async fxLatest(currencies) {
      calls.fxLatest.push([...currencies])
      return currencies.map((currency) => ({ currency, perEur: 1.1, asOf: new Date('2026-09-28T15:00:00Z') }))
    },
  }
  const fxCalls: { currencies: string[]; from: string }[] = []
  const fxHistory: FxHistoryProvider = {
    id: 'fake-fx',
    currencies: options.fxCurrencies ?? [],
    async dailyRates(currencies, from) {
      fxCalls.push({ currencies: [...currencies], from })
      return currencies.filter((c) => !options.fxSilent?.includes(c)).map((currency) => ({ currency, date: '2026-09-25', perEur: 1.1 }))
    },
  }
  return { provider, fxHistory, calls, fxCalls }
}
