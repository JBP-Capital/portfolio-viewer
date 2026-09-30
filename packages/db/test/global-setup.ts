import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'
import { createDb } from '../src/client.ts'
import { runMigrations } from '../src/migrate.ts'

let container: StartedPostgreSqlContainer | undefined

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  const url = container.getConnectionUri()
  const { db, sql } = createDb(url, { max: 1 })
  await runMigrations(db)
  await sql.end()
  project.provide('databaseUrl', url)
}

export async function teardown(): Promise<void> {
  await container?.stop()
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
