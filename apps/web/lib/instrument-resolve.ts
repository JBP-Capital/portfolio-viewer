import type { SelectedInstrument } from './portfolio-types.ts'

/** One entry of `GET /api/instruments/search`. */
export interface SearchResult {
  instrumentId: string | null
  listingId: string | null
  mic: string
  symbol: string
  name: string
  exchangeName: string
  type: string
  currency: string | null
  sector: string | null
}

/**
 * Turns a search result into a selectable security. Results found only at the provider are first added
 * to this instance; null when that is refused or the server cannot be reached.
 */
export async function resolveSearchResult(result: SearchResult, fetcher: typeof fetch = fetch): Promise<SelectedInstrument | null> {
  if (result.instrumentId && result.listingId && result.currency) {
    return { instrumentId: result.instrumentId, listingId: result.listingId, name: result.name, symbol: result.symbol, mic: result.mic, currency: result.currency }
  }
  try {
    const response = await fetcher('/api/instruments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mic: result.mic, symbol: result.symbol, sector: result.sector }),
    })
    if (!response.ok) return null
    return (await response.json()) as SelectedInstrument
  } catch {
    return null
  }
}
