import path from 'node:path'
import { retryWhileDatabaseStarts, runMigrations } from '@pv/db'
import { getDb } from './db.ts'

/**
 * After a host restart Docker starts all containers at once, so the database may still be starting.
 * Migrations are tried again for up to 2 minutes; if they still fail, the process ends and Docker's
 * restart policy starts it again instead of leaving a server that answers every request with an error.
 */
export async function migrateDatabase(): Promise<void> {
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), '../../packages/db/migrations')
  try {
    await retryWhileDatabaseStarts(() => runMigrations(getDb(), dir))
  } catch (error) {
    console.error('[migrate] the database schema could not be brought up to date; exiting so the container restarts', error)
    process.exit(1)
  }
  console.log(`[migrate] database schema is up to date (${dir})`)
}
