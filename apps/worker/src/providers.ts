import {
  createDemoFxProvider,
  createDemoProvider,
  createEcbProvider,
  createYahooProvider,
  type FxHistoryProvider,
  type MarketDataProvider,
} from '@pv/market-data'

export function selectProviders(name: string | undefined): { provider: MarketDataProvider; fxHistory: FxHistoryProvider } {
  switch (name ?? 'yahoo') {
    case 'yahoo':
      return { provider: createYahooProvider(), fxHistory: createEcbProvider() }
    case 'demo':
      return { provider: createDemoProvider(), fxHistory: createDemoFxProvider() }
    default:
      throw new Error(`Unknown MARKET_DATA_PROVIDER "${name}". Supported: yahoo, demo`)
  }
}
