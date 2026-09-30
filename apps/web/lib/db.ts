import { createDb, type Db } from '@pv/db'
import { getEnv } from './env.ts'

const holder = globalThis as unknown as { portfolioViewerDb?: Db }

export function getDb(): Db {
  holder.portfolioViewerDb ??= createDb(getEnv().DATABASE_URL).db
  return holder.portfolioViewerDb
}
