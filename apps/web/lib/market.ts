import { createDemoProvider, createYahooProvider, type MarketDataProvider } from '@pv/market-data'

let provider: MarketDataProvider | undefined

/** The provider used for the security search; the worker uses the same setting for prices. */
export function getMarketProvider(): MarketDataProvider {
  provider ??= process.env.MARKET_DATA_PROVIDER === 'demo' ? createDemoProvider() : createYahooProvider()
  return provider
}
