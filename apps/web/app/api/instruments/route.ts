import { INSTRUMENT_TYPES } from '@pv/core'
import { getInstrumentListing, upsertListing } from '@pv/db'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getMember } from '../../../lib/auth/member.ts'
import { getDb } from '../../../lib/db.ts'
import { getMarketProvider } from '../../../lib/market.ts'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  mic: z.string().regex(/^[A-Z0-9]{4}$/),
  symbol: z.string().min(1).max(20),
  sector: z.string().max(80).nullable().optional(),
  type: z.enum(INSTRUMENT_TYPES).optional(),
})

/** Adds a security found through the provider to this instance, or returns it if it is known. */
export async function POST(request: NextRequest) {
  if (!(await getMember())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const details = await getMarketProvider()
    .describe({ mic: parsed.data.mic, symbol: parsed.data.symbol })
    .catch(() => null)
  if (!details) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getDb()
  const { instrumentId } = await upsertListing(db, {
    name: details.name,
    type: parsed.data.type ?? details.type,
    sector: parsed.data.sector ?? null,
    mic: details.mic,
    symbol: details.symbol,
    currency: details.currency,
  })
  const hit = await getInstrumentListing(db, instrumentId)
  return NextResponse.json({ instrumentId, listingId: hit.listingId, name: hit.name, currency: hit.currency, mic: hit.mic, symbol: hit.symbol })
}
