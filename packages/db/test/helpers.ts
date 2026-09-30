import { afterAll, beforeEach, inject } from 'vitest'
import { createDb } from '../src/client.ts'
import { members } from '../src/schema.ts'

/** A database handle for one test file; tables are emptied before every test. */
export function useTestDb() {
  const handle = createDb(inject('databaseUrl'))
  beforeEach(async () => {
    await handle.sql`truncate members, portfolios, benchmarks, tv_devices, pairing_codes, instruments, listings, transactions, fx_rates, login_attempts, quotes, daily_prices, intraday_prices, fx_latest, reference_dividends, reference_splits, dismissed_splits, import_drafts, invites, job_status restart identity cascade`
  })
  afterAll(async () => {
    await handle.sql.end()
  })
  return handle
}

export async function makeMember(db: ReturnType<typeof createDb>['db'], email: string, values: Partial<typeof members.$inferInsert> = {}) {
  const [member] = await db.insert(members).values({ email, status: 'active', ...values }).returning()
  return member!
}
