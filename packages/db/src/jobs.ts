import { eq } from 'drizzle-orm'
import type { Db } from './client.ts'
import { jobStatus } from './schema.ts'

/** Failures a job reports without failing as a whole, e.g. single listings a provider does not know. */
function partialFailures(result: unknown): readonly string[] {
  if (typeof result !== 'object' || result === null || !('failures' in result)) return []
  const failures = (result as { failures: unknown }).failures
  return Array.isArray(failures) ? failures.map(String) : []
}

/** Status writes are best effort: a database hiccup must not crash the worker process. */
async function recordStatus(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    console.error(`[job-status] could not record: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Runs a job and records its outcome in job_status. A result with a non-empty `failures` list counts
 * as a success whose failures are shown as the last error. Never throws.
 */
export async function runJob<T>(db: Db, job: string, fn: () => Promise<T>): Promise<T | undefined> {
  const startedAt = new Date()
  await recordStatus(() =>
    db.insert(jobStatus).values({ job, lastRunAt: startedAt }).onConflictDoUpdate({ target: jobStatus.job, set: { lastRunAt: startedAt } }),
  )
  try {
    const result = await fn()
    const failures = partialFailures(result)
    const now = new Date()
    await recordStatus(() =>
      db
        .update(jobStatus)
        .set(
          failures.length > 0
            ? { lastSuccessAt: now, lastError: `${failures.length} failed: ${failures.join('; ')}`.slice(0, 1000), lastErrorAt: now }
            : { lastSuccessAt: now, lastError: null },
        )
        .where(eq(jobStatus.job, job)),
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordStatus(() => db.update(jobStatus).set({ lastError: message.slice(0, 1000), lastErrorAt: new Date() }).where(eq(jobStatus.job, job)))
    return undefined
  }
}
