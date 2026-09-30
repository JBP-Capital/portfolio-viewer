import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getInstrumentListing, searchInstruments, upsertListing } from '../src/instruments.ts'
import { instruments } from '../src/schema.ts'
import { useTestDb } from './helpers.ts'

const { db } = useTestDb()

describe('upsertListing', () => {
  it('returns the same listing for the same exchange and symbol', async () => {
    const first = await upsertListing(db, { name: 'Agnico Eagle', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const second = await upsertListing(db, { name: 'Agnico Eagle Mines', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    expect(second).toEqual(first)
  })

  it('attaches a second listing to the instrument with the same ISIN and keeps the first as default', async () => {
    const nyse = await upsertListing(db, { name: 'Agnico Eagle', isin: 'CA0084741085', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    const frankfurt = await upsertListing(db, { name: 'Agnico Eagle', isin: 'CA0084741085', mic: 'XFRA', symbol: 'AE9', currency: 'EUR' })
    expect(frankfurt.instrumentId).toBe(nyse.instrumentId)
    expect(frankfurt.listingId).not.toBe(nyse.listingId)
    const [row] = await db.select().from(instruments).where(eq(instruments.id, nyse.instrumentId))
    expect(row!.defaultListingId).toBe(nyse.listingId)
  })
})

describe('searchInstruments', () => {
  it('finds securities by symbol, name or ISIN', async () => {
    const aem = await upsertListing(db, { name: 'Agnico Eagle Mines', isin: 'CA0084741085', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
    await upsertListing(db, { name: 'SAP SE', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
    for (const query of ['aem', 'agnico', 'CA0084741085']) {
      expect((await searchInstruments(db, query)).map((h) => h.instrumentId)).toEqual([aem.instrumentId])
    }
    expect(await getInstrumentListing(db, aem.instrumentId)).toMatchObject({ symbol: 'AEM', mic: 'XNYS', currency: 'USD', listingId: aem.listingId })
  })
})
