import type { InstrumentType } from '@pv/core'

/** A listing: exchange (ISO MIC) plus the symbol on that exchange. */
export interface ListingRef {
  mic: string
  symbol: string
}

export interface ListingCandidate extends ListingRef {
  name: string
  type: InstrumentType
  exchangeName: string
  sector: string | null
}

export interface ListingDetails extends ListingRef {
  name: string
  /** Stored code, e.g. GBX for London prices in pence. */
  currency: string
  type: InstrumentType
}

export interface QuotePoint {
  ts: Date
  price: number
}

export interface Quote {
  ref: ListingRef
  price: number
  previousClose: number | null
  asOf: Date
  /** Intraday prices of the current session. */
  points: QuotePoint[]
}

export interface DailyBar {
  date: string
  /** Real (unadjusted) close in the listing currency. */
  close: number
}

export interface DividendEvent {
  exDate: string
  amount: number
}

/**
 * A price adjustment the provider calls a split. Ordinary splits have small whole numbers
 * (see `isRegularSplit`); spin-offs show up as e.g. 1281:1000 and change no share count.
 */
export interface SplitEvent {
  date: string
  numerator: number
  denominator: number
  /** numerator / denominator: new shares per old share for an ordinary split. */
  ratio: number
}

export interface DailyHistory {
  bars: DailyBar[]
  dividends: DividendEvent[]
  splits: SplitEvent[]
}

export interface FxQuote {
  currency: string
  /** Units of `currency` per one euro. */
  perEur: number
  asOf: Date
}

export interface FxDailyRate {
  currency: string
  date: string
  perEur: number
}

export interface MarketDataProvider {
  readonly id: string
  search(query: string): Promise<ListingCandidate[]>
  describe(ref: ListingRef): Promise<ListingDetails | null>
  /** Latest prices; listings the provider cannot answer for are left out. */
  quotes(refs: readonly ListingRef[]): Promise<Quote[]>
  dailyHistory(ref: ListingRef, from: string): Promise<DailyHistory>
  fxLatest(currencies: readonly string[]): Promise<FxQuote[]>
}

export interface FxHistoryProvider {
  readonly id: string
  /** Currencies it publishes rates for; their history is kept, so a first transaction in any of them finds its rate. */
  readonly currencies: readonly string[]
  dailyRates(currencies: readonly string[], from: string): Promise<FxDailyRate[]>
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>
