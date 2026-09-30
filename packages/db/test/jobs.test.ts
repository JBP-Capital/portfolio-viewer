import { describe, expect, inject, it } from 'vitest'
import { createDb } from '../src/client.ts'
import { runJob } from '../src/jobs.ts'
import { jobStatus } from '../src/schema.ts'
import { useTestDb } from './helpers.ts'

const { db } = useTestDb()

describe('runJob', () => {
  it('records a successful run and returns its result', async () => {
    expect(await runJob(db, 'quotes', async () => 3)).toBe(3)
    const [row] = await db.select().from(jobStatus)
    expect(row).toMatchObject({ job: 'quotes', lastError: null })
    expect(row!.lastSuccessAt).not.toBeNull()
  })

  it('records a run that partly failed as a success with its failures', async () => {
    await runJob(db, 'backfill', async () => ({ listings: 3, failures: ['XNYS:GONE: no data', 'XTSX:OLD: HTTP 404'] }))
    const [row] = await db.select().from(jobStatus)
    expect(row!.lastSuccessAt).not.toBeNull()
    expect(row!.lastError).toBe('2 failed: XNYS:GONE: no data; XTSX:OLD: HTTP 404')
  })

  it('never throws, even when the status cannot be written (database gone)', async () => {
    const gone = createDb(inject('databaseUrl'))
    await gone.sql.end()
    await expect(runJob(gone.db, 'quotes', async () => 5)).resolves.toBe(5)
    await expect(
      runJob(gone.db, 'quotes', async () => {
        throw new Error('provider down')
      }),
    ).resolves.toBeUndefined()
  })

  it('records a failure without throwing', async () => {
    expect(
      await runJob(db, 'history', async () => {
        throw new Error('provider down')
      }),
    ).toBeUndefined()
    const [row] = await db.select().from(jobStatus)
    expect(row).toMatchObject({ job: 'history', lastError: 'provider down', lastSuccessAt: null })
  })
})
