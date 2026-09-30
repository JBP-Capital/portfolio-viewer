import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx

export function createDb(url: string, options: { max?: number } = {}): { db: Db; sql: postgres.Sql } {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} })
  return { db: drizzle({ client, schema }), sql: client }
}
