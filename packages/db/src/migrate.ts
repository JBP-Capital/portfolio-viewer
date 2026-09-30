import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.ts'

// Built from the module path rather than `new URL('../migrations', …)`, which bundlers try to resolve as an asset.
export const DEFAULT_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function runMigrations(db: Db, migrationsFolder: string = DEFAULT_MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder })
}
