import { searchInstruments } from '@pv/db'
import { NextResponse, type NextRequest } from 'next/server'
import { getMember } from '../../../../lib/auth/member.ts'
import { getDb } from '../../../../lib/db.ts'
import { getMarketProvider } from '../../../../lib/market.ts'

export const dynamic = 'force-dynamic'

export interface SearchResult {
  /** Null when the security is not known here yet; POST /api/instruments adds it. */
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

/** Securities known to this instance first, then new ones from the market data provider. */
export async function GET(request: NextRequest) {
  if (!(await getMember())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60)
  if (q.length < 2) return NextResponse.json({ results: [] })
  const known = await searchInstruments(getDb(), q)
  const remote = await getMarketProvider()
    .search(q)
    .catch(() => [])
  const seen = new Set(known.map((k) => `${k.mic}:${k.symbol}`))
  const results: SearchResult[] = [
    ...known.map((k) => ({
      instrumentId: k.instrumentId,
      listingId: k.listingId,
      mic: k.mic,
      symbol: k.symbol,
      name: k.name,
      exchangeName: k.mic,
      type: k.type,
      currency: k.currency,
      sector: null,
    })),
    ...remote
      .filter((r) => !seen.has(`${r.mic}:${r.symbol}`))
      .map((r) => ({
        instrumentId: null,
        listingId: null,
        mic: r.mic,
        symbol: r.symbol,
        name: r.name,
        exchangeName: r.exchangeName,
        type: r.type,
        currency: null,
        sector: r.sector,
      })),
  ]
  return NextResponse.json({ results })
}
