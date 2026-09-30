import type { InstrumentType } from '@pv/core'
import { and, asc, eq, ilike, or } from 'drizzle-orm'
import type { Db } from './client.ts'
import { assertId, NotFoundError } from './errors.ts'
import { instruments, listings } from './schema.ts'

export interface InstrumentHit {
  instrumentId: string
  listingId: string
  name: string
  isin: string | null
  type: InstrumentType
  mic: string
  symbol: string
  currency: string
}

const hitColumns = {
  instrumentId: instruments.id,
  listingId: listings.id,
  name: instruments.name,
  isin: instruments.isin,
  type: instruments.type,
  mic: listings.mic,
  symbol: listings.symbol,
  currency: listings.currency,
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Securities already known to this instance (with their default listing), by symbol, name or ISIN. */
export async function searchInstruments(db: Db, query: string, limit = 10): Promise<InstrumentHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const like = escapeLike(q)
  return db
    .select(hitColumns)
    .from(instruments)
    .innerJoin(listings, eq(listings.id, instruments.defaultListingId))
    .where(or(ilike(listings.symbol, `${like}%`), ilike(instruments.name, `%${like}%`), eq(instruments.isin, q.toUpperCase())))
    .orderBy(asc(instruments.name))
    .limit(limit)
}

export async function getInstrumentListing(db: Db, instrumentId: string): Promise<InstrumentHit> {
  assertId(instrumentId, 'Security')
  const [hit] = await db
    .select(hitColumns)
    .from(instruments)
    .innerJoin(listings, eq(listings.id, instruments.defaultListingId))
    .where(eq(instruments.id, instrumentId))
  if (!hit) throw new NotFoundError('Security')
  return hit
}

export interface ListingInput {
  name: string
  isin?: string | null
  type?: InstrumentType
  sector?: string | null
  country?: string | null
  mic: string
  symbol: string
  currency: string
}

/** Finds or creates the listing (exchange + symbol) and its instrument; instruments are shared by all members. */
export async function upsertListing(db: Db, input: ListingInput): Promise<{ instrumentId: string; listingId: string }> {
  return db.transaction(async (t) => {
    const [existing] = await t
      .select({ listingId: listings.id, instrumentId: listings.instrumentId })
      .from(listings)
      .where(and(eq(listings.mic, input.mic), eq(listings.symbol, input.symbol)))
    if (existing) return existing

    let instrumentId: string | undefined
    if (input.isin) {
      const [byIsin] = await t.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, input.isin))
      instrumentId = byIsin?.id
    }
    const isNewInstrument = !instrumentId
    if (!instrumentId) {
      const [created] = await t
        .insert(instruments)
        .values({ name: input.name, isin: input.isin ?? null, type: input.type ?? 'stock', sector: input.sector ?? null, country: input.country ?? null })
        .returning({ id: instruments.id })
      instrumentId = created!.id
    }
    const [listing] = await t
      .insert(listings)
      .values({ instrumentId, mic: input.mic, symbol: input.symbol, currency: input.currency })
      .returning({ id: listings.id })
    if (isNewInstrument) await t.update(instruments).set({ defaultListingId: listing!.id }).where(eq(instruments.id, instrumentId))
    return { instrumentId, listingId: listing!.id }
  })
}
