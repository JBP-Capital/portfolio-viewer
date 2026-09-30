import type { InstrumentType } from '@pv/core'
import { asc, eq } from 'drizzle-orm'
import type { Db } from './client.ts'
import { upsertListing } from './instruments.ts'
import { benchmarks, listings } from './schema.ts'

/** EUR-listed, accumulating ETFs on Xetra: real prices every provider has, no index licence needed. */
export const DEFAULT_BENCHMARKS = [
  { mic: 'XETR', symbol: 'EUNL', label: 'MSCI World' },
  { mic: 'XETR', symbol: 'SXR8', label: 'S&P 500' },
  { mic: 'XETR', symbol: 'EXS1', label: 'DAX' },
  { mic: 'XETR', symbol: '4GLD', label: 'Gold' },
] as const

export interface Benchmark {
  listingId: string
  instrumentId: string
  label: string
  currency: string
  position: number
}

export async function listBenchmarks(db: Db): Promise<Benchmark[]> {
  return db
    .select({ listingId: benchmarks.listingId, instrumentId: listings.instrumentId, label: benchmarks.label, currency: listings.currency, position: benchmarks.position })
    .from(benchmarks)
    .innerJoin(listings, eq(listings.id, benchmarks.listingId))
    .orderBy(asc(benchmarks.position))
}

type Describe = (ref: { mic: string; symbol: string }) => Promise<{ name: string; currency: string; type: InstrumentType } | null>

/**
 * Adds the default benchmarks that are not there yet. Ones the provider does not know, or cannot
 * answer for right now, are skipped and tried again on the next run. Returns how many were added.
 */
export async function seedDefaultBenchmarks(db: Db, describe: Describe): Promise<number> {
  const present = new Set(
    (await db.select({ mic: listings.mic, symbol: listings.symbol }).from(benchmarks).innerJoin(listings, eq(listings.id, benchmarks.listingId))).map(
      (l) => `${l.mic}:${l.symbol}`,
    ),
  )
  let added = 0
  for (const [position, b] of DEFAULT_BENCHMARKS.entries()) {
    if (present.has(`${b.mic}:${b.symbol}`)) continue
    const details = await describe({ mic: b.mic, symbol: b.symbol }).catch(() => null)
    if (!details) continue
    const { listingId } = await upsertListing(db, { name: details.name, type: details.type, mic: b.mic, symbol: b.symbol, currency: details.currency })
    await db.insert(benchmarks).values({ listingId, label: b.label, position }).onConflictDoNothing()
    added += 1
  }
  return added
}
